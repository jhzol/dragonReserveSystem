/**
 * Shared activity adaptation + list-style enrichment for detail page.
 * Mirrors activity_list processActivityList mapping for a single item.
 */

const pad = (n) => (n < 10 ? `0${n}` : `${n}`);

const { parseCreatedAtMs, orderParticipantsForRecentAvatarSlice } = require("./participantSort");
const { resolveLocalMediaUrl, isLocalTestMediaUrl } = require("../services/config");

const DEFAULT_AVATAR = "/images/default-avatar.svg";
const LOCAL_TEST_AVATAR_PREFIX = "/images/avatars";
const DEFAULT_ACTIVITY_TYPE_KEY = "other";

const DEFAULT_ACTIVITY_TYPE_STYLES = [
  {
    key: "badminton",
    display_name: "羽毛球",
    default_style_key: "badminton-default",
    styles: [
      {
        style_key: "badminton-default",
        style_name: "纯静态图（无头像）",
        badge_label: "Badminton",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/card-bg-badminton-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/card-bg-badminton-sm.png",
        bg_video_url: null
      }
    ]
  },
  {
    key: "boardgame",
    display_name: "桌游",
    default_style_key: "boardgame-default",
    styles: [
      {
        style_key: "boardgame-default",
        style_name: "纯静态图（无头像）",
        badge_label: "Boardgame",
        show_badge: true,
        show_avatar_cluster: true,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/card-bg-boardgame-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/card-bg-boardgame-sm.jpg",
        bg_video_url: null
      }
    ]
  },
  {
    key: "other",
    display_name: "其它",
    default_style_key: "other-video",
    styles: [
      {
        style_key: "other-video",
        style_name: "纯静态图",
        badge_label: "",
        show_badge: false,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/card-bg-other-v2-lg.jpg",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/card-bg-other-v2-sm.jpg",
        bg_video_url: null
      }
    ]
  },
  {
    key: "eating",
    display_name: "吃饭",
    default_style_key: "image-clean",
    styles: [
      {
        style_key: "image-clean",
        style_name: "静态图无头像",
        badge_label: "Eating",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/eating-image-clean-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/eating-image-clean-sm.png",
        bg_video_url: null
      }
    ]
  },
  {
    key: "outing",
    display_name: "\u5916\u51fa",
    default_style_key: "outing-tram",
    styles: [
      {
        style_key: "outing-tram",
        style_name: "\u9759\u6001\u56fe\u65e0\u5934\u50cf",
        badge_label: "Outing",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/outing-tram-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/outing-tram-sm.png",
        bg_video_url: null
      },
      {
        style_key: "outing-cycling",
        style_name: "\u9759\u6001\u56fe\u65e0\u5934\u50cf2",
        badge_label: "Outing",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/outing-cycling-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/outing-cycling-sm.png",
        bg_video_url: null
      }
    ]
  },
  {
    key: "movie",
    display_name: "电影",
    default_style_key: "image-clean",
    styles: [
      {
        style_key: "image-clean",
        style_name: "纯静态图",
        badge_label: "Movie",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/movie-image-clean-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/movie-image-clean-sm.png",
        bg_video_url: null
      },
      {
        style_key: "image-clean-2",
        style_name: "纯静态图2",
        badge_label: "Movie",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/movie-image-clean-2-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/movie-image-clean-2-sm.png",
        bg_video_url: null
      },
      {
        style_key: "image-clean-3",
        style_name: "Static image 3",
        badge_label: "Movie",
        show_badge: true,
        show_avatar_cluster: false,
        large_card_bg_image_url: "https://dragon.liqqihome.top/media/images/movie-image-spiderverse-lg.png",
        small_card_bg_image_url: "https://dragon.liqqihome.top/media/images/movie-image-spiderverse-sm.png",
        bg_video_url: null
      }
    ]
  }
];

function normalizeTypeKey(value) {
  if (value == null) return "";
  const t = String(value).trim().toLowerCase();
  if (!t) return "";
  if (t === "羽毛球") return "badminton";
  if (t === "桌游" || t === "board game") return "boardgame";
  if (t === "其它" || t === "其他") return "other";
  if (t === "吃饭") return "eating";
  if (t === "电影") return "movie";
  if (t === "\u5916\u51fa") return "outing";
  return t;
}

