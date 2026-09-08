const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Red/green migration contract for the calendar tab.
 *
 * These tests intentionally describe the completed Skyline shape. They are
 * expected to fail while the calendar page is still on the WebView/WXS
 * implementation, then become a permanent regression guard after migration.
 */

const pageDir = path.join(__dirname, "../pages/activity_calendar");
const pageJson = JSON.parse(
  fs.readFileSync(path.join(pageDir, "activity_calendar.json"), "utf8")
);
const wxml = fs.readFileSync(
  path.join(pageDir, "activity_calendar.wxml"),
  "utf8"
);
const wxss = fs.readFileSync(
  path.join(pageDir, "activity_calendar.wxss"),
  "utf8"
);
const js = fs.readFileSync(
  path.join(pageDir, "activity_calendar.js"),
  "utf8"
);
const projectConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../project.config.json"), "utf8")
);

function openingTag(source, tagName, discriminator) {
  const tags = source.match(new RegExp(`<${tagName}\\b[^>]*>`, "g")) || [];
  return tags.find((tag) => discriminator.test(tag)) || "";
}

function assertBalancedMarkup(source) {
  const stack = [];
  const tags = source.match(/<\/?[a-z-]+\b[^>]*>/g) || [];
  for (const tag of tags) {
    const name = tag.match(/^<\/?([a-z-]+)/)[1];
    if (tag.startsWith("</")) {
      assert.equal(stack.pop(), name, `unexpected closing tag ${tag}`);
    } else if (!tag.endsWith("/>")) {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], "calendar WXML tags must be balanced");
}

test("calendar tab opts into Skyline with a locked page viewport", () => {
  assertBalancedMarkup(wxml);
  assert.equal(pageJson.renderer, "skyline");
  assert.equal(pageJson.componentFramework, "glass-easel");
  assert.equal(pageJson.navigationStyle, "custom");
  assert.equal(pageJson.disableScroll, true);
  assert.equal(pageJson.enablePullDownRefresh, false);

  assert.equal(projectConfig.setting.skylineRenderEnable, true);
  assert.equal(
    projectConfig.setting.compileWorklet,
    true,
    "calendar UI-thread animation requires Worklet compilation"
  );
});

test("calendar fixes the left axis while only the three right-hand days move", () => {
  const pageRoot = openingTag(wxml, "view", /class="calendar-page"/);
  const calendarBody = openingTag(wxml, "view", /class="calendar-body"/);
  const timelineScroll = openingTag(wxml, "scroll-view", /class="timeline-scroll"/);

  assert.match(pageRoot, /id="qa-calendar-page"/);
  assert.doesNotMatch(
    calendarBody,
    /\bwx:(?:if|elif|else)\b/,
    "the Worklet target must remain mounted while loading state overlays change"
  );
  assert.match(timelineScroll, /id="qa-calendar-timeline-scroll"/);
  assert.match(timelineScroll, /\btype="custom"/);
  assert.match(timelineScroll, /\bscroll-y(?:\s|=|>)/);
  assert.match(timelineScroll, /\bscroll-top="\{\{timelineScrollTop\}\}"/);
  assert.match(timelineScroll, /\bbindscroll="onTimelineScroll"/);
  assert.doesNotMatch(wxml, /<sticky-section\b|<sticky-header\b/);
  assert.doesNotMatch(wxml, /timelineViewportPages|timeline-table-page/);
  assert.match(
    wxml,
    /<view class="timeline-sticky-header">[\s\S]*?<scroll-view\b[^>]*class="timeline-scroll"[\s\S]*?<view class="time-axis time-axis--body">[\s\S]*?<horizontal-drag-gesture-handler\b/,
    "the sticky date row and fixed time axis must stay outside the moving day strip"
  );
  assert.match(wxml, /id="qa-calendar-day-title-strip"/);
  assert.match(wxml, /id="qa-calendar-day-grid-strip"/);
  assert.match(wxml, /wx:for="\{\{timelineSwipePages\}\}"/);
  assert.match(wxml, /class="timeline-sticky-header-row"/);
  assert.match(wxml, /class="timeline-header-line timeline-header-line--top"/);
  assert.match(wxml, /class="timeline-header-line timeline-header-line--bottom"/);
  assert.match(wxml, /class="time-axis-head-text"/);
  assert.match(wxml, /class="day-title-text"/);
  assert.match(
    wxss,
    /\.day-title-text\s*\{[^}]*font-size:\s*23\.07692rpx;[^}]*line-height:\s*23\.07692rpx;[^}]*font-weight:\s*400;/s
  );
  assert.match(
    wxss,
    /\.time-axis-head-text\s*\{[^}]*font-size:\s*19\.23077rpx;[^}]*line-height:\s*19\.23077rpx;[^}]*font-weight:\s*400;/s
  );
  assert.doesNotMatch(wxss, /position\s*:\s*sticky\b/);
});

