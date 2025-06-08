const config = require('../config/app-config');
const { getRef, sendFCMNotification, getFCMToken } = require('../services/firebase-service');
const { sendMQTTMessage } = require('../services/mqtt-service');

// Biến theo dõi
let currentRainPercent = null;
let isAutoMode = false;
let isInitialized = false;

/**
 * Logic AI đơn giản
 */
function makeAIDecision(rainPercent) {
    if (rainPercent >= 70) {
        return {
            shouldWait: true,
            message: `🌧️ Khả năng mưa cao ${rainPercent}% → AI khuyên CHỜ MƯA`
        };
    } else {
        return {
            shouldWait: false,
            message: `☀️ Khả năng mưa thấp ${rainPercent}% → AI cho phép TƯỚI BÌNH THƯỜNG`
        };
    }
}

/**
 * Gửi lệnh AI đến ESP32
 */
async function sendAICommand(shouldWait, rainPercent) {
    try {
        // Kiểm tra config có tồn tại
        if (!config.mqtt || !config.mqtt.topics || !config.mqtt.topics.weatherAiControl) {
            console.error("❌ Thiếu cấu hình MQTT topic cho AI control");
            return false;
        }

        const topic = config.mqtt.topics.weatherAiControl;
        const command = shouldWait ? "1" : "0";

        const success = await sendMQTTMessage(topic, command, true);
        console.log(`📡 MQTT→ESP32: Rain=${rainPercent}% → ${shouldWait ? "CHỜ MƯA" : "BÌNH THƯỜNG"} (${success ? "✅" : "❌"})`);
        return success;
    } catch (error) {
        console.error("❌ Lỗi gửi lệnh AI:", error);
        return false;
    }
}

/**
 * Gửi thông báo đến app
 */
async function sendNotification(message) {
    try {
        const token = getFCMToken();
        if (!token) {
            console.log("⚠️ Không có FCM token, bỏ qua thông báo");
            return false;
        }

        const success = await sendFCMNotification(token, "🤖 AI Tưới Nước", message);
        console.log(`📱 Notification: ${success ? "✅" : "❌"}`);
        return success;
    } catch (error) {
        console.error("❌ Lỗi gửi notification:", error);
        return false;
    }
}

/**
 * Xử lý khi % mưa thay đổi
 */
async function handleRainChange(newRainPercent) {
    try {
        console.log(`🌧️ % mưa thay đổi: ${currentRainPercent}% → ${newRainPercent}%`);
        currentRainPercent = newRainPercent;

        // Chỉ xử lý khi auto mode BẬT
        if (!isAutoMode) {
            console.log("⚠️ Auto mode TẮT → Bỏ qua");
            return;
        }

        // AI quyết định
        const decision = makeAIDecision(newRainPercent);

        // Gửi lệnh và thông báo (không await để tránh block)
        sendAICommand(decision.shouldWait, newRainPercent);
        sendNotification(decision.message);

    } catch (error) {
        console.error("❌ Lỗi xử lý thay đổi rain:", error);
    }
}

/**
 * Theo dõi auto mode
 */
function watchAutoMode() {
    try {
        if (!config.firebasePaths || !config.firebasePaths.weatherData) {
            console.error("❌ Thiếu cấu hình Firebase paths");
            return;
        }

        const autoModeRef = getRef(config.firebasePaths.weatherData + '/auto_mode');

        // Sử dụng callback riêng cho error handling
        const onValue = (snapshot) => {
            try {
                const newAutoMode = snapshot.val() === true;

                if (newAutoMode !== isAutoMode) {
                    const previousMode = isAutoMode;
                    isAutoMode = newAutoMode;

                    console.log(`🔧 Auto Mode: ${isAutoMode ? "BẬT" : "TẮT"}`);

                    // Gửi thông báo về app khi có thay đổi auto mode
                    const notificationMessage = isAutoMode ?
                        "🔄 Đã BẬT chế độ tự động - AI sẽ điều khiển tưới nước" :
                        "⏸️ Đã TẮT chế độ tự động - Chuyển về điều khiển thủ công";

                    // Gửi thông báo (không await để tránh block)
                    sendNotification(notificationMessage);

                    // Nếu vừa bật auto mode và có dữ liệu rain, thực hiện quyết định AI ngay
                    if (isAutoMode && currentRainPercent !== null) {
                        console.log(`🤖 Auto mode vừa BẬT - Thực hiện quyết định AI với rain=${currentRainPercent}%`);
                        const decision = makeAIDecision(currentRainPercent);
                        sendAICommand(decision.shouldWait, currentRainPercent);
                        sendNotification(decision.message);
                    }
                }
            } catch (error) {
                console.error("❌ Lỗi xử lý auto mode change:", error);
            }
        };

        const onError = (error) => {
            console.error("❌ Lỗi Firebase auto mode listener:", error);
        };

        // Thiết lập listener với error callback
        autoModeRef.on('value', onValue, onError);

    } catch (error) {
        console.error("❌ Lỗi thiết lập auto mode watcher:", error);
    }
}

