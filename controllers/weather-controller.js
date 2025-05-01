const { getWeatherDataRef, updateFCMToken } = require('../services/firebase-service');
const { handleWateringUpdate } = require('./watering-controller');
const { sendWarningNotifications } = require('./warning-controller');

// Biến lưu dữ liệu thời tiết trước đó để phát hiện thay đổi
let prevWeather = null;
// Lấy reference đến đường dẫn dữ liệu thời tiết
const weatherDataRef = getWeatherDataRef();
/**
 * Xử lý khi dữ liệu thời tiết thay đổi
 * @param {Object} weatherData - Dữ liệu thời tiết mới
 */
async function handleWeatherChange(weatherData) {
    if (!weatherData) return;

    // Xác định các trường dữ liệu đã thay đổi
    let changedFields = [];
    if (prevWeather) {
        // So sánh với dữ liệu trước đó để tìm các trường thay đổi
        changedFields = Object.keys(weatherData).filter(key => weatherData[key] !== prevWeather[key]);
    } else {
        // Nếu chưa có dữ liệu trước đó, xem tất cả các trường là đã thay đổi
        changedFields = Object.keys(weatherData);
    }

    if (changedFields.length > 0) {
        console.log("📢 Phát hiện thay đổi dữ liệu thời tiết:", changedFields);

        // Gửi thông báo cảnh báo nếu có điều kiện thoả mãn
        await sendWarningNotifications(changedFields, weatherData);

        // Lấy cấu hình tưới nước hiện tại
        const firebaseService = require('../services/firebase-service');
        const wateringRef = firebaseService.getWateringRef();
        const wateringSnap = await wateringRef.once("value");
        const watering = wateringSnap.val();

        // Xử lý trạng thái tưới nước dựa trên dữ liệu thời tiết mới
        await handleWateringUpdate(watering, weatherData);
    }

    // Cập nhật biến lưu dữ liệu thời tiết trước đó
    prevWeather = weatherData;
}

// Thiết lập listener cho thay đổi dữ liệu thời tiết
async function setupWeatherListeners() {
    weatherDataRef.on('value', snapshot => {
        const weatherData = snapshot.val();
        handleWeatherChange(weatherData);
    });

    console.log("✅ Đã thiết lập listener cho dữ liệu thời tiết");
    return true;
}

module.exports = {
    handleWeatherChange,
    setupWeatherListeners
};