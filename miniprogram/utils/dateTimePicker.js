function pad(value) {
  return String(value).padStart(2, "0");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function range(start, end, step = 1) {
  const values = [];
  for (let value = start; value <= end; value += step) values.push(value);
  return values;
}

function buildMinutes(step = 5, selectedMinute) {
  const safeStep = Math.max(1, Math.min(30, Math.floor(Number(step) || 5)));
  const values = range(0, 59, safeStep);
  const selected = Number(selectedMinute);
  if (Number.isInteger(selected) && selected >= 0 && selected <= 59 && !values.includes(selected)) {
    values.push(selected);
    values.sort((a, b) => a - b);
  }
  return values;
}

function parseDateValue(value, fallback = new Date()) {
  const text = String(value || "");
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!matched) {
    return {
      year: fallback.getFullYear(),
      month: fallback.getMonth() + 1,
      day: fallback.getDate()
    };
  }
  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3])
  };
}

function parseTimeValue(value, fallback = new Date()) {
  const text = String(value || "");
  const matched = text.match(/(?:^|\s)(\d{2}):(\d{2})/);
  if (!matched) {
    return {
      hour: fallback.getHours(),
      minute: fallback.getMinutes()
    };
  }
  return {
    hour: Number(matched[1]),
    minute: Number(matched[2])
  };
}

function roundUpToMinuteStep(input, step = 5) {
  const date = new Date(input.getTime());
  const safeStep = Math.max(1, Math.min(30, Math.floor(Number(step) || 5)));
  const hadSubMinute = date.getSeconds() > 0 || date.getMilliseconds() > 0;
  date.setSeconds(0, 0);
  const remainder = date.getMinutes() % safeStep;
  if (remainder || hadSubMinute) {
    date.setMinutes(date.getMinutes() + (remainder ? safeStep - remainder : safeStep));
  }
  return date;
}

function formatDate(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function formatTime(hour, minute) {
  return `${pad(hour)}:${pad(minute)}`;
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatDayWithWeekday(year, month, day) {
  const weekdayIndex = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay();
  return `${pad(day)}日 · ${WEEKDAY_LABELS[weekdayIndex]}`;
}

function buildDayLabels(year, month) {
  return range(1, daysInMonth(year, month)).map((day) => formatDayWithWeekday(year, month, day));
}

function buildPickerState(options = {}) {
  const mode = ["date", "time", "datetime"].includes(options.mode) ? options.mode : "datetime";
  const now = options.now instanceof Date ? options.now : new Date();
  const datePart = parseDateValue(options.value, now);
  const timePart = parseTimeValue(options.value, now);
  const baseMinYear = Number(options.minYear) || now.getFullYear() - 2;
  const baseMaxYear = Number(options.maxYear) || now.getFullYear() + 2;
  const minYear = Math.min(baseMinYear, datePart.year);
  const maxYear = Math.max(baseMaxYear, datePart.year);
  const years = range(minYear, maxYear);
  const months = range(1, 12);
  const safeMonth = clamp(datePart.month, 1, 12);
  const days = range(1, daysInMonth(datePart.year, safeMonth));
  const safeDay = clamp(datePart.day, 1, days.length);
  const hours = range(0, 23);
  const minutes = buildMinutes(options.minuteStep, timePart.minute);
  const yearIndex = Math.max(0, years.indexOf(datePart.year));
  const monthIndex = safeMonth - 1;
  const dayIndex = safeDay - 1;
  const hourIndex = clamp(timePart.hour, 0, 23);
  const minuteIndex = Math.max(0, minutes.indexOf(timePart.minute));
  const yearLabels = years.map((year) => mode === "datetime" ? pad(year % 100) : String(year));
  const dayLabels = buildDayLabels(datePart.year, safeMonth);
  let pickerValue;
  if (mode === "date") pickerValue = [yearIndex, monthIndex, dayIndex];
  else if (mode === "time") pickerValue = [hourIndex, minuteIndex];
  else pickerValue = [yearIndex, monthIndex, dayIndex, hourIndex, minuteIndex];

  return {
    mode,
    years,
    yearLabels,
    months,
    days,
    dayLabels,
    hours,
    minutes,
    pickerValue,
    showDate: mode !== "time",
    showTime: mode !== "date"
  };
}

module.exports = {
  pad,
  clamp,
  daysInMonth,
  range,
  buildMinutes,
  parseDateValue,
  parseTimeValue,
  roundUpToMinuteStep,
  formatDate,
  formatTime,
  formatDayWithWeekday,
  buildDayLabels,
  buildPickerState
};
