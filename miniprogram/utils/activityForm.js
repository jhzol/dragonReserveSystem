const { roundUpToMinuteStep, formatDate, formatTime } = require("./dateTimePicker");

const DEFAULT_MAX_PARTICIPANTS = 12;
const MAX_NAME_LENGTH = 10;
const MAX_REMARK_LENGTH = 120;

function splitDateTime(value, fallback = {}) {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  return {
    date: matched ? matched[1] : (fallback.date || ""),
    time: matched ? matched[2] : (fallback.time || "")
  };
}

function toLocalDateTime(date, time) {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateParts(date) {
  return {
    date: formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate()),
    time: formatTime(date.getHours(), date.getMinutes())
  };
}

function buildCreateForm(now = new Date()) {
  const start = roundUpToMinuteStep(new Date(now.getTime() + 2 * 60 * 60 * 1000), 5);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const deadline = new Date(start.getTime() - 60 * 60 * 1000);
  const startParts = dateParts(start);
  const endParts = dateParts(end);
  const deadlineParts = dateParts(deadline);

  return {
    name: "",
    status: "未开始",
    remark: "",
    startDate: startParts.date,
    startTime: startParts.time,
    endDate: endParts.date,
    endTime: endParts.time,
    signupDeadlineDate: deadlineParts.date,
    signupDeadlineTime: deadlineParts.time,
    locationName: "",
    locationAddress: "",
    locationLatitude: null,
    locationLongitude: null,
    signupEnabled: true,
    limitEnabled: true,
    maxParticipants: DEFAULT_MAX_PARTICIPANTS,
    activityCoverId: ""
  };
}

function buildEditForm(activity = {}) {
  const start = splitDateTime(activity.startTime, { date: activity.date || "", time: "00:00" });
  const end = splitDateTime(activity.endTime, { date: activity.date || start.date, time: "01:00" });
  let deadline = splitDateTime(activity.signupDeadline);
  if (!deadline.date || !deadline.time) {
    const startDateTime = toLocalDateTime(start.date, start.time);
    if (startDateTime) deadline = dateParts(new Date(startDateTime.getTime() - 60 * 60 * 1000));
    else deadline = { date: start.date, time: start.time };
  }
  const maxParticipants = activity.maxParticipants == null
    ? DEFAULT_MAX_PARTICIPANTS
    : Number(activity.maxParticipants);

  return {
    name: String(activity.name || ""),
    status: String(activity.status || "未开始"),
    remark: String(activity.remark || ""),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    signupDeadlineDate: deadline.date,
    signupDeadlineTime: deadline.time,
    locationName: String(activity.locationName || ""),
    locationAddress: String(activity.locationAddress || ""),
    locationLatitude: activity.locationLatitude == null ? null : activity.locationLatitude,
    locationLongitude: activity.locationLongitude == null ? null : activity.locationLongitude,
    signupEnabled: activity.signupEnabled !== false,
    limitEnabled: activity.maxParticipants != null,
    maxParticipants,
    activityCoverId: String(activity.activityCoverId || activity.activity_cover_id || "")
  };
}

function applyStartDateTime(form, value) {
  const next = { ...form };
  const start = splitDateTime(value);
  if (!start.date || !start.time) return next;
  next.startDate = start.date;
  next.startTime = start.time;

  const startDateTime = toLocalDateTime(start.date, start.time);
  if (!startDateTime) return next;
  if (!next.endDate || !next.endTime) {
    const end = dateParts(new Date(startDateTime.getTime() + 60 * 60 * 1000));
    next.endDate = end.date;
    next.endTime = end.time;
  }
  if (!next.signupDeadlineDate || !next.signupDeadlineTime) {
    const deadline = dateParts(new Date(startDateTime.getTime() - 60 * 60 * 1000));
    next.signupDeadlineDate = deadline.date;
    next.signupDeadlineTime = deadline.time;
  }
  return next;
}

function validateActivityForm(form, options = {}) {
  const mode = options.mode === "edit" ? "edit" : "create";
  const now = options.now instanceof Date ? options.now : new Date();
  const participantCount = Math.max(0, Number(options.participantCount) || 0);
  const name = String(form && form.name || "").trim();
  const remark = String(form && form.remark || "").trim();

  if (!name) return { ok: false, message: "请输入活动名称" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, message: `活动名称不能超过 ${MAX_NAME_LENGTH} 个字` };
  if (!remark) return { ok: false, message: "请输入活动备注" };
  if (remark.length > MAX_REMARK_LENGTH) return { ok: false, message: `活动备注不能超过 ${MAX_REMARK_LENGTH} 个字` };
  if (!String(form && form.activityCoverId || "").trim()) return { ok: false, message: "请选择活动封面" };

  const start = toLocalDateTime(form.startDate, form.startTime);
  const end = toLocalDateTime(form.endDate, form.endTime);
  const deadline = toLocalDateTime(form.signupDeadlineDate, form.signupDeadlineTime);
  if (!start) return { ok: false, message: "请选择有效的开始时间" };
  if (!end) return { ok: false, message: "请选择有效的结束时间" };
  if (!deadline) return { ok: false, message: "请选择有效的报名截止时间" };
  if (mode === "create" && start.getTime() < now.getTime()) {
    return { ok: false, message: "开始时间不能早于当前时间" };
  }
  if (end.getTime() <= start.getTime()) return { ok: false, message: "结束时间必须晚于开始时间" };
  if (deadline.getTime() > start.getTime()) return { ok: false, message: "报名截止时间必须早于或等于开始时间" };
  if (deadline.getTime() >= end.getTime()) return { ok: false, message: "报名截止时间必须早于结束时间" };

  if (form.limitEnabled) {
    const maxParticipants = Number(form.maxParticipants);
    if (!Number.isInteger(maxParticipants) || maxParticipants < 1) {
      return { ok: false, message: "人数上限需为 1–999 的整数" };
    }
    if (maxParticipants > 999) return { ok: false, message: "人数上限不能超过 999" };
    if (mode === "edit" && maxParticipants < participantCount) {
      return { ok: false, message: `人数上限不能低于当前报名人数 ${participantCount}` };
    }
  }

  return { ok: true, message: "" };
}

function buildActivityPayload(form, options = {}) {
  const payload = {
    name: String(form.name || "").trim(),
    remark: String(form.remark || "").trim(),
    start_time: `${form.startDate}T${form.startTime}:00`,
    end_time: `${form.endDate}T${form.endTime}:00`,
    signup_deadline: `${form.signupDeadlineDate}T${form.signupDeadlineTime}:00`,
    location_name: String(form.locationName || ""),
    location_address: String(form.locationAddress || ""),
    location_latitude: form.locationLatitude == null ? null : form.locationLatitude,
    location_longitude: form.locationLongitude == null ? null : form.locationLongitude,
    max_participants: form.limitEnabled ? Number(form.maxParticipants) : null,
    signup_enabled: form.signupEnabled !== false,
    activity_cover_id: String(form.activityCoverId || "").trim()
  };
  return payload;
}

module.exports = {
  DEFAULT_MAX_PARTICIPANTS,
  MAX_NAME_LENGTH,
  MAX_REMARK_LENGTH,
  splitDateTime,
  toLocalDateTime,
  buildCreateForm,
  buildEditForm,
  applyStartDateTime,
  validateActivityForm,
  buildActivityPayload
};