function buildTypeStyleMap(typeStyles) {
  const source = Array.isArray(typeStyles) && typeStyles.length > 0 ? typeStyles : DEFAULT_ACTIVITY_TYPE_STYLES;
  const map = {};
  source.forEach((item) => {
    const key = normalizeTypeKey(item && item.key);
    if (!key) return;
    const styles = Array.isArray(item.styles) ? item.styles : [];
    const styleMap = {};
    styles.forEach((s) => {
      const styleKey = String(s.style_key || "").trim();
      if (!styleKey) return;
      styleMap[styleKey] = {
        styleKey,
        styleName: String(s.style_name || styleKey),
        badgeLabel: String(s.badge_label || ""),
        showBadge: s.show_badge !== false,
        showAvatarCluster: s.show_avatar_cluster !== false,
        largeCardBgImageUrl: String(s.large_card_bg_image_url || ""),
        largeCardGlassImageUrl: "",
        smallCardBgImageUrl: String(s.small_card_bg_image_url || ""),
        bgVideoUrl: s.bg_video_url ? String(s.bg_video_url) : ""
      };
    });
    const defaultStyleKey = String(item.default_style_key || "").trim();
    const fallbackStyleKey = defaultStyleKey && styleMap[defaultStyleKey]
      ? defaultStyleKey
      : (Object.keys(styleMap)[0] || "");
    map[key] = {
      key,
      displayName: String(item.display_name || key),
      defaultStyleKey: fallbackStyleKey,
      styleMap
    };
  });
  if (!map[DEFAULT_ACTIVITY_TYPE_KEY]) {
    map[DEFAULT_ACTIVITY_TYPE_KEY] = {
      key: DEFAULT_ACTIVITY_TYPE_KEY,
      displayName: "其它",
      defaultStyleKey: "",
      styleMap: {}
    };
  }
  return map;
}

function normalizeActivityTypeByMap(rawType, typeStyleMap) {
  const key = normalizeTypeKey(rawType);
  if (key && typeStyleMap[key]) return key;
  return DEFAULT_ACTIVITY_TYPE_KEY;
}

function resolveStyleByTypeAndKey(typeKey, styleKey, typeStyleMap) {
  const typeEntry = typeStyleMap[typeKey] || typeStyleMap[DEFAULT_ACTIVITY_TYPE_KEY];
  if (!typeEntry) return null;
  const styleMap = typeEntry.styleMap || {};
  const normalizedStyleKey = String(styleKey || "").trim();
  if (normalizedStyleKey && styleMap[normalizedStyleKey]) return styleMap[normalizedStyleKey];
  if (typeEntry.defaultStyleKey && styleMap[typeEntry.defaultStyleKey]) return styleMap[typeEntry.defaultStyleKey];
  const firstKey = Object.keys(styleMap)[0];
  return firstKey ? styleMap[firstKey] : null;
}

