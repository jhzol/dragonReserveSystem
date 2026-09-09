const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageDir = path.join(__dirname, "../pages/activity_list");
const js = fs.readFileSync(path.join(pageDir, "activity_list.js"), "utf8");
const wxml = fs.readFileSync(path.join(pageDir, "activity_list.wxml"), "utf8");
const pageConfig = JSON.parse(fs.readFileSync(path.join(pageDir, "activity_list.json"), "utf8"));
const detailConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../pages/activity_detail/activity_detail.json"), "utf8"));
const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../app.json"), "utf8"));
const projectConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../../project.config.json"), "utf8"));
const appJs = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const groups = ["joined", "accepting", "notStarted", "ended"];

test("activity cards use Skyline open-container for native card-to-page transitions", () => {
  const smallCardContainers = wxml.match(/<open-container\b[^>]*class="small-card-wrap"[^>]*>/g) || [];

  assert.equal((wxml.match(/<open-container\b/g) || []).length, 4);
  assert.equal((wxml.match(/<\/open-container>/g) || []).length, 4);
  assert.equal((wxml.match(/bind:tap="showDetail"/g) || []).length, 4);
  assert.equal((wxml.match(/transition-type="fadeThrough"/g) || []).length, 4);
  assert.equal((wxml.match(/transition-duration="320"/g) || []).length, 4);
  assert.equal((wxml.match(/closed-color="transparent"/g) || []).length, 4);
  assert.equal(smallCardContainers.length, 3);
  assert.ok(smallCardContainers.every((container) => container.includes('closed-color="transparent"')));
  assert.ok(smallCardContainers.every((container) => container.includes('closed-border-radius="0"')));
  assert.equal((wxml.match(/class="small-card-layout home-card-entrance home-card-entrance--\{\{!item\._homeMediaReady \? 'pending' : \(item\._id == createdCardEntranceId \? createdCardEntranceState : 'entered'\)\}\}"/g) || []).length, 3);
  assert.match(wxml, /<view[\s\S]*?class="large-card-wrap home-card-entrance[^\"]*"[\s\S]*?<text class="card-datetime-label">[\s\S]*?<open-container[\s\S]*?class="large-card-transition"[\s\S]*?closed-color="transparent"/);

  assert.equal(projectConfig.setting.skylineRenderEnable, true);
  assert.equal(pageConfig.renderer, "skyline");
  assert.equal(pageConfig.componentFramework, "glass-easel");
  assert.equal(pageConfig.disableScroll, true);
  assert.equal(detailConfig.renderer, "skyline");
  assert.equal(detailConfig.componentFramework, "glass-easel");
  assert.equal(appConfig.componentFramework, "glass-easel");
  assert.equal(appConfig.rendererOptions.skyline.disableABTest, true);
  assert.equal(appConfig.rendererOptions.skyline.sdkVersionBegin, "3.0.0");
});

