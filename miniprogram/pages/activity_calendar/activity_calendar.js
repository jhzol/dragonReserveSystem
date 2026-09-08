const app = getApp();
const activityService = require("../../services/activity");
const userService = require("../../services/user");
const myActivitiesCache = require("../../utils/myActivitiesCache");
const { patchTabBarIfNeeded } = require("../../utils/tabBarSync");
const { getBottomSafeAreaRpx } = require("../../utils/safeArea");
const { shared, timing, Easing, runOnJS, cancelAnimation } = wx.worklet;

function ensureSessionParallel(appLocal) {
  return new Promise((resolve) => {
    if (
      appLocal.globalData.sessionValidated &&
      appLocal.globalData.accessToken &&
      appLocal.globalData.userId &&
      appLocal.globalData.userProfile
    ) {
      resolve({ ok: true });
      return;
    }
    const token = appLocal.globalData.accessToken || wx.getStorageSync("accessToken") || "";
    if (!token) {
      resolve({ ok: false });
      return;
    }
    userService
      .getMe()
      .then((user) => {
        appLocal.applyCurrentUser(user);
        resolve({ ok: true });
      })
      .catch((err) => {
        console.error("activity_calendar ensureSessionParallel", err);
        appLocal.logout();
        resolve({ ok: false });
      });
  });
}

function currentUserId(appLocal) {
  return String(appLocal.globalData.userId || wx.getStorageSync("userId") || "").trim();
}

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_FULL = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const HOUR_HEIGHT_RPX = 115.38;
const MIN_EVENT_HEIGHT_RPX = 115.38;
// Pencil 页面实例：日程网格相对视窗 y=-430；网格原始 y=62，因此 scrollTop=492px。
const TIMELINE_DEFAULT_SCROLL_TOP_RPX = 946.15385;

/**
 * 时间格采用「长日期列表 + 单一横向位移」架构：
 *   - timelineSwipePages 总长 = 2*RADIUS + 1 = 31 天
 *   - 标题条和活动网格绑定同一个 SharedValue，拖动中逐帧同步
 *   - timelineSwiperCurrent 仅记录松手后左列日期，不再驱动第二套原生位移
 *   - 用户每次手势最多翻一天；周条翻周时程序化移动七天
 *   - 接近边界时在两端补日期，并同步修正唯一位移
 */
const TIMELINE_RADIUS = 15;
const CENTER_OFFSET = TIMELINE_RADIUS;          // 中心日在数组中的下标
/** 初始左列为锚点日（pages[CENTER_OFFSET]），可见 [15,16,17] */
const INITIAL_CURRENT = TIMELINE_RADIUS;
const EDGE_GUARD = 3;                           // current 距两端 ≤ 此值时触发扩展
const EDGE_EXTEND = 14;                         // 每次扩展 14 天
/** 周条翻周引发的时间格连扫动画时长（ms） */
const TIMELINE_BURST_TOTAL_MS = 700;

