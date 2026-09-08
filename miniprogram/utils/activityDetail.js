const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const ENGLISH_MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER"
];

function parseLocalDateTime(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized.length === 16 ? `${normalized}:00` : normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatActivityDate(value) {
  const date = parseLocalDateTime(value);
  if (!date) return "—";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

function formatClock(value) {
  const date = parseLocalDateTime(value);
  if (!date) return "";
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatActivityTime(startValue, endValue) {
  const start = formatClock(startValue);
  const end = formatClock(endValue);
  if (!start) return "—";
  return end ? `${start} - ${end}` : start;
}

function truncateActivityTitle(value, maxLength = 10) {
  const characters = Array.from(String(value || "").trim());
  if (characters.length <= maxLength) return characters.join("");
  return `${characters.slice(0, maxLength).join("")}…`;
}

function formatHeroMeta(activity) {
  const start = parseLocalDateTime(activity && activity.startTime);
  if (!start) return "";
  const month = ENGLISH_MONTH_NAMES[start.getMonth()];
  const day = String(start.getDate()).padStart(2, "0");
  return `${month} · ${day}`;
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function calculateDistanceMeters(fromLat, fromLng, toLat, toLng) {
  const values = [fromLat, fromLng, toLat, toLng].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [lat1, lng1, lat2, lng2] = values;
  const earthRadius = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined || String(distanceMeters).trim() === "") return "";
  const meters = Number(distanceMeters);
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters < 1000) return `约 ${Math.max(1, Math.round(meters / 10) * 10)}m`;
  const kilometers = meters / 1000;
  return `约 ${kilometers >= 10 ? Math.round(kilometers) : kilometers.toFixed(1)}km`;
}

function resolveWeatherIcon(code, condition) {
  const numericCode = Number(code);
  if ([100, 150].includes(numericCode)) return "/images/weather-sunny.svg";
  if ([102, 103, 152, 153].includes(numericCode)) return "/images/weather-partly-cloudy.svg";
  if ([101, 104, 151].includes(numericCode)) return "/images/weather-cloudy.svg";
  if (numericCode >= 300 && numericCode <= 399) return "/images/weather-rain.svg";
  if (numericCode >= 400 && numericCode <= 499) return "/images/weather-snow.svg";
  if ([500, 501, 509, 510, 514, 515].includes(numericCode)) return "/images/weather-fog.svg";
  if (numericCode >= 502 && numericCode <= 508) return "/images/weather-dust.svg";
  const text = String(condition || "");
  if (/雨/.test(text)) return "/images/weather-rain.svg";
  if (/雪/.test(text)) return "/images/weather-snow.svg";
  if (/雾|霾/.test(text)) return "/images/weather-fog.svg";
  if (/沙|尘/.test(text)) return "/images/weather-dust.svg";
  if (/晴间多云|少云/.test(text)) return "/images/weather-partly-cloudy.svg";
  if (/晴/.test(text)) return "/images/weather-sunny.svg";
  return "/images/weather-cloudy.svg";
}

function buildWeatherView(payload) {
  if (!payload || payload.available !== true) {
    return {
      loading: false,
      available: false,
      message: (payload && payload.message) || "距离活动时间较远，暂不展示天气信息",
      attribution: "天气服务驱动 by QWeather"
    };
  }
  const representativeTemperature = payload.temperature != null
    ? payload.temperature
    : (payload.temperature_max != null ? payload.temperature_max : payload.temperature_min);
  return {
    loading: false,
    available: true,
    condition: payload.condition || "—",
    temperature: representativeTemperature != null ? `${representativeTemperature}°` : "—",
    humidity: payload.humidity != null ? `${payload.humidity}%` : "—",
    wind: [payload.wind_direction, payload.wind_scale ? `${payload.wind_scale}级` : ""].filter(Boolean).join(" ") || "—",
    airQuality: payload.air_quality || "—",
    icon: resolveWeatherIcon(payload.icon_code, payload.condition),
    attribution: payload.attribution || "天气服务驱动 by QWeather"
  };
}

function resolvePrimaryAction(activity) {
  if (!activity) return { label: "已停止报名", disabled: true, action: "none" };
  if (activity.status === "已结束") return { label: "活动已结束", disabled: true, action: "none" };
  if (activity.hasCheckedIn) return { label: "已签到", disabled: true, action: "none" };
  if (activity.hasSignedUp && activity.status === "进行中") {
    return { label: "立即签到", disabled: false, action: "checkin" };
  }
  if (activity.hasSignedUp && activity.status === "未开始" && !activity.signupDeadlinePassed) {
    return { label: "取消报名", disabled: false, action: "cancel" };
  }
  if (
    activity.status !== "未开始" ||
    activity.isSignupClosed ||
    activity.signupEnabled === false ||
    activity.isFull
  ) {
    return { label: "已停止报名", disabled: true, action: "none" };
  }
  return { label: "立即报名", disabled: false, action: "signup" };
}

module.exports = {
  parseLocalDateTime,
  formatActivityDate,
  formatActivityTime,
  truncateActivityTitle,
  formatHeroMeta,
  calculateDistanceMeters,
  formatDistance,
  buildWeatherView,
  resolvePrimaryAction
};
