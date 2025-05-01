const { sendFCMNotification, getFCMToken, getWateringRef } = require('../services/firebase-service');
const { sendMQTTMessage, isConnected } = require('../services/mqtt-service');
const { isScheduledDay, formatTimeStr, convertToMinutes, calculateNextChangeTime } = require('../utils/time-utils');
const config = require('../config/app-config');


// Biến theo dõi trạng thái hẹn giờ
let isInWateringTime = false;
let scheduledTimerCheck = null; // Biến lưu trữ timeout ID
let wateringRef = getWateringRef();
/**
 * Hàm kiểm tra và cập nhật trạng thái tưới theo thời gian đã hẹn
 * @param {Object} watering - Cấu hình tưới nước
 */
async function checkWateringTimer(watering) {
    // Kiểm tra cấu hình thời gian và trạng thái timer
    if (!watering || watering.timer_start === undefined || watering.timer_end === undefined || watering.status_timer !== 1) {
        console.log("Không thỏa điều kiện cơ bản để tưới theo lịch");
        return;
    }

    try {
        // Kiểm tra xem hôm nay có thuộc lịch hẹn tưới không
        if (!isScheduledDay(watering.repeat)) {
            console.log("Hôm nay không thuộc lịch tưới:", watering.repeat);

            // Nếu hôm nay không thuộc lịch hẹn tưới và hệ thống đang bật
            if (watering.status === 1 && isInWateringTime) {
                // Tắt hệ thống tưới qua MQTT
                isInWateringTime = false;

                // Gửi lệnh TẮT qua MQTT
                const mqttSuccess = await sendMQTTMessage(config.mqtt.topics.wateringStatus, '0');

                if (mqttSuccess) {
                    console.log("📤 Đã gửi lệnh TẮT máy bơm qua MQTT (không thuộc lịch tưới)");
                } else {
                    // Nếu MQTT thất bại, cập nhật qua Firebase
                    const wateringRef = firebaseService.getWateringRef();
                    await wateringRef.update({ status: 0 });
                    console.log("⚠️ MQTT thất bại, đã cập nhật trạng thái qua Firebase");
                }

                // Gửi thông báo tắt hệ thống
                const token = getFCMToken();
                await sendFCMNotification(
                    token,
                    "⏰ Cập nhật hệ thống tưới theo lịch",
                    "⏰ Hệ thống tưới tự động TẮT do hôm nay không thuộc lịch tưới"
                );
            }
            return; // Không tiếp tục kiểm tra thời gian
        }

        // Lấy thời gian hiện tại và chuyển đổi thành số phút
        const now = new Date();
        console.log(`⏰ Thời gian kiểm tra hiện tại: ${now.toLocaleString('vi-VN')}`);
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentInMinutes = currentHours * 60 + currentMinutes;

        // Xử lý timer_start và timer_end dựa trên kiểu dữ liệu
        const startInMinutes = convertToMinutes(watering.timer_start);
        const endInMinutes = convertToMinutes(watering.timer_end);

        console.log(`⏰ Kiểm tra thời gian tưới: hiện tại = ${currentInMinutes} phút (${formatTimeStr(currentInMinutes)}), bắt đầu = ${startInMinutes} phút (${formatTimeStr(startInMinutes)}), kết thúc = ${endInMinutes} phút (${formatTimeStr(endInMinutes)})`);

        // Kiểm tra xem thời gian hiện tại có nằm trong khoảng thời gian tưới hay không
        const shouldBeWatering = currentInMinutes >= startInMinutes && currentInMinutes < endInMinutes;

        // Chỉ xử lý khi trạng thái thay đổi so với lần kiểm tra trước
        if (shouldBeWatering !== isInWateringTime) {
            console.log(`🔄 Trạng thái tưới thay đổi: ${isInWateringTime} -> ${shouldBeWatering}`);

            // Cập nhật biến trạng thái
            isInWateringTime = shouldBeWatering;

            // Xác định trạng thái và thông báo dựa vào kết quả kiểm tra
            let newStatus = shouldBeWatering ? 1 : 0;  // 1: BẬT, 0: TẮT

            const startTimeStr = formatTimeStr(startInMinutes);
            const endTimeStr = formatTimeStr(endInMinutes);

            // Lấy thông tin về lịch theo thứ để hiển thị
            const scheduleInfo = watering.repeat
                ? ` theo lịch (${watering.repeat || "Hàng ngày"})`
                : " hàng ngày";

            let message = shouldBeWatering
                ? `⏰ Hệ thống tưới tự động BẬT${scheduleInfo} (${startTimeStr} - ${endTimeStr})`
                : `⏰ Hệ thống tưới tự động TẮT (kết thúc ${endTimeStr})`;

            console.log(message);

            // Gửi trạng thái qua MQTT
            const mqttSuccess = await sendMQTTMessage(config.mqtt.topics.wateringStatus, newStatus.toString());

            if (mqttSuccess) {
                console.log(`📤 Đã gửi lệnh ${newStatus === 1 ? 'BẬT' : 'TẮT'} máy bơm qua MQTT`);

                // Cập nhật Firebase để UI đồng bộ
                await wateringRef.update({ status: newStatus });
            } else {
                // Nếu MQTT thất bại, cập nhật qua Firebase
                await wateringRef.update({ status: newStatus });
                console.log("⚠️ MQTT thất bại, đã cập nhật trạng thái qua Firebase");
            }

            // Gửi thông báo nếu có FCM token
            const token = getFCMToken();
            await sendFCMNotification(token, "⏰ Cập nhật hệ thống tưới theo lịch", message);
        }

        // Tính toán thời gian cho lần thay đổi trạng thái tiếp theo
        scheduleNextTimerCheck(watering);

    } catch (error) {
        console.error("❌ Lỗi khi xử lý timer:", error);
        console.log("Dữ liệu timer:", {
            timer_start: watering.timer_start,
            timer_end: watering.timer_end,
            kiểu_dữ_liệu_start: typeof watering.timer_start,
            kiểu_dữ_liệu_end: typeof watering.timer_end
        });
    }
}

