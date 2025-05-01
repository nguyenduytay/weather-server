/**
 * Hàm kiểm tra xem ngày hiện tại có thuộc thứ được hẹn không
 * @param {string} scheduleDays - Chuỗi chứa các thứ được hẹn (T2, T3, T4, T5, T6, T7, CN)
 * @returns {boolean} - True nếu hôm nay thuộc lịch hẹn, False nếu không thuộc
 */
function isScheduledDay(scheduleDays) {
    // Nếu không có lịch theo thứ hoặc lịch là "daily" thì luôn trả về true (tưới mỗi ngày)
    if (!scheduleDays || scheduleDays.toLowerCase() === "mỗi ngày" || scheduleDays.toLowerCase() === "hàng ngày") {
        return true;
    }

    // Lấy thứ hiện tại (0: Chủ nhật, 1: Thứ 2, 2: Thứ 3, ..., 6: Thứ 7)
    const today = new Date().getDay();

    // Chuyển đổi giá trị today sang định dạng T2, T3, ..., CN cho dễ so sánh
    let todayStr;
    switch (today) {
        case 0: todayStr = "CN"; break;
        case 1: todayStr = "T2"; break;
        case 2: todayStr = "T3"; break;
        case 3: todayStr = "T4"; break;
        case 4: todayStr = "T5"; break;
        case 5: todayStr = "T6"; break;
        case 6: todayStr = "T7"; break;
    }

    // Kiểm tra xem thứ hiện tại có trong chuỗi lịch hẹn không
    return scheduleDays.includes(todayStr);
}

/**
 * Hàm tạo chuỗi giờ:phút từ số phút
 * @param {number} minutes - Số phút 
 * @returns {string} - Chuỗi định dạng "HH:MM"
 */
function formatTimeStr(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

/**
 * Chuyển đổi chuỗi thời gian hoặc số phút thành số phút
 * @param {string|number} time - Thời gian định dạng "HH:MM" hoặc số phút
 * @returns {number} - Số phút
 */
function convertToMinutes(time) {
    if (typeof time === 'string') {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    } else {
        return Number(time);
    }
}

/**
 * Tính số mili giây còn lại đến thời điểm tiếp theo (bắt đầu hoặc kết thúc)
 * @param {number} currentInMinutes - Thời gian hiện tại tính bằng phút
 * @param {number} startInMinutes - Thời gian bắt đầu tính bằng phút
 * @param {number} endInMinutes - Thời gian kết thúc tính bằng phút
 * @returns {Object} - Thông tin về thời điểm tiếp theo
 */
function calculateNextChangeTime(currentInMinutes, currentSeconds, startInMinutes, endInMinutes) {
    let nextChangeInMinutes;
    let nextChangeDescription;

    if (currentInMinutes < startInMinutes) {
        // Thời gian hiện tại < thời gian bắt đầu -> tiếp theo sẽ BẬT
        nextChangeInMinutes = startInMinutes;
        nextChangeDescription = "BẬT máy bơm";
    } else if (currentInMinutes < endInMinutes) {
        // Thời gian hiện tại nằm giữa bắt đầu và kết thúc -> tiếp theo sẽ TẮT
        nextChangeInMinutes = endInMinutes;
        nextChangeDescription = "TẮT máy bơm";
    } else {
        // Thời gian hiện tại >= thời gian kết thúc -> không có thay đổi tiếp theo trong ngày
        return {
            nextChangeInMinutes: null,
            millisToNextChange: null,
            nextChangeDescription: "Đã hết thời gian tưới hôm nay"
        };
    }

    // Tính milliseconds tới lần thay đổi tiếp theo
    let millisToNextChange = (nextChangeInMinutes - currentInMinutes) * 60 * 1000;
    // Trừ đi số giây đã trôi qua trong phút hiện tại
    millisToNextChange -= currentSeconds * 1000;

    // Đảm bảo thời gian luôn dương
    if (millisToNextChange <= 0) {
        millisToNextChange = 60 * 1000; // 1 phút nếu có lỗi tính toán
    }

    return { nextChangeInMinutes, millisToNextChange, nextChangeDescription };
}

module.exports = {
    isScheduledDay,
    formatTimeStr,
    convertToMinutes,
    calculateNextChangeTime
};