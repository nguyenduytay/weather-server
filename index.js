require('dotenv').config();
const admin = require("firebase-admin");
const express = require("express");
const app = express();

// Đọc thông tin xác thực từ biến môi trường
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!serviceAccountJson) {
    console.error("❌ Biến môi trường FIREBASE_SERVICE_ACCOUNT không được định nghĩa.");
    process.exit(1);
}

let serviceAccount;
try {
    // Chuyển đổi chuỗi JSON thành object
    serviceAccount = JSON.parse(serviceAccountJson);
} catch (error) {
    console.error("❌ Lỗi khi parse Firebase Service Account:", error);
    process.exit(1);
}
//======================================================
// PHẦN 1: KHỞI TẠO KẾT NỐI FIREBASE
//======================================================

// Khởi tạo ứng dụng Firebase với thông tin xác thực
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL
});

// Khởi tạo các dịch vụ Firebase sẽ sử dụng
const db = admin.database();            // Dịch vụ Realtime Database
const messaging = admin.messaging();    // Dịch vụ Cloud Messaging để gửi thông báo

// Thêm route health check cho Render và UptimeRobot
app.get('/', (req, res) => {
    res.status(200).send('Smart Watering System Server is running 🚀');
});
// Các biến lưu trữ trạng thái toàn cục
let prevWarning = null;       // Lưu cấu hình cảnh báo trước đó để phát hiện thay đổi
let prevWeather = null;       // Lưu dữ liệu thời tiết trước đó để phát hiện thay đổi
let cachedFcmToken = null;    // Lưu token FCM để gửi thông báo không cần truy vấn liên tục

// Tham chiếu đến node cấu hình tưới trong Firebase
const wateringRef = db.ref("/watering");



//======================================================
// PHẦN 2: CHỨC NĂNG CẢNH BÁO MÔI TRƯỜNG
//======================================================

/**
 * Hàm gửi thông báo cảnh báo khi các điều kiện môi trường vượt ngưỡng
 * @param {Array} changes - Danh sách các trường dữ liệu đã thay đổi
 * @param {Object} warning - Cấu hình ngưỡng cảnh báo
 * @param {Object} weatherData - Dữ liệu thời tiết và môi trường hiện tại
 */
