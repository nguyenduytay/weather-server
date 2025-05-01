require('dotenv').config();
process.env.TZ = 'Asia/Ho_Chi_Minh';
console.log(`⏰ Thiết lập múi giờ: ${process.env.TZ}`);
console.log(`⏰ Thời gian hiện tại: ${new Date().toLocaleString('vi-VN')}`);

const express = require("express");
const https = require("https");
const app = express();

// Khởi tạo Firebase TRƯỚC TIÊN
const { initFirebase } = require('./services/firebase-service');
initFirebase();

// Sau đó mới import các dịch vụ và controller khác
const { connectMQTT, setupMQTTCleanup } = require('./services/mqtt-service');
const { startPeriodicNotification } = require('./services/notification-service');

// Import các controller
const { setupWateringListeners } = require('./controllers/watering-controller');
const { setupTimerChecker } = require('./controllers/timer-controller');
const { setupWeatherListeners } = require('./controllers/weather-controller');
const { setupWarningListeners } = require('./controllers/warning-controller');

// Thêm route health check cho Render và UptimeRobot
app.get('/', (req, res) => {
    res.status(200).send('Smart Watering System Server is running 🚀');
});

// Khởi tạo tất cả các listener và controllers
async function initializeApp() {
    try {
        // Khởi tạo các listener
        await setupWeatherListeners();
        await setupWarningListeners();
        await setupWateringListeners();

        // Khởi tạo hệ thống kiểm tra hẹn giờ
        await setupTimerChecker();

        // Kiểm tra và khởi động hệ thống thông báo định kỳ
        await startPeriodicNotification();

        console.log("✅ Đã khởi tạo xong tất cả dịch vụ và listener");
    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo ứng dụng:", error);
    }
}

// Hàm tự ping để tránh Render ngủ
function setupSelfPing() {
    const SERVER_URL = process.env.SERVER_URL || `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + (process.env.PORT || 3000)}`;
    console.log(`🔄 Thiết lập tự ping đến: ${SERVER_URL}`);

    // Ping mỗi 14 phút (dưới ngưỡng 15 phút của Render)
    const PING_INTERVAL = 14 * 60 * 1000;

    setInterval(() => {
        https.get(SERVER_URL, (res) => {
            console.log(`✅ Ping thành công: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`❌ Ping thất bại: ${err.message}`);
        });
    }, PING_INTERVAL);

    console.log(`⏰ Đã thiết lập tự ping mỗi ${PING_INTERVAL / 60000} phút`);
}

// Khởi động server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy trên port ${PORT}`);

    // Khởi tạo ứng dụng sau khi server đã chạy
    initializeApp();

    // Thiết lập xử lý đóng kết nối MQTT an toàn
    setupMQTTCleanup();

    // Bắt đầu tự ping
    setupSelfPing();
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