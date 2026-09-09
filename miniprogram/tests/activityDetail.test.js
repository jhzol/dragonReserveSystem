const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const detail = require("../utils/activityDetail");
const { enrichSingleActivity } = require("../utils/activityEnrich");
const detailSource = fs.readFileSync(path.join(__dirname, "../utils/activityDetail.js"), "utf8");
const activityServiceSource = fs.readFileSync(path.join(__dirname, "../services/activity.js"), "utf8");
const pageDir = path.join(__dirname, "../pages/activity_detail");
const js = fs.readFileSync(path.join(pageDir, "activity_detail.js"), "utf8");
const wxml = fs.readFileSync(path.join(pageDir, "activity_detail.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageDir, "activity_detail.wxss"), "utf8");
const pageJson = JSON.parse(fs.readFileSync(path.join(pageDir, "activity_detail.json"), "utf8"));

test("activity detail loading state matches the prototype skeleton and reuses the cover shimmer", () => {
  assert.match(wxml, /wx:if="\{\{loading \|\| detailSkeletonLeaving\}\}" id="qaActivityDetailSkeleton" class="detail-skeleton-screen \{\{detailSkeletonLeaving \? 'detail-skeleton-screen--leaving' : ''\}\}"/);
  assert.doesNotMatch(wxml, /<text class="state-text">加载中…<\/text>/);
  for (const className of [
    "detail-skeleton-hero",
    "detail-skeleton-hero-copy",
    "detail-skeleton-panel",
    "detail-skeleton-facts-row",
    "detail-skeleton-location-card",
    "detail-skeleton-weather-card",
    "detail-skeleton-bottom-bar"
  ]) {
    assert.match(wxml, new RegExp(`class="[^"]*${className}`));
  }
  assert.match(wxss, /\.detail-skeleton-hero\s*\{[^}]*height:\s*750rpx;[^}]*background:\s*#1a1d24;/s);
  assert.match(wxss, /\.detail-skeleton-hero-copy\s*\{[^}]*top:\s*373\.08rpx;[^}]*right:\s*38\.46rpx;[^}]*left:\s*38\.46rpx;/s);
  assert.match(wxss, /\.detail-skeleton-panel\s*\{[^}]*top:\s*642\.31rpx;[^}]*padding:\s*30\.77rpx;[^}]*border-radius:\s*46\.15rpx 46\.15rpx 0 0;/s);
  assert.match(wxss, /\.detail-skeleton-location-card\s*\{\s*height:\s*388\.46rpx;/s);
  assert.match(wxss, /\.detail-skeleton-weather-card\s*\{\s*height:\s*192\.31rpx;/s);
  assert.match(wxss, /\.detail-skeleton-block\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*hidden;[^}]*background-color:\s*#eaecef;/s);
  assert.doesNotMatch(wxss, /\.detail-skeleton-block\s*\{[^}]*animation-/s);
  const shimmerRule = wxss.match(/\.detail-skeleton-shimmer\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(shimmerRule, /position:\s*absolute;/);
  assert.match(shimmerRule, /width:\s*72%;/);
  assert.match(shimmerRule, /rgba\(248, 249, 251, 0\.52\) 42%/);
  assert.match(shimmerRule, /rgba\(248, 249, 251, 0\.52\) 58%/);
  assert.match(shimmerRule, /transform:\s*translateX\(-100%\);/);
  assert.match(shimmerRule, /animation-name:\s*detail-skeleton-shimmer;/);
  assert.match(shimmerRule, /animation-duration:\s*1800ms;/);
  assert.match(shimmerRule, /animation-timing-function:\s*linear;/);
  assert.match(wxss, /@keyframes detail-skeleton-shimmer\s*\{\s*from\s*\{\s*transform:\s*translateX\(-100%\);\s*\}\s*to\s*\{\s*transform:\s*translateX\(150%\);\s*\}\s*\}/s);
});

test("activity detail skeleton keeps its bottom actions visible and crossfades into content", () => {
  assert.match(wxml, /class="detail-skeleton-bottom-bar" style="height: calc\(107\.69rpx \+ \{\{safeBottomRpx\}\}rpx\); padding-bottom: \{\{safeBottomRpx\}\}rpx"/);
  assert.match(wxml, /class="detail-skeleton-block detail-skeleton-share-button"/);
  assert.match(wxml, /class="detail-skeleton-block detail-skeleton-primary-button"/);
  assert.match(wxss, /\.detail-skeleton-bottom-bar\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*0;[^}]*z-index:\s*4;/s);
  assert.match(wxss, /\.detail-skeleton-share-button\s*\{[^}]*left:\s*38\.46rpx;[^}]*width:\s*184\.62rpx;/s);
  assert.match(wxss, /\.detail-skeleton-primary-button\s*\{[^}]*left:\s*238\.46rpx;[^}]*width:\s*473\.08rpx;/s);
  assert.match(wxml, /wx:if="\{\{activity \|\| loadError\}\}" class="detail-content-layer \{\{activity && !detailContentVisible \? 'detail-content-layer--hidden' : 'detail-content-layer--visible'\}\}"/);
  assert.match(wxss, /\.detail-skeleton-screen\s*\{[^}]*opacity:\s*1;[^}]*transition:\s*opacity 280ms ease-out;/s);
  assert.match(wxss, /\.detail-skeleton-screen--leaving\s*\{[^}]*opacity:\s*0;/s);
  assert.match(wxss, /\.detail-content-layer\s*\{[^}]*opacity:\s*0;[^}]*transition:\s*opacity 280ms ease-out;/s);
  assert.match(wxss, /\.detail-content-layer--visible\s*\{[^}]*opacity:\s*1;/s);
  assert.match(js, /applyActivity\(activity, \(\) => this\.startDetailEntranceTransition\(\)\)/);
  const entranceStart = js.indexOf("  startDetailEntranceTransition() {");
  const entranceEnd = js.indexOf("  refreshDetail(options = {})", entranceStart);
  const entranceMethod = entranceStart >= 0 && entranceEnd > entranceStart
    ? js.slice(entranceStart, entranceEnd)
    : "";
  assert.match(entranceMethod, /detailSkeletonLeaving:\s*true/);
  assert.match(entranceMethod, /detailContentVisible:\s*false/);
  assert.match(entranceMethod, /DETAIL_ENTRANCE_FRAME_MS/);
  assert.match(entranceMethod, /detailContentVisible:\s*true/);
  assert.match(entranceMethod, /DETAIL_ENTRANCE_DURATION_MS/);
  assert.match(entranceMethod, /detailSkeletonLeaving:\s*false/);
  assert.match(js, /onUnload\(\)[\s\S]*?clearDetailEntranceTransition\(\)/);
});

