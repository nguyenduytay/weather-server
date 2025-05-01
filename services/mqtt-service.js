const mqtt = require('mqtt');
const config = require('../config/app-config');

// Biến toàn cục
let mqttClient;
let mqttConnected = false;

// Hàm kết nối tới MQTT broker
function connectMQTT() {
    // Kiểm tra nếu đã có kết nối trước đó
    if (mqttClient) {
        console.log('Đã có phiên kết nối MQTT trước đó, không tạo kết nối mới');
        return mqttClient;
    }

    const { server, port, username, password, clientId } = config.mqtt;
    console.log(`🔌 Đang kết nối tới MQTT broker: ${server}:${port}`);

    // Tạo URL kết nối MQTT
    const broker_url = `mqtts://${server}:${port}`;

    // Cấu hình kết nối với Client ID cố định
    const options = {
        username: username,
        password: password,
        clean: true,  // Yêu cầu broker xóa phiên cũ
        connectTimeout: 4000,
        clientId: clientId,  // ID cố định để tránh tràn phiên
        rejectUnauthorized: false  // Chỉ sử dụng trong môi trường phát triển
    };

    // Kết nối tới broker
    mqttClient = mqtt.connect(broker_url, options);

    // Xử lý sự kiện kết nối
    mqttClient.on('connect', function () {
        console.log('✅ Đã kết nối thành công tới MQTT broker');
        mqttConnected = true;

        // Subscribe các topic cần thiết
        mqttClient.subscribe(config.mqtt.topics.wateringStatus, { qos: 1 });
        console.log('📩 Đã đăng ký nhận tin từ topic tưới nước');
    });

    // Xử lý sự kiện lỗi
    mqttClient.on('error', function (error) {
        console.error('❌ Lỗi kết nối MQTT:', error.message);
        mqttConnected = false;
    });

    // Xử lý sự kiện mất kết nối
    mqttClient.on('close', function () {
        console.log('❌ Mất kết nối MQTT. Đang thử kết nối lại...');
        mqttConnected = false;
        // Sử dụng phương thức reconnect thay vì tạo kết nối mới
        setTimeout(() => {
            if (mqttClient && !mqttClient.connected) {
                mqttClient.reconnect();
            }
        }, 5000);
    });

    // Xử lý sự kiện nhận tin nhắn
    mqttClient.on('message', function (topic, message) {
        console.log(`📥 Nhận tin nhắn từ topic [${topic}]: ${message.toString()}`);

        // Xử lý tin nhắn nhận được
        handleIncomingMessage(topic, message);
    });

    return mqttClient;
}

// Hàm gửi thông điệp qua MQTT
async function sendMQTTMessage(topic, message, retain = true) {
    return new Promise((resolve) => {
        // Kiểm tra kết nối MQTT
        if (mqttClient && mqttClient.connected) {
            mqttClient.publish(topic, message, { qos: 1, retain }, (error) => {
                if (error) {
                    console.error(`❌ Lỗi gửi tin nhắn MQTT đến ${topic}:`, error.message);
                    resolve(false);
                } else {
                    console.log(`✅ Đã gửi tin nhắn MQTT đến ${topic}: ${message}`);
                    resolve(true);
                }
            });
        } else {
            console.log(`⚠️ MQTT không kết nối, không thể gửi tin nhắn đến ${topic}`);
            resolve(false);
        }
    });
}

// Hàm xử lý tin nhắn nhận được
function handleIncomingMessage(topic, message) {
    // Xử lý dựa vào topic
    if (topic === config.mqtt.topics.wateringStatus) {
        const statusValue = message.toString();
        console.log(`📊 Cập nhật trạng thái tưới từ thiết bị: ${statusValue}`);

        // Event callback có thể được thêm vào sau
        if (typeof mqttCallbacks.onWateringStatusReceived === 'function') {
            mqttCallbacks.onWateringStatusReceived(statusValue);
        }
    }
}

// Xử lý đóng kết nối MQTT an toàn khi ứng dụng kết thúc
function setupMQTTCleanup() {
    process.on('SIGINT', () => {
        console.log('Đang đóng kết nối MQTT...');
        if (mqttClient && mqttClient.connected) {
            mqttClient.end(true, () => {
                console.log('Đã đóng kết nối MQTT thành công');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });

    process.on('SIGTERM', () => {
        console.log('Đang đóng kết nối MQTT...');
        if (mqttClient && mqttClient.connected) {
            mqttClient.end(true, () => {
                console.log('Đã đóng kết nối MQTT thành công');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });
}

// Đối tượng lưu trữ các callback
const mqttCallbacks = {
    onWateringStatusReceived: null
};

// Đăng ký callback function
function registerCallback(event, callback) {
    if (typeof callback === 'function') {
        mqttCallbacks[event] = callback;
        return true;
    }
    return false;
}

// Kiểm tra trạng thái kết nối
function isConnected() {
    return mqttConnected;
}

// Đóng kết nối MQTT
function closeMQTT() {
    if (mqttClient && mqttClient.connected) {
        mqttClient.end(true, () => {
            console.log('Đã đóng kết nối MQTT thành công');
            mqttClient = null;
            mqttConnected = false;
        });
    }
}

module.exports = {
    connectMQTT,
    sendMQTTMessage,
    setupMQTTCleanup,
    registerCallback,
    isConnected,
    closeMQTT
};