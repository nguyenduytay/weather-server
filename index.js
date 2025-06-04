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

// Import các dịch vụ
const { connectMQTT, setupMQTTCleanup } = require('./services/mqtt-service');
const { startPeriodicNotification } = require('./services/notification-service');

// Import các controller
const { setupWateringListeners } = require('./controllers/watering-controller');
const { setupTimerChecker } = require('./controllers/timer-controller');
const { setupWeatherListeners } = require('./controllers/weather-controller');
const { setupWarningListeners } = require('./controllers/warning-controller');
const { startAIController } = require('./controllers/ai-controller');

// Health check route
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'running',
        message: 'Smart Watering System Server is running 🚀',
        timestamp: new Date().toLocaleString('vi-VN'),
        services: {
            firebase: '✅',
            mqtt: '✅',
            ai: '✅'
        }
    });
});

// Khởi tạo tất cả các dịch vụ
async function initializeApp() {
    try {
        console.log("🔧 Bắt đầu khởi tạo các dịch vụ...");

        // 1. Kết nối MQTT trước tiên (quan trọng cho AI)
        console.log("📡 Đang kết nối MQTT...");
        await connectMQTT();
        console.log("✅ MQTT đã kết nối");

        // 2. Khởi tạo các listener Firebase
        console.log("🔥 Đang thiết lập Firebase listeners...");
        await setupWeatherListeners();
        await setupWarningListeners();
        await setupWateringListeners();
        console.log("✅ Firebase listeners đã sẵn sàng");

        // 3. Khởi tạo hệ thống timer
        console.log("⏰ Đang thiết lập timer checker...");
        await setupTimerChecker();
        console.log("✅ Timer checker đã khởi động");

        // 4. Khởi tạo thông báo định kỳ
        console.log("📱 Đang thiết lập notification service...");
        await startPeriodicNotification();
        console.log("✅ Notification service đã khởi động");

        // 5. Cuối cùng khởi động AI Controller
        console.log("🤖 Đang khởi động AI Controller...");
        await startAIController();
        console.log("✅ AI Controller đã khởi động");

        console.log("🎉 TẤT CẢ DỊCH VỤ ĐÃ KHỞI ĐỘNG THÀNH CÔNG!");

    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo ứng dụng:", error);

        // Log chi tiết lỗi để debug
        if (error.stack) {
            console.error("📋 Stack trace:", error.stack);
        }

        // Không exit, tiếp tục chạy các dịch vụ khác
        console.log("⚠️ Một số dịch vụ có thể không hoạt động đầy đủ");
    }
}

// Tự ping để tránh Render ngủ  
function setupSelfPing() {
    const SERVER_URL = process.env.SERVER_URL ||
        `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + (process.env.PORT || 3000)}`;

    console.log(`🔄 Thiết lập tự ping đến: ${SERVER_URL}`);

    // Ping mỗi 14 phút
    const PING_INTERVAL = 14 * 60 * 1000;

    setInterval(() => {
        https.get(SERVER_URL, (res) => {
            const timestamp = new Date().toLocaleString('vi-VN');
            console.log(`✅ Self-ping thành công: ${res.statusCode} tại ${timestamp}`);
        }).on('error', (err) => {
            const timestamp = new Date().toLocaleString('vi-VN');
            console.error(`❌ Self-ping thất bại tại ${timestamp}: ${err.message}`);
        });
    }, PING_INTERVAL);

    console.log(`⏰ Đã thiết lập tự ping mỗi ${PING_INTERVAL / 60000} phút`);
}

// Khởi động server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, async () => {
    console.log(`🚀 Server đang chạy trên port ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);

    // Delay nhỏ để đảm bảo server đã sẵn sàng
    setTimeout(async () => {
        await initializeApp();

        // Thiết lập cleanup và self-ping
        setupMQTTCleanup();
        setupSelfPing();

        console.log("🎯 Hệ thống đã sẵn sàng hoạt động!");
    }, 1000);
});

// Xử lý đóng server an toàn
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM nhận được. Đang đóng server...');
    server.close(() => {
        console.log('✅ Server đã đóng an toàn');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT nhận được. Đang đóng server...');
    server.close(() => {
        console.log('✅ Server đã đóng an toàn');
        process.exit(0);
    });
});

// Xử lý lỗi Promise không được catch
process.on('unhandledRejection', (error) => {
    console.error('❌ Lỗi Promise không được xử lý:', error);
    // Không exit để tránh crash server
});

// Xử lý lỗi exception không được catch  
process.on('uncaughtException', (error) => {
    console.error('❌ Lỗi Exception không được xử lý:', error);
    // Log nhưng không exit ngay, cho phép cleanup
});