test("activity detail formats date, time and the prototype month-date hero meta", () => {
  assert.equal(detail.formatActivityDate("2026-09-05 16:30"), "9月5日 周六");
  assert.equal(detail.formatActivityTime("2026-09-05 16:30", "2026-09-05 19:00"), "16:30 - 19:00");
  assert.equal(detail.formatHeroMeta({
    startTime: "2026-09-05 16:30",
    typeBadgeLabel: "outdoor",
    typeDisplayName: "户外"
  }), "SEPTEMBER · 05");
  assert.equal(detail.formatHeroMeta({
    startTime: "2026-03-07 16:30",
    activityType: "other",
    typeDisplayName: "其它"
  }), "MARCH · 07");
  assert.equal(detail.formatHeroMeta({
    startTime: ""
  }), "");
  assert.doesNotMatch(detailSource, /typeBadgeLabel|typeDisplayName|activityType/);
  assert.match(wxss, /\.hero-meta\s*\{[^}]*color:\s*rgba\(255, 255, 255, 0\.9\);[^}]*font-size:\s*25rpx;[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*2\.31rpx;/s);
});

test("activity title is limited to ten characters for the one-line hero display", () => {
  assert.equal(detail.truncateActivityTitle("一二三四五六七八九十"), "一二三四五六七八九十");
  assert.equal(detail.truncateActivityTitle("一二三四五六七八九十一"), "一二三四五六七八九十…");
  assert.equal(detail.truncateActivityTitle("周末😀一起玩桌游超长标题"), "周末😀一起玩桌游超长…");
  assert.match(wxml, /class="hero-title">\{\{activityTitleText\}\}<\/text>/);
  assert.match(js, /activityTitleText: truncateActivityTitle\(activity\.name\)/);
  assert.match(wxss, /\.hero-title\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
});

test("activity remark uses measured one-line overflow and restores the prototype toggle", () => {
  assert.match(wxml, /class="remark-toggle"/);
  assert.match(wxml, /class="remark-toggle-label"/);
  assert.match(wxml, /remark-toggle-text-out-up' : 'remark-toggle-text-active'\}\}">展开<\/text>/);
  assert.match(wxml, /remark-toggle-text-active' : 'remark-toggle-text-out-down'\}\}">收起<\/text>/);
  assert.match(wxml, /class="hero-remark"[\s\S]*?overflow="ellipsis"[\s\S]*?max-lines="\{\{remarkExpanded \? 999 : 1\}\}"/);
  assert.match(wxml, /class="remark-chevron-rotator" style="transform: rotate\(\{\{remarkToggleRotationDeg\}\}deg\);"[\s\S]*?<view class="remark-chevron"><\/view>/);
  assert.match(wxml, /class="hero-remark-measure"/);
  assert.match(wxml, /class="hero-remark-full-measure"/);
  assert.match(wxml, /class="hero-remark-viewport"/);
  assert.match(wxml, /class="remark-toggle-measure"/);
  assert.match(js, /updateRemarkOverflow\(\)/);
  assert.match(js, /select\("\.hero-remark-row"\)\.boundingClientRect\(\)/);
  assert.match(js, /select\("\.hero-remark-measure"\)\.boundingClientRect\(\)/);
  assert.match(js, /select\("\.remark-toggle-measure"\)\.boundingClientRect\(\)/);
  assert.match(js, /select\("\.hero-remark-full-measure"\)\.boundingClientRect\(\)/);
  assert.match(js, /naturalTextOverflowsRow = naturalTextWidth > rowWidth \+ 0\.5/);
  assert.match(js, /if \(!naturalTextOverflowsRow\) \{[\s\S]*?remarkExpandable:\s*false/);
  assert.match(js, /availableTextWidth = Math\.max\(0, rowWidth - toggleWidth - 7\.69\)/);
  assert.doesNotMatch(js, /textRect\.width > availableTextWidth/);
  assert.doesNotMatch(js, /remark\.length\s*>/);
  assert.match(wxss, /\.hero-remark-viewport\s*\{[^}]*overflow:\s*hidden;[^}]*transition:\s*height 260ms/s);
  assert.match(wxss, /\.hero-copy\s*\{[^}]*left:\s*38\.46rpx;[^}]*right:\s*38\.46rpx;/s);
  assert.match(wxss, /\.hero-remark\s*\{[^}]*white-space:\s*normal;[^}]*word-break:\s*break-all;/s);
  assert.match(wxss, /\.remark-toggle\s*\{[^}]*gap:\s*7\.69rpx;[^}]*flex-shrink:\s*0;/s);
  assert.match(wxss, /\.remark-chevron-rotator\s*\{[^}]*width:\s*26\.92rpx;[^}]*height:\s*26\.92rpx;[^}]*transition:\s*transform 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/s);
  assert.match(wxss, /\.remark-chevron\s*\{[^}]*position:\s*relative;[^}]*width:\s*26\.92rpx;[^}]*height:\s*26\.92rpx;/s);
  assert.match(wxss, /\.remark-chevron::after\s*\{[^}]*border-right:\s*2\.31rpx solid rgba\(255, 255, 255, 0\.8\);[^}]*border-bottom:\s*2\.31rpx solid rgba\(255, 255, 255, 0\.8\);[^}]*rotate\(45deg\)/s);
  assert.doesNotMatch(wxss, /\.remark-chevron-up::after/);
  assert.match(wxss, /\.remark-toggle-text\s*\{[^}]*font-size:\s*23\.08rpx;[^}]*font-weight:\s*500;/s);
  assert.match(wxss, /\.remark-toggle-label\s*\{[^}]*width:\s*46\.15rpx;[^}]*height:\s*38\.46rpx;[^}]*overflow:\s*hidden;/s);
  assert.match(wxss, /\.remark-toggle-label \.remark-toggle-text\s*\{[^}]*transition:\s*opacity 160ms ease-out, transform 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/s);
  assert.match(wxss, /\.remark-toggle-text-out-up\s*\{[^}]*translateY\(-7\.69rpx\)/s);
  assert.match(wxss, /\.remark-toggle-text-out-down\s*\{[^}]*translateY\(7\.69rpx\)/s);
  assert.match(js, /remarkToggleRotationDeg:\s*\(Number\(this\.data\.remarkToggleRotationDeg\) \|\| 0\) \+ 180/);
  assert.match(wxml, /<\/view>\s*<\/view>\s*<!-- 测量节点必须放在 hero-copy 外/);
});