test("home carousels use native Skyline swiper paging", () => {
  assert.equal((wxml.match(/<swiper(?:\s|>)/g) || []).length, 4);
  assert.equal((wxml.match(/bindchange="onGroupSwiperChange"/g) || []).length, 4);
  assert.equal((wxml.match(/cache-extent="1"/g) || []).length, 4);
  assert.equal((wxml.match(/duration="300"/g) || []).length, 4);
  assert.equal((wxml.match(/easing-function="easeOutCubic"/g) || []).length, 4);
  assert.match(wxml, /id="qaJoinedCardSwiper"[\s\S]*class="cards-swiper large-cards-swiper"/);
  assert.equal((wxml.match(/class="cards-swiper small-cards-swiper"/g) || []).length, 3);
  assert.doesNotMatch(wxml, /bindtouchstart="onGroupTouchStart"|style="transform:translate3d\(-\{\{groupOffset\./);
  assert.doesNotMatch(js, /onGroupTouchStart|onGroupTouchMove|onGroupTouchEnd|applyGroupSnap|groupOffset/);
  assert.match(js, /onGroupSwiperChange\(e\)/);
  assert.match(js, /this\._syncVideoFocus\(group, previous, current\)/);
  assert.match(js, /group === "ended" && this\.data\.endedHasMore && current === endedCount/);
});

test("home activity refresh stays silent without a global loading overlay", () => {
  assert.doesNotMatch(js, /title:\s*"加载中\.\.\."/);
  assert.doesNotMatch(js, /skipPullOverlayLoading/);
  assert.match(js, /loadActivityList\(options = \{\}\)[\s\S]*?activityService\.listActivities\(\)/);
});

test("returning from activity detail preserves the active card by ID across list refreshes", () => {
  const vm = require("node:vm");
  let page;
  vm.runInNewContext(js, {
    getApp: () => ({ globalData: {} }),
    Page: (definition) => { page = definition; },
    require: () => ({}),
    console,
    setTimeout,
    clearTimeout,
    wx: { navigateTo: () => {} }
  });

  const context = {
    data: {
      focusedCardIndex: { joined: 2, accepting: 0, notStarted: 0, ended: 0 },
      groupedActivities: {
        joined: [{ _id: "a" }, { _id: "b" }, { _id: "c" }],
        accepting: [], notStarted: [], ended: []
      }
    },
    _focusedCardActivityIds: {}
  };
  context._rememberFocusedCard = page._rememberFocusedCard;
  page._rememberFocusedCard.call(context, "joined", 2);

  const sameOrder = page._resolveFocusedCardIndex.call(context, context.data.groupedActivities);
  assert.equal(sameOrder.joined, 2);

  const refreshedOrder = page._resolveFocusedCardIndex.call(context, {
    joined: [{ _id: "a" }, { _id: "c" }, { _id: "b" }],
    accepting: [], notStarted: [], ended: []
  });
  assert.equal(refreshedOrder.joined, 1);
  // Tapping a neighbouring card must not move the carousel on return.
  page.showDetail.call(context, {
    currentTarget: { dataset: { activity: { _id: "b", _homeMediaReady: true } } }
  });
  assert.equal(context._focusedCardActivityIds.joined, "c");
  assert.equal(page._resolveFocusedCardIndex.call(context, context.data.groupedActivities).joined, 2);
  assert.equal(context.data.focusedCardIndex.joined, 2);
  assert.doesNotMatch(js, /focusReset/);
});

test("home uses independent skeletons and an image-independent Tab entrance", () => {
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");
  assert.match(js, /homeListLoading: true/);
  assert.doesNotMatch(js, /_coldStartGlassPendingIds|_pendingColdStartGroupedActivities/);
  assert.match(wxml, /wx:if="\{\{homeListLoading\}\}"/);
  assert.equal((wxml.match(/class="home-card-slot home-card-slot--/g) || []).length, 4);
  assert.equal((wxml.match(/wx:if="\{\{!item\._homeMediaReady\}\}"/g) || []).length, 4);
  assert.doesNotMatch(wxml, /cardEntranceStaggerMs|lazy-load="\{\{true\}\}"/);
  assert.match(wxss, /background: #e9eaec/);
  assert.match(wxss, /skeleton-shimmer--running[^}]*transition: transform 1400ms linear/s);
  assert.match(wxss, /home-card-entrance--pending[^}]*opacity: 0/s);
  assert.match(js, /homeTabEntrancePending = false;[\s\S]*?_setTabBarHidden\(false, \{ animate: true \}\)/);
});

test("a newly created activity is inserted immediately and animates without replaying old cards", () => {
  assert.match(js, /activityService\.createActivity\(payload\)[\s\S]*?\.then\(\(createdActivity\) =>[\s\S]*?this\.insertCreatedActivity\(createdActivity\)/);
  assert.match(js, /insertCreatedActivity\(rawActivity\)[\s\S]*?this\.processActivityList\(\[rawActivity\], new Date\(\)\)/);
  assert.match(js, /insertCreatedActivity\(rawActivity\)[\s\S]*?const activityList = \[[\s\S]*?createdActivity,[\s\S]*?\.filter/);
  assert.match(js, /createdCardEntranceId:\s*createdActivity\._id,[\s\S]*?createdCardEntranceState:\s*"pending"/);
  assert.match(js, /onCreateFormAfterLeave\(\)[\s\S]*?this\._revealCreatedCard\(\)/);
  assert.match(js, /_revealCreatedCard\(\)[\s\S]*?_createdCardDrawerDismissed\s*=\s*true[\s\S]*?_tryRevealCreatedCard\(\)/);
  assert.match(js, /_tryRevealCreatedCard\(\)[\s\S]*?!this\._createdCardDrawerDismissed[\s\S]*?!this\._createdCardGlassReady[\s\S]*?createdCardEntranceState:\s*"entered"/);
  assert.match(js, /CREATED_CARD_ENTRANCE_DURATION_MS\s*=\s*560/);
  assert.equal((wxml.match(/!item\._homeMediaReady \? 'pending' : \(item\._id == createdCardEntranceId \? createdCardEntranceState : 'entered'\)/g) || []).length, 4);
  assert.doesNotMatch(wxml, /transition-delay/);
});

test("a newly created large card waits for its glass bitmap before entering", () => {
  assert.match(js, /const waitsForGlass = createdGroup === "joined" &&[\s\S]*?!!createdActivity\.largeCardGlassImageUrl/);
  assert.match(js, /this\._createdCardGlassReady = !waitsForGlass/);
  assert.doesNotMatch(js, /CREATED_CARD_GLASS_WAIT_TIMEOUT_MS/);
  assert.match(js, /onCardGlassLoaded\(e\)[\s\S]*?_markCreatedCardGlassReady/);
  const glassError = js.slice(js.indexOf("  onCardGlassError(e)"), js.indexOf("  onCardVideoLoaded(e)"));
  assert.doesNotMatch(glassError, /_markCreatedCardGlassReady|_markHomeImageReady/);
  assert.match(wxml, /class="glass-static-blur-image"[\s\S]*?bindload="onCardGlassLoaded"[\s\S]*?binderror="onCardGlassError"[\s\S]*?data-activity-id="\{\{item\._id\}\}"/);
});

test("ended load-more strip stays hidden until ended cards are rendered", () => {
  assert.match(wxml, /<swiper-item wx:if="\{\{endedHasMore && groupedActivities\.ended\.length > 0\}\}" class="small-card-slide">/);
  assert.doesNotMatch(wxml, /<swiper-item wx:if="\{\{endedHasMore\}\}" class="small-card-slide">/);
});

test("native swiper leaves vertical page scrolling enabled without JS gesture locks", () => {
  assert.match(wxml, /<scroll-view[\s\S]*?class="main-scroll"[\s\S]*?type="list"/);
  assert.match(wxml, /scroll-y="\{\{true\}\}"/);
  assert.doesNotMatch(js, /mainScrollEnabled|isGroupSwiping|GESTURE_TUNING|SWIPE_MOVE_SMOOTHING/);
});

test("cards do not apply native press opacity during horizontal paging", () => {
  assert.equal((wxml.match(/hover-class="\{\{isGroupSwiping \? '' : 'card-press'\}\}"/g) || []).length, 0);
  assert.equal((wxml.match(/hover-stay-time=/g) || []).length, 0);
  assert.doesNotMatch(wxml, /pressedCardKey|onCardPressMove|onCardPressCancel|card-press/);
  assert.doesNotMatch(fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8"), /\.card-press/);
});

test("home large and small cards no longer render activity type badges", () => {
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");

  assert.doesNotMatch(wxml, /card-type-label|typeBadgeLabel|showTypeBadge/);
  assert.doesNotMatch(wxss, /\.card-type-label(?:-sm)?\s*\{/);
});

test("small card layout preserves its clipping layers without a shadow", () => {
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");
  const shadowLayerCount = (wxml.match(/class="small-card-shadow"/g) || []).length;

  assert.equal(shadowLayerCount, 3);
  assert.equal((wxml.match(/class="small-card-layout[^>]*>[\s\S]*?<view class="small-card-shadow"[^>]*><\/view>[\s\S]*?<open-container/g) || []).length, 3);
  assert.match(wxss, /\.small-card-layout\s*\{[^}]*position:\s*relative;[^}]*overflow:\s*visible;/s);
  assert.match(wxss, /\.small-card-shadow\s*\{[^}]*position:\s*absolute;[^}]*overflow:\s*visible;[^}]*box-shadow:/s);
  assert.match(wxss, /\.small-card\s*\{[^}]*overflow:\s*hidden;[^}]*box-shadow:\s*none;/s);
  assert.equal((wxml.match(/previous-margin="26\.92rpx"/g) || []).length, 3);
  assert.equal((wxml.match(/next-margin="353\.85rpx"/g) || []).length, 3);
  assert.match(wxss, /\.small-card-slide\s*\{[^}]*padding:\s*23\.08rpx 11\.54rpx 38\.46rpx;/s);
});

test("home sections match the prototype title and module spacing", () => {
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");

  assert.match(wxml, /<view class="page-wrap">\s*<!--[\s\S]*?-->\s*<image class="page-watermark[\s\S]*?<scroll-view/);
  assert.match(wxss, /\.page-wrap\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(wxss, /\.page-watermark\s*\{[^}]*position:\s*absolute;[^}]*pointer-events:\s*none;/s);
  assert.match(wxss, /\.navbar-title\s*\{[^}]*font-size:\s*46\.15rpx;[^}]*font-weight:\s*600;[^}]*line-height:\s*65\.38rpx;/s);
  assert.match(wxss, /\.group-section\s*\{[^}]*margin-bottom:\s*0;/s);
  assert.match(wxss, /\.group-header\s*\{[^}]*height:\s*53\.85rpx;/s);
  assert.match(wxss, /\.group-title\s*\{[^}]*font-size:\s*38\.46rpx;[^}]*font-weight:\s*700;[^}]*line-height:\s*53\.85rpx;/s);
  assert.match(wxml, /<view wx:if="\{\{groupSectionVisibility\.joined\}\}" class="group-section joined-group-section">/);
  assert.doesNotMatch(wxml, /group-create-btn|添加活动/);
  assert.doesNotMatch(wxss, /\.group-create-(?:btn|icon|text)\b/);
  assert.match(js, /hasCreateActivityPermission\(\)\s*\{[\s\S]*?role === "user" \|\| role === "admin"/);
  assert.match(js, /consumePendingCreateActivity\(\)\s*\{[\s\S]*?pendingOpenCreateActivity = false[\s\S]*?showCreateModal\(\)/);
  assert.match(js, /showCreateModal\(\)\s*\{\s*if \(!this\.hasCreateActivityPermission\(\)\) return;/);
  assert.match(js, /_setTabBarHidden\(!!\([\s\S]*?app\.globalData\.pendingOpenCreateActivity[\s\S]*?\)\);/);
  assert.match(wxss, /\.large-cards-swiper\s*\{[^}]*height:\s*823\.07rpx;/s);
  assert.match(wxss, /\.small-cards-swiper\s*\{[^}]*height:\s*488\.46rpx;/s);
  assert.match(wxss, /\.large-card-slide\s*\{[^}]*padding:\s*23\.08rpx 23\.08rpx 38\.46rpx 0;/s);
  assert.match(wxss, /\.small-card-slide\s*\{[^}]*padding:\s*23\.08rpx 11\.54rpx 38\.46rpx;/s);
  assert.match(wxss, /\.small-card-wrap\s*\{[^}]*display:\s*block;[^}]*width:\s*346\.15rpx;[^}]*background-color:\s*transparent;[^}]*overflow:\s*visible;/s);
  assert.match(wxss, /\.small-card-content\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*15\.38rpx;[^}]*width:\s*346\.15rpx;[^}]*overflow:\s*visible;/s);
  assert.match(wxss, /\.small-card-info\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*padding:\s*0;[^}]*background-color:\s*transparent;/s);
  assert.match(wxss, /\.small-card-name\s*\{[^}]*font-size:\s*23\.08rpx;[^}]*line-height:\s*32\.69rpx;[^}]*font-weight:\s*500;/s);
  assert.match(wxss, /\.small-card-time\s*\{[^}]*font-size:\s*23\.08rpx;[^}]*line-height:\s*32\.69rpx;[^}]*font-weight:\s*500;/s);
});

