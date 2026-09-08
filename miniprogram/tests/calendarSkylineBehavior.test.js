const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../pages/activity_calendar/activity_calendar.js"),
  "utf8"
);

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCalendarPage() {
  let pageDefinition = null;
  const animatedStyles = new Map();
  const wxMock = {
    worklet: {
      shared(value) {
        return { value };
      },
      timing(value, options, callback) {
        if (callback) callback(true);
        return value;
      },
      cancelAnimation() {},
      Easing: { ease: "ease" },
      runOnJS(fn) {
        return fn;
      },
    },
    getStorageSync() {
      return "";
    },
    getSystemInfoSync() {
      return { windowWidth: 390, statusBarHeight: 44 };
    },
    getMenuButtonBoundingClientRect() {
      return { left: 300 };
    },
    nextTick(fn) {
      fn();
    },
    navigateTo() {},
    switchTab() {},
  };
  const appMock = {
    globalData: {
      accessToken: "",
      userId: "",
      userProfile: null,
      userRole: "user",
      isAuthenticated: false,
    },
    applyCurrentUser() {},
    logout() {},
  };
  const sandbox = {
    console,
    Date,
    Map,
    Math,
    Number,
    Promise,
    setTimeout,
    clearTimeout,
    wx: wxMock,
    getApp() {
      return appMock;
    },
    Page(definition) {
      pageDefinition = definition;
    },
    require(request) {
      if (request === "../../utils/tabBarSync") return { patchTabBarIfNeeded() {} };
      if (request === "../../utils/safeArea") return { getBottomSafeAreaRpx: () => 0 };
      if (request === "../../utils/myActivitiesCache") {
        return { readRawList: () => null, writeRawList() {} };
      }
      if (request === "../../services/activity") {
        return { listMyActivities: () => Promise.resolve([]) };
      }
      if (request === "../../services/user") {
        return { getMe: () => Promise.reject(new Error("not used")) };
      }
      throw new Error(`Unexpected module: ${request}`);
    },
  };

  vm.runInNewContext(source, sandbox, { filename: "activity_calendar.js" });
  assert.ok(pageDefinition, "calendar Page definition must register");

  const page = Object.assign({}, pageDefinition);
  page.data = cloneData(pageDefinition.data);
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  page.applyAnimatedStyle = function applyAnimatedStyle(selector, updater) {
    animatedStyles.set(selector, updater);
  };
  page.clearAnimatedStyle = function clearAnimatedStyle(selector) {
    animatedStyles.delete(selector);
  };
  page.onLoad();
  page.setData({ loading: false });
  page.onReady();

  return { page, animatedStyles };
}

function assertSettledAnchor(page) {
  const current = page.data.timelineSwiperCurrent;
  const key = page.data.timelineSwipePages[current].key;
  assert.equal(page.data.selectedDateKey, key);
  assert.equal(page.data.weekStripHighlightKey, key);
  assert.equal(page._timelineTranslateX.value, -current * page.data.headerCellWidthPx);
}

function dragTimeline(page, deltaDays, distanceRatio = 0.4) {
  const fingerDirection = deltaDays > 0 ? -1 : 1;
  const distance = fingerDirection * page.data.headerCellWidthPx * distanceRatio;
  page.onTimelineGesture({ state: 1 });
  page.onTimelineGesture({ state: 2, deltaX: distance });
  page.onTimelineGesture({ state: 3, velocityX: fingerDirection * 500 });
}