function measureRemarkOverflow({ rowWidth, naturalTextWidth, toggleWidth, expandedHeight, textHeight = 20, toggleHeight = 20, status = "未开始" }) {
  const vm = require("node:vm");
  let page;
  let fullMeasureRequested = false;
  const wx = {
    nextTick(callback) { callback(); },
    createSelectorQuery() {
      const selectors = [];
      return {
        select(selector) { selectors.push(selector); return this; },
        boundingClientRect() { return this; },
        exec(callback) {
          if (selectors.includes(".hero-remark-full-measure")) {
            fullMeasureRequested = true;
            callback([{ height: expandedHeight }]);
            return;
          }
          callback([
            { width: rowWidth },
            { width: naturalTextWidth, height: textHeight },
            { width: toggleWidth, height: toggleHeight }
          ]);
        }
      };
    }
  };
  vm.runInNewContext(js, {
    getApp: () => ({ globalData: {} }),
    Page: (definition) => { page = definition; },
    require: () => ({}),
    wx,
    console,
    setTimeout
  });
  const data = {
    activity: { remark: "测试备注", status },
    remarkExpandable: false,
    remarkExpanded: false,
    remarkToggleRotationDeg: 0
  };
  page.updateRemarkOverflow.call({
    data,
    setData(next, callback) {
      Object.assign(data, next);
      if (typeof callback === "function") callback();
    }
  });
  return { data, fullMeasureRequested };
}

test("activity remark only reserves toggle space after the text truly overflows the full row", () => {
  const singleLine = measureRemarkOverflow({
    rowWidth: 250,
    naturalTextWidth: 220,
    toggleWidth: 60,
    expandedHeight: 40,
    status: "已结束"
  });
  assert.equal(singleLine.data.remarkExpandable, false);
  assert.equal(singleLine.data.remarkExpanded, false);
  assert.equal(singleLine.fullMeasureRequested, false);

  const multiLine = measureRemarkOverflow({
    rowWidth: 250,
    naturalTextWidth: 251,
    toggleWidth: 60,
    expandedHeight: 40,
    status: "已结束"
  });
  assert.equal(multiLine.data.remarkExpandable, true);
  assert.equal(multiLine.data.remarkExpanded, true);
  assert.equal(multiLine.data.remarkViewportHeightPx, 40);
  assert.equal(multiLine.fullMeasureRequested, true);
});

test("activity detail calculates and formats location distance", () => {
  assert.equal(Math.round(detail.calculateDistanceMeters(39.9042, 116.4074, 39.9042, 116.4074)), 0);
  assert.equal(detail.formatDistance(428), "约 430m");
  assert.equal(detail.formatDistance(2400), "约 2.4km");
  assert.equal(detail.formatDistance(null), "");
});

test("weather view uses one temperature and degrades air quality independently", () => {
  const view = detail.buildWeatherView({
    available: true,
    temperature: 24,
    temperature_min: 18,
    temperature_max: 24,
    condition: "晴间多云",
    icon_code: "103",
    humidity: 58,
    wind_direction: "东南风",
    wind_scale: "2",
    air_quality: null
  });
  assert.equal(view.temperature, "24°");
  assert.equal(view.humidity, "58%");
  assert.equal(view.wind, "东南风 2级");
  assert.equal(view.airQuality, "—");
  assert.equal(view.icon, "/images/weather-partly-cloudy.svg");
});

test("weather unavailable state is independent from location state", () => {
  assert.deepEqual(detail.buildWeatherView(null), {
    loading: false,
    available: false,
    message: "距离活动时间较远，暂不展示天气信息",
    attribution: "天气服务驱动 by QWeather"
  });
});