test("calendar keeps the week swiper but gives the timeline one Worklet position source", () => {
  const weekStrip = openingTag(wxml, "swiper", /data-role="week-strip"/);
  const timelineGesture = openingTag(
    wxml,
    "horizontal-drag-gesture-handler",
    /tag="calendar-timeline-drag"/
  );

  assert.match(weekStrip, /id="qa-calendar-week-strip"/);
  assert.match(weekStrip, /\bcurrent="\{\{weekStripSwiperIndex\}\}"/);
  assert.match(weekStrip, /\bduration="\{\{weekStripSwiperDuration\}\}"/);
  assert.match(weekStrip, /\bbindchange="onWeekStripSwiperChange"/);
  assert.match(
    weekStrip,
    /\bbindanimationfinish="onWeekStripSwiperAnimationFinish"/
  );

  assert.match(timelineGesture, /\bworklet:ongesture="onTimelineGesture"/);
  assert.doesNotMatch(wxml, /data-role="timeline"|qa-calendar-timeline-swiper/);
  assert.doesNotMatch(js, /\bonTimelineSwiperChange\s*\(|\bonTimelineSwiperAnimFinish\s*\(/);

  for (const method of [
    "onWeekStripSwiperChange",
    "onWeekStripSwiperAnimationFinish",
    "onTimelineGesture",
    "previewTimelineDate",
    "commitTimelineCurrent",
    "_animateTimelineToCurrent",
    "onDateTap",
    "onJumpToToday",
    "_ensurePagesCoverCurrent"
  ]) {
    assert.match(js, new RegExp(`\\b${method}\\s*\\(`), `${method} must remain`);
  }
});

test("calendar replaces the WebView animation bridge with Worklet", () => {
  const weekStripMotion = openingTag(
    wxml,
    "view",
    /class="week-strip-slide-wrapper"/
  );

  assert.doesNotMatch(wxml, /<wxs\b|\bbindtransition=/);
  assert.equal(fs.existsSync(path.join(pageDir, "swiper-header-sync.wxs")), false);
  assert.doesNotMatch(wxml, /\banimation="\{\{weekStripSlideAnim\}\}"/);
  assert.doesNotMatch(js, /\bwx\.createAnimation\s*\(|\bweekStripSlideAnim\b/);

  assert.match(weekStripMotion, /id="qa-week-strip-slide"/);

  assert.match(js, /\bwx\.worklet\b/);
  assert.match(js, /\bshared\s*\(/);
  assert.match(js, /\btiming\s*\(/);
  assert.match(js, /\bapplyAnimatedStyle\s*\(/);
  assert.match(js, /applyAnimatedStyle\s*\(\s*['"]#qa-week-strip-slide['"]/);
  assert.match(js, /applyAnimatedStyle\s*\(\s*['"]#qa-calendar-day-title-strip['"]/);
  assert.match(js, /applyAnimatedStyle\s*\(\s*['"]#qa-calendar-day-grid-strip['"]/);
  assert.match(js, /const timelineTranslateX = this\._timelineTranslateX/);
  assert.match(js, /this\._timelineTranslateX\.value\s*=\s*nextX/);
  assert.match(js, /\b_installCalendarWorkletStyles\s*\(\)/);
  assert.match(js, /['"]worklet['"]/);
  assert.match(js, /\brunOnJS\s*\(/);
  assert.doesNotMatch(
    js,
    /['"]worklet['"]\s*;?[\s\S]{0,500}?\b(?:const|let|var)\s*\{[^}]+\}\s*=\s*this\.data\b/,
    "a worklet must not destructure this.data because it can freeze page data"
  );
});

test("calendar removes WebView-only page and overflow behavior", () => {
  assert.doesNotMatch(js, /\bonPageScroll\s*\(/);
  assert.doesNotMatch(wxss, /position\s*:\s*sticky\b/);
  assert.doesNotMatch(wxss, /overflow(?:-x|-y)?\s*:\s*(?:auto|scroll)\b/);
  assert.doesNotMatch(wxss, /display\s*:\s*inline\b/);

  assert.match(
    wxss,
    /\.timeline-scroll\s*\{[^}]*flex\s*:\s*1\s*;[^}]*min-height\s*:\s*0\s*;/s
  );
  assert.match(
    wxss,
    /\.timeline-sticky-header\s*\{[^}]*display\s*:\s*flex\s*;[^}]*background\s*:\s*#ffffff\s*;/s
  );
});

test("calendar keeps the left-column anchor contract observable for L1 automation", () => {
  assert.match(wxml, /id="qa-calendar-week-strip"/);
  assert.match(wxml, /id="qa-calendar-timeline-scroll"/);
  assert.match(wxml, /id="qa-calendar-day-title-strip"/);
  assert.match(wxml, /id="qa-calendar-day-grid-strip"/);
  assert.match(wxml, /class="timeline-sticky-header"/);
  assert.match(wxml, /tag="calendar-timeline-drag"/);

  assert.match(js, /selectedDateKey:\s*""/);
  assert.match(js, /weekStripHighlightKey:\s*""/);
  assert.match(js, /timelineSwiperCurrent:\s*INITIAL_CURRENT/);
  assert.match(js, /timelineFrozen:\s*false/);
  assert.doesNotMatch(js, /timelineSuppressDragPreview|timelineSwiperRemountTick/);
});

test("calendar preserves data states, activity navigation and Skyline-safe event icons", () => {
  assert.match(wxml, /<text class="navbar-main-title">日程<\/text>/);
  for (const stateText of [
    "登录后查看你的活动日程",
    "正在加载日程...",
    "请稍后重试",
    "本周暂无报名活动",
  ]) {
    assert.match(wxml, new RegExp(stateText));
  }
  for (const method of ["loadCalendar", "onRetry", "goProfile", "onActivityTap"]) {
    assert.match(js, new RegExp(`\\b${method}\\s*\\(`));
  }
  assert.match(wxml, /src="\{\{activity\.locationIcon\}\}"/);
  assert.match(wxml, /src="\{\{activity\.timeIcon\}\}"/);
  assert.match(wxml, /dayTitle\.isToday \? 'day-titles-strip-cell--today'/);
  assert.doesNotMatch(
    wxml,
    /dayTitle\.key === weekStripHighlightKey/,
    "week-strip drag previews must not rerender the moving date-title strip"
  );
  assert.match(js, /calendar-event-location-\$\{iconTone\}\.svg/);
  assert.match(js, /calendar-event-time-\$\{iconTone\}\.svg/);
  assert.doesNotMatch(wxss, /(?:-webkit-)?mask\s*:/);
});
