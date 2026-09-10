const { rankHomeCardImages, cardVisibilityKey } = require("../../utils/homeCardImagePriority");
const { prepareHomeImage, invalidateHomeImageCache } = require("../../utils/homeImagePreparation");
const app = getApp();
const activityService = require("../../services/activity");
const { resolveLocalMediaUrl, isLocalTestMediaUrl } = require("../../services/config");
const { createTraceId, logInfo, summarizeError } = require("../../services/logger");
const { enrichSingleActivity } = require("../../utils/activityEnrich");
const { parseCreatedAtMs, orderParticipantsForRecentAvatarSlice } = require("../../utils/participantSort");
const cacheManager = require("../../services/cacheManager");
const { patchTabBarIfNeeded } = require("../../utils/tabBarSync");
const { createHomeCardMediaLoader } = require("../../utils/homeCardMediaLoader");
const { createHomePresentationDiagnostics } = require("../../utils/homePresentationDiagnostics");
const calendarWarmup = require("../../utils/calendarWarmup");
const { getBottomSafeAreaRpx } = require("../../utils/safeArea");

const pad = (n) => (n < 10 ? `0${n}` : `${n}`);

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function getWeekdayLabel(dateTimeString) {
  if (!dateTimeString) return "";
  const safe = String(dateTimeString).replace(" ", "T");
  const d = new Date(safe);
  if (Number.isNaN(d.getTime())) return "";
  return WEEKDAY_LABELS[d.getDay()];
}

const DEFAULT_AVATAR = "/images/default-avatar.svg";
const LOCAL_TEST_AVATAR_PREFIX = "/images/avatars";
const DEFAULT_ACTIVITY_TYPE_KEY = "other";
const ENDED_ACTIVITY_PAGE_SIZE = 5;
/** 须与 wxml 中 refresher-threshold 一致 */
const MAIN_REFRESH_THRESHOLD_PX = 80;
const COLD_START_CARD_ENTRANCE_DELAY_MS = 400;
const COLD_START_CARD_ENTRANCE_FRAME_MS = 17;
const CREATED_CARD_ENTRANCE_DURATION_MS = 560;
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
  // 测试造数和示例域名经常是占位地址，直接回退默认头像，避免 404
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
    checkinLat: participant.checkin_lat,
    checkinLng: participant.checkin_lng,
    signedUpAtMs: parseCreatedAtMs(participant.created_at)
  };
}

/** 按当前用户重算 hasSignedUp / hasCheckedIn（修复缓存是在旧登录态下写入导致报名态错误） */
function reapplyListParticipationFlags(list, myUserId, myNickname) {
  const myIdStr = String(myUserId || "").trim();
  const nn = String(myNickname || "").trim();
  return (list || []).map((activity) => {
    const rawParticipants = activity.participants || [];
    let hasSignedUp = false;
    let hasCheckedIn = false;
    rawParticipants.forEach((p) => {
      if (typeof p === "object" && p !== null) {
        const uidStr = p.userId != null ? String(p.userId) : "";
        const name = (p.name || "").trim();
        const checkedIn = !!p.checkedInAt;
        if (myIdStr && uidStr && uidStr === myIdStr) {
          hasSignedUp = true;
          if (checkedIn) hasCheckedIn = true;
        } else if (nn && name === nn) {
          hasSignedUp = true;
          if (checkedIn) hasCheckedIn = true;
        }
      } else if (typeof p === "string" && nn && p === nn) {
        hasSignedUp = true;
      }
    });
    return { ...activity, hasSignedUp, hasCheckedIn };
  });
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
    _rawActivityType: rawType
  };
}



function pickCardMediaMetaFromDataset(dataset, mediaType) {
  const safeDataset = dataset || {};
  const rawId = safeDataset.activityId;
  return {
    mediaType,
    group: safeDataset.group || "unknown",
    cardSize: safeDataset.cardSize || "unknown",
    activityId: rawId != null && rawId !== "" ? String(rawId) : "",
    activityName: safeDataset.activityName || "",
    url: safeDataset.url || safeDataset.src || ""
  };
}


