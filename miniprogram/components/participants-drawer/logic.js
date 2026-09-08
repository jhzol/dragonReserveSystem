const ACTION_WIDTH_RPX = 323.08;
const ACTION_AREA_WIDTH_RPX = 315.38;
const REMOVE_ACTION_WIDTH_RPX = 161.54;
const REMOVE_ACTION_AREA_WIDTH_RPX = 153.85;
const SWIPE_OPEN_THRESHOLD_RATIO = 0.25;
// 已展开行右滑回收只需移动操作区宽度的 15%，避免沿用“从关闭态打开”的全局阈值。
const SWIPE_CLOSE_THRESHOLD_RATIO = 0.15;
const DRAWER_MAX_HEIGHT_RATIO = 0.85;
const DEFAULT_MAX_HEIGHT_RPX = 1384.62;

function getMaxHeightRpx() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const width = Number(info && info.windowWidth);
    const height = Number(info && info.windowHeight);
    if (width > 0 && height > 0) {
      return Math.round(height * DRAWER_MAX_HEIGHT_RATIO * 750 / width * 100) / 100;
    }
  } catch (error) {
    // Use the design fallback when the runtime metrics are unavailable.
  }
  return DEFAULT_MAX_HEIGHT_RPX;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSwipeSettledState(startOffsetX, endOffsetX, actionWidthRpx = ACTION_WIDTH_RPX) {
  const resolvedActionWidthRpx = Math.max(0, Number(actionWidthRpx) || 0);
  const startedOpen = Number(startOffsetX) < 0;
  const movedRightRpx = Number(endOffsetX) - Number(startOffsetX);
  const openThresholdRpx = resolvedActionWidthRpx * SWIPE_OPEN_THRESHOLD_RATIO;
  const closeThresholdRpx = resolvedActionWidthRpx * SWIPE_CLOSE_THRESHOLD_RATIO;
  const actionOpen = startedOpen
    ? movedRightRpx < closeThresholdRpx
    : Math.abs(Number(endOffsetX) || 0) >= openThresholdRpx;
  return {
    offsetX: actionOpen ? -resolvedActionWidthRpx : 0,
    actionOpen
  };
}

function getActionMetrics(canManage, isAdmin) {
  if (!canManage) {
    return { actionOffsetRpx: 0, actionAreaWidthRpx: 0 };
  }
  return isAdmin
    ? { actionOffsetRpx: ACTION_WIDTH_RPX, actionAreaWidthRpx: ACTION_AREA_WIDTH_RPX }
    : { actionOffsetRpx: REMOVE_ACTION_WIDTH_RPX, actionAreaWidthRpx: REMOVE_ACTION_AREA_WIDTH_RPX };
}

function formatCheckinParts(value) {
  if (!value) return { date: "—", time: "—" };
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return { date: "—", time: "—" };
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  };
}

function hasParticipantLimit(maxParticipants) {
  if (maxParticipants === null || maxParticipants === undefined || maxParticipants === "") {
    return false;
  }
  // 后端以 null 表示不限人数；0 不是合法人数上限，兼容旧数据时也按不限人数处理。
  const limit = Number(maxParticipants);
  return Number.isFinite(limit) && limit > 0;
}

function buildProgressView(participantCount, checkinCount, maxParticipants) {
  const participants = Math.max(0, Number(participantCount) || 0);
  const checkedIn = clamp(Number(checkinCount) || 0, 0, participants);
  const hasLimit = hasParticipantLimit(maxParticipants);
  const max = hasLimit ? Math.max(0, Number(maxParticipants) || 0) : null;
  const remaining = Math.max(0, participants - checkedIn);
  return {
    participantCountText: String(participants),
    participantLimitText: hasLimit ? `${max} 人` : "",
    participantHasLimit: hasLimit,
    progressPercent: participants > 0 ? Math.round((checkedIn / participants) * 10000) / 100 : 0,
    progressWidth: `${participants > 0 ? (checkedIn / participants) * 100 : 0}%`,
    progressMessage: participants === 0 ? "暂无成员报名" : (remaining > 0 ? `还有 ${remaining} 人未签到` : "已全部签到")
  };
}

module.exports = {
  ACTION_WIDTH_RPX,
  ACTION_AREA_WIDTH_RPX,
  REMOVE_ACTION_WIDTH_RPX,
  REMOVE_ACTION_AREA_WIDTH_RPX,
  DRAWER_MAX_HEIGHT_RATIO,
  DEFAULT_MAX_HEIGHT_RPX,
  getMaxHeightRpx,
  SWIPE_OPEN_THRESHOLD_RATIO,
  SWIPE_CLOSE_THRESHOLD_RATIO,
  clamp,
  getSwipeSettledState,
  getActionMetrics,
  formatCheckinParts,
  buildProgressView,
  hasParticipantLimit
};
