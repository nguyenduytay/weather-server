const admin = require("firebase-admin");
const config = require('../config/app-config');

// Biến toàn cục
let db;
let messaging;
let cachedFcmToken = null;
let initialized = false;

// Khởi tạo Firebase
function initFirebase() {
    // Kiểm tra nếu đã khởi tạo
    if (initialized) {
        console.log("ℹ️ Firebase đã được khởi tạo trước đó");
        return { db, messaging };
    }

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

    try {
        // Khởi tạo ứng dụng Firebase với thông tin xác thực
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL
        });

        // Khởi tạo các dịch vụ Firebase sẽ sử dụng
        db = admin.database();            // Dịch vụ Realtime Database
        messaging = admin.messaging();    // Dịch vụ Cloud Messaging để gửi thông báo
        initialized = true;

        console.log("✅ Đã khởi tạo kết nối Firebase thành công");
        return { db, messaging };
    } catch (error) {
        console.error("❌ Lỗi khi khởi tạo Firebase:", error);
        process.exit(1);
    }
}

// Hàm lấy database instance
function getDb() {
    if (!db) {
        throw new Error("Cơ sở dữ liệu Firebase chưa được khởi tạo!");
    }
    return db;
}

// Hàm lấy messaging instance
function getMessaging() {
    if (!messaging) {
        throw new Error("Firebase Messaging chưa được khởi tạo!");
    }
    return messaging;
}

// Hàm lấy reference
function getRef(path) {
    const database = getDb();
    return database.ref(path);
}

// Hàm gửi thông báo FCM
async function sendFCMNotification(token, title, body) {
    try {
        if (!token) {
            console.log("⚠️ Không có FCM token để gửi thông báo");
            return false;
        }

        const msgService = getMessaging();
        await msgService.send({
            token: token,
            notification: {
                title: title,
                body: body,
            },
        });
        console.log("✅ Đã gửi thông báo:", { title, body });
        return true;
    } catch (error) {
        console.error("❌ Lỗi khi gửi thông báo FCM:", error);
        return false;
    }
}

// Cập nhật token FCM 
function updateFCMToken(token) {
    if (token) {
        cachedFcmToken = token;
        return true;
    }
    return false;
}

// Lấy token FCM hiện tại
function getFCMToken() {
    return cachedFcmToken;
}

// Hàm getter để truy cập các tham chiếu Firebase
function getWateringRef() {
    return getRef(config.firebasePaths.watering);
}

function getWeatherDataRef() {
    return getRef(config.firebasePaths.weatherData);
}

function getWarningsRef() {
    return getRef(config.firebasePaths.warnings);
}

function getNotificationRef() {
    return getRef(config.firebasePaths.notification);
}

// Kiểm tra trạng thái khởi tạo
function isInitialized() {
    return initialized;
}

module.exports = {
    initFirebase,
    getDb,
    getMessaging,
    getRef,
    sendFCMNotification,
    updateFCMToken,
    getFCMToken,
    getWateringRef,
    getWeatherDataRef,
    getWarningsRef,
    getNotificationRef,
    isInitialized
};