test("detail weather is read from the activity detail snapshot without a second weather request", () => {
  assert.match(js, /resolveActivityWeather\(activity\)/);
  assert.match(js, /weather: buildWeatherView\(resolveActivityWeather\(activity\)\)/);
  assert.doesNotMatch(js, /weatherService/);
  assert.doesNotMatch(js, /getActivityWeather\s*\(/);
  assert.doesNotMatch(js, /loadWeather\s*\(/);
});

test("primary action keeps signup, cancel, checkin and disabled business states", () => {
  assert.deepEqual(detail.resolvePrimaryAction({ status: "未开始", hasSignedUp: false }), {
    label: "立即报名", disabled: false, action: "signup"
  });
  assert.deepEqual(detail.resolvePrimaryAction({ status: "未开始", hasSignedUp: true, signupDeadlinePassed: false }), {
    label: "取消报名", disabled: false, action: "cancel"
  });
  assert.deepEqual(detail.resolvePrimaryAction({ status: "进行中", hasSignedUp: true }), {
    label: "立即签到", disabled: false, action: "checkin"
  });
  assert.deepEqual(detail.resolvePrimaryAction({ status: "已结束", hasSignedUp: false }), {
    label: "活动已结束", disabled: true, action: "none"
  });
  assert.deepEqual(detail.resolvePrimaryAction({ status: "已结束", hasSignedUp: true, hasCheckedIn: true }), {
    label: "活动已结束", disabled: true, action: "none"
  });
});

test("signup permission is enforced before the signup request and guides guests to Profile", () => {
  assert.match(js, /showSignupPermissionDenied\(\)\s*\{[\s\S]*?title:\s*"暂无报名权限"[\s\S]*?confirmText:\s*"去我的"[\s\S]*?wx\.switchTab\(\{\s*url:\s*"\/pages\/profile\/profile"\s*\}\)/);
  assert.match(js, /const userRole = app\.globalData\.userRole \|\| wx\.getStorageSync\("userRole"\) \|\| "guest";\s*if \(userRole !== "user" && userRole !== "admin"\) \{\s*this\.showSignupPermissionDenied\(\);\s*return;/s);
  assert.ok(js.indexOf('if (userRole !== "user" && userRole !== "admin")') < js.indexOf('.signupActivity(activity._id)'));
});

test("activity detail keeps QA anchors and the existing participants drawer", () => {
  for (const id of [
    "qaActivityDetailHero",
    "qaActivityDetailContent",
    "qaActivityLocationCard",
    "qaActivityWeatherCard",
    "qaActivityDetailBottomBar"
  ]) {
    assert.match(wxml, new RegExp(`id="${id}"`));
  }
  assert.match(wxml, /bindtap="openParticipantsDrawer"/);
  assert.match(wxml, /<participants-drawer/);
  assert.match(wxml, /id="qaParticipantsDrawer"/);
  assert.match(wxml, /visible="\{\{showParticipantsDrawer\}\}"/);
  assert.match(wxml, /participants="\{\{participantDrawerList\}\}"/);
  assert.match(wxml, /bindretrocheckin="adminRetroCheckin"/);
  assert.match(wxml, /bindcancelcheckin="adminCancelCheckin"/);
  assert.match(wxml, /bindremove="removeParticipant"/);
});

test("detail exposes checkin only after the activity enters the ongoing state", () => {
  assert.match(detailSource, /activity\.hasSignedUp && activity\.status === "进行中"/);
  assert.doesNotMatch(detailSource, /isCheckinWindowOpen/);
  assert.doesNotMatch(js, /isCheckinWindowOpen/);
  assert.match(js, /if \(activity\.status !== "进行中"\)[\s\S]*?仅进行中的活动可以签到/);
});

test("edit form and its time pickers share one full-height Skyline container", () => {
  assert.equal(pageJson.usingComponents["date-time-picker-sheet"], undefined);
  assert.match(wxml, /<page-container[\s\S]*id="qaActivityEditContainer"[\s\S]*show="{{showActivityForm}}"[\s\S]*bind:afterleave="onActivityFormAfterLeave"/);
  assert.match(wxml, /<activity-form-sheet[\s\S]*id="qaActivityFormSheet"[\s\S]*route-embedded="{{true}}"[\s\S]*mode="edit"/);
  assert.doesNotMatch(wxml, /external-date-time-picker|qaEditDateTimePickerSheet|bindopendatetimepicker/);
  assert.match(js, /openAdminEdit\(\)\s*\{[\s\S]*activityFormContainerRendered:\s*true[\s\S]*showActivityForm:\s*false[\s\S]*wx\.nextTick\(\(\) => this\.setData\(\{ showActivityForm: true \}\)\)/);
  assert.match(js, /onActivityFormAfterLeave\(\)\s*\{[\s\S]*activityFormContainerRendered:\s*false/);
  assert.doesNotMatch(js, /openEditDateTimePicker|confirmEditDateTimePicker|editDateTimePickerVisible/);
});

test("mini-program never exposes physical deletion and ended activities cannot be edited", () => {
  assert.doesNotMatch(wxml, /binddeleteactivity|删除活动/);
  assert.doesNotMatch(js, /deleteActivityFromForm|\.deleteActivity\(/);
  assert.doesNotMatch(activityServiceSource, /function deleteActivity|\bdeleteActivity,/);
  assert.match(wxml, /wx:if="{{canManageActivity && activity\.status !== '已结束'}}"/);
  assert.match(wxml, /activityFormContainerRendered && canManageActivity && activity && activity\.status !== '已结束'/);
  assert.match(js, /openAdminEdit\(\)\s*\{[\s\S]*activity\.status === "已结束"[\s\S]*\) return;/);
  assert.match(js, /resolveCanManageActivity\(activity,[\s\S]*?role === "admin"[\s\S]*?role !== "user"[\s\S]*?activity\.createdBy/);
  assert.match(wxml, /can-manage="\{\{canManageActivity\}\}"/);
  assert.match(wxml, /is-admin="\{\{isAdmin\}\}"/);
  assert.match(js, /adminRetroCheckin\(e\)\s*\{[\s\S]*?if \(!this\.data\.isAdmin/);
  assert.match(js, /adminCancelCheckin\(e\)\s*\{[\s\S]*?if \(!this\.data\.isAdmin/);
});

test("activity detail removes the legacy countdown and standalone pigeon sections", () => {
  assert.doesNotMatch(wxml, /报名倒计时|鸽子名单/);
  assert.doesNotMatch(js, /countdownVisible|showPigeonDrawer|pigeonList|pigeonPreviewList|startCountdownTimer/);
});

test("signup status remains global after the current user has signed up", () => {
  const activity = enrichSingleActivity({
    id: 49,
    name: "未来活动",
    status: "未开始",
    start_time: "2026-10-18T10:00:00",
    end_time: "2026-10-18T12:00:00",
    signup_deadline: "2026-10-17T23:00:00",
    signup_enabled: true,
    max_participants: null,
    activity_type: "other",
    participants: [{
      id: 1,
      user_id: 7,
      display_nickname: "当前用户",
      display_avatar_url: "",
      checked_in_at: null,
      created_at: "2026-09-01T08:00:00"
    }]
  }, [], "7", "当前用户", new Date("2026-09-02T10:00:00"));

  assert.equal(activity.hasSignedUp, true);
  assert.equal(activity.detailStatusTag, "报名中");
});

test("cover-based activities retain the server-rendered large-card glass image", () => {
  const activity = enrichSingleActivity({
    id: 51,
    name: "封面活动",
    status: "未开始",
    remark: "验证毛玻璃",
    start_time: "2026-10-18T10:00:00",
    end_time: "2026-10-18T12:00:00",
    participants: [],
    activity_cover_id: "lam-001",
    activity_cover: {
      id: "lam-001",
      thumbnail_url: "https://example.test/lam-001-thumb.jpg",
      image_url: "https://example.test/lam-001.jpg",
      large_card_glass_image_url: "https://example.test/lam-001-glass.png"
    }
  }, [], "", "", new Date("2026-09-06T10:00:00"));

  assert.equal(activity.largeCardBgImageUrl, "https://example.test/lam-001.jpg");
  assert.equal(activity.largeCardGlassImageUrl, "https://example.test/lam-001-glass.png");
});

test("flow-cancelled activity remains a terminal state after frontend enrichment", () => {
  const activity = enrichSingleActivity({
    id: 50,
    name: "已流局活动",
    status: "已流局",
    start_time: "2026-10-18T10:00:00",
    end_time: "2026-10-18T12:00:00",
    signup_deadline: "2026-10-17T23:00:00",
    signup_enabled: true,
    max_participants: 12,
    activity_type: "other",
    participants: []
  }, [], "", "", new Date("2026-09-02T10:00:00"));

  assert.equal(activity.status, "已流局");
  assert.equal(activity.detailStatusTag, "已流局");
  assert.deepEqual(detail.resolvePrimaryAction(activity), {
    label: "已停止报名", disabled: true, action: "none"
  });
});

test("activity detail top navigation has no text title", () => {
  assert.doesNotMatch(wxml, /<text class="navbar-title">活动详情<\/text>/);
});

test("basic information header has no right-side status text", () => {
  assert.match(wxml, /class="hero-status-row"/);
  assert.match(wxml, /class="status-pill \{\{detailStatusClass\}\}"/);
  assert.match(wxml, /participant-current/);
  assert.match(wxml, /participant-separator/);
  assert.match(wxml, /participant-limit/);
  assert.doesNotMatch(wxml, /signupStatusText|section-assist|报名进行中/);
  assert.doesNotMatch(js, /signupStatusText|resolveBasicInfoStatusText/);
  assert.equal(detail.resolveBasicInfoStatusText, undefined);
});



test("activity detail locks the viewport instead of exposing page overscroll", () => {
  assert.equal(pageJson.disableScroll, true);
  assert.match(wxml, /<view\s+class="main-scroll"[\s\S]*?height: calc\(100vh - \{\{bottomBarHeightRpx\}\}rpx\)/);
  assert.doesNotMatch(wxml, /<scroll-view\s+[\s\S]*?class="main-scroll"/);
  assert.doesNotMatch(wxml, /class="scroll-bottom-spacer"/);
  assert.match(wxss, /^page\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(wxss, /\.page-wrap\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
  assert.match(wxss, /\.main-scroll\s*\{[^}]*overflow:\s*hidden;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(wxss, /\.immersive-hero\s*\{[^}]*height:\s*750rpx;[^}]*flex:\s*1 1 750rpx;[^}]*min-height:\s*0;/s);
  assert.match(wxss, /\.detail-panel\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test("activity location uses a native coordinate marker instead of a viewport cover layer", () => {
  assert.match(wxml, /<map[\s\S]*?markers="\{\{locationMapMarkers\}\}"[\s\S]*?\/>/);
  assert.doesNotMatch(wxml, /<cover-view class="map-pin-wrap">/);
  assert.doesNotMatch(wxss, /\.map-pin(?:-wrap|-shadow|-icon)?\s*\{/);
  assert.match(js, /function buildLocationMapMarkers\(latitude, longitude, windowWidthPx\)/);
  assert.match(js, /iconPath:\s*LOCATION_MAP_MARKER_ICON/);
  assert.match(js, /anchor:\s*\{ x:\s*0\.5, y:\s*LOCATION_MAP_MARKER_ANCHOR_Y \}/);
  assert.match(js, /locationMapMarkers:\s*locationMapAvailable/);
  const markerPath = path.join(__dirname, "../images/icon-activity-map-marker.png");
  assert.equal(fs.existsSync(markerPath), true);
});

test("location card uses the activity coordinates for a real non-interactive map", () => {
  assert.match(wxml, /<map[\s\S]*id="qaActivityLocationMap"/);
  assert.match(wxml, /latitude="\{\{locationMapLatitude\}\}"/);
  assert.match(wxml, /longitude="\{\{locationMapLongitude\}\}"/);
  assert.match(wxml, /scale="10"/);
  assert.match(wxml, /enable-scroll="\{\{false\}\}"/);
  assert.match(wxml, /enable-zoom="\{\{false\}\}"/);
  assert.match(wxml, /enable-rotate="\{\{false\}\}"/);
  assert.match(wxml, /enable-overlooking="\{\{false\}\}"/);
  assert.match(wxml, /wx:if="\{\{locationMapAvailable\}\}"/);
  assert.match(wxml, /markers="\{\{locationMapMarkers\}\}"/);
  assert.doesNotMatch(wxml, /map-water|map-road|map-label/);
  assert.match(js, /const rawLocationMapLatitude = activity\.locationLatitude;/);
  assert.match(js, /rawLocationMapLatitude !== null/);
  assert.match(js, /rawLocationMapLongitude !== ""/);
  assert.match(js, /Number\.isFinite\(locationMapLatitude\)/);
  assert.match(js, /locationMapLatitude >= -90/);
  assert.match(js, /locationMapLongitude <= 180/);
});

test("native map marker preserves the prototype size across viewport widths", () => {
  assert.match(js, /const LOCATION_MAP_MARKER_DESIGN_SIZE_PX = 54;/);
  assert.match(js, /LOCATION_MAP_MARKER_DESIGN_SIZE_PX \* viewportWidth \/ 390/);
  assert.match(js, /width:\s*markerSizePx/);
  assert.match(js, /height:\s*markerSizePx/);
  assert.match(js, /const LOCATION_MAP_MARKER_ANCHOR_Y = 23 \/ 54;/);
});

test("activity detail follows the latest eight-pixel drawer rhythm", () => {
  assert.match(wxss, /\.detail-panel\s*\{[^}]*margin-top:\s*-94\.23rpx;[^}]*padding:\s*30\.77rpx;[^}]*box-shadow:\s*0 -7\.69rpx 34\.62rpx rgba\(0, 0, 0, 0\.102\);/s);
  assert.match(wxss, /\.facts-row\s*\{[^}]*margin-top:\s*15\.38rpx;/s);
  assert.match(wxss, /\.location-card,\s*\n\.weather-card\s*\{[^}]*margin-top:\s*15\.38rpx;/s);
  assert.match(wxss, /\.hero-copy\s*\{[^}]*bottom:\s*calc\(94\.23rpx \+ 46\.15rpx\);[^}]*gap:\s*23\.08rpx;/s);
});

test("weather card matches the prototype structure and unavailable state", () => {
  assert.match(wxml, /weather-icon-wrap/);
  assert.match(wxml, /weather-humidity\.svg/);
  assert.match(wxml, /weather-wind\.svg/);
  assert.match(wxml, /weather-air-quality\.svg/);
  assert.match(wxml, />空气湿度</);
  assert.match(wxml, />风向风速</);
  assert.match(wxml, /wx:if="\{\{weather\.available\}\}" class="weather-attribution"/);
  assert.doesNotMatch(wxml, /天气暂不可用/);
});

test("activity detail uses the shared rpx safe-area resolver", () => {
  assert.match(js, /getBottomSafeAreaRpx/);
  assert.match(wxml, /padding-bottom: \{\{safeBottomRpx\}\}rpx/);
  assert.match(wxml, /bottomBarHeightRpx\}\}rpx/);
  assert.doesNotMatch(wxml, /safeBottom\}\}px/);
});

test("detail hero avatar composition scales the home large-card layout by width", () => {
  assert.match(wxss, /\.hero-avatar-tl\s*\{[^}]*top:\s*43\.48rpx;[^}]*left:\s*43\.48rpx;[^}]*width:\s*448\.37rpx;[^}]*height:\s*448\.37rpx;/s);
  assert.match(wxss, /\.hero-avatar-tr\s*\{[^}]*top:\s*364\.13rpx;[^}]*left:\s*451\.09rpx;[^}]*width:\s*255\.43rpx;[^}]*height:\s*255\.43rpx;/s);
  assert.match(wxss, /\.hero-avatar-mid\s*\{[^}]*top:\s*505\.43rpx;[^}]*left:\s*233\.70rpx;[^}]*width:\s*222\.83rpx;[^}]*height:\s*222\.83rpx;/s);
  assert.doesNotMatch(wxss, /\.hero-avatar-tr\s*\{[^}]*right:/s);
});

test("prototype key sizes, colors, typography and action layout do not regress", () => {
  assert.match(wxss, /\.immersive-hero\s*\{[^}]*height:\s*750rpx;/s);
  assert.match(wxss, /\.hero-shade\s*\{[\s\S]*?radial-gradient\(circle 420px[\s\S]*?linear-gradient\(/);
  assert.doesNotMatch(wxss, /background-blend-mode|\binset\s*:/);
  assert.match(wxss, /\.status-pill\s*\{[^}]*height:\s*53\.85rpx;[^}]*border-radius:\s*26\.92rpx;[^}]*font-size:\s*26\.92rpx;/s);
  assert.match(wxss, /\.hero-title\s*\{[^}]*height:\s*84\.62rpx;[^}]*font-size:\s*61\.54rpx;/s);
  assert.match(wxss, /\.hero-title\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s);
  assert.doesNotMatch(wxss, /\.section-assist(?:-text)?\s*\{/);
  assert.match(wxss, /\.hero-copy\s*\{[^}]*bottom:\s*calc\(94\.23rpx \+ 46\.15rpx\);[^}]*gap:\s*23\.08rpx;/s);
  assert.match(wxss, /\.section-title\s*\{[^}]*font-size:\s*34\.62rpx;[^}]*font-weight:\s*700;/s);
  assert.match(wxss, /\.facts-row\s*\{[^}]*height:\s*84\.62rpx;[^}]*padding:\s*0;[^}]*justify-content:\s*center;[^}]*gap:\s*23\.08rpx;/s);
  assert.match(wxss, /\.fact-item\s*\{[^}]*height:\s*84\.62rpx;/s);
  assert.match(wxss, /\.nav-back-icon\s*\{[^}]*width:\s*34\.62rpx;[^}]*height:\s*34\.62rpx;/s);
  assert.match(wxss, /\.fact-item\s*\{[^}]*padding:\s*0;[^}]*gap:\s*7\.69rpx;/s);
  assert.match(wxml, /class="fact-item fact-item-time"/);
  assert.match(wxss, /\.fact-item:first-child\s*\{[^}]*flex:\s*0 0 184\.62rpx;/s);
  assert.match(wxss, /\.fact-item-time\s*\{[^}]*flex:\s*0 0 196\.15rpx;/s);
  assert.match(wxss, /\.fact-label\s*\{[^}]*font-size:\s*23\.08rpx;[^}]*font-weight:\s*500;[^}]*line-height:\s*32\.69rpx;/s);
  assert.match(wxss, /\.fact-value,[\s\S]*?\{[^}]*font-size:\s*30\.77rpx;[^}]*font-weight:\s*600;[^}]*line-height:\s*44\.23rpx;/s);
  assert.doesNotMatch(wxss, /font-family\s*:/);
  assert.doesNotMatch(wxml, /fact-value-time/);
  assert.match(wxss, /\.participant-separator\s*\{[^}]*font-size:\s*30\.77rpx;[^}]*font-weight:\s*500;[^}]*line-height:\s*44\.23rpx;/s);
  assert.match(wxss, /\.fact-participants\s*\{[^}]*flex:\s*0 0 180\.77rpx;/s);
  assert.match(wxss, /\.location-card\s*\{[^}]*height:\s*388\.46rpx;/s);
  assert.match(wxss, /\.location-name\s*\{[^}]*font-size:\s*26\.92rpx;/s);
  assert.match(wxss, /\.location-distance,\s*\n\.location-address\s*\{[^}]*font-size:\s*23\.08rpx;/s);
  assert.match(wxss, /\.location-address\s*\{[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.3;/s);
  assert.match(wxss, /\.navigate-button\s*\{[^}]*width:\s*130\.77rpx;[^}]*height:\s*69\.23rpx;[^}]*border-radius:\s*23\.08rpx;/s);
  assert.match(wxss, /\.weather-card\s*\{[^}]*height:\s*192\.31rpx;/s);
  assert.match(wxss, /\.weather-metric-value\s*\{[^}]*height:\s*23\.08rpx;[^}]*font-size:\s*23\.08rpx;[^}]*line-height:\s*1;/s);
  assert.match(wxss, /\.weather-metric-label\s*\{[^}]*font-size:\s*19\.23rpx;[^}]*font-weight:\s*500;[^}]*line-height:\s*1\.4;/s);
  assert.match(wxss, /\.weather-unavailable-message\s*\{[^}]*font-size:\s*23\.08rpx;[^}]*font-weight:\s*400;/s);
  assert.match(wxss, /\.weather-attribution\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*flex-end;/s);
  assert.match(wxss, /\.weather-attribution-text\s*\{[^}]*font-size:\s*19\.23rpx;[^}]*font-weight:\s*400;[^}]*line-height:\s*1;/s);
  assert.match(wxss, /\.bottom-icon-button:first-child\s*\{[^}]*left:\s*38\.46rpx;/s);
  assert.match(wxss, /\.bottom-icon-button:nth-child\(2\)\s*\{[^}]*left:\s*138\.46rpx;/s);
  assert.match(wxss, /\.bottom-icon-button-wide\s*\{[^}]*width:\s*184\.62rpx;/s);
  assert.match(wxss, /\.bottom-primary\s*\{[^}]*left:\s*238\.46rpx;[^}]*width:\s*473\.08rpx;[^}]*height:/s);
  assert.match(wxss, /\.bottom-primary-cancel\s*\{[^}]*background:\s*rgba\(255, 255, 255, 0\);[^}]*border:\s*1\.92rpx solid #ff9800;[^}]*color:\s*#ff9800;[^}]*font-weight:\s*600;/s);
  assert.match(wxss, /\.bottom-primary-disabled\s*\{[^}]*background:\s*#e5e7eb;[^}]*color:\s*#9ca3af;/s);
  assert.match(wxml, /\{\{\(!canManageActivity \|\| activity\.status === '已结束'\) \? 'bottom-icon-button-wide' : ''\}\}/);
  assert.match(wxml, /wx:if="\{\{canManageActivity && activity\.status !== '已结束'\}\}"/);
  assert.match(js, /openAdminEdit\(\)\s*\{[\s\S]*?!this\.data\.canManageActivity[\s\S]*?activity\.status === "已结束"/);
  assert.match(wxml, /primaryActionType === 'cancel' \? 'bottom-primary-cancel'/);
  assert.match(js, /const shouldExpandRemarkByDefault = activity\.status === "已结束";/);
  assert.match(js, /const expandByDefault = !!\([\s\S]*?this\.data\.activity\.status === "已结束"[\s\S]*?remarkExpanded:\s*expandByDefault,[\s\S]*?remarkToggleRotationDeg:\s*expandByDefault \? 180 : 0/);
  assert.match(wxml, /src="\/images\/activity-detail-chevron-left\.svg"/);
  assert.doesNotMatch(wxml, /activity-detail-chevron-(?:up|down)\.svg/);
  assert.match(wxml, /src="\/images\/activity-detail-chevron-right\.svg"/);
  assert.match(wxml, /src="\/images\/icon-navigation\.svg"/);
  assert.match(wxml, /src="\/images\/weather-humidity\.svg"/);
  assert.match(wxml, /src="\/images\/weather-wind\.svg"/);
  assert.match(wxml, /src="\/images\/weather-air-quality\.svg"/);
  assert.match(wxml, /src="\/images\/icon-share\.svg"/);
  assert.match(wxml, /src="\/images\/icon-edit\.svg"/);
  assert.doesNotMatch(wxml, /icon-chevron-down-light\.svg/);
  assert.doesNotMatch(wxss, /remark-chevron-up/);
});

test("signup executes the real page handler for each role without contacting a server", async () => {
  const vm = require("node:vm");
  for (const role of ["user", "admin", "guest", "unknown", ""]) {
    const events = [];
    const app = { globalData: {
      accessToken: "test-token", userId: "123", userRole: role,
      userProfile: { nickname: "测试用户", avatarUrl: "https://example.test/avatar.png" }
    } };
    let page;
    vm.runInNewContext(js, {
      getApp: () => app,
      Page: (definition) => { page = definition; },
      require: (name) => {
        if (name === "../../services/activity") return {
          signupActivity: async () => { events.push("request"); }
        };
        if (name === "../../utils/profileUtils") return {
          isDefaultNickname: () => false, isDefaultAvatar: () => false
        };
        return {};
      },
      wx: {
        getStorageSync: () => "", showLoading() {}, hideLoading() {},
        showToast() {}, showModal: () => events.push("modal")
      },
      console
    });
    page.selectComponent = (id) => {
      assert.equal(id, "#signup-login-dialog");
      return { open(options) {
        assert.equal(options.confirmBehavior, "emit");
        assert.equal(options.confirmText, "去登录");
        events.push("modal");
      } };
    };
    page.showSignupPermissionDenied = () => events.push("denied");
    page.refreshDetail = async () => {};
    const activity = { _id: 1, status: "未开始", participants: [] };
    page.directSignup(activity);
    await new Promise(setImmediate);
    assert.deepEqual(events, [role === "user" || role === "admin" ? "request" : "denied"], role);
    events.length = 0;
    app.globalData.accessToken = "";
    page.directSignup(activity);
    assert.deepEqual(events, ["modal"], "logged-out users must log in");
  }
});


test("remark line box cannot be shortened by iOS text bounds and rounds outward", () => {
  const result = measureRemarkOverflow({ rowWidth: 250, naturalTextWidth: 300,
    toggleWidth: 50, textHeight: 12.1, toggleHeight: 21.54,
    expandedHeight: 64.62, status: "已结束" });
  assert.equal(result.data.remarkCollapsedHeightPx, 22);
  assert.equal(result.data.remarkExpandedHeightPx, 65);
  assert.equal(result.data.remarkViewportHeightPx, 65);
});

test("remark toggle stays bottom-anchored during expansion and measurement uses layout boxes", () => {
  assert.match(wxss, /\.hero-remark-row\s*\{[^}]*align-items: flex-end;/s);
  assert.match(wxss, /\.hero-copy\s*\{[^}]*bottom: calc\(94\.23rpx \+ 46\.15rpx\);/s);
  for (const name of ["hero-remark", "hero-remark-measure", "hero-remark-full-measure"]) {
    assert.match(wxss, new RegExp("\\." + name + "\\s*\\{[^}]*line-height: 38\\.46rpx;", "s"));
  }
  assert.match(wxss, /\.hero-remark-viewport\s*\{[^}]*min-height: 38\.46rpx;/s);
  assert.match(wxml, /<view[^>]*class="hero-remark-measure"/);
  assert.match(wxml, /<view\s+wx:if="\{\{activity.remark\}\}"\s+class="hero-remark-full-measure"/);
});


test("detail login prompt reuses the yellow dialog and resumes signup on confirm", () => {
  assert.equal(pageJson.usingComponents["create-access-dialog"], "../../components/create-access-dialog/index");
  assert.match(wxml, /<create-access-dialog id="signup-login-dialog" bind:confirm="onSignupLoginConfirm"/);
  assert.match(js, /selectComponent\("#signup-login-dialog"\)\.open\(\{[^}]*confirmBehavior: "emit"/s);
  assert.match(js, /onSignupLoginConfirm\(\)\s*\{[\s\S]*?loginWithWechat\(app\)[\s\S]*?this\.directSignup\(this\.data\.activity\)/);
  assert.doesNotMatch(js, /wx\.showModal\(\{\s*title: "提示",\s*content: "当前尚未登录/);
});