/**
 * Hàm tính toán và lập lịch cho lần thay đổi trạng thái tiếp theo
 * @param {Object} watering - Cấu hình tưới nước
 */
function scheduleNextTimerCheck(watering) {
    // Hủy bỏ lịch kiểm tra cũ nếu có
    if (scheduledTimerCheck) {
        clearTimeout(scheduledTimerCheck);
    }

    try {
        // Lấy thời gian hiện tại
        const now = new Date();
        console.log(`⏰ Thời gian lập lịch hiện tại: ${now.toLocaleString('vi-VN')}`);
        const currentHours = now.getHours();
        const currentMinutes = now.getMinutes();
        const currentSeconds = now.getSeconds();
        const currentInMinutes = currentHours * 60 + currentMinutes;

        // Xử lý timer_start và timer_end
        const startInMinutes = convertToMinutes(watering.timer_start);
        const endInMinutes = convertToMinutes(watering.timer_end);

        // Tính thời gian đến lần thay đổi trạng thái tiếp theo
        const { nextChangeInMinutes, millisToNextChange, nextChangeDescription } =
            calculateNextChangeTime(currentInMinutes, currentSeconds, startInMinutes, endInMinutes);

        // Nếu không có thay đổi tiếp theo trong ngày
        if (!nextChangeInMinutes) {
            console.log("⏰ Đã hết thời gian tưới hôm nay, sẽ kiểm tra lại sau 1 giờ");

            // Thiết lập kiểm tra lại sau 1 giờ
            scheduledTimerCheck = setTimeout(async () => {
                const latestWateringSnap = await wateringRef.once("value");
                const latestWatering = latestWateringSnap.val();
                if (latestWatering && latestWatering.status_timer === 1) {
                    await checkWateringTimer(latestWatering);
                }
            }, 60 * 60 * 1000); // 60 phút = 1 giờ

            return; // Thoát khỏi hàm, không thực hiện phần còn lại
        }

        const nextChangeTime = new Date(now.getTime() + millisToNextChange);
        console.log(`⏰ Đã lập lịch ${nextChangeDescription} vào ${nextChangeTime.getHours()}:${nextChangeTime.getMinutes().toString().padStart(2, '0')} (sau ${Math.round(millisToNextChange / 60000)} phút)`);

        // Thiết lập timeout cho lần thay đổi tiếp theo
        scheduledTimerCheck = setTimeout(async () => {
            // Lấy cấu hình tưới nước mới nhất
            const wateringSnap = await wateringRef.once("value");
            const currentWatering = wateringSnap.val();

            // Kiểm tra lại toàn bộ điều kiện
            if (currentWatering && currentWatering.status_timer === 1) {
                await checkWateringTimer(currentWatering);
            } else {
                // Nếu chế độ hẹn giờ đã bị tắt, kiểm tra lại sau 5 phút
                console.log("⏰ Chế độ hẹn giờ đã bị tắt, sẽ kiểm tra lại sau 5 phút");
                scheduledTimerCheck = setTimeout(() => scheduleNextTimerCheck(currentWatering), 5 * 60 * 1000);
            }
        }, millisToNextChange);

    } catch (error) {
        console.error("❌ Lỗi khi lập lịch timer:", error);
        // Nếu có lỗi, thử lại sau 1 phút
        scheduledTimerCheck = setTimeout(() => scheduleNextTimerCheck(watering), 60 * 1000);
    }
}

/**
 * Hàm thiết lập hệ thống kiểm tra thời gian tưới tự động
 */
async function setupTimerChecker() {
    try {
        // Lấy cấu hình tưới nước hiện tại
        const wateringSnap = await wateringRef.once("value");
        const watering = wateringSnap.val();

        // Kiểm tra ngay lần đầu và lập lịch cho lần tiếp theo
        if (watering && watering.status_timer === 1) {
            await checkWateringTimer(watering);
        } else {
            // Nếu chế độ hẹn giờ không được bật, kiểm tra lại sau mỗi 5 phút
            console.log("⏰ Chế độ hẹn giờ chưa được bật, sẽ kiểm tra lại sau 5 phút");
            scheduledTimerCheck = setTimeout(async () => {
                const latestWateringSnap = await wateringRef.once("value");
                const latestWatering = latestWateringSnap.val();
                if (latestWatering && latestWatering.status_timer === 1) {
                    await checkWateringTimer(latestWatering);
                } else {
                    scheduleNextTimerCheck(latestWatering);
                }
            }, 5 * 60 * 1000);
        }

        console.log("⏳ Đã thiết lập hệ thống hẹn giờ tưới tự động chính xác");
        return true;
    } catch (error) {
        console.error("❌ Lỗi khi thiết lập hệ thống hẹn giờ:", error);
        return false;
    }
}

module.exports = {
    checkWateringTimer,
    scheduleNextTimerCheck,
    setupTimerChecker
};