async function sendNotification(changes, warning, weatherData) {
    // Mảng chứa các thông báo sẽ gửi
    const messages = [];

    // Kiểm tra cảnh báo NHIỆT ĐỘ CAO
    if (changes.includes("tempStatusMax") || changes.includes("tempMax") || changes.includes("temperature")) {
        // Điều kiện: Trạng thái cảnh báo = BẬT (1) và nhiệt độ vượt ngưỡng
        if (Number(warning.tempStatusMax) === 1 && weatherData.temperature > (warning.tempMax - 100)) {
            messages.push(`🌡️ Nhiệt độ ${weatherData.temperature}°C quá cao!`);
        }
    }

    // Kiểm tra cảnh báo NHIỆT ĐỘ THẤP
    if (changes.includes("tempStatusMin") || changes.includes("tempMin") || changes.includes("temperature")) {
        // Điều kiện: Trạng thái cảnh báo = BẬT (1) và nhiệt độ dưới ngưỡng
        if (Number(warning.tempStatusMin) === 1 && weatherData.temperature < (warning.tempMin - 100)) {
            messages.push(`🌡️ Nhiệt độ ${weatherData.temperature}°C quá thấp!`);
        }
    }

    // Kiểm tra cảnh báo ĐỘ ẨM KHÔNG KHÍ CAO
    if (changes.includes("humidityAirStatusMax") || changes.includes("humidityAirMax") || changes.includes("humidity")) {
        // Điều kiện: Trạng thái cảnh báo = BẬT (1) và độ ẩm không khí vượt ngưỡng
        if (Number(warning.humidityAirStatusMax) === 1 && weatherData.humidity > warning.humidityAirMax) {
            messages.push(`💧 Độ ẩm không khí ${weatherData.humidity}% quá cao!`);
        }
    }

    // Kiểm tra cảnh báo ĐỘ ẨM KHÔNG KHÍ THẤP
    if (changes.includes("humidityAirStatusMin") || changes.includes("humidityAirMin") || changes.includes("humidity")) {
        // Điều kiện: Trạng thái cảnh báo = BẬT (1) và độ ẩm không khí dưới ngưỡng
        if (Number(warning.humidityAirStatusMin) === 1 && weatherData.humidity < warning.humidityAirMin) {
            messages.push(`💧 Độ ẩm không khí ${weatherData.humidity}% quá thấp!`);
        }
    }

    // Kiểm tra cảnh báo ĐỘ ẨM ĐẤT CAO
    if (changes.includes("humidityLandStatusMax") || changes.includes("humidityLandMax") || changes.includes("humidityLand")) {
        // Điều kiện: Trạng thái cảnh báo = BẬT (1) và độ ẩm đất vượt ngưỡng
        if (Number(warning.humidityLandStatusMax) === 1 && weatherData.humidityLand > warning.humidityLandMax) {
            messages.push(`🌱 Độ ẩm đất ${weatherData.humidityLand}% quá cao!`);
        }
    }

    // Kiểm tra cảnh báo ĐỘ ẨM ĐẤT THẤP
    if (changes.includes("humidityLandStatusMin") || changes.includes("humidityLandMin") || changes.includes("humidityLand")) {
        // Điều kiện: Trạng thái cảnh báo = BẬT (1) và độ ẩm đất dưới ngưỡng
        if (Number(warning.humidityLandStatusMin) === 1 && weatherData.humidityLand < warning.humidityLandMin) {
            messages.push(`🌱 Độ ẩm đất ${weatherData.humidityLand}% quá thấp!`);
        }
    }

    // Nếu không có cảnh báo nào được kích hoạt, thoát khỏi hàm
    if (messages.length === 0) return;

    // Nếu có FCM token để gửi thông báo
    if (warning.fcmToken) {
        // Lưu token vào biến toàn cục để sử dụng sau này
        cachedFcmToken = warning.fcmToken;

        try {
            // Gửi thông báo qua Firebase Cloud Messaging
            await messaging.send({
                token: warning.fcmToken,
                notification: {
                    title: "⚠️ Cảnh báo môi trường",
                    body: messages.join("\n"),  // Gộp tất cả thông báo thành 1 nội dung
                },
            });
            console.log("✅ Đã gửi thông báo:", messages);
        } catch (error) {
            console.error("❌ Lỗi khi gửi thông báo:", error);
        }
    }
}



//======================================================
// PHẦN 3: CHỨC NĂNG TƯỚI NƯỚC TỰ ĐỘNG THEO ĐỘ ẨM ĐẤT
//======================================================

// Biến lưu trạng thái cuối cùng của hệ thống tưới
let lastWateringStatus = null;

/**
 * Hàm xử lý cập nhật trạng thái tưới nước dựa trên độ ẩm đất
 * @param {Object} watering - Cấu hình tưới nước
 * @param {Object} weatherData - Dữ liệu thời tiết hiện tại
 */
async function handleWateringUpdate(watering, weatherData) {
    // Kiểm tra dữ liệu đầu vào
    if (!watering || !weatherData) return;

    // Khai báo biến lưu trạng thái
    let newStatus = null;  // Trạng thái mới của hệ thống tưới (0: TẮT, 1: BẬT)
    let message = null;    // Thông báo sẽ được gửi

    // Kiểm tra nếu chức năng tưới tự động THEO ĐỘ ẨM ĐẤT được BẬT
    if (watering.status_humidity_land === 1) {
        // Logic tưới: BẬT khi độ ẩm đất THỰC TẾ < ngưỡng cài đặt
        if (weatherData.humidityLand < watering.humidity_land) {
            newStatus = 1; // BẬT hệ thống tưới
            message = `🚰 Hệ thống tưới nước tự động đã BẬT do độ ẩm đất thấp (${weatherData.humidityLand}% < ${watering.humidity_land}%)`;
        } else {
            newStatus = 0; // TẮT hệ thống tưới
            message = `✅ Hệ thống tưới nước tự động đã TẮT do độ ẩm đất đủ (${weatherData.humidityLand}% >= ${watering.humidity_land}%)`;
        }
    } else {
        // Nếu chức năng tưới tự động TẮT, đảm bảo hệ thống tưới cũng TẮT
        newStatus = 0;
        message = "✅ Hệ thống tưới nước tự động đã TẮT do chế độ tự động tắt";
    }

    // Chỉ cập nhật và thông báo khi có sự thay đổi trạng thái
    // So sánh với trạng thái cuối và trạng thái hiện tại trong database
    if (newStatus !== lastWateringStatus && newStatus !== watering.status) {
        console.log(`🔄 Cập nhật trạng thái tưới: ${lastWateringStatus} -> ${newStatus}`);

        try {
            // Cập nhật trạng thái vào Firebase
            await wateringRef.update({ status: newStatus });
            lastWateringStatus = newStatus;  // Cập nhật biến lưu trạng thái

            // Gửi thông báo nếu có FCM token
            if (cachedFcmToken) {
                await messaging.send({
                    token: cachedFcmToken,
                    notification: {
                        title: "💧 Cập nhật hệ thống tưới nước tự động",
                        body: message,
                    },
                });
                console.log("📩 Đã gửi thông báo:", message);
            }
        } catch (error) {
            console.error("❌ Lỗi khi cập nhật trạng thái tưới:", error);
        }
    }
}