test("large card matches the prototype geometry and typography", () => {
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");

  assert.match(wxss, /\.large-card\s*\{[^}]*width:\s*530\.77rpx;[^}]*height:\s*707\.69rpx;[^}]*border-radius:\s*30\.77rpx;/s);
  assert.match(wxss, /\.large-card-wrap\s*\{[^}]*width:\s*530\.77rpx;/s);
  assert.match(wxss, /\.large-card-wrap\s*\{[^}]*gap:\s*15\.38rpx;[^}]*background-color:\s*transparent;/s);
  assert.match(wxss, /\.large-card-transition\s*\{[^}]*width:\s*530\.77rpx;[^}]*height:\s*707\.69rpx;[^}]*overflow:\s*visible;[^}]*border-radius:\s*30\.77rpx;[^}]*background-color:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(wxss, /\.large-card\s*\{[^}]*box-shadow:\s*none;/s);
  assert.match(wxss, /\.small-card-shadow\s*\{[^}]*width:\s*346\.15rpx;[^}]*height:\s*346\.15rpx;[^}]*border-radius:\s*23\.08rpx;[^}]*overflow:\s*visible;[^}]*box-shadow:\s*none;/s);
  assert.match(wxss, /\.small-card\s*\{[^}]*width:\s*346\.15rpx;[^}]*height:\s*346\.15rpx;[^}]*border-radius:\s*23\.08rpx;[^}]*overflow:\s*hidden;[^}]*box-shadow:\s*none;/s);
  const datetimeRule = wxss.match(/\.card-datetime-label\s*\{([^}]*)\}/);
  assert.ok(datetimeRule);
  assert.match(datetimeRule[1], /font-size:\s*26\.92rpx;/);
  assert.match(datetimeRule[1], /line-height:\s*38\.46rpx;/);
  assert.match(datetimeRule[1], /font-weight:\s*400;/);
  assert.match(datetimeRule[1], /background-color:\s*transparent;/);
  assert.doesNotMatch(datetimeRule[1], /margin-bottom:/);
  assert.match(wxss, /\.glass-bottom\s*\{[^}]*padding:\s*31\.4rpx;/s);
  assert.match(wxss, /\.glass-content\s*\{[^}]*gap:\s*7\.69rpx;/s);
  assert.match(wxss, /\.glass-remark\s*\{[^}]*line-height:\s*33\.15rpx;[^}]*height:\s*33\.15rpx;/s);
  assert.match(wxss, /\.glass-meta-row\s*\{[^}]*height:\s*33\.15rpx;/s);
  assert.match(wxss, /\.glass-meta-text\s*\{[^}]*line-height:\s*33\.15rpx;/s);
});

