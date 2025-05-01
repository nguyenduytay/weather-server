const config = require('../config/app-config');
const firebaseService = require('../services/firebase-service');
const { connectMQTT, sendMQTTMessage, isConnected } = require('../services/mqtt-service');
const { setupTimerChecker, checkWateringTimer, scheduleNextTimerCheck } = require('../controllers/timer-controller');

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
            let mqttSuccess = false;

            // Nếu chế độ hẹn giờ được bật, sử dụng MQTT để điều khiển
            if (watering.status_timer === 1 && isConnected()) {
                mqttSuccess = await sendMQTTMessage(config.mqtt.topics.wateringStatus, newStatus.toString());
                console.log(`📤 Đã gửi lệnh ${newStatus === 1 ? 'BẬT' : 'TẮT'} máy bơm qua MQTT`);
            }

            // Luôn cập nhật Firebase để UI đồng bộ
            const wateringRef = firebaseService.getWateringRef();
            await wateringRef.update({ status: newStatus });
            lastWateringStatus = newStatus;  // Cập nhật biến lưu trạng thái

            // Gửi thông báo nếu có FCM token
            const token = firebaseService.getFCMToken();
            await firebaseService.sendFCMNotification(
                token,
                "💧 Cập nhật hệ thống tưới nước tự động",
                message
            );
        } catch (error) {
            console.error("❌ Lỗi khi cập nhật trạng thái tưới:", error);
        }
    }
}

/**
 * Xử lý khi trạng thái tưới theo độ ẩm đất thay đổi
 * @param {Object} watering - Cấu hình tưới mới
 * @param {Object} previousWatering - Cấu hình tưới trước đó
 */
async function handleWateringConfigChange(watering, previousWatering = {}) {
    if (!watering) return;

    // Kiểm tra xem có sự thay đổi trong các trường quan trọng không
    const isTimerChanged = watering.status_timer !== previousWatering.status_timer;
    const isScheduleChanged = watering.timer_start !== previousWatering.timer_start ||
        watering.timer_end !== previousWatering.timer_end ||
        watering.repeat !== previousWatering.repeat;

    // Ghi log thay đổi
    console.log("📢 Phát hiện thay đổi cấu hình tưới nước:", {
        status: watering.status,
        status_timer: watering.status_timer,
        timer_start: watering.timer_start,
        timer_end: watering.timer_end,
        repeat: watering.repeat
    });

    // Xử lý kết nối MQTT dựa trên trạng thái timer
    if (watering.status_timer === 1) {
        // Đảm bảo đã kết nối MQTT nếu chế độ hẹn giờ BẬT
        if (!isConnected()) {
            connectMQTT();
        }

        // Kiểm tra hẹn giờ và lập lịch ngay lập tức
        if (checkWateringTimer) {
            await checkWateringTimer(watering);
        } else {
            console.log("Hàm checkWateringTimer chưa được khởi tạo");
        }
    } else if (previousWatering.status_timer === 1 && watering.status_timer !== 1) {
        // Nếu vừa TẮT chế độ hẹn giờ, gửi lệnh tắt cuối cùng qua MQTT
        if (isConnected()) {
            await sendMQTTMessage(config.mqtt.topics.wateringStatus, '0');
            console.log("📤 Đã gửi lệnh TẮT máy bơm qua MQTT do chế độ hẹn giờ bị tắt");
        }
    }
}

// Thiết lập listener cho các thay đổi cấu hình tưới
async function setupWateringListeners() {
    // Lấy và lưu trạng thái ban đầu
    const wateringRef = firebaseService.getWateringRef();
    const wateringSnap = await wateringRef.once("value");
    const watering = wateringSnap.val();

    if (watering) {
        lastWateringStatus = watering.status;
        console.log(`🔄 Khởi tạo trạng thái tưới: ${lastWateringStatus}`);

        // Khởi tạo kết nối MQTT nếu cần
        if (watering.status_timer === 1) {
            connectMQTT();
        }
    }

    // Đăng ký listener
    let previousWatering = watering || {};
    wateringRef.on('value', async (snapshot) => {
        const newWatering = snapshot.val();
        await handleWateringConfigChange(newWatering, previousWatering);
        previousWatering = newWatering;
    });

    console.log("✅ Đã thiết lập listener cho cấu hình tưới nước");
}

// Phương thức để đặt reference cho checkWateringTimer từ bên ngoài
function setCheckWateringTimer(checkTimerFunction) {
    checkWateringTimer = checkTimerFunction;
}

module.exports = {
    handleWateringUpdate,
    setupWateringListeners,
    setCheckWateringTimer,
    get lastWateringStatus() { return lastWateringStatus; }
};