const config = require('../config/app-config');
const { getRef, sendFCMNotification, getFCMToken } = require('./firebase-service');

//biến để lưu trữ ID của interval thông báo định kỳ
let periodicNotificationInterval = null;
//biến để lưu trữ thời gian gửi thông báo cuối cùng
let lastNotificationTime = 0;

//hàm gửi thông báo định kỳ theo cài đặt
async function sendPeriodicNotification() {
    try {
        //lấy cấu hình thông báo
        const notificationConfigSnap = await getRef(config.firebasePaths.notification).once("value");
        const notificationConfig = notificationConfigSnap.val();

        //nếu không có cấu hình hoặc status=false thì không thông báo
        if (!notificationConfig || notificationConfig.status !== true) {
            console.log("⏰ Không có thông báo định kỳ hoặc đã tắt.");
            return;
        }

        //lấy thời gian hiện tại tính bằng mili giây
        const currentTime = Date.now();
        // tính khoảng thời gian giữa các lần thông báo
        const notificationInterval = (notificationConfig.time || config.notification.defaultIntervalMinutes) * 60 * 1000; // chuyển đổi phút thành mili giây

        //kiểm trả xem thời gian hiện tại có phải là thời điểm tiếp theo của thông báo không
        if (currentTime - lastNotificationTime < notificationInterval) {
            // Thêm dòng này để ghi log thời gian còn lại
            const remainingMinutes = Math.ceil((notificationInterval - (currentTime - lastNotificationTime)) / 60000);
            console.log(`⏰ Còn ${remainingMinutes} phút nữa đến lần thông báo tiếp theo`);
            return;
        }

        //lấy dữ liệu thời tiết hiện tại
        const weatherSnap = await getRef(config.firebasePaths.weatherData).once("value");
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
        const token = getFCMToken();
        const success = await sendFCMNotification(
            token,
            "📊 Cập nhật thông số môi trường",
            messages.join("\n")
        );

        if (success) {
            // Cập nhật thời gian gửi thông báo cuối cùng
            lastNotificationTime = currentTime;
        }

    } catch (error) {
        console.error("❌ Lỗi khi gửi thông báo thời tiết định kỳ:", error);
    }
}

/**
 * Hàm bắt đầu gửi thông báo định kỳ
 * @param {number} checkIntervalMinutes - Khoảng thời gian kiểm tra (phút)
 */
function startPeriodicNotification(checkIntervalMinutes = config.notification.checkIntervalMinutes) {
    // Dừng interval cũ nếu đang chạy
    stopPeriodicNotification();

    // Chạy kiểm tra mỗi phút (hoặc theo khoảng thời gian được chỉ định)
    periodicNotificationInterval = setInterval(sendPeriodicNotification, checkIntervalMinutes * 60 * 1000);

    console.log(`📊 Đã bắt đầu hệ thống thông báo thời tiết định kỳ (kiểm tra mỗi ${checkIntervalMinutes} phút)`);

    // Kiểm tra ngay lập tức lần đầu
    sendPeriodicNotification();

    return true;
}

/**
 * Hàm dừng gửi thông báo định kỳ
 */
function stopPeriodicNotification() {
    if (periodicNotificationInterval) {
        clearInterval(periodicNotificationInterval);
        periodicNotificationInterval = null;
        console.log("📊 Đã dừng hệ thống thông báo thời tiết định kỳ");
        return true;
    }
    return false;
}

module.exports = {
    sendPeriodicNotification,
    startPeriodicNotification,
    stopPeriodicNotification
};