const EVENT_COLORS = [
  { bg: "#fff3e0", border: "#ff9800", text: "#ff9800", iconTone: "orange" },
  { bg: "#f1f8e9", border: "#7cb342", text: "#558b2f", iconTone: "green" },
  { bg: "#e3f2fd", border: "#2196f3", text: "#1565c0", iconTone: "blue" },
  { bg: "#fff7ed", border: "#f97316", text: "#c2410c", iconTone: "deep-orange" },
  { bg: "#f5f3ff", border: "#8b5cf6", text: "#6d28d9", iconTone: "purple" }
];

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getMonday(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(d, diff);
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const safe = String(value).replace(" ", "T");
  const dateOnly = safe.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const date = new Date(safe);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 网络/缓存刷新 rebuild 时优先用当前时间格左列，避免首滑误改 selectedDateKey 后整表锚到错误周（见 debug 首帧大 dx 后紧跟 rebuild） */
function anchorDateFromVisibleTimelinePage(self) {
  const pages = self.data.timelineSwipePages;
  const cur = self.data.timelineSwiperCurrent;
  const row = pages && pages[cur];
  const key = row && row.key;
  const d = key ? parseDate(key) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** 返回日期所在的周条页；预览跨周时用它把对应周页同步移入视口。 */
function weekStripPageIndexForDateKey(weekStripPages, dateKey) {
  if (!dateKey || !Array.isArray(weekStripPages)) return -1;
  for (let p = 0; p < weekStripPages.length; p++) {
    const days = weekStripPages[p] && weekStripPages[p].days;
    if (!Array.isArray(days)) continue;
    for (let i = 0; i < days.length; i++) {
      if (days[i] && days[i].key === dateKey) return p;
    }
  }
  return -1;
}

function timeText(date) {
  if (!date) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function monthDayText(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getWeekNumber(date) {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  const pastDays = Math.floor((startOfDay(date) - firstDay) / 86400000);
  return Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
}

function calendarDaysBetween(a, b) {
  const A = startOfDay(a).getTime();
  const B = startOfDay(b).getTime();
  return Math.round((B - A) / 86400000);
}

/** 一周的 7 天（周一→周日顺序） */
function buildWeekStripPage(monday, todayKey, byDate) {
  const m = startOfDay(monday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(m, i);
    const key = dateKey(d);
    const hasActivity = (byDate.get(key) || []).length > 0;
    return {
      key,
      weekday: WEEKDAY_SHORT[d.getDay()],
      day: d.getDate(),
      isToday: key === todayKey,
      showStripEventBar: hasActivity,
      hasActivity
    };
  });
}

/** 三块周面板：上一周 / 当前周 / 下一周 */
function buildWeekStripSwipePages(centerDate, todayKey, byDate) {
  const prevMonday = getMonday(addDays(startOfDay(centerDate), -7));
  const centerMonday = getMonday(startOfDay(centerDate));
  const nextMonday = getMonday(addDays(startOfDay(centerDate), 7));
  const weekKey = (mon) => `${dateKey(mon)}_${dateKey(addDays(mon, 6))}`;
  return [
    { weekKey: weekKey(prevMonday),   days: buildWeekStripPage(prevMonday,   todayKey, byDate) },
    { weekKey: weekKey(centerMonday), days: buildWeekStripPage(centerMonday, todayKey, byDate) },
    { weekKey: weekKey(nextMonday),   days: buildWeekStripPage(nextMonday,   todayKey, byDate) }
  ];
}

function buildTimelineColumn(dayDate, byDate, todayKey) {
  const day = startOfDay(dayDate);
  const key = dateKey(day);
  return {
    key,
    isToday: key === todayKey,
    title: `${monthDayText(day)} - ${WEEKDAY_FULL[day.getDay()]}`,
    activities: (byDate.get(key) || [])
      .slice()
      .sort((a, b) => {
        const ta = a.start ? new Date(a.start).getTime() : 0;
        const tb = b.start ? new Date(b.start).getTime() : 0;
        return ta - tb;
      })
  };
}

/**
 * 构建以 anchorDate 为中心的长 page 列表（共 2*RADIUS+1 = 31 个）。
 * pages[CENTER_OFFSET] === anchorDate
 */
function buildTimelineLongList(anchorDate, byDate, todayKey, radius) {
  const r = typeof radius === "number" ? radius : TIMELINE_RADIUS;
  const c = startOfDay(anchorDate);
  return Array.from({ length: 2 * r + 1 }, (_, i) =>
    buildTimelineColumn(addDays(c, i - r), byDate, todayKey)
  );
}

function adaptActivity(item, index) {
  const start = parseDate(item.start_time);
  const end = parseDate(item.end_time);
  const startMinutes = start ? start.getHours() * 60 + start.getMinutes() : 0;
  const durationMinutes = start && end ? Math.max(30, Math.round((end - start) / 60000)) : 60;
  const color = EVENT_COLORS[index % EVENT_COLORS.length];
  const status = item.status || "";
  const isCancelled = status === "已取消";
  const iconTone = isCancelled ? "gray" : color.iconTone;
  const topRpx = Number(((startMinutes / 60) * HOUR_HEIGHT_RPX).toFixed(2));
  const heightRpx = Math.max(
    MIN_EVENT_HEIGHT_RPX,
    Number(((durationMinutes / 60) * HOUR_HEIGHT_RPX).toFixed(2))
  );
  const locationName = String(item.location_name || item.location_address || "").trim();

  return {
    _id: String(item.id),
    name: item.name || "未命名活动",
    status,
    locationName,
    start,
    end,
    dateKey: start ? dateKey(start) : "",
    timeRange: `${timeText(start)} - ${timeText(end)}`,
    locationIcon: `/images/calendar-event-location-${iconTone}.svg`,
    timeIcon: `/images/calendar-event-time-${iconTone}.svg`,
    style: [
      `top:${topRpx}rpx`,
      `height:${heightRpx}rpx`,
      `background:${isCancelled ? "#f3f4f6" : color.bg}`,
      `border-left-color:${isCancelled ? "#9ca3af" : color.border}`,
      `color:${isCancelled ? "#6b7280" : color.text}`
    ].join(";")
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navbarPaddingRightPx: 12,
    loading: true,
    loadError: "",
    isGuest: false,
    empty: false,
    todayDateKey: "",
    selectedDateKey: "",
    /** 周条高亮（拖动中由 Worklet 预览更新，松手后与 selectedDateKey 对齐） */
    weekStripHighlightKey: "",
    weekNumber: "",
    weekStripPages: [],
    weekStripSwiperIndex: 1,
    weekStripSwiperDuration: 300,
    /** 长日期列表：只在加载、范围外日期跳转或边界扩展时重建 */
    timelineSwipePages: [],
    /** 松手后的左列日期下标；可见 pages[current..current+2] */
    timelineSwiperCurrent: INITIAL_CURRENT,
    timelineScrollTop: 0,
    headerCellWidthPx: 0,
    timelinePageWidthPx: 0,
    /** 边界扩展瞬间冻结拖动预览（避免 setData 触发的中间帧错位） */
    timelineFrozen: false,
    hours: [],
    gridHeight: HOUR_HEIGHT_RPX * 24,
    activities: [],
    bottomSafeAreaRpx: 0,
  },

  onLoad() {
    const info = wx.getSystemInfoSync();
    let navbarPaddingRightPx = 12;
    try {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.left && info.windowWidth) {
        navbarPaddingRightPx = Math.max(12, Math.ceil(info.windowWidth - menu.left) + 8);
      }
    } catch (e) {}
    const today = startOfDay(new Date());
    const winW = info.windowWidth || 390;
    const statusBarPx = info.statusBarHeight || 20;
    const timeAxisWidthPx = (96.15385 / 750) * winW;
    const headerCellWidthPx = (winW - timeAxisWidthPx) / 3;

    this._hourHeightPx = (HOUR_HEIGHT_RPX / 750) * winW;
    this._windowWidthPx = winW;
    this._timelineTranslateX = shared(-INITIAL_CURRENT * headerCellWidthPx);
    this._headerTranslateX = this._timelineTranslateX;
    this._weekStripTranslateX = shared(0);
    this._timelineGestureBaseCurrent = shared(INITIAL_CURRENT);
    this._timelineGestureDeltaX = shared(0);
    this._timelinePreviewIndex = shared(INITIAL_CURRENT);
    this._timelinePageCount = shared(2 * TIMELINE_RADIUS + 1);
    this._headerCellWidthPx = shared(headerCellWidthPx);
    this._timelineFrozen = shared(0);

    this.setData({
      statusBarHeight: statusBarPx,
      bottomSafeAreaRpx: getBottomSafeAreaRpx(),
      navbarPaddingRightPx,
      todayDateKey: dateKey(today),
      selectedDateKey: dateKey(today),
      weekStripHighlightKey: dateKey(today),
      hours: Array.from({ length: 24 }, (_, i) => `${pad(i)}:00`),
      headerCellWidthPx,
      timelinePageWidthPx: headerCellWidthPx,
      timelineSwiperCurrent: INITIAL_CURRENT,
    });
    this.rebuildAll([], today);
  },

  onReady() {
    this._calendarReady = true;
    this._installCalendarWorkletStyles();
  },

  _installCalendarWorkletStyles() {
    if (!this._calendarReady || this._calendarWorkletStylesBound) return;
    const weekStripTranslateX = this._weekStripTranslateX;
    const timelineTranslateX = this._timelineTranslateX;
    this.applyAnimatedStyle('#qa-week-strip-slide', () => {
      'worklet'
      return { transform: `translateX(${weekStripTranslateX.value}px)` };
    });
    this.applyAnimatedStyle('#qa-calendar-day-title-strip', () => {
      'worklet'
      return { transform: `translateX(${timelineTranslateX.value}px)` };
    });
    this.applyAnimatedStyle('#qa-calendar-day-grid-strip', () => {
      'worklet'
      return { transform: `translateX(${timelineTranslateX.value}px)` };
    });
    this._calendarWorkletStylesBound = true;
  },

  onShow() {
    patchTabBarIfNeeded(this, {
      selected: 1,
      isAdmin: app.globalData.userRole === "admin",
    });
    this.loadCalendar();
  },

  _clearTimelineTouchGestureState() {
    if (this._timelinePreviewIndex && this._timelineGestureBaseCurrent) {
      this._timelinePreviewIndex.value = this._timelineGestureBaseCurrent.value;
    }
  },

  syncGuestState() {
    const hasWeChatAuth = !!wx.getStorageSync("hasWeChatAuth");
    const hasToken = !!(app.globalData.accessToken || wx.getStorageSync("accessToken"));
    const isGuest = !hasWeChatAuth || !hasToken || !app.globalData.isAuthenticated;
    this.setData({ isGuest });
    return isGuest;
  },

  /** 默认纵向滚动到 09:00 附近 */
  _applyDefaultTimelineScroll() {
    const target = Math.max(
      0,
      Math.round((TIMELINE_DEFAULT_SCROLL_TOP_RPX / 750) * (this._windowWidthPx || 390))
    );
    if (typeof this._timelineScrollSeq !== "number") this._timelineScrollSeq = 0;
    this._timelineScrollSeq += 1;
    const seq = this._timelineScrollSeq;
    this.setData({ timelineScrollTop: 0 }, () => {
      wx.nextTick(() => {
        if (seq !== this._timelineScrollSeq) return;
        this.setData({ timelineScrollTop: target }, () => {
          this._timelineScrollTopPreserve = target;
          this._timelineInitialScrollDone = true;
        });
      });
    });
  },

  _restoreTimelineScroll(desiredTop) {
    let top =
      typeof desiredTop === "number" && !Number.isNaN(desiredTop)
        ? Math.max(0, Math.round(desiredTop))
        : typeof this.data.timelineScrollTop === "number"
          ? Math.max(0, Math.round(this.data.timelineScrollTop))
          : 0;
    if (typeof this._timelineScrollSeq !== "number") this._timelineScrollSeq = 0;
    this._timelineScrollSeq += 1;
    const seq = this._timelineScrollSeq;
    this.setData({ timelineScrollTop: 0 }, () => {
      wx.nextTick(() => {
        if (seq !== this._timelineScrollSeq) return;
        this.setData({ timelineScrollTop: top }, () => {
          this._timelineScrollTopPreserve = top;
        });
      });
    });
  },

  onTimelineScroll(e) {
    const d = (e && e.detail) || {};
    if (typeof d.scrollTop === "number") this._timelineScrollTopPreserve = d.scrollTop;
  },

  onTimelineVerticalScrollEnd(e) {
    'worklet'
    const scrollTop = e && e.detail && e.detail.scrollTop;
    if (typeof scrollTop !== 'number') return;
    const commitScrollTop = this.commitTimelineScrollTop.bind(this);
    runOnJS(commitScrollTop)(scrollTop);
  },

  commitTimelineScrollTop(scrollTop) {
    const top = Math.max(0, Math.round(Number(scrollTop) || 0));
    this._timelineScrollTopPreserve = top;
    if (Math.abs((this.data.timelineScrollTop || 0) - top) < 1) return;
    this.setData({ timelineScrollTop: top });
  },

  /** 避免 setData 后 Date 序列化失真，周切换始终以这份列表分组 */
  activitiesForRebuild() {
    if (Array.isArray(this._calendarActivitiesCanon)) return this._calendarActivitiesCanon;
    return this.data.activities || [];
  },

  /**
   * 完整重建（仅在数据加载、点击日期、跨周翻周时使用）。
   * 围绕 anchorDate 构建 31 page 长列表，current 重置为 INITIAL_CURRENT，
   * weekStripPages 围绕 anchorDate 构建。
   */
  rebuildAll(activities, anchorDate) {
    const anchor = startOfDay(parseDate(anchorDate) || new Date());
    const byDate = new Map();
    (activities || []).forEach((activity) => {
      if (!byDate.has(activity.dateKey)) byDate.set(activity.dateKey, []);
      byDate.get(activity.dateKey).push(activity);
    });
    const todayKey = dateKey(startOfDay(new Date()));
    const timelineSwipePages = buildTimelineLongList(anchor, byDate, todayKey);
    const weekStripPages = buildWeekStripSwipePages(anchor, todayKey, byDate);

    this._anchorDateKey = dateKey(anchor);
    this._byDateMap = byDate;
    this._clearTimelineTouchGestureState();

    this._timelineFrozen.value = 1;
    this.setData({
      selectedDateKey: this._anchorDateKey,
      weekStripHighlightKey: this._anchorDateKey,
      weekNumber: `第${getWeekNumber(anchor)}周`,
      weekStripPages,
      weekStripSwiperIndex: 1,
      timelineSwipePages,
      timelineSwiperCurrent: INITIAL_CURRENT,
      timelineFrozen: true,
    }, () => {
      this._installCalendarWorkletStyles();
      const baseOffset = -INITIAL_CURRENT * this.data.headerCellWidthPx;
      this._timelineTranslateX.value = baseOffset;
      this._weekStripTranslateX.value = 0;
      this._timelineGestureBaseCurrent.value = INITIAL_CURRENT;
      this._timelineGestureDeltaX.value = 0;
      this._timelinePreviewIndex.value = INITIAL_CURRENT;
      this._timelinePageCount.value = timelineSwipePages.length;
      if (!this._timelineInitialScrollDone) {
        this._applyDefaultTimelineScroll();
      } else {
        const top = typeof this._timelineScrollTopPreserve === "number"
          ? this._timelineScrollTopPreserve
          : this.data.timelineScrollTop;
        this._restoreTimelineScroll(top);
      }
      // 等视图消费完新列表再解冻，避免边界扩展或数据刷新时读到旧宽度。
      wx.nextTick(() => {
        wx.nextTick(() => {
          this._timelineFrozen.value = 0;
          this.setData({ timelineFrozen: false });
        });
      });
    });
  },

  loadCalendar(forceRefresh) {
    const isGuest = this.syncGuestState();
    if (isGuest) {
      this._calendarActivitiesCanon = [];
      this.setData({ loading: false, loadError: "", empty: true, activities: [] }, () => {
        this.rebuildAll([], parseDate(this.data.selectedDateKey) || new Date());
      });
      return;
    }

    if (typeof this._calendarLoadSeq !== "number") this._calendarLoadSeq = 0;
    this._calendarLoadSeq += 1;
    const seq = this._calendarLoadSeq;

    if (forceRefresh) this.setData({ loadError: "" });

    const readUid = currentUserId(app);
    let hadCachePaint = false;
    if (!forceRefresh && readUid) {
      const cached = myActivitiesCache.readRawList(readUid);
      if (cached != null && Array.isArray(cached)) {
        const activities = cached.map(adaptActivity);
        this._calendarActivitiesCanon = activities;
        this.setData(
          { loading: false, loadError: "", empty: activities.length === 0, activities },
          () => {
            const anchor = anchorDateFromVisibleTimelinePage(this) || parseDate(this.data.selectedDateKey) || new Date();
            this.rebuildAll(this.activitiesForRebuild(), anchor);
          }
        );
        hadCachePaint = true;
      }
    }

    const token = app.globalData.accessToken || wx.getStorageSync("accessToken") || "";
    if (!token) {
      this.syncGuestState();
      this._calendarActivitiesCanon = [];
      this.setData({ loading: false, loadError: "", empty: true, activities: [] }, () => {
        this.rebuildAll([], parseDate(this.data.selectedDateKey) || new Date());
      });
      return;
    }

    if (!hadCachePaint) this.setData({ loading: true, loadError: "" });

    Promise.all([
      activityService.listMyActivities().catch((e) => ({ __error: e })),
      ensureSessionParallel(app),
    ]).then(([listRes, ens]) => {
      if (seq !== this._calendarLoadSeq) return;

      if (!ens.ok || this.syncGuestState()) {
        this._calendarActivitiesCanon = [];
        this.setData({ loading: false, loadError: "", empty: true, activities: [] }, () => {
          this.rebuildAll([], parseDate(this.data.selectedDateKey) || new Date());
        });
        return;
      }

      const uidForCache = currentUserId(app);

      if (listRes && listRes.__error) {
        const errMsg = listRes.__error.message || listRes.__error.errMsg || "日程加载失败";
        if (!hadCachePaint) {
          this.setData({ loading: false, loadError: String(errMsg) || "日程加载失败", empty: false });
        } else {
          this.setData({ loading: false });
        }
        return;
      }

      const rawList = Array.isArray(listRes) ? listRes : [];
      if (uidForCache) myActivitiesCache.writeRawList(uidForCache, rawList);

      const activities = rawList.map(adaptActivity);
      this._calendarActivitiesCanon = activities;
      this.setData(
        { loading: false, loadError: "", empty: activities.length === 0, activities },
        () => {
          const anchor = anchorDateFromVisibleTimelinePage(this) || parseDate(this.data.selectedDateKey) || new Date();
          this.rebuildAll(this.activitiesForRebuild(), anchor);
        }
      );
    });
  },

  /** 周条手势：仅记录翻周方向（±7），动画在 animationFinish 中执行 */
  onWeekStripSwiperChange(e) {
    const d = e.detail || {};
    const src = d.source;
    const idxNum = Number(d.current);
    if (this._weekStripSwipeBusy) return;
    // 时间轴拖动会程序化切换周条可见页；只有用户直接拖周条才提交 ±7 天。
    if (src !== "touch") return;
    const slideIndex = Number.isFinite(idxNum) ? idxNum : NaN;
    if (slideIndex !== 0 && slideIndex !== 2) return;

    this._weekStripPendingSlideIndex = slideIndex;
    this._weekStripGestureRole = "week-strip";
    this._weekStripCommitConsumed = false;
    this.setData({ weekStripSwiperIndex: slideIndex });
    this._weekStripSwipeBusy = true;
  },

  /**
   * 周条翻周完成：沿唯一的时间轴位移移动七天，不重建日期数据。
   * 必要时先在前/后扩展 14 天保证 current ± 7 不越界。
   */
  onWeekStripSwiperAnimationFinish(e) {
    const d = (e && e.detail) || {};
    const idxNum = Number(d.current);
    const currentIndex = Number.isFinite(idxNum) ? idxNum : NaN;
    const pending = this._weekStripPendingSlideIndex;
    const slideIndex = pending === 0 || pending === 2 ? pending : currentIndex;


    if (this._weekStripCommitConsumed) return;
    const gestureRole = this._weekStripGestureRole || "";
    if (gestureRole !== "week-strip") return;

    if (slideIndex !== 0 && slideIndex !== 2) {
      this._weekStripPendingSlideIndex = null;
      this._weekStripGestureRole = "";
      this._weekStripCommitConsumed = false;
      this._weekStripSwipeBusy = false;
      return;
    }
    this._weekStripCommitConsumed = true;

    const deltaDays = slideIndex === 0 ? -7 : 7;
    this._weekStripPendingSlideIndex = null;
    this._weekStripGestureRole = "";
    this._weekStripCommitConsumed = false;

    const curCurrent = this.data.timelineSwiperCurrent;
    const targetCurrent = curCurrent + deltaDays;

    // 确保 targetCurrent 在 [0, pages.length - 3] 之内，否则先扩展
    this._ensurePagesCoverCurrent(targetCurrent, () => {
      // 扩展可能改变了 current 的相对位置；重新读取 current 后计算偏移目标
      const adjustedTarget = this.data.timelineSwiperCurrent + deltaDays;
      const newCenterPage = this.data.timelineSwipePages[adjustedTarget];

      // #endregion

      if (!newCenterPage) {
        this._weekStripSwipeBusy = false;
        return;
      }
      this.setData({
        weekStripSwiperIndex: 1,
        weekStripSwiperDuration: 0,
      }, () => {
        this._animateTimelineToCurrent(adjustedTarget, TIMELINE_BURST_TOTAL_MS);
        wx.nextTick(() => {
          this.setData({ weekStripSwiperDuration: 300 });
        });
        this._weekStripSwipeBusy = false;
      });
    });
  },

  /**
   * 边界扩展：若 targetCurrent 不在 [0, pages.length-3] 之内，或距两端 ≤ EDGE_GUARD，
   * 在前/后补 EDGE_EXTEND 天。前补会改变所有 cell 的 idx，需同步调整 current。
   * 扩展后同时调整 current 与共享 transform，可见日期保持不变。
   */
  _ensurePagesCoverCurrent(targetCurrent, done) {
    const pages = this.data.timelineSwipePages;
    const len = pages.length;
    const todayKey = dateKey(startOfDay(new Date()));
    const byDate = this._byDateMap || new Map();

    let prependCount = 0;
    let appendCount = 0;
    if (targetCurrent <= EDGE_GUARD) prependCount = EDGE_EXTEND;
    if (targetCurrent >= len - 3 - EDGE_GUARD) appendCount = EDGE_EXTEND;
    if (prependCount === 0 && appendCount === 0) {
      done && done();
      return;
    }

    let newPages = pages;
    if (prependCount > 0) {
      const firstDate = parseDate(pages[0].key);
      const prepend = Array.from({ length: prependCount }, (_, i) =>
        buildTimelineColumn(addDays(firstDate, -prependCount + i), byDate, todayKey)
      );
      newPages = prepend.concat(newPages);
    }
    if (appendCount > 0) {
      const lastDate = parseDate(pages[len - 1].key);
      const append = Array.from({ length: appendCount }, (_, i) =>
        buildTimelineColumn(addDays(lastDate, i + 1), byDate, todayKey)
      );
      newPages = newPages.concat(append);
    }

    const newCurrent = this.data.timelineSwiperCurrent + prependCount;
    this._timelineFrozen.value = 1;
    this.setData({
      timelineFrozen: true,
      timelineSwipePages: newPages,
      timelineSwiperCurrent: newCurrent,
    }, () => {
      this._timelineTranslateX.value = -newCurrent * this.data.headerCellWidthPx;
      this._timelineGestureBaseCurrent.value = newCurrent;
      this._timelineGestureDeltaX.value = 0;
      this._timelinePreviewIndex.value = newCurrent;
      this._timelinePageCount.value = newPages.length;
      wx.nextTick(() => {
        this._timelineFrozen.value = 0;
        this.setData({ timelineFrozen: false });
        done && done();
      });
    });
  },

  /** 周条上点击某日：跳转到该日 */
  onJumpToToday() {
    const todayKey = this.data.todayDateKey || dateKey(startOfDay(new Date()));
    if (!todayKey) return;
    if (this.data.selectedDateKey === todayKey) return;
    this._clearTimelineTouchGestureState();
    const pages = this.data.timelineSwipePages || [];
    const idx = pages.findIndex((p) => p && p.key === todayKey);
    if (idx >= 0 && idx <= pages.length - 3) {
      this._animateTimelineToCurrent(idx, 300);
      return;
    }
    this.rebuildAll(this.activitiesForRebuild(), parseDate(todayKey) || new Date());
  },

  /** 周条上点击某日：跳转到该日 */
  onDateTap(e) {
    const key = e.currentTarget.dataset.key;
    const selected = parseDate(key);
    if (!selected) return;
    this._clearTimelineTouchGestureState();
    const pages = this.data.timelineSwipePages;
    // 在现有 pages 中查找 idx
    const idx = pages.findIndex((p) => p.key === key);
    if (idx >= 0) {
      // 左列为选中日：pages[current].key === key ⇒ current === idx
      const targetCurrent = idx;
      // 越界（display=3 要求 current ∈ [0, len-3]）则按 rebuild 处理
      if (targetCurrent >= 0 && targetCurrent <= pages.length - 3) {
        this._animateTimelineToCurrent(targetCurrent, 300);
        return;
      }
    }
    // 不在范围内：完全重建围绕该日
    this.rebuildAll(this.activitiesForRebuild(), selected);
  },

  /**
   * Skyline 单坐标源时间轴：日期栏与活动列共用 timelineTranslateX。
   * deltaX 是相对上一帧的增量，每帧只写一个 SharedValue，不经过 setData。
   */
  onTimelineGesture(e) {
    'worklet'
    if (this._timelineFrozen.value === 1) return;
    const state = e.state;
    const cellWidth = this._headerCellWidthPx.value;
    if (!(cellWidth > 0)) return;

    if (state === 1) {
      cancelAnimation(this._timelineTranslateX);
      this._timelineGestureDeltaX.value = 0;
      this._timelinePreviewIndex.value = this._timelineGestureBaseCurrent.value;
      return;
    }

    if (state === 2) {
      const deltaX = typeof e.deltaX === 'number' ? e.deltaX : 0;
      this._timelineGestureDeltaX.value += deltaX;
      const minTranslate = -Math.max(0, this._timelinePageCount.value - 3) * cellWidth;
      let nextX = this._timelineTranslateX.value + deltaX;
      nextX = Math.max(minTranslate, Math.min(0, nextX));
      this._timelineTranslateX.value = nextX;

      const previewIndex = Math.max(
        0,
        Math.min(this._timelinePageCount.value - 3, Math.round(-nextX / cellWidth))
      );
      if (previewIndex !== this._timelinePreviewIndex.value) {
        this._timelinePreviewIndex.value = previewIndex;
        const preview = this.previewTimelineDate.bind(this);
        runOnJS(preview)(previewIndex);
      }
      return;
    }

    if (state !== 3 && state !== 4) return;
    const baseCurrent = this._timelineGestureBaseCurrent.value;
    const dragX = this._timelineGestureDeltaX.value;
    const velocityX = typeof e.velocityX === 'number' ? e.velocityX : 0;
    let direction = 0;
    if (state === 3) {
      if (dragX <= -cellWidth * 0.25 || velocityX <= -350) direction = 1;
      if (dragX >= cellWidth * 0.25 || velocityX >= 350) direction = -1;
    }
    const maxCurrent = Math.max(0, this._timelinePageCount.value - 3);
    const targetCurrent = Math.max(0, Math.min(maxCurrent, baseCurrent + direction));
    this._timelineGestureBaseCurrent.value = targetCurrent;
    this._timelineGestureDeltaX.value = 0;
    this._timelinePreviewIndex.value = targetCurrent;
    this._timelineTranslateX.value = timing(-targetCurrent * cellWidth, {
      duration: 240,
      easing: Easing.ease,
    });
    const commit = this.commitTimelineCurrent.bind(this);
    runOnJS(commit)(targetCurrent);
  },

  previewTimelineDate(previewIndex) {
    const idx = Number(previewIndex);
    const page = this.data.timelineSwipePages[idx];
    const key = page && page.key;
    if (!key || key === this.data.weekStripHighlightKey) return;
    if (weekStripPageIndexForDateKey(this.data.weekStripPages, key) < 0) return;
    this.setData({ weekStripHighlightKey: key });
  },

  _animateTimelineToCurrent(current, duration) {
    const pages = this.data.timelineSwipePages;
    const maxCurrent = Math.max(0, pages.length - 3);
    const cur = Math.max(0, Math.min(maxCurrent, Number(current)));
    if (!Number.isInteger(cur) || !pages[cur]) return;
    cancelAnimation(this._timelineTranslateX);
    this._timelineGestureBaseCurrent.value = cur;
    this._timelineGestureDeltaX.value = 0;
    this._timelinePreviewIndex.value = cur;
    this._timelineTranslateX.value = timing(-cur * this.data.headerCellWidthPx, {
      duration: Math.max(0, Number(duration) || 0),
      easing: Easing.ease,
    });
    this.commitTimelineCurrent(cur);
  },

  /** 手势和程序化跳转的唯一提交点。 */
  commitTimelineCurrent(current) {
    const pages = this.data.timelineSwipePages;
    const cur = Number(current);
    if (!Number.isInteger(cur) || !pages[cur]) return;
    const anchorKey = pages[cur] && pages[cur].key;
    const kSel = this.data.selectedDateKey;
    const k = anchorKey || kSel;
    const didSync = this.data.weekStripHighlightKey !== k;
    const previewedOtherWeek = this.data.weekStripSwiperIndex !== 1;
    const weekStripPreviewNeedsRestore =
      previewedOtherWeek || this.data.weekStripSwiperDuration === 0;
    const anchorDate = parseDate(k);
    const oldSelectedDate = parseDate(this.data.selectedDateKey) || anchorDate;
    const crossWeek = anchorDate
      && oldSelectedDate
      && getMonday(anchorDate).getTime() !== getMonday(oldSelectedDate).getTime();
    const patch = {};
    patch.timelineSwiperCurrent = cur;
    if (anchorDate) {
      patch.selectedDateKey = k;
      patch.weekNumber = `第${getWeekNumber(anchorDate)}周`;
    }
    if (didSync) patch.weekStripHighlightKey = k;
    if (previewedOtherWeek) {
      patch.weekStripSwiperIndex = 1;
      patch.weekStripSwiperDuration = 0;
    }
    if (crossWeek && anchorDate) {
      const oldMon = getMonday(oldSelectedDate);
      const newMon = getMonday(anchorDate);
      const forward = newMon.getTime() > oldMon.getTime();
      this._weekStripTranslateX.value = forward ? 600 : -600;
      patch.weekStripPages = buildWeekStripSwipePages(
        anchorDate, dateKey(startOfDay(new Date())), this._byDateMap || new Map()
      );
      patch.weekStripSwiperIndex = 1;
      patch.weekStripSwiperDuration = 0;
    }
    this.setData(patch, () => {
      this._timelineGestureBaseCurrent.value = cur;
      this._timelineGestureDeltaX.value = 0;
      this._timelinePreviewIndex.value = cur;
      if (crossWeek && anchorDate) {
        wx.nextTick(() => {
          this._weekStripTranslateX.value = timing(0, {
            duration: 220,
            easing: Easing.ease,
          });
          this.setData({ weekStripSwiperDuration: 300 });
        });
      } else if (weekStripPreviewNeedsRestore) {
        wx.nextTick(() => {
          this.setData({ weekStripSwiperDuration: 300 });
        });
      }
      if (cur <= EDGE_GUARD || cur >= pages.length - 3 - EDGE_GUARD) {
        this._ensurePagesCoverCurrent(cur, () => {});
      }
    });
  },

  onActivityTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/activity_detail/activity_detail?id=${id}` });
  },

  onRetry() {
    this.loadCalendar(true);
  },

  goProfile() {
    wx.switchTab({ url: "/pages/profile/profile" });
  },

});