Page({
  data: {
    activityList: [],
    filteredList: [],
    groupedActivities: { joined: [], accepting: [], notStarted: [], ended: [] },
    groupSectionVisibility: { joined: false, accepting: false, notStarted: false, ended: false },
    allEndedActivities: [],
    endedHasMore: false,
    endedLoadingMore: false,
    statusBarHeight: 0,
    navBarHeight: 0,
    focusedCardIndex: { joined: 0, accepting: 0, notStarted: 0, ended: 0 },
    mainRefresherTriggered: false,
    mainRefresherHint: "下拉刷新",
    myUserId: "", // 当前用户 openid（用于判断能否删除自己的报名）
    myNickname: "", // 当前用户昵称（userId 为空时的回退，兼容旧数据）
    locationDisabled: false,
    isAdmin: false,
    isGuest: true,
    searchKeyword: "",
    selectedFilter: "我参与的",
    activityTypeStyles: DEFAULT_ACTIVITY_TYPE_STYLES,
    homeListLoading: true,
    skeletonShimmerRunning: false,
    createdCardEntranceId: null,
    createdCardEntranceState: "entered",
    createFormContainerRendered: false,
    showCreateForm: false,
    createFormSubmitting: false,
    bottomSafeAreaRpx: 0
  },

  onLoad(options) {
    this._homeFirstFrameReady = false;
    this._cardEntranceNotBefore = 0;
    this._coldStartTabEntrancePending = false;
    this._cardEntranceTimer = null;
    this._cardEntranceFrameTimer = null;
    this._createdCardEntranceFrameTimer = null;
    this._createdCardEntranceClearTimer = null;
    this._createdCardDrawerDismissed = false;
    this._createdCardGlassReady = true;
    this._createdCardRevealStarted = false;
    this._loadedCardGlassUrls = new Set();
    this._homeReadyImages = new Map();
    this._homeInvalidImageUrls = new Set();
    this._homeEnteredMediaKeys = new Set();
    const aid = options && options.activityId;
    if (aid) {
      if (app && app.globalData) app.globalData.homeTabEntrancePending = false;
      wx.redirectTo({
        url: `/pages/activity_detail/activity_detail?id=${encodeURIComponent(String(aid))}`
      });
      return;
    }
    this._coldStartTabEntrancePending = true;
    if (app && app.globalData) app.globalData.homeTabEntrancePending = true;
    this.syncGuestState();
    this.setData({ bottomSafeAreaRpx: getBottomSafeAreaRpx() });
    // 计算自定义导航栏高度
    try {
      const windowInfo = wx.getWindowInfo();
      const statusBarHeight = windowInfo.statusBarHeight || 20;
      this.setData({
        statusBarHeight,
        navBarHeight: statusBarHeight + 44
      });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 64 });
    }

  },

  onReady() {
    this._homeFirstFrameReady = true;
    this._cardEntranceNotBefore = Date.now() + COLD_START_CARD_ENTRANCE_DELAY_MS;
    this._scheduleColdStartCardEntrance();
    this._startSkeletonShimmer();
  },

  onShow() {
    this._pageVisible = true;
    this._ensureHomePresentationDiagnostics();
    this._loadGeneration = (this._loadGeneration || 0) + 1;
    this.syncGuestState();
    /** 原生弹层也可能触发 show；一级抽屉仍存续时不得提前恢复 Tab。 */
    this._setTabBarHidden(!!(
      this.data.createFormContainerRendered ||
      this.data.showCreateForm ||
      app.globalData.pendingOpenCreateActivity ||
      this._coldStartTabEntrancePending
    ));
    const isAdmin = app.globalData.userRole === "admin";
    const myUserId = app.globalData.userId || wx.getStorageSync("userId") || "";
    const myNickname = (app.globalData.userProfile?.nickname || wx.getStorageSync("userNickname") || "").trim();
    this.setData({ isAdmin, myUserId, myNickname }, () => {
      this.loadActivityListByCachePolicy();
      this.consumePendingCreateActivity();
    });
    patchTabBarIfNeeded(this, {
      selected: 0,
      isAdmin: app.globalData.userRole === "admin",
    });
    this._scheduleColdStartCardEntrance();
    this._startSkeletonShimmer();
  },

  hasCreateActivityPermission() {
    const role = String(app.globalData.userRole || "");
    const token = String(app.globalData.accessToken || wx.getStorageSync("accessToken") || "");
    return !!app.globalData.isAuthenticated && !!token && (role === "user" || role === "admin");
  },

  consumePendingCreateActivity() {
    if (!app.globalData.pendingOpenCreateActivity) return;
    app.globalData.pendingOpenCreateActivity = false;
    if (!this.hasCreateActivityPermission()) {
      this._setTabBarHidden(false);
      return;
    }
    wx.nextTick(() => this.showCreateModal());
  },

  loadActivityListByCachePolicy() {
    const usedCachedList = this.loadActivityListFromCache();
    if (usedCachedList) {
      // V2 activities carry their complete cover presentation.  Render the cache
      // immediately and refresh only the activity payload in the background.
      return this.loadActivityList({ forceNetwork: false, skipCardMediaDiagnostics: true });
    }
    return this.loadActivityList({ forceNetwork: true });
  },

  onHide() {
    this._pageVisible = false;
    this._loadGeneration = (this._loadGeneration || 0) + 1;
    this._finishColdStartCardEntrance();
    this._stopHomeCardMedia({ preserveDownloads: true });
    this._finishCreatedCardEntrance();
    calendarWarmup.cancelScheduledPrefetch();
    /**
     * 页面隐藏时只保留抽屉对 Tab 的隐藏要求；卡片准备状态不影响其他页面的 Tab。
     */
    const keepTabBarHidden = !!(
      this.data.createFormContainerRendered ||
      this.data.showCreateForm
    );
    const self = this;
    const flush = () => self._setTabBarHidden(keepTabBarHidden);
    if (typeof wx !== "undefined" && typeof wx.nextTick === "function") wx.nextTick(flush);
    else flush();
  },

  onUnload() {
    this._pageVisible = false;
    this._loadGeneration = (this._loadGeneration || 0) + 1;
    this._stopHomeCardMedia();
    if (this._createFormCloseTimer) clearTimeout(this._createFormCloseTimer);
    this._createFormCloseTimer = null;
    if (this._cardEntranceTimer) clearTimeout(this._cardEntranceTimer);
    if (this._cardEntranceFrameTimer) clearTimeout(this._cardEntranceFrameTimer);
    if (this._createdCardEntranceFrameTimer) clearTimeout(this._createdCardEntranceFrameTimer);
    if (this._createdCardEntranceClearTimer) clearTimeout(this._createdCardEntranceClearTimer);
    this._cardEntranceTimer = null;
    this._cardEntranceFrameTimer = null;
    this._createdCardEntranceFrameTimer = null;
    this._createdCardEntranceClearTimer = null;
    this._coldStartTabEntrancePending = false;
    if (app && app.globalData) app.globalData.homeTabEntrancePending = false;
    calendarWarmup.cancelScheduledPrefetch();
    const self = this;
    const flush = () => self._setTabBarHidden(false);
    if (typeof wx !== "undefined" && typeof wx.nextTick === "function") wx.nextTick(flush);
    else flush();
  },

  _setTabBarHidden(hidden, { animate = false } = {}) {
    const nextHidden = !!hidden;
    if (app && app.globalData) app.globalData.tabBarHidden = nextHidden;
    if (typeof this.getTabBar !== "function") return;
    const tabBar = this.getTabBar();
    if (!tabBar || typeof tabBar.setData !== "function") return;
    if (typeof tabBar.setHidden === "function") {
      tabBar.setHidden(nextHidden, { animate: !!animate });
      return;
    }
    tabBar.setData({ hidden: nextHidden });
  },

  _buildGroupSectionVisibility(groupedActivities) {
    const groups = groupedActivities || {};
    return Object.keys(groups).reduce((visibility, group) => {
      visibility[group] = Array.isArray(groups[group]) && groups[group].length > 0;
      return visibility;
    }, {});
  },

  _rememberFocusedCard(group, index, groupedActivities = this.data.groupedActivities) {
    const cards = Array.isArray(groupedActivities && groupedActivities[group])
      ? groupedActivities[group]
      : [];
    const activity = cards[index];
    if (!activity || activity._id == null) return;
    this._focusedCardActivityIds = {
      ...(this._focusedCardActivityIds || {}),
      [group]: String(activity._id)
    };
  },

  _rememberFocusedActivity(activityId) {
    if (activityId == null) return;
    const groups = this.data.groupedActivities || {};
    Object.keys(groups).some((group) => {
      const cards = Array.isArray(groups[group]) ? groups[group] : [];
      const index = cards.findIndex((item) => String(item && item._id) === String(activityId));
      if (index < 0) return false;
      this._rememberFocusedCard(group, index, groups);
      return true;
    });
  },

  _resolveFocusedCardIndex(groupedActivities) {
    const previous = this.data.focusedCardIndex || {};
    const focusedIds = this._focusedCardActivityIds || {};
    return Object.keys(previous).reduce((nextFocus, group) => {
      const cards = Array.isArray(groupedActivities && groupedActivities[group])
        ? groupedActivities[group]
        : [];
      const focusedId = focusedIds[group];
      const matchedIndex = focusedId
        ? cards.findIndex((item) => String(item && item._id) === focusedId)
        : -1;
      const previousIndex = Math.max(0, Math.floor(Number(previous[group]) || 0));
      nextFocus[group] = matchedIndex >= 0
        ? matchedIndex
        : Math.min(previousIndex, Math.max(0, cards.length - 1));
      return nextFocus;
    }, {});
  },

  _cardImageUrls(item, group) {
    return [group === "joined" ? item.largeCardBgImageUrl : item.smallCardBgImageUrl,
      group === "joined" ? item.largeCardGlassImageUrl : ""].filter(Boolean);
  },

  _cardMediaKey(item, group) {
    return JSON.stringify([group, String(item._id), ...this._cardImageUrls(item, group), item.bgVideoUrl || ""]);
  },

  _prepareColdStartCardPresentation(groupedActivities) {
    const decorated = {};
    Object.keys(groupedActivities).forEach((group) => {
      decorated[group] = groupedActivities[group].map((item) => {
        const key = this._cardMediaKey(item, group);
        const cover = group === "joined" ? item.largeCardBgImageUrl : item.smallCardBgImageUrl;
        return { ...item, _homeMediaKey: key, _homeMediaReady: this._homeEnteredMediaKeys.has(key),
          _homeMediaError: !this._homeEnteredMediaKeys.has(key) && this._cardImageUrls(item, group).some(url => this._homeExhaustedImages?.has(url)),
          _homeCoverSrc: this._homeReadyImages.get(cover) || "",
          _homeGlassSrc: this._homeReadyImages.get(item.largeCardGlassImageUrl) || "" };
      });
    });
    return {
      groupedActivities: decorated,
      groupSectionVisibility: this._buildGroupSectionVisibility(decorated)
    };
  },

  _ensureHomePresentationDiagnostics() {
    if (this._homePresentationDiagnostics || this._pageVisible === false) return;
    this._homePresentationDiagnostics = createHomePresentationDiagnostics({
      page: this, wxApi: wx, traceId: createTraceId("home-view"),
      emit: (event, payload) => logInfo(event, payload)
    });
  },

  // Tab entrance is gated only by the page's first frame, never by requests/images.
  _scheduleColdStartCardEntrance() {
    if (this._pageVisible === false || !this._homeFirstFrameReady) return;
    if (this._coldStartTabEntrancePending && !this._cardEntranceTimer) {
      const waitMs = Math.max(0, this._cardEntranceNotBefore - Date.now());
      this._cardEntranceTimer = setTimeout(() => {
        this._cardEntranceTimer = null;
        if (this._pageVisible === false) return;
        this._coldStartTabEntrancePending = false;
        if (app && app.globalData) app.globalData.homeTabEntrancePending = false;
        if (!this.data.createFormContainerRendered && !this.data.showCreateForm && !app.globalData.pendingOpenCreateActivity) {
          this._setTabBarHidden(false, { animate: true });
        }
      }, waitMs);
    }
    this._ensureHomePresentationDiagnostics();
    this._prepareHomeCardImages();
    this._scheduleReadyHomeCards();
    this._startSkeletonShimmer();
  },

  _prepareHomeCardImages({ retryFailed = false } = {}) {
    if (this._pageVisible === false) return;
    if (!this._homeImageLoader) {
      this._homeImageLoader = createHomeCardMediaLoader({
        onStage: (url, name, details) => this._homePresentationDiagnostics?.phase(url, name,
          { ...details, ...(name === "worker_started" ? { startPriority: this._homeImagePriorities?.get(url) } : {}) }),
        load: (url, ready, failed, context) => prepareHomeImage({ wxApi: wx, url, ready, failed,
          stage: (name, details) => context.report(name, details)
        }),
        onReady: (url, path) => {
          this._homePresentationDiagnostics?.media(url, "preload", "loaded");
          this._markHomeImageReady(url, path);
        },
        onExhausted: (url) => this._setHomeImageExhausted(url, true),
        onError: (url, error) => {
          this._homePresentationDiagnostics?.media(url, "preload", summarizeError(error));
          this._homePresentationDiagnostics?.snapshot("preload_error", { url: String(url).split(/[?#]/)[0], summary: summarizeError(error) });
        }
      });
    }
    this._resetInvalidHomeImages();
    // Completions while hidden are cached without mutating a hidden page.
    for (const [url, path] of this._homeReadyImages) this._markHomeImageReady(url, path);
    this._observeHomeCardVisibility();
    if (this._homeVisibilityCollecting) {
      this._homeImageLoader.pause();
      if (retryFailed) this._homePendingRetry = true;
      return;
    }
    retryFailed = retryFailed || !!this._homePendingRetry;
    this._homePendingRetry = false;
    const ranked = rankHomeCardImages({ groups: this.data.groupedActivities || {},
      focused: this.data.focusedCardIndex, visible: this._homeVisibleCardKeys,
      visibilityKnown: !!this._homeVisibilityKnown });
    this._homeImagePriorities = new Map(ranked.map(({ url, priority }) => [url, priority]));
    ranked.forEach(({ url, priority }) => {
      this._homePresentationDiagnostics?.phase(url, "priority_updated", { priority });
    });
    const pendingUrls = ranked.map(item => item.url).filter(url => !this._homeReadyImages.has(url));
    if (retryFailed) pendingUrls.forEach(url => this._setHomeImageExhausted(url, false));
    this._homeImageLoader.enqueue(pendingUrls, { retryFailed, prioritize: true,
      foregroundUrls: ranked.filter(item => item.priority === 0).map(item => item.url) });
    this._homeImageLoader.resume();
    for (const url of this._homeExhaustedImages || []) this._setHomeImageExhausted(url, true);
  },

  _observeHomeCardVisibility() {
    if (typeof this.createIntersectionObserver !== "function") return;
    const groups = this.data.groupedActivities || {};
    const signature = JSON.stringify(Object.keys(groups).map(group => [group, groups[group].map(item => String(item._id))]));
    if (this._homeVisibilitySignature === signature) return;
    this._homeVisibilitySignature = signature;
    if (this._homeVisibilityObserver) this._homeVisibilityObserver.disconnect();
    const generation = (this._homeVisibilityGeneration || 0) + 1;
    this._homeVisibilityGeneration = generation;
    this._homeVisibleCardKeys = new Set();
    this._homeVisibilityKnown = false;
    this._homeVisibilityCollecting = true;
    clearTimeout(this._homeVisibilityInitialTimer);
    // Collect the initial observer batch, including partially exposed cards.
    // A missing callback must not prevent loading: bounded fallback at 120ms.
    this._homeVisibilityInitialTimer = setTimeout(() => {
      this._homeVisibilityInitialTimer = null;
      if (this._pageVisible === false || this._homeVisibilityGeneration !== generation) return;
      this._homeVisibilityCollecting = false;
      if (!this._homeVisibleCardKeys.size) this._homeVisibilityKnown = false;
      this._prepareHomeCardImages();
    }, 120);
    wx.nextTick(() => {
      if (this._pageVisible === false || this._homeVisibilityGeneration !== generation) return;
      try {
        const observer = this.createIntersectionObserver({ observeAll: true, thresholds: [0, 0.01] });
        this._homeVisibilityObserver = observer;
        observer.relativeTo(".main-scroll").relativeToViewport().observe(".home-card-slot", result => {
          if (this._pageVisible === false || this._homeVisibilityGeneration !== generation) return;
          const data = result.dataset || {};
          if (!data.group || data.activityId == null) return;
          const key = cardVisibilityKey(data.group, data.activityId);
          const visible = result.intersectionRatio > 0;
          const changed = !this._homeVisibilityKnown || this._homeVisibleCardKeys.has(key) !== visible;
          this._homeVisibilityKnown = true;
          if (visible) this._homeVisibleCardKeys.add(key);
          else this._homeVisibleCardKeys.delete(key);
          if (changed) this._scheduleHomeImagePriorityUpdate();
        });
      } catch (_) {
        // Visibility diagnostics must never gate media loading on older runtimes.
        if (this._homeVisibilityObserver) this._homeVisibilityObserver.disconnect();
        this._homeVisibilityObserver = null;
        this._homeVisibilityKnown = false;
        this._homeVisibilityCollecting = false;
        clearTimeout(this._homeVisibilityInitialTimer);
        this._homeVisibilityInitialTimer = null;
        this._scheduleHomeImagePriorityUpdate();
      }
    });
  },

  _scheduleHomeImagePriorityUpdate() {
    if (this._pageVisible === false || this._homePriorityTimer) return;
    this._homePriorityTimer = setTimeout(() => {
      this._homePriorityTimer = null;
      this._prepareHomeCardImages();
    }, 32);
  },

  _setHomeImageExhausted(url, exhausted) {
    if (!url) return;
    if (!this._homeExhaustedImages) this._homeExhaustedImages = new Set();
    if (exhausted && !this._homeReadyImages.has(url)) this._homeExhaustedImages.add(url);
    else this._homeExhaustedImages.delete(url);
    if (this._pageVisible === false) return;
    const patch = {};
    Object.entries(this.data.groupedActivities || {}).forEach(([group, cards]) => {
      cards.forEach((item, index) => {
        const failed = !item._homeMediaReady && this._cardImageUrls(item, group)
          .some(src => this._homeExhaustedImages.has(src));
        if (!!item._homeMediaError !== failed) patch[`groupedActivities.${group}[${index}]._homeMediaError`] = failed;
      });
    });
    if (Object.keys(patch).length) this.setData(patch);
  },

  onRetryHomeCard(e) {
    if (this._pageVisible === false) return;
    const { group, activityId } = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const item = (this.data.groupedActivities[group] || []).find(card => String(card._id) === String(activityId));
    if (!item || item._homeMediaReady || !item._homeMediaError) return;
    const urls = this._cardImageUrls(item, group).filter(url => !this._homeReadyImages.has(url));
    urls.forEach(url => this._setHomeImageExhausted(url, false));
    this._prepareHomeCardImages();
    this._homeImageLoader?.enqueue(urls, { retryFailed: true });
    this._startSkeletonShimmer();
  },

  _isCurrentHomeImageEvent(e, role) {
    const data = (e && e.currentTarget && e.currentTarget.dataset) || {};
    // Older event callers have no source token. Current image elements always do.
    if (data.mediaSrc == null) return true;
    if (!data.mediaSrc || this._homeReadyImages.get(data.url) !== data.mediaSrc) return false;
    const group = data.group || "joined";
    const item = (this.data.groupedActivities[group] || []).find(card => String(card._id) === String(data.activityId));
    if (!item) return false;
    const url = role === "glass" ? item.largeCardGlassImageUrl
      : group === "joined" ? item.largeCardBgImageUrl : item.smallCardBgImageUrl;
    const src = role === "glass" ? item._homeGlassSrc : item._homeCoverSrc;
    return url === data.url && src === data.mediaSrc;
  },

  _resetInvalidHomeImages() {
    if (this._pageVisible === false || !this._homeInvalidImageUrls?.size) return;
    const patch = {};
    Object.entries(this.data.groupedActivities || {}).forEach(([group, cards]) => {
      cards.forEach((item, index) => {
        const cover = group === "joined" ? item.largeCardBgImageUrl : item.smallCardBgImageUrl;
        const badCover = this._homeInvalidImageUrls.has(cover);
        const badGlass = group === "joined" && this._homeInvalidImageUrls.has(item.largeCardGlassImageUrl);
        if (!badCover && !badGlass) return;
        const prefix = `groupedActivities.${group}[${index}]`;
        if (badCover) patch[`${prefix}._homeCoverSrc`] = "";
        if (badGlass) patch[`${prefix}._homeGlassSrc`] = "";
        patch[`${prefix}._homeMediaReady`] = false;
        patch[`${prefix}._homeMediaError`] = false;
        this._homeEnteredMediaKeys.delete(this._cardMediaKey(item, group));
      });
    });
    this._homeInvalidImageUrls.clear();
    if (Object.keys(patch).length) this.setData(patch);
  },

  _recoverHomeImage(e) {
    const { url } = (e && e.currentTarget && e.currentTarget.dataset) || {};
    // Only invalidate prepared files. A duplicate error must not restart an
    // in-flight transfer, reset its retry budget, or revive an unloaded page.
    if (!url || !this._homeImageLoader || !this._homeReadyImages.has(url)) return;
    this._homeReadyImages.delete(url);
    this._loadedCardGlassUrls.delete(url);
    if (!this._homeInvalidImageUrls) this._homeInvalidImageUrls = new Set();
    this._homeInvalidImageUrls.add(url);
    this._resetInvalidHomeImages();
    invalidateHomeImageCache(wx, url);
    this._homeImageLoader.invalidateReady(url);
    this._startSkeletonShimmer();
  },

  _markHomeImageReady(url, path) {
    if (!url) return;
    if (this._pageVisible === false) {
      if (path) this._homeReadyImages.set(url, path);
      return;
    }
    this._setHomeImageExhausted(url, false);
    if (!this._homeReadyImages.has(url)) this._homeReadyImages.set(url, path || url);
    this._loadedCardGlassUrls.add(url);
    const created = Object.values(this.data.groupedActivities || {}).flat().find(
      (item) => String(item._id) === String(this.data.createdCardEntranceId)
    );
    if (created && created.largeCardGlassImageUrl === url) this._markCreatedCardGlassReady(created._id);
    const patch = {};
    Object.keys(this.data.groupedActivities || {}).forEach((group) => {
      this.data.groupedActivities[group].forEach((item, index) => {
        const cover = group === "joined" ? item.largeCardBgImageUrl : item.smallCardBgImageUrl;
        if (cover === url && path && item._homeCoverSrc !== path) patch[`groupedActivities.${group}[${index}]._homeCoverSrc`] = path;
        if (group === "joined" && item.largeCardGlassImageUrl === url && path && item._homeGlassSrc !== path) patch[`groupedActivities.${group}[${index}]._homeGlassSrc`] = path;
      });
    });
    if (Object.keys(patch).length) this.setData(patch, () => this._scheduleReadyHomeCards());
    else this._scheduleReadyHomeCards();
  },

  _scheduleReadyHomeCards() {
    if (this._pageVisible === false || !this._homeFirstFrameReady || this._cardEntranceFrameTimer) return;
    this._cardEntranceFrameTimer = setTimeout(() => {
      this._cardEntranceFrameTimer = null;
      if (this._pageVisible === false) return;
      const patch = {};
      Object.keys(this.data.groupedActivities || {}).forEach((group) => {
        this.data.groupedActivities[group].forEach((item, index) => {
          if (item._homeMediaReady) return;
          const urls = this._cardImageUrls(item, group);
          const videoOnlyPending = !urls.length && item.bgVideoUrl && !this._homeReadyImages.has(item.bgVideoUrl);
          if (videoOnlyPending || !urls.every((url) => this._homeReadyImages.has(url))) return;
          const key = this._cardMediaKey(item, group);
          this._homeEnteredMediaKeys.add(key);
          patch[`groupedActivities.${group}[${index}]._homeMediaReady`] = true;
        });
      });
      if (Object.keys(patch).length) this.setData(patch, () => this._homePresentationDiagnostics?.check());
      else this._homePresentationDiagnostics?.check();
    }, COLD_START_CARD_ENTRANCE_FRAME_MS);
  },

  _startSkeletonShimmer() {
    if (!this._homeFirstFrameReady || this._pageVisible === false || this._skeletonShimmerTimer) return;
    const tick = () => {
      if (this._pageVisible === false) return;
      const pending = this.data.homeListLoading || Object.values(this.data.groupedActivities || {})
        .some((cards) => cards.some((item) => !item._homeMediaReady && !item._homeMediaError));
      if (!pending) {
        this._skeletonShimmerTimer = null;
        if (this.data.skeletonShimmerRunning) this.setData({ skeletonShimmerRunning: false });
        return;
      }
      this.setData({ skeletonShimmerRunning: !this.data.skeletonShimmerRunning });
      this._skeletonShimmerTimer = setTimeout(tick, this.data.skeletonShimmerRunning ? 1500 : 100);
    };
    tick();
  },

  _stopHomeCardMedia({ preserveDownloads = false } = {}) {
    this._homeVisibilityGeneration = (this._homeVisibilityGeneration || 0) + 1;
    if (this._homeVisibilityObserver) this._homeVisibilityObserver.disconnect();
    this._homeVisibilityObserver = null;
    this._homeVisibilitySignature = null;
    clearTimeout(this._homeVisibilityInitialTimer);
    this._homeVisibilityInitialTimer = null;
    this._homeVisibilityCollecting = false;
    this._homePendingRetry = false;
    this._homeVisibilityKnown = false;
    this._homeVisibleCardKeys = new Set();
    this._homeImagePriorities = null;
    clearTimeout(this._homePriorityTimer);
    this._homePriorityTimer = null;
    if (this._homeImageLoader) {
      if (preserveDownloads) this._homeImageLoader.pause();
      else this._homeImageLoader.dispose();
    }
    this._homePresentationDiagnostics?.stop();
    this._homePresentationDiagnostics = null;
    if (!preserveDownloads) this._homeImageLoader = null;
    if (!preserveDownloads) this._homeExhaustedImages = new Set();
    const reset = {};
    Object.entries(this.data.groupedActivities || {}).forEach(([group, cards]) => cards.forEach((item, index) => {
      if (item._homeMediaError) reset[`groupedActivities.${group}[${index}]._homeMediaError`] = false;
    }));
    if (Object.keys(reset).length) this.setData(reset);
    clearTimeout(this._skeletonShimmerTimer);
    this._skeletonShimmerTimer = null;
  },

  _finishColdStartCardEntrance() {
    clearTimeout(this._cardEntranceTimer);
    clearTimeout(this._cardEntranceFrameTimer);
    this._cardEntranceTimer = null;
    this._cardEntranceFrameTimer = null;
  },

  _finishCreatedCardEntrance() {
    if (this._createdCardEntranceFrameTimer) {
      clearTimeout(this._createdCardEntranceFrameTimer);
      this._createdCardEntranceFrameTimer = null;
    }
    if (this._createdCardEntranceClearTimer) {
      clearTimeout(this._createdCardEntranceClearTimer);
      this._createdCardEntranceClearTimer = null;
    }
    this._createdCardDrawerDismissed = false;
    this._createdCardGlassReady = true;
    this._createdCardRevealStarted = false;
    if (this.data.createdCardEntranceId != null) {
      this.setData({
        createdCardEntranceId: null,
        createdCardEntranceState: "entered"
      });
    }
  },

  _revealCreatedCard() {
    if (this.data.createdCardEntranceId == null) return;
    this._createdCardDrawerDismissed = true;
    this._tryRevealCreatedCard();
  },

  _tryRevealCreatedCard() {
    if (
      this.data.createdCardEntranceId == null ||
      !this._createdCardDrawerDismissed ||
      !this._createdCardGlassReady ||
      this._createdCardRevealStarted
    ) return;
    if (this._pageVisible === false) {
      this._finishCreatedCardEntrance();
      return;
    }
    this._createdCardRevealStarted = true;
    if (this._createdCardEntranceFrameTimer) clearTimeout(this._createdCardEntranceFrameTimer);
    const enter = () => {
      if (this._pageVisible === false || this.data.createdCardEntranceId == null) return;
      this._createdCardEntranceFrameTimer = setTimeout(() => {
        this._createdCardEntranceFrameTimer = null;
        if (this._pageVisible === false || this.data.createdCardEntranceId == null) return;
        this.setData({ createdCardEntranceState: "entered" });
        this._createdCardEntranceClearTimer = setTimeout(() => {
          this._createdCardEntranceClearTimer = null;
          this.setData({ createdCardEntranceId: null });
        }, CREATED_CARD_ENTRANCE_DURATION_MS);
      }, COLD_START_CARD_ENTRANCE_FRAME_MS);
    };
    if (typeof wx !== "undefined" && typeof wx.nextTick === "function") wx.nextTick(enter);
    else enter();
  },

  _markCreatedCardGlassReady(activityId) {
    if (
      this.data.createdCardEntranceId == null ||
      String(activityId || "") !== String(this.data.createdCardEntranceId)
    ) return;
    this._createdCardGlassReady = true;
    this._tryRevealCreatedCard();
  },

  _syncVideoFocus(group, oldIndex, newIndex) {
    const previousIndex = typeof oldIndex === "number" ? oldIndex : 0;
    const nextIndex = typeof newIndex === "number" ? newIndex : previousIndex;
    if (previousIndex === nextIndex) return;

    try {
      wx.createVideoContext(`vid-${group}-${previousIndex}`, this).stop();
    } catch (e) {}

    setTimeout(() => {
      try {
        wx.createVideoContext(`vid-${group}-${nextIndex}`, this).play();
      } catch (e) {}
    }, 30);
  },

  onGroupSwiperChange(e) {
    const group = e.currentTarget && e.currentTarget.dataset
      ? String(e.currentTarget.dataset.group || "")
      : "";
    if (!group || !Object.prototype.hasOwnProperty.call(this.data.focusedCardIndex, group)) return;
    const current = Math.max(0, Math.floor(Number(e.detail && e.detail.current) || 0));
    const previous = Number(this.data.focusedCardIndex[group]) || 0;
    this._homePresentationDiagnostics?.swipe();
    this._rememberFocusedCard(group, current);
    this.setData({ [`focusedCardIndex.${group}`]: current }, () => {
      this._syncVideoFocus(group, previous, current);
      // Native intersection updates cover scrolling and partial cards. Promote a
      // touched swiper immediately too, without waiting for its animation to end.
      if (e.detail && e.detail.source === "touch") {
        this._homeVisibleCardKeys = this._homeVisibleCardKeys || new Set();
        (this.data.groupedActivities[group] || []).forEach((item, index) => {
          const key = cardVisibilityKey(group, item._id);
          if (index === current) this._homeVisibleCardKeys.add(key);
          else this._homeVisibleCardKeys.delete(key);
        });
      }
      this._prepareHomeCardImages();
      const endedCount = (this.data.groupedActivities.ended || []).length;
      if (group === "ended" && this.data.endedHasMore && current === endedCount) {
        this.loadMoreEndedActivities();
      }
    });
  },

  /** 「已结束」横向滑到末尾加载格或点击加载格 */
  onEndedHorizontalLoadMore() {
    this.loadMoreEndedActivities();
  },

  onMainScroll(e) {
    const scrollTop = (e && e.detail && typeof e.detail.scrollTop === "number") ? e.detail.scrollTop : null;

    // 节流：避免日志刷屏
    const now = Date.now();
    if (this._lastScrollLogAt && now - this._lastScrollLogAt < 350) return;
    this._lastScrollLogAt = now;

    if (this._didMeasureAtScrollTop0 == null && (scrollTop === 0 || (scrollTop != null && scrollTop < 2))) {
      this._didMeasureAtScrollTop0 = true;
    }

    // 在滚动接近 0 / 50 / 120 这些点采样一次布局，用于判断“顶部是否跟随滚动”和 Logo 层级
    const shouldMeasure =
      this._lastMeasuredBucket == null ||
      (scrollTop != null && Math.abs(scrollTop - (this._lastMeasuredScrollTop || 0)) > 60);
    if (!shouldMeasure) return;
    this._lastMeasuredScrollTop = scrollTop || 0;
    this._lastMeasuredBucket = Math.round((scrollTop || 0) / 60);

    const q = wx.createSelectorQuery();
    q.select(".custom-navbar").boundingClientRect();
    q.select(".page-watermark").boundingClientRect();
    q.select(".group-section").boundingClientRect();
    q.select(".group-section .group-header").boundingClientRect();
    q.select(".navbar-inner").boundingClientRect();
    q.select(".navbar-title").boundingClientRect();
    q.select(".large-card").boundingClientRect();
    q.select(".small-card").boundingClientRect();
    q.selectAll(".group-section").boundingClientRect();
    q.selectAll("video.card-video-bg").boundingClientRect();
    q.selectAll(".card-type-label-sm").boundingClientRect();
    q.selectAll(".glass-meta-icon-img").boundingClientRect();
    q.select(".group-section .group-header").boundingClientRect();
    q.select(".group-section .card-datetime-label").boundingClientRect();
    q.select(".large-card").boundingClientRect();
    q.select(".avatar-tl").boundingClientRect();
    q.select(".avatar-tr").boundingClientRect();
    q.select(".avatar-mid").boundingClientRect();
    q.select(".small-card").boundingClientRect();
    q.select(".avatar-tl-sm").boundingClientRect();
    q.select(".avatar-tr-sm").boundingClientRect();
    q.select(".avatar-mid-sm").boundingClientRect();
    q.exec((res) => {
      const navbarRect = res && res[0] ? res[0] : null;
      const logoRect = res && res[1] ? res[1] : null;
      const firstGroupRect = res && res[2] ? res[2] : null;
      const firstGroupHeaderRect = res && res[3] ? res[3] : null;
      const navbarInnerRect = res && res[4] ? res[4] : null;
      const navbarTitleRect = res && res[5] ? res[5] : null;
      const largeCardRect = res && res[6] ? res[6] : null;
      const smallCardRect = res && res[7] ? res[7] : null;
      const allGroupRects = res && res[8] ? res[8] : null;
      const allVideoRects = res && res[9] ? res[9] : null;
      const allSmallTypeLabelRects = res && res[10] ? res[10] : null;
      const allGlassMetaIconRects = res && res[11] ? res[11] : null;
      const firstGroupHeaderRect2 = res && res[12] ? res[12] : null;
      const firstCardDateLabelRect = res && res[13] ? res[13] : null;
      const largeCardRect2 = res && res[14] ? res[14] : null;
      const avatarTlRect = res && res[15] ? res[15] : null;
      const avatarTrRect = res && res[16] ? res[16] : null;
      const avatarMidRect = res && res[17] ? res[17] : null;
      const smallCardRect2 = res && res[18] ? res[18] : null;
      const avatarTlSmRect = res && res[19] ? res[19] : null;
      const avatarTrSmRect = res && res[20] ? res[20] : null;
      const avatarMidSmRect = res && res[21] ? res[21] : null;

      const gapNavbarToFirstGroup = (navbarRect && firstGroupRect)
        ? (firstGroupRect.top - navbarRect.bottom)
        : null;
      const gapNavbarToFirstGroupHeader = (navbarRect && firstGroupHeaderRect)
        ? (firstGroupHeaderRect.top - navbarRect.bottom)
        : null;
    });
  },

  /** 首页列表强制走网络刷新（scroll-view 内须用 refresher；游客态同样可下拉拉新） */
  runListPullRefresh() {
    this.syncGuestState();
    const myUserId = app.globalData.userId || wx.getStorageSync("userId") || "";
    const myNickname = (app.globalData.userProfile?.nickname || wx.getStorageSync("userNickname") || "").trim();
    this.setData({ isAdmin: app.globalData.userRole === "admin", myUserId, myNickname });
    this._prepareHomeCardImages({ retryFailed: true });
    return this.loadActivityList({ forceNetwork: true });
  },

  onMainRefresherPulling(e) {
    const dy = e.detail && typeof e.detail.dy === "number" ? e.detail.dy : 0;
    if (this.data.mainRefresherTriggered) return;
    const hint = dy >= MAIN_REFRESH_THRESHOLD_PX ? "松手刷新" : "下拉刷新";
    if (hint !== this.data.mainRefresherHint) {
      this.setData({ mainRefresherHint: hint });
    }
  },

  onMainRefresherRestore() {
    if (!this.data.mainRefresherTriggered && this.data.mainRefresherHint !== "下拉刷新") {
      this.setData({ mainRefresherHint: "下拉刷新" });
    }
  },

  onMainRefresherRefresh() {
    this.setData({ mainRefresherTriggered: true, mainRefresherHint: "刷新中…" });
    this.runListPullRefresh().finally(() => {
      this.setData({ mainRefresherTriggered: false, mainRefresherHint: "下拉刷新" });
    });
  },

  // 保留：若将来去掉外层 scroll-view 可再打开页面级下拉
  onPullDownRefresh() {
    this.runListPullRefresh().finally(() => wx.stopPullDownRefresh());
  },

  syncGuestState() {
    const hasWeChatAuth = !!wx.getStorageSync("hasWeChatAuth");
    const isAuthenticated = app.globalData.isAuthenticated;
    // 未完成登录或未获取访问权限，都视为游客
    const isGuest = !hasWeChatAuth || !isAuthenticated;
    this.setData({ isGuest });

    return isGuest;
  },

  buildEndedStreamState(groupedActivities, visibleCount) {
    const grouped = groupedActivities || { joined: [], accepting: [], notStarted: [], ended: [] };
    const allEndedActivities = Array.isArray(grouped.ended) ? grouped.ended : [];
    const nextVisibleCount = Math.min(
      allEndedActivities.length,
      Math.max(ENDED_ACTIVITY_PAGE_SIZE, Number(visibleCount) || ENDED_ACTIVITY_PAGE_SIZE)
    );
    const visibleEnded = allEndedActivities.slice(0, nextVisibleCount);
    const endedHasMore = nextVisibleCount < allEndedActivities.length;
    return {
      groupedActivities: {
        ...grouped,
        ended: visibleEnded
      },
      allEndedActivities,
      endedHasMore
    };
  },

  loadMoreEndedActivities() {
    const allEndedActivities = this.data.allEndedActivities || [];
    const currentEnded = (this.data.groupedActivities && this.data.groupedActivities.ended) || [];
    if (this.data.endedLoadingMore || currentEnded.length >= allEndedActivities.length) {
      return;
    }

    const nextVisibleCount = Math.min(allEndedActivities.length, currentEnded.length + ENDED_ACTIVITY_PAGE_SIZE);
    const visibleEnded = allEndedActivities.slice(0, nextVisibleCount);
    const endedHasMore = nextVisibleCount < allEndedActivities.length;
    const groupedActivities = {
      ...this.data.groupedActivities,
      ended: visibleEnded
    };
    this.setData({
      groupedActivities: this._prepareColdStartCardPresentation(groupedActivities).groupedActivities,
      endedHasMore,
      endedLoadingMore: false
    }, () => this._scheduleColdStartCardEntrance());
  },

  loadActivityListFromCache() {
    const cached = cacheManager.getCachedActivityList();
    const list = cached && Array.isArray(cached.list) ? cached.list : [];
    if (!list.length) return false;
    const myUserId = this.data.myUserId || "";
    const myNickname = (this.data.myNickname || "").trim();
    const cacheUserId = String((cached && cached.userId) || "");
    // 缓存绑定了某个用户：当前未登录（myUserId 为空）或换了账号，均丢弃缓存
    if (cacheUserId && (!myUserId || cacheUserId !== String(myUserId))) {
      return false;
    }
    this._homePresentationDiagnostics?.list("cache");
    const listWithFlags = reapplyListParticipationFlags(list, myUserId, myNickname);
    cacheManager.setCachedActivityList(listWithFlags, myUserId);
    const { selectedFilter, searchKeyword } = this.data;
    const filtered = this.computeFilteredList(listWithFlags, selectedFilter, searchKeyword);
    const fullGroupedActivities = this.computeGroupedActivities(listWithFlags);
    const endedStream = this.buildEndedStreamState(fullGroupedActivities, ENDED_ACTIVITY_PAGE_SIZE);
    const groupedActivities = endedStream.groupedActivities;
    const focusedCardIndex = this._resolveFocusedCardIndex(groupedActivities);
    const cardPresentation = this._prepareColdStartCardPresentation(groupedActivities);
    // 须在 setData 回调之前创建 session，否则缓存命中的首帧 bindload 可能早于回调，导致事件丢弃并误报 stalled（H1）
    this.setData({
      activityList: listWithFlags,
      filteredList: filtered,
      groupedActivities: cardPresentation.groupedActivities,
      allEndedActivities: endedStream.allEndedActivities,
      endedHasMore: endedStream.endedHasMore,
      endedLoadingMore: false,
      focusedCardIndex,
      homeListLoading: false,
      groupSectionVisibility: cardPresentation.groupSectionVisibility
    }, () => this._scheduleColdStartCardEntrance());
    return true;
  },

  loadActivityList(options = {}) {
    const generation = options.generation == null ? (this._loadGeneration || 0) : options.generation;
    if (this._pageVisible === false || generation !== (this._loadGeneration || 0)) return Promise.resolve();
    this._homePresentationDiagnostics?.list("request_pending");
    return (options.responsePromise || activityService.listActivities())
      .then((res) => {
        if (this._pageVisible !== false && generation === (this._loadGeneration || 0)) this._homePresentationDiagnostics?.list("response_received");
        return this.processActivityList(res || [], new Date());
      })
      .then(result => {
        if (this._pageVisible === false || generation !== (this._loadGeneration || 0)) return;
        if (result) {
          this._homePresentationDiagnostics?.list("list_processed");
          const { list } = result;
          const { selectedFilter, searchKeyword } = this.data;
          const filtered = this.computeFilteredList(list, selectedFilter, searchKeyword);
          const fullGroupedActivities = this.computeGroupedActivities(list);
          const endedStream = this.buildEndedStreamState(fullGroupedActivities, ENDED_ACTIVITY_PAGE_SIZE);
          const groupedActivities = endedStream.groupedActivities;
          const focusedCardIndex = this._resolveFocusedCardIndex(groupedActivities);
          const cardPresentation = this._prepareColdStartCardPresentation(groupedActivities);
          if (!options.skipCardMediaDiagnostics) {
          }
          this.setData({
            activityList: list,
            filteredList: filtered,
            groupedActivities: cardPresentation.groupedActivities,
            allEndedActivities: endedStream.allEndedActivities,
            endedHasMore: endedStream.endedHasMore,
            endedLoadingMore: false,
            focusedCardIndex,
            homeListLoading: false,
            groupSectionVisibility: cardPresentation.groupSectionVisibility
          }, () => this._scheduleColdStartCardEntrance());
          cacheManager.setCachedActivityList(list, this.data.myUserId || "");

          wx.nextTick(() => {
            calendarWarmup.schedulePrefetchSignedUpList(app);
          });

        }
      })
      .catch(err => {
        if (this._pageVisible === false || generation !== (this._loadGeneration || 0)) return;
        this._homePresentationDiagnostics?.list("list_failed", summarizeError(err));
        this._homePresentationDiagnostics?.snapshot("list_error");
        console.error(err);
        // The independent Tab entrance also runs when the request never resolves.
        this._scheduleColdStartCardEntrance();
        // 测试环境切换后常见：本地缓存 token 对应的用户不在当前库中
        if (err && err.statusCode === 404 && String(err.message || "").includes("User not found")) {
          app.logout();
          this.syncGuestState();
          wx.showToast({ title: "测试环境用户不存在，请重新登录", icon: "none", duration: 2500 });
          wx.switchTab({ url: "/pages/profile/profile" });
          return;
        }
        wx.showToast({ title: "加载失败", icon: "none" });
      });
  },

  processActivityList(resData, now) {
    const myUserId = String(this.data.myUserId || "").trim();
    const myNickname = (this.data.myNickname || "").trim();
    const typeStyleMap = buildTypeStyleMap(this.data.activityTypeStyles);

    const list = (resData || []).map(rawItem => {
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
      // 首页大小卡统一使用高清原图；小卡仅改变 aspectFill 裁切区域，不加载缩略图。
      activity.smallCardBgImageUrl = selectedStyle ? (selectedStyle.largeCardBgImageUrl || "") : "";
      if (activity.activityCover && activity.activityCover.imageUrl) {
        activity.largeCardBgImageUrl = activity.activityCover.imageUrl;
        activity.smallCardBgImageUrl = activity.activityCover.imageUrl;
        activity.largeCardGlassImageUrl = activity.activityCover.largeCardGlassImageUrl || "";
        activity.bgVideoUrl = "";
        activity.showTypeBadge = false;
        activity.showAvatarCluster = false;
      }
      let signupDeadline = activity.signupDeadline;
      if (!signupDeadline && activity.startTime) {
        const base = new Date(activity.startTime.replace(" ", "T") + ":00");
        if (!isNaN(base.getTime())) {
          const dl = new Date(base.getTime() - 60 * 60 * 1000);
          signupDeadline = `${dl.getFullYear()}-${pad(dl.getMonth() + 1)}-${pad(dl.getDate())} ${pad(dl.getHours())}:${pad(dl.getMinutes())}`;
        }
      }
      activity.signupDeadline = signupDeadline;

      // 计算开始时间与报名截止时间对应的周几标签，用于前端展示
      activity.startWeekdayLabel = getWeekdayLabel(activity.startTime || activity.date);
      activity.signupDeadlineWeekdayLabel = getWeekdayLabel(signupDeadline);

      // 大卡顶部时间：MM-DD 周几 HH:mm-HH:mm
      const formatRangeLabel = () => {
        const start = activity.startTime;
        if (!start) return "";
        const s = String(start);
        const datePart = s.split(" ")[0] || "";
        const timePart = s.split(" ")[1] || "";
        const mmdd = datePart ? datePart.slice(5) : "";
        const weekday = activity.startWeekdayLabel || "";
        const startHm = timePart ? timePart.slice(0, 5) : "";
        const end = activity.endTime ? String(activity.endTime) : "";
        const endHm = end.split(" ")[1] ? end.split(" ")[1].slice(0, 5) : "";
        if (!mmdd || !startHm) return "";
        return `${mmdd} ${weekday} ${startHm}${endHm ? `-${endHm}` : ""}`;
      };
      activity.cardDateTimeLabel = formatRangeLabel();
      activity.smallCardTimeLabel = formatRangeLabel();

      let hasSignedUp = false;
      let hasCheckedIn = false;
      let checkinCount = 0;
      const rawParticipants = orderParticipantsForRecentAvatarSlice(activity.participants || []);
      const avatarList = [];

      rawParticipants.forEach(p => {
        if (typeof p === "object" && p !== null) {
          const uidStr = p.userId != null ? String(p.userId) : "";
          const name = (p.name || "").trim();
          const checkedIn = !!p.checkedInAt;
          if (checkedIn) {
            checkinCount += 1;
          }
          const avatarUrl = normalizeAvatarUrl(p.avatarUrl);
          const hasCustomAvatar = avatarUrl !== DEFAULT_AVATAR;
          avatarList.push({
            url: avatarUrl,
            isDefault: !hasCustomAvatar
          });
          if (myUserId && uidStr && uidStr === myUserId) {
            hasSignedUp = true;
            if (checkedIn) {
              hasCheckedIn = true;
            }
          } else if (myNickname && name === myNickname) {
            hasSignedUp = true;
            if (checkedIn) {
              hasCheckedIn = true;
            }
          }
        } else if (typeof p === "string") {
          avatarList.push({
            url: DEFAULT_AVATAR,
            isDefault: true
          });
          if (myNickname && p === myNickname) {
            hasSignedUp = true;
          }
        }
      });
      activity.hasSignedUp = hasSignedUp;
      activity.hasCheckedIn = hasCheckedIn;
      activity.checkinCount = checkinCount;
      activity.avatarList = avatarList;
      // 卡片头像：按 created_at 升序生成 avatarList 后取末尾 3 人 = 最近报名；与大卡 TL>TR>Mid 索引一致
      activity.cardAvatars = avatarList.slice(-3);

      // 是否已满员（仅在设置了人数上限时生效）
      const max = activity.maxParticipants;
      const currentCount = rawParticipants.length;
      activity.isFull = max != null && currentCount >= max;

      // 报名是否已截止（受报名开关与截止时间共同控制）
      let isSignupClosed = false;
      if (activity.signupEnabled === false) {
        isSignupClosed = true;
      } else if (signupDeadline) {
        const dl = new Date(signupDeadline.replace(" ", "T") + ":00");
        if (!isNaN(dl.getTime())) {
          isSignupClosed = now.getTime() >= dl.getTime();
        }
      }
      activity.isSignupClosed = isSignupClosed;

      // 基于时间自动更新状态（已取消、已流局是终态，不参与自动推算）
      const parseDateTime = (s) => new Date(s.replace(" ", "T") + ":00");
      const start = parseDateTime(activity.startTime);
      const end = parseDateTime(activity.endTime);
      let autoStatus = activity.status || "未开始";
      if (activity.status === "已取消" || activity.status === "已流局") {
        autoStatus = activity.status;
      } else if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        if (now.getTime() < start.getTime()) {
          autoStatus = "未开始";
        } else if (now.getTime() < end.getTime()) {
          autoStatus = "进行中";
        } else {
          autoStatus = "已结束";
        }
      }

      if (activity.status !== "已取消" && activity.status !== "已流局") {
        activity.status = autoStatus;
      }

      return activity;
    });

    return { list };
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value });
    this.filterActivities();
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    this.setData({ selectedFilter: filter });
    this.filterActivities();
  },

  computeFilteredList(list, selectedFilter, searchKeyword) {
    let filtered = list ? list.slice() : [];

    if (selectedFilter === "我参与的") {
      // 只看当前用户参与过的活动（已通过 hasSignedUp 标记）
      filtered = filtered.filter(item => item.hasSignedUp);
    } else if (selectedFilter && selectedFilter !== "全部") {
      // 其他筛选仍按状态过滤
      filtered = filtered.filter(item => item.status === selectedFilter);
    }
    if (searchKeyword && searchKeyword.trim()) {
      const keyword = searchKeyword.trim().toLowerCase();
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(keyword) ||
        (item.remark && item.remark.toLowerCase().includes(keyword))
      );
    }
    return filtered;
  },

  filterActivities() {
    const { activityList, searchKeyword, selectedFilter } = this.data;
    const filtered = this.computeFilteredList(activityList, selectedFilter, searchKeyword);
    this.setData({ filteredList: filtered });
  },

  // 四分组计算（全局去重，优先级：我参与的 > 接受报名 > 未开始 > 已结束）
  computeGroupedActivities(list) {
    const sortByStart = (a, b) =>
      new Date((a.startTime || "").replace(" ", "T") + ":00") -
      new Date((b.startTime || "").replace(" ", "T") + ":00");
    const sortByStartDesc = (a, b) =>
      new Date((b.startTime || "").replace(" ", "T") + ":00") -
      new Date((a.startTime || "").replace(" ", "T") + ":00");

    const usedIds = new Set();
    const valid = list || [];

    // 1. 我参与的：已报名且未结束（已结束的归入下方「已结束」区，避免历史活动占大卡位）
    const joined = valid
      .filter((a) => a.hasSignedUp && !["已结束", "已取消", "已流局"].includes(a.status))
      .sort(sortByStart);
    joined.forEach((a) => usedIds.add(a._id));

    // 2. 接受报名：未开始 + 报名未截止 + 开关开启 + 未满员 + 未报名
    const accepting = valid
      .filter(a => !usedIds.has(a._id) &&
        a.status === "未开始" &&
        !a.isSignupClosed &&
        a.signupEnabled !== false &&
        !a.isFull &&
        !a.hasSignedUp)
      .sort(sortByStart);
    accepting.forEach(a => usedIds.add(a._id));

    // 3. 未开始：状态未开始且不在接受报名中
    const notStarted = valid
      .filter(a => !usedIds.has(a._id) && a.status === "未开始")
      .sort(sortByStart);
    notStarted.forEach(a => usedIds.add(a._id));

    // 4. 已结束：按开始时间降序
    const ended = valid
      .filter(a => !usedIds.has(a._id) && ["已结束", "已取消", "已流局"].includes(a.status))
      .sort(sortByStartDesc);

    return { joined, accepting, notStarted, ended };
  },

  // 普通用户和管理员均可创建；未登录、游客保持静默。
  showCreateModal() {
    if (!this.hasCreateActivityPermission()) return;
    if (this.data.showCreateForm || this.data.createFormSubmitting) return;
    if (this._createFormCloseTimer) clearTimeout(this._createFormCloseTimer);
    this._createFormCloseTimer = null;
    this._setTabBarHidden(true);
    this.setData({
      createFormContainerRendered: true,
      showCreateForm: false,
      createFormSubmitting: false
    }, () => {
      wx.nextTick(() => this.setData({ showCreateForm: true }));
    });
  },

  closeCreateForm() {
    if (this.data.createFormSubmitting) return;
    this.setData({ showCreateForm: false }, () => this._scheduleCreateFormCloseCompletion());
  },

  _scheduleCreateFormCloseCompletion() {
    if (this._createFormCloseTimer) clearTimeout(this._createFormCloseTimer);
    // The homepage uses its own native page-container, not the component's.
    // Do not rely solely on the native afterleave callback to release the Tab.
    this._createFormCloseTimer = setTimeout(() => {
      this._createFormCloseTimer = null;
      if (this.data.showCreateForm || !this.data.createFormContainerRendered) return;
      this._homePresentationDiagnostics?.snapshot("create_form_afterleave_missing");
      this.onCreateFormAfterLeave();
    }, 400); // Native close duration is 240ms; allow its normal animation first.
  },

  onCreateFormAfterLeave() {
    if (!this.data.showCreateForm && this.data.createFormContainerRendered) {
      if (this._createFormCloseTimer) clearTimeout(this._createFormCloseTimer);
      this._createFormCloseTimer = null;
      this.setData({ createFormContainerRendered: false }, () => {
        if (this._pageVisible === false) return;
        this._setTabBarHidden(false, { animate: true });
        this._revealCreatedCard();
      });
    }
  },

  insertCreatedActivity(rawActivity) {
    const processed = this.processActivityList([rawActivity], new Date());
    const createdActivity = processed && Array.isArray(processed.list) ? processed.list[0] : null;
    if (!createdActivity || createdActivity._id == null) return Promise.resolve(false);

    this._finishCreatedCardEntrance();
    const activityList = [
      createdActivity,
      ...(this.data.activityList || []).filter((item) => String(item._id) !== String(createdActivity._id))
    ];
    const filteredList = this.computeFilteredList(
      activityList,
      this.data.selectedFilter,
      this.data.searchKeyword
    );
    const fullGroupedActivities = this.computeGroupedActivities(activityList);
    const currentEndedCount = Math.max(
      ENDED_ACTIVITY_PAGE_SIZE,
      ((this.data.groupedActivities && this.data.groupedActivities.ended) || []).length
    );
    const endedStream = this.buildEndedStreamState(fullGroupedActivities, currentEndedCount);
    const groupedActivities = endedStream.groupedActivities;
    const createdGroup = Object.keys(groupedActivities).find((group) =>
      (groupedActivities[group] || []).some((item) => String(item._id) === String(createdActivity._id))
    );
    const focusedCardIndex = { ...(this.data.focusedCardIndex || {}) };
    if (createdGroup) {
      focusedCardIndex[createdGroup] = groupedActivities[createdGroup].findIndex(
        (item) => String(item._id) === String(createdActivity._id)
      );
    }
    const waitsForGlass = createdGroup === "joined" &&
      !!createdActivity.largeCardGlassImageUrl &&
      !this._loadedCardGlassUrls.has(createdActivity.largeCardGlassImageUrl);
    this._createdCardDrawerDismissed = false;
    this._createdCardGlassReady = !waitsForGlass;
    this._createdCardRevealStarted = false;

    return new Promise((resolve) => {
      this.setData({
        activityList,
        filteredList,
        groupedActivities: this._prepareColdStartCardPresentation(groupedActivities).groupedActivities,
        allEndedActivities: endedStream.allEndedActivities,
        endedHasMore: endedStream.endedHasMore,
        endedLoadingMore: false,
        focusedCardIndex,
        groupSectionVisibility: this._buildGroupSectionVisibility(groupedActivities),
        createdCardEntranceId: createdActivity._id,
        createdCardEntranceState: "pending"
      }, () => {
        this._scheduleColdStartCardEntrance();
        cacheManager.setCachedActivityList(activityList, this.data.myUserId || "");
        calendarWarmup.schedulePrefetchSignedUpList(app);
        resolve(true);
      });
    });
  },

  submitCreateActivity(e) {
    if (this.data.createFormSubmitting) return;
    const payload = e && e.detail && e.detail.payload;
    if (!payload) {
      wx.showToast({ title: "活动信息缺失", icon: "none" });
      return;
    }
    this.setData({ createFormSubmitting: true });
    wx.showLoading({ title: "创建中...", mask: true });
    activityService.createActivity(payload)
      .then((createdActivity) => {
        wx.hideLoading();
        wx.showToast({ title: "创建成功", icon: "success" });
        this.setData({
          showCreateForm: false,
          createFormSubmitting: false
        }, () => this._scheduleCreateFormCloseCompletion());
        return this.insertCreatedActivity(createdActivity)
          .then((inserted) => inserted || this.loadActivityList());
      })
      .catch((error) => {
        console.error(error);
        wx.hideLoading();
        this.setData({ createFormSubmitting: false });
        wx.showToast({ title: (error && error.message) || "创建失败", icon: "none" });
      });
  },

  // 管理员：从列表卡片取消活动（终态保留在首页历史区域）
  cancelActivityFromCard(e) {
    const activity = e.currentTarget.dataset.activity;
    if (!activity || !activity._id) return;
    if (activity.status === "已取消") return;
    wx.showModal({
      title: "确认取消活动",
      content: `确定要取消活动"${activity.name}"吗？取消后将归入首页历史活动，不可再报名或签到。`,
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "处理中..." });
        activityService
          .cancelActivity(activity._id)
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: "已取消活动", icon: "success" });
            this.loadActivityList();
          })
          .catch((err) => {
            console.error(err);
            wx.hideLoading();
            wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
          });
      }
    });
  },

  showDetail(e) {
    const activity = e.currentTarget.dataset.activity;
    if (!activity || !activity._id || !activity._homeMediaReady) return;
    // Preserve the visible carousel positions, not the card tapped at the edge.
    Object.entries(this.data.focusedCardIndex || {}).forEach(([group, index]) => {
      this._rememberFocusedCard(group, index);
    });
    wx.navigateTo({
      url: `/pages/activity_detail/activity_detail?id=${activity._id}`
    });
  },

  onShareAppMessage() {
    return {
      title: "龙城预约系统",
      path: "/pages/activity_list/activity_list"
    };
  },

  stopPropagation() {},

  onAvatarError(e) {
    const { index, activityId } = e.currentTarget.dataset;
    const activityList = this.data.activityList || [];
    const activity = activityList.find((item) => item._id === activityId);
    if (activity && activity.avatarList && activity.avatarList[index]) {
      activity.avatarList[index] = { url: DEFAULT_AVATAR, isDefault: true };
      this.setData({ activityList });
    }
  },

  onCardBgLoaded(e) {
    if (!this._isCurrentHomeImageEvent(e, "cover")) return;
    const meta = pickCardMediaMetaFromDataset(e && e.currentTarget && e.currentTarget.dataset, "image");
    this._homePresentationDiagnostics?.media(meta.url, meta.mediaType === "video" ? "video" : "cover", "loaded", meta);
    this._markHomeImageReady(meta.url);
  },

  onCardBgError(e) {
    if (!this._isCurrentHomeImageEvent(e, "cover")) return;
    const meta = pickCardMediaMetaFromDataset(e && e.currentTarget && e.currentTarget.dataset, "image");
    this._homePresentationDiagnostics?.media(meta.url, meta.mediaType === "video" ? "video" : "cover", "error", meta);
    this._homePresentationDiagnostics?.snapshot("native_media_error", {
      url: String(meta.url || "").split(/[?#]/)[0], summary: summarizeError(e && e.detail)
    });
    this._recoverHomeImage(e);
  },

  onCardGlassLoaded(e) {
    if (!this._isCurrentHomeImageEvent(e, "glass")) return;
    const dataset = e && e.currentTarget && e.currentTarget.dataset;
    const activityId = String((dataset && dataset.activityId) || "");
    const url = String((dataset && dataset.url) || "");
    this._homePresentationDiagnostics?.media(url, "glass", "loaded", { activityId, group: (dataset && dataset.group) || "joined" });
    this._markHomeImageReady(url);
    this._markCreatedCardGlassReady(activityId);
  },

  onCardGlassError(e) {
    if (!this._isCurrentHomeImageEvent(e, "glass")) return;
    const dataset = e && e.currentTarget && e.currentTarget.dataset;
    this._homePresentationDiagnostics?.media(dataset && dataset.url, "glass", "error", { activityId: dataset && dataset.activityId, group: (dataset && dataset.group) || "joined" });
    this._homePresentationDiagnostics?.snapshot("glass_error", {
      url: String((dataset && dataset.url) || "").split(/[?#]/)[0], summary: summarizeError(e && e.detail)
    });
    this._recoverHomeImage(e);
    // Failure never releases a card: keep its own skeleton visible.
  },

  onCardVideoLoaded(e) {
    const meta = pickCardMediaMetaFromDataset(e && e.currentTarget && e.currentTarget.dataset, "video");
    this._homePresentationDiagnostics?.media(meta.url, meta.mediaType === "video" ? "video" : "cover", "loaded", meta);
    this._markHomeImageReady(meta.url);
  },

  onCardVideoError(e) {
    const meta = pickCardMediaMetaFromDataset(e && e.currentTarget && e.currentTarget.dataset, "video");
    this._homePresentationDiagnostics?.media(meta.url, meta.mediaType === "video" ? "video" : "cover", "error", meta);
    this._homePresentationDiagnostics?.snapshot("native_media_error", {
      url: String(meta.url || "").split(/[?#]/)[0], summary: summarizeError(e && e.detail)
    });
  },

  onCardVideoWaiting(e) {
    const meta = pickCardMediaMetaFromDataset(e && e.currentTarget && e.currentTarget.dataset, "video");
    this._homePresentationDiagnostics?.snapshot("video_waiting", {
      group: meta.group,
      cardSize: meta.cardSize,
      activityId: meta.activityId,
      activityName: meta.activityName,
      url: meta.url
    });
  }
});