/**
 * Theo dõi % mưa
 */
function watchRainPercent() {
    try {
        if (!config.firebasePaths || !config.firebasePaths.weather_24h) {
            console.error("❌ Thiếu cấu hình Firebase weather_24h path");
            return;
        }

        const weather24hRef = getRef(config.firebasePaths.weather_24h);

        const onValue = (snapshot) => {
            try {
                const allData = snapshot.val();
                if (!allData) {
                    console.log("⚠️ Không có dữ liệu weather_24h");
                    return;
                }

                // Lấy tất cả timestamps và sắp xếp theo thời gian
                const timestamps = Object.keys(allData);

                if (timestamps.length === 0) {
                    console.log("⚠️ Không có timestamp nào trong weather_24h");
                    return;
                }

                // Sắp xếp timestamps theo thứ tự thời gian (mới nhất cuối)
                timestamps.sort((a, b) => new Date(a) - new Date(b));
                const latestTimestamp = timestamps[0];
                const latestData = allData[latestTimestamp];

                console.log(`📊 Timestamp mới nhất: ${latestTimestamp}`);
                console.log(`📊 Dữ liệu: rain=${latestData?.rain}, temp=${latestData?.temp}`);

                // Kiểm tra dữ liệu rain
                if (latestData && typeof latestData.rain === 'number') {
                    const newRainPercent = latestData.rain;

                    // Chỉ xử lý khi có thay đổi
                    if (newRainPercent !== currentRainPercent) {
                        handleRainChange(newRainPercent);
                    } else {
                        console.log(`📊 Rain percent không đổi: ${newRainPercent}%`);
                    }
                } else {
                    console.log(`⚠️ Dữ liệu rain không hợp lệ:`, latestData);
                }
            } catch (error) {
                console.error("❌ Lỗi xử lý rain data:", error);
                console.error("❌ Stack trace:", error.stack);
            }
        };

        const onError = (error) => {
            console.error("❌ Lỗi Firebase weather listener:", error);
        };

        // Thiết lập listener với error callback
        weather24hRef.on('value', onValue, onError);

    } catch (error) {
        console.error("❌ Lỗi thiết lập rain watcher:", error);
    }
}

/**
 * Khởi động AI Controller
 */
function startAIController() {
    try {
        if (isInitialized) {
            console.log("⚠️ AI Controller đã được khởi động trước đó");
            return;
        }

        console.log("🤖 Khởi động AI Controller...");

        // Kiểm tra config cơ bản
        if (!config) {
            throw new Error("Thiếu config");
        }

        watchAutoMode();   // Theo dõi auto mode
        watchRainPercent(); // Theo dõi % mưa

        isInitialized = true;
        console.log("✅ AI Controller đang hoạt động");

    } catch (error) {
        console.error("❌ Lỗi khởi động AI Controller:", error);
        throw error; // Re-throw để caller biết có lỗi
    }
}

/**
 * Dừng AI Controller
 */
function stopAIController() {
    try {
        console.log("🤖 Dừng AI Controller...");

        if (config.firebasePaths) {
            const autoModeRef = getRef(config.firebasePaths.weatherData + '/auto_mode');
            const weather24hRef = getRef(config.firebasePaths.weather_24h);

            autoModeRef.off();
            weather24hRef.off();
        }

        isInitialized = false;
        currentRainPercent = null;
        isAutoMode = false;

        console.log("✅ Đã dừng AI Controller");

    } catch (error) {
        console.error("❌ Lỗi dừng AI Controller:", error);
    }
}

module.exports = {
    startAIController,
    stopAIController
};