function shiftDateKey(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

test("Skyline calendar binds date titles and activity columns to one SharedValue", () => {
  const { page, animatedStyles } = loadCalendarPage();
  assert.equal(page.data.timelineSwiperCurrent, 15);
  assert.equal(page.data.timelineSwipePages.length, 31);
  assert.equal(page.data.timelineScrollTop, 492);
  assert.ok(Math.abs(page.data.headerCellWidthPx - (390 - 50) / 3) < 0.001);
  assert.deepEqual(
    [...animatedStyles.keys()],
    ["#qa-week-strip-slide", "#qa-calendar-day-title-strip", "#qa-calendar-day-grid-strip"]
  );

  page._timelineTranslateX.value -= 17.25;
  const titleStyle = animatedStyles.get("#qa-calendar-day-title-strip")();
  const gridStyle = animatedStyles.get("#qa-calendar-day-grid-strip")();
  assert.deepEqual(titleStyle, gridStyle);
});

test("left and right gestures each commit exactly one day", () => {
  const { page } = loadCalendarPage();
  const initial = page.data.timelineSwiperCurrent;

  dragTimeline(page, 1, 1.8);
  assert.equal(page.data.timelineSwiperCurrent, initial + 1, "a long left drag must still move one day");
  assertSettledAnchor(page);

  dragTimeline(page, -1, 1.8);
  assert.equal(page.data.timelineSwiperCurrent, initial, "a right drag must move back one day");
  assertSettledAnchor(page);
});

test("incremental gesture deltas move titles and activities together during the drag", () => {
  const { page, animatedStyles } = loadCalendarPage();
  const current = page.data.timelineSwiperCurrent;
  const width = page.data.headerCellWidthPx;

  page.onTimelineGesture({ state: 1 });
  page.onTimelineGesture({ state: 2, deltaX: -width * 0.2 });
  page.onTimelineGesture({ state: 2, deltaX: -width * 0.2 });

  assert.ok(
    Math.abs(page._timelineTranslateX.value - (-(current + 0.4) * width)) < 0.000001
  );
  assert.deepEqual(
    animatedStyles.get("#qa-calendar-day-title-strip")(),
    animatedStyles.get("#qa-calendar-day-grid-strip")()
  );
  assert.equal(page.data.weekStripHighlightKey, page.data.timelineSwipePages[current].key);

  page.onTimelineGesture({ state: 3, velocityX: -500 });
  assert.equal(page.data.timelineSwiperCurrent, current + 1);
  assertSettledAnchor(page);
});

test("short and cancelled gestures snap back to the same date", () => {
  const { page } = loadCalendarPage();
  const current = page.data.timelineSwiperCurrent;
  const width = page.data.headerCellWidthPx;

  page.onTimelineGesture({ state: 1 });
  page.onTimelineGesture({ state: 2, deltaX: -width * 0.1 });
  page.onTimelineGesture({ state: 3, velocityX: 0 });
  assert.equal(page.data.timelineSwiperCurrent, current);
  assertSettledAnchor(page);

  page.onTimelineGesture({ state: 1 });
  page.onTimelineGesture({ state: 2, deltaX: -width * 0.8 });
  page.onTimelineGesture({ state: 4, velocityX: -800 });
  assert.equal(page.data.timelineSwiperCurrent, current);
  assertSettledAnchor(page);
});

test("drag preview changes only the top week highlight before commit", () => {
  const { page } = loadCalendarPage();
  const current = page.data.timelineSwiperCurrent;
  const originalSelected = page.data.selectedDateKey;
  const originalWeekNumber = page.data.weekNumber;

  page.onTimelineGesture({ state: 1 });
  page.onTimelineGesture({ state: 2, deltaX: -page.data.headerCellWidthPx * 0.6 });

  assert.equal(page.data.selectedDateKey, originalSelected);
  assert.equal(page.data.weekNumber, originalWeekNumber);
  assert.equal(page.data.weekStripHighlightKey, page.data.timelineSwipePages[current + 1].key);
});

test("an activity remains attached only to its real date through both-direction paging", () => {
  const { page } = loadCalendarPage();
  const realPage = page.data.timelineSwipePages[page.data.timelineSwiperCurrent - 7];
  const activity = {
    _id: "activity-real-date",
    name: "activity-real-date",
    dateKey: realPage.key,
    start: new Date(`${realPage.key}T13:00:00`),
  };

  page.rebuildAll([activity], new Date());
  for (const delta of [1, 1, -1, -1]) dragTimeline(page, delta);

  const containingPages = page.data.timelineSwipePages.filter((item) =>
    item.activities.some((entry) => entry._id === activity._id)
  );
  assert.equal(containingPages.map((item) => item.key).join(","), realPage.key);
  assertSettledAnchor(page);
});

test("week-strip paging advances the common timeline anchor by exactly seven days", () => {
  const { page } = loadCalendarPage();
  const beforeCurrent = page.data.timelineSwiperCurrent;
  const expectedKey = page.data.timelineSwipePages[beforeCurrent + 7].key;

  page.onWeekStripSwiperChange({ detail: { source: "touch", current: 2 } });
  page.onWeekStripSwiperAnimationFinish({
    detail: { current: 2 },
    currentTarget: { dataset: { role: "week-strip" } },
  });

  assert.equal(page.data.timelineSwiperCurrent, beforeCurrent + 7);
  assert.equal(page.data.selectedDateKey, expectedKey);
  assertSettledAnchor(page);
});

test("date taps and today action update the one timeline anchor immediately", () => {
  const { page } = loadCalendarPage();
  const tapped = page.data.weekStripPages[1].days[0];
  const expectedCurrent = page.data.timelineSwipePages.findIndex((item) => item.key === tapped.key);

  page.onDateTap({ currentTarget: { dataset: { key: tapped.key } } });
  assert.equal(page.data.timelineSwiperCurrent, expectedCurrent);
  assertSettledAnchor(page);

  page.onJumpToToday();
  assert.equal(page.data.selectedDateKey, page.data.todayDateKey);
  assertSettledAnchor(page);
});

test("prepending boundary pages preserves the same visible date and common transform", () => {
  const { page } = loadCalendarPage();
  const beforeLength = page.data.timelineSwipePages.length;
  const visibleKey = page.data.timelineSwipePages[3].key;
  page.setData({ timelineSwiperCurrent: 3 });

  let completed = false;
  page._ensurePagesCoverCurrent(3, () => {
    completed = true;
  });

  assert.equal(completed, true);
  assert.equal(page.data.timelineSwipePages.length, beforeLength + 14);
  assert.equal(page.data.timelineSwiperCurrent, 17);
  assert.equal(page.data.timelineSwipePages[17].key, visibleKey);
  assert.equal(page.data.timelineFrozen, false);
  assert.equal(page._timelineTranslateX.value, -17 * page.data.headerCellWidthPx);
});

test("continuous two-way drags survive both list boundaries without date drift", () => {
  const { page } = loadCalendarPage();
  const initialLength = page.data.timelineSwipePages.length;
  const deltas = [
    ...Array(14).fill(-1),
    ...Array(28).fill(1),
    ...Array(14).fill(-1),
  ];

  for (const delta of deltas) {
    const expectedKey = shiftDateKey(page.data.selectedDateKey, delta);
    dragTimeline(page, delta);
    assertSettledAnchor(page);
    assert.equal(page.data.selectedDateKey, expectedKey);
    assert.ok(
      page.data.weekStripPages[1].days.some((day) => day.key === expectedKey),
      `center week strip must contain ${expectedKey}`
    );
  }

  assert.ok(page.data.timelineSwipePages.length > initialLength);
  assert.equal(page.data.selectedDateKey, page.data.todayDateKey);
});

test("vertical timeline scroll position is retained for data rebuilds", () => {
  const { page } = loadCalendarPage();
  page.onTimelineScroll({ detail: { scrollTop: 642.4 } });
  page.rebuildAll([], new Date());
  assert.equal(page.data.timelineScrollTop, 642);
  assert.equal(page._timelineScrollTopPreserve, 642);
});
