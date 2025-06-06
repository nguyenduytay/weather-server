// Cấu hình chung cho ứng dụng

module.exports = {
    // Cấu hình MQTT
    mqtt: {
        server: process.env.MQTT_BROKER || "9f86891678dd45ea9131f5abca3db44e.s1.eu.hivemq.cloud",
        port: process.env.MQTT_PORT || 8883,
        username: process.env.MQTT_USERNAME || "tayduy",
        password: process.env.MQTT_PASSWORD || "Tay2004x8",
        clientId: 'watering-system-backend-pbl',
        topics: {
            wateringStatus: 'weather/status_pump',
            weatherAiControl: 'weather/ai_watering_control'
        }
    },

    // Firebase paths
    firebasePaths: {
        watering: "/watering",
        weatherData: "/weather_data",
        warnings: "/local_warnings",
        notification: "/local_notification",
        weather_24h: "/weather_24h",
    },

    // Cấu hình hẹn giờ
    timer: {
        checkIntervalMinutes: 5,  // Mặc định kiểm tra lại sau 5 phút
        retryIntervalMinutes: 1   // Thử lại sau 1 phút nếu có lỗi
    },

    // Cấu hình thông báo
    notification: {
        defaultIntervalMinutes: 20,
        checkIntervalMinutes: 1
    }
};