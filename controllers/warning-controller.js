const { getWarningsRef, sendFCMNotification, updateFCMToken, getWeatherDataRef, getRef } = require('../services/firebase-service');
const warningsRef = getWarningsRef();
// Biến lưu cấu hình cảnh báo trước đó để phát hiện thay đổi
let prevWarning = null;

/**
 * Hàm gửi thông báo cảnh báo khi các điều kiện môi trường vượt ngưỡng
 * @param {Array} changes - Danh sách các trường dữ liệu đã thay đổi
 * @param {Object} warning - Cấu hình ngưỡng cảnh báo
 * @param {Object} weatherData - Dữ liệu thời tiết và môi trường hiện tại
 */
async function sendWarningNotifications(changes, weatherData, warningConfig = null) {
    // Nếu không có cấu hình cảnh báo, lấy từ biến toàn cục
    const warning = warningConfig || prevWarning;

    if (!warning || !weatherData) {
        return;
    }

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

    // Lưu token vào biến toàn cục để sử dụng sau này
    if (warning.fcmToken) {
        updateFCMToken(warning.fcmToken);
    }

    // Gửi thông báo qua FCM
    await sendFCMNotification(
        warning.fcmToken,
        "⚠️ Cảnh báo môi trường",
        messages.join("\n")  // Gộp tất cả thông báo thành 1 nội dung
    );
}

/**
 * Xử lý khi cấu hình cảnh báo thay đổi
 * @param {Object} warning - Cấu hình cảnh báo mới
 */
async function handleWarningChange(warning) {
    if (!warning) return;

    // Cập nhật FCM token nếu có
    if (warning.fcmToken) {
        updateFCMToken(warning.fcmToken);
    }

    // Lấy dữ liệu thời tiết hiện tại để kiểm tra cảnh báo
    const weatherDataRef = getWeatherDataRef();
    const weatherSnap = await weatherDataRef.once("value");
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
        await sendWarningNotifications(changedFields, weatherData, warning);
    }

    // Cập nhật biến lưu cấu hình cảnh báo trước đó
    prevWarning = warning;
}

// Thiết lập listener cho thay đổi cấu hình cảnh báo
async function setupWarningListeners() {
    warningsRef.on('value', snapshot => {
        const warning = snapshot.val();
        handleWarningChange(warning);
    });

    console.log("✅ Đã thiết lập listener cho cấu hình cảnh báo");
    return true;
}

module.exports = {
    sendWarningNotifications,
    handleWarningChange,
    setupWarningListeners
};