test("large-card glass panel reserves the remark row when remark is empty", () => {
  assert.match(wxml, /<text class="glass-remark">\{\{item\.remark \|\| ''\}\}<\/text>/);
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");
  assert.doesNotMatch(wxss, /\.glass-bottom \{[\s\S]*height: 188\.46rpx;/);
  assert.match(wxss, /\.glass-remark \{[\s\S]*height: 33\.15rpx;/);
});

test("large-card meta icons use the prototype Lucide assets", () => {
  assert.match(wxml, /src="\/images\/icon-home-card-location\.svg"/);
  assert.match(wxml, /src="\/images\/icon-home-card-people\.svg"/);
  assert.match(wxml, /class="large-card large-card--\{\{item\.activityType\}\}-\{\{item\.activityStyleKey\}\}"/);
});

test("home large and small cards both use the original cover image", () => {
  assert.match(js, /activity\.smallCardBgImageUrl = selectedStyle \? \(selectedStyle\.largeCardBgImageUrl \|\| ""\) : ""/);
  assert.match(js, /activity\.largeCardBgImageUrl = activity\.activityCover\.imageUrl;[\s\S]*?activity\.smallCardBgImageUrl = activity\.activityCover\.imageUrl;/);
  assert.doesNotMatch(js, /activity\.smallCardBgImageUrl = activity\.activityCover\.thumbnailUrl/);
  assert.match(wxml, /class="card-image-bg"[\s\S]*?src="\{\{item\._homeCoverSrc\}\}"[\s\S]*?mode="aspectFill"/);
});

test("large-card glass uses a pre-rendered static image with the black gradient", () => {
  const wxss = fs.readFileSync(path.join(pageDir, "activity_list.wxss"), "utf8");
  const glassBottomRule = wxss.match(/\.glass-bottom\s*\{([^}]*)\}/);
  const glassSection = wxss.slice(wxss.indexOf("/* ── 大卡片毛玻璃底部 ── */"), wxss.indexOf("/* ── 自定义底部 Tab ── */"));

  assert.ok(glassBottomRule, "glass-bottom rule should exist");
  assert.doesNotMatch(js, /buildCardGlassImageUrl|\/activities\/type-styles\//);
  assert.match(js, /activity\.largeCardGlassImageUrl = selectedStyle/);
  assert.match(js, /largeCardGlassImageUrl: String\(rawCover\.large_card_glass_image_url \|\| ""\)/);
  assert.match(js, /activity\.largeCardGlassImageUrl = activity\.activityCover\.largeCardGlassImageUrl \|\| ""/);
  assert.match(wxml, /class="glass-bottom"[\s\S]*class="glass-static-blur-layer"/);
  assert.match(wxml, /wx:if="\{\{item\._homeGlassSrc\}\}"/);
  assert.match(wxml, /class="glass-static-blur-image"[\s\S]*src="\{\{item\._homeGlassSrc\}\}"/);
  assert.match(wxml, /class="glass-tint-layer"/);
  assert.match(wxml, /class="glass-content"/);
  assert.match(glassSection, /\.glass-static-blur-layer\s*\{[\s\S]*top: 0;[\s\S]*bottom: 0;[\s\S]*overflow: hidden;[\s\S]*border-bottom-left-radius: inherit;/);
  assert.match(glassSection, /\.glass-static-blur-layer\s*\{[\s\S]*background: rgba\(31, 41, 55, 0\.58\);/);
  assert.doesNotMatch(glassSection, /-webkit-mask-image|isolation:\s*isolate/);
  assert.match(glassSection, /\.glass-static-blur-stage\s*\{[\s\S]*left: 0;[\s\S]*bottom: 0;[\s\S]*width: 530\.77rpx;[\s\S]*height: 707\.69rpx;/);
  assert.match(glassSection, /background: linear-gradient\(180deg, rgba\(0,0,0,0\.10\) 0%, rgba\(0,0,0,0\.30\) 100%\)/);
  assert.match(glassSection, /\.large-card--boardgame-boardgame-default \.glass-tint-layer\s*\{[\s\S]*rgba\(0,0,0,0\.20\)[\s\S]*rgba\(0,0,0,0\.40\)/);
  assert.equal((glassSection.match(/(?:^|[;{}\s])(?:-webkit-)?(?:backdrop-)?filter\s*:/gm) || []).length, 0);
});