//======================================================
// PHẦN 4: CHỨC NĂNG TƯỚI NƯỚC THEO HẸN GIỜ VÀ THEO THỨ TRONG TUẦN
//======================================================

// Biến theo dõi trạng thái hẹn giờ
let isInWateringTime = false;
let scheduledTimerCheck = null; // Biến lưu trữ timeout ID

/**
 * Hàm kiểm tra xem ngày hiện tại có thuộc thứ được hẹn không
 * @param {string} scheduleDays - Chuỗi chứa các thứ được hẹn (T2, T3, T4, T5, T6, T7, CN)
 * @returns {boolean} - True nếu hôm nay thuộc lịch hẹn, False nếu không thuộc
 */
function isScheduledDay(scheduleDays) {
    // Nếu không có lịch theo thứ hoặc lịch là "daily" thì luôn trả về true (tưới mỗi ngày)
    if (!scheduleDays || scheduleDays.toLowerCase() === "mỗi ngày" || scheduleDays.toLowerCase() === "hàng ngày") {
        return true;
    }

    // Lấy thứ hiện tại (0: Chủ nhật, 1: Thứ 2, 2: Thứ 3, ..., 6: Thứ 7)
    const today = new Date().getDay();

    // Chuyển đổi giá trị today sang định dạng T2, T3, ..., CN cho dễ so sánh
    let todayStr;
    switch (today) {
        case 0: todayStr = "CN"; break;
        case 1: todayStr = "T2"; break;
        case 2: todayStr = "T3"; break;
        case 3: todayStr = "T4"; break;
        case 4: todayStr = "T5"; break;
        case 5: todayStr = "T6"; break;
        case 6: todayStr = "T7"; break;
    }

    // Kiểm tra xem thứ hiện tại có trong chuỗi lịch hẹn không
    return scheduleDays.includes(todayStr);
}

/**
 * Hàm tạo chuỗi giờ:phút từ số phút
 * @param {number} minutes - Số phút 
 * @returns {string} - Chuỗi định dạng "HH:MM"
 */