function normalizeAvatarUrl(url) {
  const value = (url && String(url).trim()) || "";
  if (!value) return DEFAULT_AVATAR;

  const lower = value.toLowerCase();
  if (lower.includes("example.com/")) return DEFAULT_AVATAR;
  if (value.startsWith("/media/")) {
    const m = value.match(/test-avatar-(\d{2})\.svg$/i);
    return m ? `${LOCAL_TEST_AVATAR_PREFIX}/test-avatar-${m[1]}.svg` : DEFAULT_AVATAR;
  }
  if (value.startsWith("media/")) {
    const m = value.match(/test-avatar-(\d{2})\.svg$/i);
    return m ? `${LOCAL_TEST_AVATAR_PREFIX}/test-avatar-${m[1]}.svg` : DEFAULT_AVATAR;
  }
  if (lower.startsWith("http://")) {
    const resolved = resolveLocalMediaUrl(value);
    return isLocalTestMediaUrl(value) ? resolved : DEFAULT_AVATAR;
  }

  return value;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function adaptParticipant(participant) {
  const name = participant.display_nickname || "";
  return {
    id: participant.id,
    name,
    userId: participant.user_id != null ? String(participant.user_id) : null,
    avatarUrl: normalizeAvatarUrl(participant.display_avatar_url),
    checkedInAt: formatDateTime(participant.checked_in_at),
    checkedInAtRaw: participant.checked_in_at || "",
    checkinLat: participant.checkin_lat,
    checkinLng: participant.checkin_lng,
    checkinLocationName: participant.checkin_location_name || "",
    checkinAddress: participant.checkin_address || "",
    signedUpAtMs: parseCreatedAtMs(participant.created_at)
  };
}

function adaptActivity(item) {
  const participants = (item.participants || []).map(adaptParticipant);
  const startTime = formatDateTime(item.start_time);
  const rawType = item.activity_type;
  const rawCover = item.activity_cover && typeof item.activity_cover === "object" ? item.activity_cover : null;
  return {
    _id: String(item.id),
    createdBy: item.created_by != null ? String(item.created_by) : "",
    date: startTime.split(" ")[0] || "",
    name: item.name,
    status: item.status || "进行中",
    remark: item.remark || "",
    participants,
    maxParticipants: item.max_participants == null ? null : item.max_participants,
    startTime,
    endTime: formatDateTime(item.end_time),
    signupDeadline: formatDateTime(item.signup_deadline),
    locationName: item.location_name || "",
    locationAddress: item.location_address || "",
    locationLatitude: item.location_latitude,
    locationLongitude: item.location_longitude,
    signupEnabled: item.signup_enabled !== false,
    activityType: rawType || "other",
    activityStyleKey: item.activity_style_key || "",
    activityCoverId: item.activity_cover_id || (rawCover && rawCover.id) || "",
    activityCover: rawCover ? {
      id: String(rawCover.id || ""),
      artistName: String(rawCover.artist_name || ""),
      artistAvatarUrl: String(rawCover.artist_avatar_url || ""),
      thumbnailUrl: String(rawCover.thumbnail_url || ""),
      imageUrl: String(rawCover.image_url || ""),
      largeCardGlassImageUrl: String(rawCover.large_card_glass_image_url || "")
    } : null,
    weather: item.weather && typeof item.weather === "object" ? item.weather : null,
    _rawActivityType: rawType
  };
}

/**
 * @param {object} rawItem - API activity payload
 * @param {Array} typeStyles - optional legacy cache fallback while upgrading existing local data
 * @param {string} myUserId
 * @param {string} myNickname
 * @param {Date} [now]
 */
function enrichSingleActivity(rawItem, typeStyles, myUserId, myNickname, now) {
  const nowDate = now || new Date();
  const myIdStr = String(myUserId || "").trim();
  const typeStyleMap = buildTypeStyleMap(typeStyles);
  const activity = adaptActivity(rawItem);

  const rawType = activity._rawActivityType;
  const normalizedType = normalizeActivityTypeByMap(rawType, typeStyleMap);
  activity.activityType = normalizedType;
  const selectedStyle = resolveStyleByTypeAndKey(activity.activityType, activity.activityStyleKey, typeStyleMap);
  activity.activityStyleKey = selectedStyle ? selectedStyle.styleKey : "";
  activity.typeBadgeLabel = selectedStyle ? selectedStyle.badgeLabel : "";
  activity.showTypeBadge = selectedStyle ? (!!selectedStyle.showBadge && !!selectedStyle.badgeLabel) : false;
  activity.showAvatarCluster = selectedStyle ? !!selectedStyle.showAvatarCluster : false;
  activity.bgVideoUrl = selectedStyle ? (selectedStyle.bgVideoUrl || "") : "";
  activity.largeCardBgImageUrl = selectedStyle ? (selectedStyle.largeCardBgImageUrl || "") : "";
  activity.largeCardGlassImageUrl = selectedStyle ? (selectedStyle.largeCardGlassImageUrl || "") : "";
  activity.smallCardBgImageUrl = selectedStyle ? (selectedStyle.largeCardBgImageUrl || "") : "";

  if (activity.activityCover && activity.activityCover.imageUrl) {
    activity.largeCardBgImageUrl = activity.activityCover.imageUrl;
    activity.smallCardBgImageUrl = activity.activityCover.imageUrl;
    activity.largeCardGlassImageUrl = activity.activityCover.largeCardGlassImageUrl || "";
    activity.bgVideoUrl = "";
    activity.showTypeBadge = false;
    activity.showAvatarCluster = false;
  }

  const typeEntry = typeStyleMap[normalizedType] || typeStyleMap[DEFAULT_ACTIVITY_TYPE_KEY];
  activity.typeDisplayName = typeEntry ? typeEntry.displayName : "其它";

  let signupDeadline = activity.signupDeadline;
  if (!signupDeadline && activity.startTime) {
    const base = new Date(activity.startTime.replace(" ", "T") + ":00");
    if (!isNaN(base.getTime())) {
      const dl = new Date(base.getTime() - 60 * 60 * 1000);
      signupDeadline = `${dl.getFullYear()}-${pad(dl.getMonth() + 1)}-${pad(dl.getDate())} ${pad(dl.getHours())}:${pad(dl.getMinutes())}`;
    }
  }
  activity.signupDeadline = signupDeadline;

  let hasSignedUp = false;
  let hasCheckedIn = false;
  let checkinCount = 0;
  const rawParticipants = orderParticipantsForRecentAvatarSlice(activity.participants || []);
  const avatarList = [];

  rawParticipants.forEach((p) => {
    if (typeof p === "object" && p !== null) {
      const uid = p.userId;
      const name = (p.name || "").trim();
      const checkedIn = !!p.checkedInAt;
      if (checkedIn) checkinCount += 1;
      const avatarUrl = normalizeAvatarUrl(p.avatarUrl);
      const hasCustomAvatar = avatarUrl !== DEFAULT_AVATAR;
      avatarList.push({ url: avatarUrl, isDefault: !hasCustomAvatar });
      const uidStr = uid != null ? String(uid) : "";
      if (myIdStr && uidStr && uidStr === myIdStr) {
        hasSignedUp = true;
        if (checkedIn) hasCheckedIn = true;
      } else if (myNickname && name === myNickname) {
        hasSignedUp = true;
        if (checkedIn) hasCheckedIn = true;
      }
    } else if (typeof p === "string") {
      avatarList.push({ url: DEFAULT_AVATAR, isDefault: true });
      if (myNickname && p === myNickname) {
        hasSignedUp = true;
      }
    }
  });
  activity.hasSignedUp = hasSignedUp;
  activity.hasCheckedIn = hasCheckedIn;
  activity.checkinCount = checkinCount;
  activity.avatarList = avatarList;
  // 与列表/详情 WXML 一致：avatarList 按报名时间升序，slice(-3) 为最近 3 人 → TL 最大=最新
  activity.cardAvatars = avatarList.slice(-3);

  const max = activity.maxParticipants;
  const currentCount = rawParticipants.length;
  activity.isFull = max != null && currentCount >= max;

  let isSignupClosed = false;
  if (activity.signupEnabled === false) {
    isSignupClosed = true;
  } else if (signupDeadline) {
    const dl = new Date(signupDeadline.replace(" ", "T") + ":00");
    if (!isNaN(dl.getTime())) {
      isSignupClosed = nowDate.getTime() >= dl.getTime();
    }
  }
  activity.isSignupClosed = isSignupClosed;

  const parseDateTime = (s) => new Date(s.replace(" ", "T") + ":00");
  const start = parseDateTime(activity.startTime);
  const end = parseDateTime(activity.endTime);
  let autoStatus = activity.status || "未开始";
  if (["已取消", "已流局"].includes(activity.status)) {
    autoStatus = activity.status;
  } else if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
    if (nowDate.getTime() < start.getTime()) {
      autoStatus = "未开始";
    } else if (nowDate.getTime() < end.getTime()) {
      autoStatus = "进行中";
    } else {
      autoStatus = "已结束";
    }
  }
  if (!["已取消", "已流局"].includes(activity.status)) {
    activity.status = autoStatus;
  }

  const startTimeStr = activity.startTime || (activity.date ? `${activity.date} 00:00` : "");
  activity.activityStarted = startTimeStr
    ? new Date(startTimeStr.replace(" ", "T") + ":00").getTime() <= Date.now()
    : false;
  activity.signupDeadlinePassed = signupDeadline
    ? new Date(signupDeadline.replace(" ", "T") + ":00").getTime() <= Date.now()
    : false;

  const acceptingLike =
    activity.status === "未开始" &&
    !activity.isSignupClosed &&
    activity.signupEnabled !== false &&
    !activity.isFull;

  if (activity.status === "已取消") {
    activity.detailStatusTag = "已取消";
  } else if (activity.status === "已流局") {
    activity.detailStatusTag = "已流局";
  } else if (activity.status === "已结束") {
    activity.detailStatusTag = "已结束";
  } else if (acceptingLike) {
    activity.detailStatusTag = "报名中";
  } else if (activity.status === "进行中") {
    activity.detailStatusTag = "进行中";
  } else {
    activity.detailStatusTag = "未开始";
  }

  return activity;
}

function formatDetailTimeRange(activity) {
  const start = activity.startTime || "";
  if (!start) return "";
  const datePart = start.split(" ")[0] || "";
  const timePart = (start.split(" ")[1] || "").slice(0, 5);
  const end = activity.endTime ? String(activity.endTime) : "";
  const endTimePart = end.split(" ")[1] ? end.split(" ")[1].slice(0, 5) : "";
  const md = datePart.length >= 10 ? `${datePart.slice(5, 7)}.${datePart.slice(8, 10)}` : "";
  if (!md || !timePart) return start;
  return endTimePart ? `${md} ${timePart} - ${endTimePart}` : `${md} ${timePart}`;
}

function formatLocationLine(activity) {
  const a = (activity.locationName || "").trim();
  const b = (activity.locationAddress || "").trim();
  if (a && b) return `${a} ${b}`;
  return a || b || "—";
}

module.exports = {
  DEFAULT_AVATAR,
  DEFAULT_ACTIVITY_TYPE_KEY,
  DEFAULT_ACTIVITY_TYPE_STYLES,
  enrichSingleActivity,
  adaptActivity,
  normalizeAvatarUrl,
  normalizeTypeKey,
  formatDetailTimeRange,
  formatLocationLine,
  buildTypeStyleMap
};