function formatTimeStr(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Hàm kiểm tra và cập nhật trạng thái tưới theo thời gian đã hẹn
 * @param {Object} watering - Cấu hình tưới nước
 */
async function checkWateringTimer(watering) {
    // Kiểm tra cấu hình thời gian và trạng thái timer
    if (!watering || watering.timer_start === undefined || watering.timer_end === undefined || watering.status_timer !== 1) {
        console.log("Không thỏa điều kiện cơ bản để tưới theo lịch");
        return;
    }

    try {
        // Kiểm tra xem hôm nay có thuộc lịch hẹn tưới không
        if (!isScheduledDay(watering.repeat)) {
            console.log("Hôm nay không thuộc lịch tưới:", watering.repeat);

            // Nếu hôm nay không thuộc lịch hẹn tưới và hệ thống đang bật
            if (watering.status === 1 && isInWateringTime) {
                // Tắt hệ thống tưới
                isInWateringTime = false;
                await wateringRef.update({ status: 0 });
                lastWateringStatus = 0;

                // Gửi thông báo tắt hệ thống
                if (cachedFcmToken) {
                    await messaging.send({
                        token: cachedFcmToken,
                        notification: {
                            title: "⏰ Cập nhật hệ thống tưới theo lịch",
                            body: `⏰ Hệ thống tưới tự động TẮT do hôm nay không thuộc lịch tưới`,
                        },
                    });
                    console.log("📩 Đã gửi thông báo: Tắt hệ thống tưới do không thuộc lịch");
                }
            }
            return; // Không tiếp tục kiểm tra thời gian
        }

        // Lấy thời gian hiện tại và chuyển đổi thành số phút
        const now = new Date();
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentInMinutes = currentHours * 60 + currentMinutes;

        // Xử lý timer_start và timer_end dựa trên kiểu dữ liệu
        let startInMinutes, endInMinutes;

        if (typeof watering.timer_start === 'string' && typeof watering.timer_end === 'string') {
            // Nếu là chuỗi "HH:MM", chuyển đổi thành số phút
            const [startHours, startMinutes] = watering.timer_start.split(':').map(Number);
            const [endHours, endMinutes] = watering.timer_end.split(':').map(Number);
            startInMinutes = startHours * 60 + startMinutes;
            endInMinutes = endHours * 60 + endMinutes;
        } else {
            // Nếu đã là số phút, sử dụng trực tiếp
            startInMinutes = Number(watering.timer_start);
            endInMinutes = Number(watering.timer_end);
        }

        console.log(`⏰ Kiểm tra thời gian tưới: hiện tại = ${currentInMinutes} phút (${formatTimeStr(currentInMinutes)}), bắt đầu = ${startInMinutes} phút (${formatTimeStr(startInMinutes)}), kết thúc = ${endInMinutes} phút (${formatTimeStr(endInMinutes)})`);

        // Kiểm tra xem thời gian hiện tại có nằm trong khoảng thời gian tưới hay không
        const shouldBeWatering = currentInMinutes >= startInMinutes && currentInMinutes < endInMinutes;

        // Chỉ xử lý khi trạng thái thay đổi so với lần kiểm tra trước
        if (shouldBeWatering !== isInWateringTime) {
            console.log(`🔄 Trạng thái tưới thay đổi: ${isInWateringTime} -> ${shouldBeWatering}`);

            // Cập nhật biến trạng thái
            isInWateringTime = shouldBeWatering;

            // Xác định trạng thái và thông báo dựa vào kết quả kiểm tra
            let newStatus = shouldBeWatering ? 1 : 0;  // 1: BẬT, 0
            // : TẮT

            const startTimeStr = formatTimeStr(startInMinutes);
            const endTimeStr = formatTimeStr(endInMinutes);

            // Lấy thông tin về lịch theo thứ để hiển thị
            const scheduleInfo = watering.repeat
                ? ` theo lịch (${watering.repeat || "Hàng ngày"})`
                : " hàng ngày";

            let message = shouldBeWatering
                ? `⏰ Hệ thống tưới tự động BẬT${scheduleInfo} (${startTimeStr} - ${endTimeStr})`
                : `⏰ Hệ thống tưới tự động TẮT (kết thúc ${endTimeStr})`;

            console.log(message);

            // Cập nhật trạng thái vào Firebase
            await wateringRef.update({ status: newStatus });
            lastWateringStatus = newStatus;

            // Gửi thông báo nếu có FCM token
            if (cachedFcmToken) {
                await messaging.send({
                    token: cachedFcmToken,
                    notification: {
                        title: "⏰ Cập nhật hệ thống tưới theo lịch",
                        body: message,
                    },
                });
                console.log("📩 Đã gửi thông báo timer:", message);
            }
        }

        // Tính toán thời gian cho lần thay đổi trạng thái tiếp theo
        scheduleNextTimerCheck(watering);

    } catch (error) {
        console.error("❌ Lỗi khi xử lý timer:", error);
        console.log("Dữ liệu timer:", {
            timer_start: watering.timer_start,
            timer_end: watering.timer_end,
            kiểu_dữ_liệu_start: typeof watering.timer_start,
            kiểu_dữ_liệu_end: typeof watering.timer_end
        });
    }
}

/**
 * Hàm tính toán và lập lịch cho lần thay đổi trạng thái tiếp theo
 * @param {Object} watering - Cấu hình tưới nước
 */
function scheduleNextTimerCheck(watering) {
    // Hủy bỏ lịch kiểm tra cũ nếu có
    if (scheduledTimerCheck) {
        clearTimeout(scheduledTimerCheck);
    }

    try {
        // Lấy thời gian hiện tại
        const now = new Date();
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentSeconds = now.getSeconds();
        const currentInMinutes = currentHours * 60 + currentMinutes;

        // Xử lý timer_start và timer_end
        let startInMinutes, endInMinutes;

        if (typeof watering.timer_start === 'string' && typeof watering.timer_end === 'string') {
            const [startHours, startMinutes] = watering.timer_start.split(':').map(Number);
            const [endHours, endMinutes] = watering.timer_end.split(':').map(Number);
            startInMinutes = startHours * 60 + startMinutes;
            endInMinutes = endHours * 60 + endMinutes;
        } else {
            startInMinutes = Number(watering.timer_start);
            endInMinutes = Number(watering.timer_end);
        }

        // Tính thời gian đến lần thay đổi trạng thái tiếp theo
        let nextChangeInMinutes;
        let nextChangeDescription;

        if (currentInMinutes < startInMinutes) {
            // Thời gian hiện tại < thời gian bắt đầu -> tiếp theo sẽ BẬT
            nextChangeInMinutes = startInMinutes;
            nextChangeDescription = "BẬT máy bơm";
        } else if (currentInMinutes < endInMinutes) {
            // Thời gian hiện tại nằm giữa bắt đầu và kết thúc -> tiếp theo sẽ TẮT
            nextChangeInMinutes = endInMinutes;
            nextChangeDescription = "TẮT máy bơm";
        } else {
            // Thời gian hiện tại >= thời gian kết thúc
            // Không lập lịch tưới cho ngày mai, thay vào đó kiểm tra lại sau 1 giờ
            console.log("⏰ Đã hết thời gian tưới hôm nay, sẽ kiểm tra lại sau 1 giờ");

            // Thiết lập kiểm tra lại sau 1 giờ
            scheduledTimerCheck = setTimeout(async () => {
                const latestWateringSnap = await wateringRef.once("value");
                const latestWatering = latestWateringSnap.val();
                if (latestWatering && latestWatering.status_timer === 1) {
                    await checkWateringTimer(latestWatering);
                }
            }, 60 * 60 * 1000); // 60 phút = 1 giờ

            return; // Thoát khỏi hàm, không thực hiện phần còn lại
        }
        // Tính milliseconds tới lần thay đổi tiếp theo
        let millisToNextChange = (nextChangeInMinutes - currentInMinutes) * 60 * 1000;
        // Trừ đi số giây đã trôi qua trong phút hiện tại
        millisToNextChange -= currentSeconds * 1000;

        // Đảm bảo thời gian luôn dương
        if (millisToNextChange <= 0) {
            millisToNextChange = 60 * 1000; // 1 phút nếu có lỗi tính toán
        }

        const nextChangeTime = new Date(now.getTime() + millisToNextChange);
        console.log(`⏰ Đã lập lịch ${nextChangeDescription} vào ${nextChangeTime.getHours()}:${nextChangeTime.getMinutes().toString().padStart(2, '0')} (sau ${Math.round(millisToNextChange / 60000)} phút)`);

        // Thiết lập timeout cho lần thay đổi tiếp theo
        scheduledTimerCheck = setTimeout(async () => {
            // Lấy cấu hình tưới nước mới nhất
            const wateringSnap = await wateringRef.once("value");
            const currentWatering = wateringSnap.val();

            // Kiểm tra lại toàn bộ điều kiện
            if (currentWatering && currentWatering.status_timer === 1) {
                await checkWateringTimer(currentWatering);
            } else {
                // Nếu chế độ hẹn giờ đã bị tắt, kiểm tra lại sau 5 phút
                console.log("⏰ Chế độ hẹn giờ đã bị tắt, sẽ kiểm tra lại sau 5 phút");
                scheduledTimerCheck = setTimeout(() => scheduleNextTimerCheck(currentWatering), 5 * 60 * 1000);
            }
        }, millisToNextChange);

    } catch (error) {
        console.error("❌ Lỗi khi lập lịch timer:", error);
        // Nếu có lỗi, thử lại sau 1 phút
        scheduledTimerCheck = setTimeout(() => scheduleNextTimerCheck(watering), 60 * 1000);
    }
}

/**
 * Hàm thiết lập hệ thống kiểm tra thời gian tưới tự động
 */
function setupTimerChecker() {
    // Thực hiện kiểm tra ngay khi khởi động
    (async () => {
        try {
            // Lấy cấu hình tưới nước hiện tại
            const wateringSnap = await wateringRef.once("value");
            const watering = wateringSnap.val();

            // Kiểm tra ngay lần đầu và lập lịch cho lần tiếp theo
            if (watering && watering.status_timer === 1) {
                await checkWateringTimer(watering);
            } else {
                // Nếu chế độ hẹn giờ không được bật, kiểm tra lại sau mỗi 5 phút
                console.log("⏰ Chế độ hẹn giờ chưa được bật, sẽ kiểm tra lại sau 5 phút");
                scheduledTimerCheck = setTimeout(async () => {
                    const latestWateringSnap = await wateringRef.once("value");
                    const latestWatering = latestWateringSnap.val();
                    if (latestWatering && latestWatering.status_timer === 1) {
                        await checkWateringTimer(latestWatering);
                    } else {
                        scheduleNextTimerCheck(latestWatering);
                    }
                }, 5 * 60 * 1000);
            }
        } catch (error) {
            console.error("❌ Lỗi khi thiết lập hệ thống hẹn giờ:", error);
        }
    })();

    console.log("⏳ Đã thiết lập hệ thống hẹn giờ tưới tự động chính xác");
}


//======================================================
// PHẦN 5: CHỨC NĂNG THÔNG BÁO DỮ LIỆU THỜI TIẾT THEO THỜI GIAN ĐẶT
//======================================================

//biến để lưu trữ ID của interval thông báo định kỳ
let periodicNotificationInterval = null;
//biến để lưu trữ thời gian gửi thông báo cuối cùng
let lastNotificationTime = 0;

//hàm gửi thông báo định kỳ theo cài đặt
async function sendPeriodicNotification() {
    try {
        //lấy cấu hình thông báo
        const notificationConfigSnap = await db.ref("/local_notification").once("value");
        const notificationConfig = notificationConfigSnap.val();

        //nếu không có cấu hình hoặc status=false thì không thông báo
        if (!notificationConfig || notificationConfig.status !== true) {
            console.log("⏰ Không có thông báo định kỳ hoặc đã tắt.");
            return;
        }

        //lấy thời gian hiện tại tính bằng mili giây
        const currentTime = Date.now();
        // tính khoảng thời gian giữa các lần thông báo
        const notificationInterval = (notificationConfig.time || 20) * 60 * 1000; // chuyển đổi phút thành mili giây

        //kiểm trả xem thời gian hiện tại có phải là thời điểm tiếp theo của thông báo không
        if (currentTime - lastNotificationTime < notificationInterval) {
            // Thêm dòng này để ghi log thời gian còn lại
            const remainingMinutes = Math.ceil((notificationInterval - (currentTime - lastNotificationTime)) / 60000);
            console.log(`⏰ Còn ${remainingMinutes} phút nữa đến lần thông báo tiếp theo`);
            return;
        }

        //lấy dữ liệu thời tiết hiện tại
        const weatherSnap = await db.ref("/weather_data").once("value");
        const weatherData = weatherSnap.val();

        if (!weatherData) {
            console.log("⚠️ Không có dữ liệu thời tiết.");
            return;
        }
        //danh sách thông báo sẽ gửi 
        const messages = [];
        // Kiểm tra và thêm thông báo tương ứng với từng loại dữ liệu nếu được bật
        if (notificationConfig.temp === true) {
            messages.push(`🌡️ Nhiệt độ hiện tại: ${weatherData.temperature}°C`);
        }

        if (notificationConfig.humidityAir === true) {
            messages.push(`💧 Độ ẩm không khí: ${weatherData.humidity}%`);
        }

        if (notificationConfig.humidityLand === true) {
            messages.push(`🌱 Độ ẩm đất: ${weatherData.humidityLand}%`);
        }

        // Nếu không có dữ liệu nào được chọn để thông báo
        if (messages.length === 0) {
            console.log("⚠️ Không có loại dữ liệu nào được chọn để thông báo");
            return;
        }
        // Gửi thông báo nếu có FCM token
        if (cachedFcmToken) {
            await messaging.send({
                token: cachedFcmToken,
                notification: {
                    title: "📊 Cập nhật thông số môi trường",
                    body: messages.join("\n"),
                },
            });
            console.log("📩 Đã gửi thông báo định kỳ về thời tiết:", messages);

            // Cập nhật thời gian gửi thông báo cuối cùng
            lastNotificationTime = currentTime;
        } else {
            console.log("❌ Không có FCM token để gửi thông báo");
        }

    } catch (error) {
        console.error("❌ Lỗi khi gửi thông báo thời tiết định kỳ:", error);
    }
}
/**
 * Hàm bắt đầu gửi thông báo định kỳ
 * @param {number} checkIntervalMinutes - Khoảng thời gian kiểm tra (phút)
 */
function startPeriodicNotification(checkIntervalMinutes = 1) {
    // Dừng interval cũ nếu đang chạy
    stopPeriodicNotification();

    // Chạy kiểm tra mỗi phút (hoặc theo khoảng thời gian được chỉ định)
    periodicNotificationInterval = setInterval(sendPeriodicNotification, checkIntervalMinutes * 60 * 1000);

    console.log(`📊 Đã bắt đầu hệ thống thông báo thời tiết định kỳ (kiểm tra mỗi ${checkIntervalMinutes} phút)`);

    // Kiểm tra ngay lập tức lần đầu
    sendPeriodicNotification();
}
/**
 * Hàm dừng gửi thông báo định kỳ
 */
function stopPeriodicNotification() {
    if (periodicNotificationInterval) {
        clearInterval(periodicNotificationInterval);
        periodicNotificationInterval = null;
        console.log("📊 Đã dừng hệ thống thông báo thời tiết định kỳ");
    }
}

//======================================================
// PHẦN 6: XỬ LÝ SỰ KIỆN CẬP NHẬT DỮ LIỆU
//======================================================

/**
 * Xử lý khi dữ liệu thời tiết thay đổi
 * @param {Object} snapshot - Snapshot dữ liệu từ Firebase
 */
async function handleWeatherChange(snapshot) {
    // Lấy dữ liệu thời tiết mới
    const weatherData = snapshot.val();
    if (!weatherData) return;

    // Lấy cấu hình cảnh báo hiện tại
    const warningSnap = await db.ref("/local_warnings").once("value");
    const warning = warningSnap.val();

    // Cập nhật FCM token nếu có
    if (warning && warning.fcmToken) {
        cachedFcmToken = warning.fcmToken;
    }

    // Xác định các trường dữ liệu đã thay đổi
    let changedFields = [];
    if (prevWeather) {
        // So sánh với dữ liệu trước đó để tìm các trường thay đổi
        changedFields = Object.keys(weatherData).filter(key => weatherData[key] !== prevWeather[key]);
    } else {
        // Nếu chưa có dữ liệu trước đó, xem tất cả các trường là đã thay đổi
        changedFields = Object.keys(weatherData);
    }

    // Xử lý thông báo nếu có trường thay đổi và đã cấu hình cảnh báo
    if (changedFields.length > 0 && warning) {
        console.log("📢 Phát hiện thay đổi dữ liệu thời tiết:", changedFields);
        await sendNotification(changedFields, warning, weatherData);
    }

    // Lấy cấu hình tưới nước hiện tại
    const wateringSnap = await wateringRef.once("value");
    const watering = wateringSnap.val();

    // Xử lý trạng thái tưới nước dựa trên dữ liệu thời tiết mới
    await handleWateringUpdate(watering, weatherData);

    // Cập nhật biến lưu dữ liệu thời tiết trước đó
    prevWeather = weatherData;
}

/**
 * Xử lý khi cấu hình cảnh báo thay đổi
 * @param {Object} snapshot - Snapshot dữ liệu từ Firebase
 */
async function handleWarningChange(snapshot) {
    // Lấy cấu hình cảnh báo mới
    const warning = snapshot.val();
    if (!warning) return;

    // Cập nhật FCM token nếu có
    if (warning.fcmToken) {
        cachedFcmToken = warning.fcmToken;
    }

    // Lấy dữ liệu thời tiết hiện tại để kiểm tra cảnh báo
    const weatherSnap = await db.ref("/weather_data").once("value");
    const weatherData = weatherSnap.val();
    if (!weatherData) return;

    // Xác định các trường cấu hình đã thay đổi
    let changedFields = [];
    if (prevWarning) {
        // So sánh với cấu hình trước đó để tìm các trường thay đổi
        changedFields = Object.keys(warning).filter(key => warning[key] !== prevWarning[key]);
    } else {
        // Nếu chưa có cấu hình trước đó, xem tất cả các trường là đã thay đổi
        changedFields = Object.keys(warning);
    }

    // Xử lý thông báo nếu có trường thay đổi
    if (changedFields.length > 0) {
        console.log("📢 Phát hiện thay đổi cấu hình cảnh báo:", changedFields);
        await sendNotification(changedFields, warning, weatherData);
    }

    // Cập nhật biến lưu cấu hình cảnh báo trước đó
    prevWarning = warning;
}

/**
 * Hàm xử lý khi cấu hình tưới nước thay đổi
 * Đây là hàm được gọi khi có bất kỳ thay đổi nào trên node /watering
 * @param {Object} snapshot - Snapshot dữ liệu từ Firebase
 */
async function handleWateringConfigChange(snapshot) {
    // Lấy cấu hình tưới nước mới
    const watering = snapshot.val();
    if (!watering) return;

    console.log("📢 Phát hiện thay đổi cấu hình tưới nước:", {
        status: watering.status,
        status_timer: watering.status_timer,
        timer_start: watering.timer_start,
        timer_end: watering.timer_end,
        repeat: watering.repeat
    });

    // Lấy dữ liệu thời tiết hiện tại
    const weatherSnap = await db.ref("/weather_data").once("value");
    const weatherData = weatherSnap.val();
    if (!weatherData) return;

    // Xử lý cập nhật trạng thái tưới ngay lập tức khi cấu hình thay đổi
    await handleWateringUpdate(watering, weatherData);

    // Kiểm tra timer ngay khi cấu hình thay đổi nếu chế độ hẹn giờ được BẬT
    if (watering.status_timer === 1) {
        // Kiểm tra ngay lập tức để cập nhật trạng thái
        await checkWateringTimer(watering);
    } else if (isInWateringTime) {
        // Nếu chế độ hẹn giờ bị tắt nhưng hệ thống đang ở trạng thái tưới theo hẹn giờ
        // Cập nhật lại trạng thái
        isInWateringTime = false;
        console.log("🔄 Hệ thống tưới theo lịch bị tắt do status_timer = 0");
    }
}

/**
 * Hàm xử lý khi cấu hình thông báo thay đổi
 * @param {Object} snapshot - Snapshot dữ liệu từ Firebase
 */
async function handleNotificationConfigChange(snapshot) {
    const notificationConfig = snapshot.val();

    console.log("📢 Phát hiện thay đổi cấu hình thông báo:", notificationConfig);

    if (!notificationConfig) return;

    // Nếu status = true thì bắt đầu gửi thông báo định kỳ
    if (notificationConfig.status === true) {
        const checkIntervalMinutes = 1; // Kiểm tra mỗi phút
        startPeriodicNotification(checkIntervalMinutes);
    } else {
        // Nếu status = false thì dừng gửi thông báo
        stopPeriodicNotification();
    }
}

//======================================================
// PHẦN 7: KHỞI TẠO VÀ THIẾT LẬP LISTENER
//======================================================

// Thiết lập listener cho các nút dữ liệu
db.ref("/weather_data").on('value', handleWeatherChange);
db.ref("/local_warnings").on('value', handleWarningChange);
db.ref("/watering").on('value', handleWateringConfigChange);
db.ref("/local_notification").on('value', handleNotificationConfigChange);

// Khởi tạo giá trị ban đầu cho biến theo dõi trạng thái tưới
wateringRef.once("value").then(snapshot => {
    const watering = snapshot.val();
    if (watering) {
        lastWateringStatus = watering.status;
        console.log(`🔄 Khởi tạo trạng thái tưới: ${lastWateringStatus}`);
    }
});

// Khởi động hệ thống kiểm tra thời gian
setupTimerChecker();

// Khởi tạo hệ thống thông báo định kỳ
(async () => {
    try {
        const notificationConfigSnap = await db.ref("/local_notification").once("value");
        const notificationConfig = notificationConfigSnap.val();

        if (notificationConfig && notificationConfig.status === true) {
            startPeriodicNotification(1);
            console.log("📊 Đã khởi động hệ thống thông báo định kỳ");
        } else {
            console.log("📊 Thông báo định kỳ chưa được bật");
        }
    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo hệ thống thông báo định kỳ:", error);
    }
})();

// Xử lý port cho Render
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy trên port ${PORT}`);
});

// Xử lý đóng server an toàn
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM nhận được. Đang đóng server...');
    server.close(() => {
        console.log('✅ Server đã đóng');
        process.exit(0);
    });
});

// Xử lý lỗi Promise
process.on('unhandledRejection', (error) => {
    console.error('❌ Lỗi Promise không được xử lý:', error);
});