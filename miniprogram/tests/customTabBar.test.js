const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tabDir = path.join(__dirname, "../custom-tab-bar");
const createAccessDialogDir = path.join(__dirname, "../components/create-access-dialog");
const imageDir = path.join(__dirname, "../images");

const iconNames = [
  "tab-home-material-rounded",
  "tab-tools-material-rounded",
  "tab-leaderboard-material-rounded",
  "tab-person-material-rounded"
];

test("custom tab bar follows the updated floating glass Pencil component", () => {
  const wxml = fs.readFileSync(path.join(tabDir, "index.wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(tabDir, "index.wxss"), "utf8");
  const componentJson = JSON.parse(fs.readFileSync(path.join(tabDir, "index.json"), "utf8"));
  const strokeSvg = fs.readFileSync(path.join(imageDir, "tab-glass-stroke.svg"), "utf8");
  const js = fs.readFileSync(path.join(tabDir, "index.js"), "utf8");
  const syncJs = fs.readFileSync(path.join(__dirname, "../utils/tabBarSync.js"), "utf8");
  const listWxml = fs.readFileSync(path.join(__dirname, "../pages/activity_list/activity_list.wxml"), "utf8");
  const listWxss = fs.readFileSync(path.join(__dirname, "../pages/activity_list/activity_list.wxss"), "utf8");
  const historyWxml = fs.readFileSync(path.join(__dirname, "../pages/history/history.wxml"), "utf8");
  const historyWxss = fs.readFileSync(path.join(__dirname, "../pages/history/history.wxss"), "utf8");
  const profileWxml = fs.readFileSync(path.join(__dirname, "../pages/profile/profile.wxml"), "utf8");
  const profileWxss = fs.readFileSync(path.join(__dirname, "../pages/profile/profile.wxss"), "utf8");
  const hostRule = wxss.match(/:host\s*\{([^}]*)\}/);
  const glassBlurRule = wxss.match(/\.tab-glass-blur\s*\{([^}]*)\}/);
  const activeTabRule = wxss.match(/\.tab-item--active\s*\{([^}]*)\}/);
  const hiddenIconRule = wxss.match(/\.tab-icon-glyph--hidden\s*\{([^}]*)\}/);
  const activeLabelRule = wxss.match(/\.tab-label--active\s*\{([^}]*)\}/);

  assert.equal((wxml.match(/class="tab-item /g) || []).length, 4);
  assert.equal(componentJson.styleIsolation, "isolated");
  assert.match(wxml, /id="qa-custom-tab-bar"/);
  assert.match(wxml, /class="tab-bar-wrap {{!hidden && !entering \? 'tab-bar-wrap--visible' : ''}}" hidden="{{hidden}}"/);
  assert.match(wxml, /id="qa-tab-glass"/);
  assert.match(wxml, /id="qa-tab-glass" class="tab-items-wrap \{\{modalMaskVisible \? 'tab-items-wrap--modal' : ''\}\}"/);
  assert.doesNotMatch(wxml, /modalContentOpacity/);
  assert.match(wxml, /id="qa-tab-glass-blur"[^>]*opacity: \{\{tabGlassBlurOpacity\}\}[^>]*blur\(\{\{tabGlassBlurRadiusRpx\}\}rpx\)/);
  assert.match(wxml, /id="qa-tab-glass-fill"[^>]*rgba\(255, 255, 255, \{\{tabGlassFillOpacity\}\}\)/);
  assert.match(wxml, /id="qa-tab-glass-stroke"/);
  assert.match(wxml, /class="tab-glass-stroke"/);
  assert.match(wxml, /src="\/images\/tab-glass-stroke\.svg"/);
  for (const qaId of ["home", "tools", "ranking", "profile"]) {
    assert.match(wxml, new RegExp(`id="qa-tab-${qaId}"`));
  }
  assert.match(wxml, /id="qa-tab-create"[^>]*catchtap="onCreateActivityTap"/);
  assert.match(wxml, /id="qa-tab-modal-mask"[^>]*catchtap="blockTabInteraction"[^>]*catchtouchmove="blockTabInteraction"/s);
  assert.match(wxml, /src="\/images\/tab-create-plus\.svg"/);
  assert.match(wxml, />首页<\/text>/);
  assert.doesNotMatch(wxml, />日程<\/text>|qa-tab-calendar|tab-calendar-month/);
  assert.match(wxml, />排行<\/text>/);
  assert.match(wxml, />我的<\/text>/);
  assert.match(wxml, />工具<\/text>/);
  assert.doesNotMatch(wxml, /tab-indicator|tab-bottom-fade|data:image\/svg|lucide/);
  assert.equal((wxml.match(/<view class="tab-icon"/g) || []).length, 4);
  assert.equal((wxml.match(/<image class="tab-icon-glyph /g) || []).length, 8);
  assert.doesNotMatch(wxml, /tab-icon-glyph--(?:home|calendar|tools|ranking|profile)/);
  assert.doesNotMatch(wxml, /<image[^>]*src="\{\{/);

  for (const iconName of iconNames) {
    assert.match(wxml, new RegExp(`src="/images/${iconName}\\.svg"`));
    assert.match(wxml, new RegExp(`src="/images/${iconName}-active\\.svg"`));
  }
  assert.doesNotMatch(wxml, /material-rounded-states\.svg/);
  assert.doesNotMatch(wxml, /active-positive/);

  assert.match(wxml, /style="height: calc\(52px \+ \{\{safeBottomPx\}\}px\); padding-bottom: \{\{safeBottomPx\}\}px;"/);
  assert.match(js, /function getBottomSafeAreaCssPx\(\)/);
  assert.match(js, /getBottomSafeAreaRpx\(\) \* windowWidth \/ 750/);
  assert.match(js, /safeBottomPx:\s*0/);
  assert.doesNotMatch(js, /safeBottomRpx:\s*0/);
  assert.doesNotMatch(wxss, /107\.69231rpx|safe-area-inset-bottom/);
  assert.doesNotMatch(wxml, /107\.69231rpx|safe-area-inset-bottom/);
  assert.match(wxss, /background:\s*transparent/);
  assert.doesNotMatch(wxss, /border-top:/);
  assert.match(wxss, /\.tab-items-wrap\s*{[\s\S]*?width:\s*calc\(100% - 76\.92308rpx\);[\s\S]*?height:\s*52px;[\s\S]*?margin:\s*0 38\.46154rpx;[\s\S]*?padding:\s*4px 7\.69231rpx;[\s\S]*?border-radius:\s*26px;[\s\S]*?background:\s*transparent;/);
  assert.match(wxss, /box-shadow:\s*0 5\.76923rpx 23\.07692rpx rgba\(100, 116, 139, 0\.101961\)/);
  assert.match(wxss, /\.tab-glass-blur\s*\{[\s\S]*?z-index:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(wxss, /\.tab-glass-fill\s*\{[\s\S]*?z-index:\s*1;/);
  assert.doesNotMatch(wxss, /backdrop-filter:|rgba\(255, 255, 255, 0\)/);
  assert.ok(glassBlurRule);
  assert.doesNotMatch(glassBlurRule[1], /opacity:\s*1;/);
  assert.match(js, /const TAB_GLASS_TUNING = Object\.freeze\(\{[\s\S]*?blurRadiusRpx:\s*12,[\s\S]*?blurLayerOpacity:\s*1,[\s\S]*?whiteFillOpacity:\s*0\.4/);
  assert.match(js, /setGlassTuning\(\{ blurRadiusRpx, blurLayerOpacity, whiteFillOpacity \} = \{\}\)/);
  assert.match(js, /wx\.vibrateShort\(\{ type: "light", fail: fallback \}\)/);
  assert.match(js, /success: vibrateTabSelection/);
  assert.doesNotMatch(wxss, /border:\s*1\.92308rpx solid transparent|background:[^;]*(?:padding-box|border-box|linear-gradient\()/);
  assert.doesNotMatch(wxss, /\.tab-items-wrap::before/);
  assert.match(wxss, /\.tab-glass-stroke\s*{[\s\S]*?position:\s*absolute;[\s\S]*?z-index:\s*2;[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;[\s\S]*?pointer-events:\s*none;/);
  assert.equal((wxml.match(/catchtap="onTabTap"/g) || []).length, 4);

  assert.match(strokeSvg, /width="350" height="52" viewBox="0 0 350 52" preserveAspectRatio="none"/);
  assert.match(strokeSvg, /<linearGradient id="tabGlassStroke" x1="0" y1="1" x2="1" y2="0">/);
  assert.match(strokeSvg, /<stop offset="0" stop-color="#FFFFFF" stop-opacity="0"\/>/);
  assert.match(strokeSvg, /<stop offset="0\.319628" stop-color="#FFF7ED" stop-opacity="0\.219608"\/>/);
  assert.match(strokeSvg, /<stop offset="0\.691822" stop-color="#FFFFFF" stop-opacity="0\.439216"\/>/);
  assert.match(strokeSvg, /<stop offset="1" stop-color="#FFFFFF" stop-opacity="0\.658824"\/>/);
  assert.match(strokeSvg, /<rect x="0\.5" y="0\.5" width="349" height="51" rx="25\.5" ry="25\.5" fill="none" stroke="url\(#tabGlassStroke\)" stroke-width="1"\/>/);

  const tabItemRule = wxss.match(/\.tab-item\s*{([^}]*)\}/);
  assert.ok(tabItemRule);
  assert.match(tabItemRule[1], /display:\s*block;/);
  assert.match(tabItemRule[1], /height:\s*44px;/);
  assert.match(tabItemRule[1], /border-radius:\s*22px;/);
  assert.match(tabItemRule[1], /pointer-events:\s*auto;/);
  assert.doesNotMatch(tabItemRule[1], /gap:|flex-direction:|align-items:|justify-content:/);
  assert.match(wxss, /\.tab-item--active\s*{[\s\S]*?background:\s*rgba\(255, 255, 255, 0\.901961\);[\s\S]*?box-shadow:\s*0 3\.84615rpx 15\.38462rpx rgba\(100, 116, 139, 0\.070588\)/);
  assert.ok(activeTabRule);
  assert.doesNotMatch(activeTabRule[1], /gap:|padding:|width:|height:|transform:/);
  assert.match(wxss, /\.tab-icon\s*{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*5px;[\s\S]*?left:\s*50%;[\s\S]*?overflow:\s*hidden;[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;[\s\S]*?transform:\s*translateX\(-50%\);/);
  assert.match(wxss, /\.tab-icon-glyph\s*{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*0;[\s\S]*?left:\s*0;[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*none;/);
  assert.doesNotMatch(wxss, /\.tab-icon-glyph--(?:home|calendar|tools|ranking|profile)\b/);
  assert.ok(hiddenIconRule);
  assert.match(hiddenIconRule[1], /opacity:\s*0;/);
  assert.doesNotMatch(hiddenIconRule[1], /gap:|margin:|padding:|left:|top:|width:|height:|transform:/);
  assert.doesNotMatch(wxss, /69\.23076rpx|left:\s*-34\.61538rpx/);
  assert.doesNotMatch(wxss, /mask-image|mask-size|mask-position|mask-repeat/);
  assert.match(wxss, /\.tab-label\s*{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*25px;[\s\S]*?left:\s*0;[\s\S]*?width:\s*100%;[\s\S]*?height:\s*14px;[\s\S]*?font-size:\s*10px;[\s\S]*?line-height:\s*14px;[\s\S]*?font-weight:\s*400;[\s\S]*?text-align:\s*center;/);
  assert.match(wxss, /\.tab-label--active\s*{[\s\S]*?color:\s*#f59e0b;/);
  assert.match(wxss, /\.tab-create-item\s*\{[^}]*height:\s*44px;[^}]*flex:\s*1;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  assert.match(wxss, /\.tab-create-button\s*\{[^}]*width:\s*34px;[^}]*height:\s*26px;[^}]*border-radius:\s*8px;[^}]*background:\s*#ff9800;[^}]*box-shadow:\s*0 3\.84615rpx 11\.53846rpx rgba\(255, 152, 0, 0\.2\);/s);
  assert.match(wxss, /\.tab-modal-mask\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*0;[^}]*z-index:\s*10;[^}]*pointer-events:\s*auto;/s);
  assert.doesNotMatch(wxml, /id="qa-tab-modal-mask"[\s\S]*?background: rgba\(23, 24, 20,/);
  assert.match(wxss, /\.tab-items-wrap--modal\s*\{[^}]*box-shadow:\s*none;/s);
  assert.match(wxss, /\.tab-items-wrap--modal \.tab-glass-fill\s*\{[^}]*opacity:\s*0;/s);
  assert.match(wxss, /\.tab-items-wrap--modal \.tab-glass-stroke,[\s\S]*?\.tab-items-wrap--modal \.tab-create-item\s*\{[^}]*opacity:\s*0\.6;/s);
  assert.match(wxss, /\.tab-modal-mask\s*\{[^}]*background:\s*transparent;/s);
  assert.match(js, /setModalMaskVisible\(visible, opacity = 0\.4\)/);
  assert.ok(activeLabelRule);
  assert.doesNotMatch(activeLabelRule[1], /gap:|margin:|padding:|font-size:|font-weight:|line-height:|transform:/);
  assert.doesNotMatch(wxss, /border-radius:\s*999(?:r?px)|tab-indicator/);

  assert.equal((js.match(/"\/pages\//g) || []).length, 4);
  assert.doesNotMatch(js, /TAB_SWITCH_COMMIT_DELAY_MS|_pendingSwitchIndex/);
  assert.doesNotMatch(syncJs, /indicatorTransitionEnabled/);
  assert.match(listWxml, /height: calc\(100rpx \+ \{\{bottomSafeAreaRpx\}\}rpx\)/);
  assert.doesNotMatch(
    listWxss,
    /\.(?:custom-tab-bar|tab-items-wrap|tab-item|tab-item-active|tab-icon|tab-label|tab-label-active)\b/,
    "the home page must not leak obsolete tab styles into custom-tab-bar"
  );
  assert.ok(hostRule, "custom tab bar should define a :host rule");
  assert.match(hostRule[1], /background:\s*transparent;/);
  assert.doesNotMatch(hostRule[1], /position:\s*fixed;/);
  assert.match(wxss, /\.tab-bar-wrap\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?bottom:\s*0;[\s\S]*?left:\s*0;[\s\S]*?z-index:\s*300;[\s\S]*?width:\s*100%;/);
  assert.match(wxss, /\.tab-bar-wrap\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?transform:\s*translateY\(100%\);[\s\S]*?transition:\s*transform 240ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\), opacity 160ms ease-out;[\s\S]*?pointer-events:\s*none;/);
  assert.match(wxss, /\.tab-bar-wrap--visible\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);[^}]*pointer-events:\s*auto;/s);
  assert.match(js, /setHidden\(hidden, \{ animate = false \} = \{\}\)/);
  assert.match(js, /function getGlobalTabHidden\(\)/);
  assert.match(js, /function getGlobalHomeTabEntrancePending\(\)/);
  assert.match(js, /hidden:\s*true/);
  assert.match(js, /function shouldKeepTabHidden\(route\)[\s\S]*?if \(!route\) return true;[\s\S]*?route === ACTIVITY_LIST_ROUTE &&[\s\S]*?getGlobalTabHidden\(\) \|\| getGlobalHomeTabEntrancePending\(\)/);
  assert.match(js, /setHidden\(hidden,[\s\S]*?setGlobalTabHidden\(nextHidden\)/);
  assert.doesNotMatch(historyWxml, /bottom: calc\(107\.69231rpx/);
  assert.match(historyWxss, /\.ranking-scroll\s*\{[^}]*bottom:\s*0;/);
  assert.match(historyWxml, /class="ranking-content"[^>]*padding-bottom: calc\(123\.07692rpx \+ \{\{bottomSafeAreaRpx\}\}rpx\)/);
  assert.doesNotMatch(historyWxss, /safe-area-inset-bottom|123\.07692rpx/);
  assert.match(profileWxml, /class="container" style="padding-bottom: calc\(131\.69231rpx \+ \{\{bottomSafeAreaRpx\}\}rpx\);"/);
  assert.doesNotMatch(profileWxss, /safe-area-inset-bottom|131\.69231rpx/);
});

test("tab labels inherit the runtime system font", () => {
  const wxss = fs.readFileSync(path.join(tabDir, "index.wxss"), "utf8");
  assert.doesNotMatch(wxss, /font-family\s*:/);
});

test("create access dialog follows the warning-level centered modal spec", () => {
  const wxml = fs.readFileSync(path.join(createAccessDialogDir, "index.wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(createAccessDialogDir, "index.wxss"), "utf8");
  const warningSvg = fs.readFileSync(path.join(imageDir, "dialog-warning.svg"), "utf8");
  const appJs = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const profileJs = fs.readFileSync(path.join(__dirname, "../pages/profile/profile.js"), "utf8");

  assert.match(wxml, /id="qa-create-access-dialog-overlay"/);
  assert.match(wxml, /id="qa-create-access-dialog"/);
  assert.match(wxml, /class="create-access-dialog-title-row"/);
  assert.match(wxml, /src="\/images\/dialog-warning\.svg"/);
  assert.match(wxml, /id="qa-create-access-dialog-confirm"/);
  assert.match(wxss, /\.create-access-dialog-overlay\s*\{[^}]*background:\s*rgba\(23, 24, 20, 0\.4\);/s);
  assert.match(wxss, /\.create-access-dialog\s*\{[^}]*width:\s*576\.92308rpx;[^}]*padding:\s*38\.46154rpx;[^}]*gap:\s*30\.76923rpx;[^}]*border-radius:\s*30\.76923rpx;/s);
  assert.match(wxss, /\.create-access-dialog-title-row\s*\{[^}]*gap:\s*15\.38462rpx;/s);
  assert.match(wxss, /\.create-access-dialog-icon\s*\{[^}]*width:\s*34\.61538rpx;[^}]*height:\s*34\.61538rpx;/s);
  assert.match(wxss, /\.create-access-dialog-title\s*\{[^}]*font-size:\s*30\.76923rpx;[^}]*font-weight:\s*700;/s);
  assert.match(wxss, /\.create-access-dialog-message\s*\{[^}]*color:\s*#4b5563;[^}]*font-size:\s*26\.92308rpx;[^}]*font-weight:\s*400;/s);
  assert.match(wxss, /\.create-access-dialog-actions\s*\{[^}]*gap:\s*23\.07692rpx;/s);
  assert.match(wxss, /\.create-access-dialog-button\s*\{[^}]*height:\s*84\.61538rpx;[^}]*border-radius:\s*23\.07692rpx;[^}]*font-size:\s*26\.92308rpx;/s);
  assert.match(wxss, /\.create-access-dialog-button--cancel\s*\{[^}]*color:\s*#4b5563;[^}]*background:\s*#f5f5f5;/s);
  assert.match(wxss, /\.create-access-dialog-button--confirm\s*\{[^}]*color:\s*#ffffff;[^}]*background:\s*#ff9800;/s);
  assert.match(warningSvg, /stroke="#F59E0B"/);
  assert.doesNotMatch(warningSvg, /<rect|fill="#FFF3E0"/);
  assert.match(appJs, /pendingCreateAccessAction:\s*""/);
  assert.match(profileJs, /pendingCreateAccessAction === "login"[\s\S]*?this\.startRegister\(\)/);
  assert.match(profileJs, /pendingCreateAccessAction === "permission"[\s\S]*?this\.openPermissionModal\(\)/);
  assert.match(profileJs, /function syncProfileTabBarModalMask\(page, visible\)[\s\S]*?tabBar\.setModalMaskVisible\(visible\)/);
  assert.match(profileJs, /openPermissionModal\(\)\s*\{[\s\S]*?syncProfileTabBarModalMask\(this, true\)/);
  assert.match(profileJs, /closePermissionModal\(\)\s*\{[\s\S]*?syncProfileTabBarModalMask\(this, false\)/);

  for (const pageName of ["activity_list", "tools", "history", "profile"]) {
    const pageDir = path.join(__dirname, `../pages/${pageName}`);
    const pageJson = fs.readFileSync(path.join(pageDir, `${pageName}.json`), "utf8");
    const pageWxml = fs.readFileSync(path.join(pageDir, `${pageName}.wxml`), "utf8");
    assert.match(pageJson, /"create-access-dialog":\s*"\.\.\/\.\.\/components\/create-access-dialog\/index"/);
    assert.match(pageWxml, /<create-access-dialog id="create-access-dialog"\s*\/>/);
  }
});

test("tab modal mask can be synchronized by page-level dialogs", () => {
  const componentPath = path.join(tabDir, "index.js");
  const previousComponent = global.Component;
  let definition;
  try {
    global.Component = (value) => { definition = value; };
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const ctx = {
      data: { modalMaskVisible: false, modalMaskOpacity: 0.4 },
      setData(patch) { Object.assign(this.data, patch); }
    };
    definition.methods.setModalMaskVisible.call(ctx, true, 0.5);
    assert.deepEqual(ctx.data, { modalMaskVisible: true, modalMaskOpacity: 0.5 });
    definition.methods.setModalMaskVisible.call(ctx, false, 0.5);
    assert.deepEqual(ctx.data, { modalMaskVisible: false, modalMaskOpacity: 0.5 });
  } finally {
    delete require.cache[require.resolve(componentPath)];
    if (previousComponent === undefined) delete global.Component;
    else global.Component = previousComponent;
  }
});

test("hidden tab bar re-enters from below on demand and ordinary visibility changes stay immediate", async () => {
  const componentPath = path.join(tabDir, "index.js");
  const previousGlobals = {
    Component: global.Component,
    wx: global.wx
  };
  let definition;

  try {
    global.Component = (value) => { definition = value; };
    global.wx = { nextTick(callback) { callback(); } };
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const patches = [];
    const ctx = {
      data: { hidden: true, entering: false },
      setData(patch, callback) {
        patches.push(patch);
        Object.assign(this.data, patch);
        if (callback) callback();
      }
    };

    definition.methods.setHidden.call(ctx, false, { animate: true });
    assert.deepEqual(patches[0], { hidden: false, entering: true });
    assert.equal(ctx.data.entering, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(ctx.data.entering, false);

    definition.methods.setHidden.call(ctx, true);
    assert.deepEqual(patches.at(-1), { hidden: true, entering: false });

    definition.methods.setHidden.call(ctx, false);
    assert.deepEqual(patches.at(-1), { hidden: false, entering: false });
  } finally {
    delete require.cache[require.resolve(componentPath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});

test("tab bar remount preserves the hidden state while the home drawer survives a native page", () => {
  const componentPath = path.join(tabDir, "index.js");
  const previousGlobals = {
    Component: global.Component,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages
  };
  let definition;
  const app = { globalData: { tabBarSelected: 0, tabBarHidden: true, userRole: "admin" } };

  try {
    global.Component = (value) => { definition = value; };
    global.getApp = () => app;
    global.getCurrentPages = () => [{ route: "pages/activity_list/activity_list" }];
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const ctx = {
      data: { selected: 0, hidden: false, entering: false, isAdmin: true },
      syncBottomSafeArea() {},
      setData(patch) { Object.assign(this.data, patch); }
    };

    definition.lifetimes.attached.call(ctx);
    assert.equal(ctx.data.hidden, true);

    app.globalData.tabBarHidden = false;
    definition.pageLifetimes.show.call(ctx);
    assert.equal(ctx.data.hidden, false);
  } finally {
    delete require.cache[require.resolve(componentPath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});

test("tab bar stays hidden while its page route is not available during the first mount", () => {
  const componentPath = path.join(tabDir, "index.js");
  const previousGlobals = {
    Component: global.Component,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages
  };
  let definition;
  const app = { globalData: { tabBarSelected: 0, tabBarHidden: false, homeTabEntrancePending: true } };

  try {
    global.Component = (value) => { definition = value; };
    global.getApp = () => app;
    global.getCurrentPages = () => [];
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const patches = [];
    const ctx = {
      data: { selected: 0, hidden: true, entering: false },
      syncBottomSafeArea() {},
      setData(patch) {
        patches.push(patch);
        Object.assign(this.data, patch);
      }
    };

    definition.lifetimes.attached.call(ctx);
    assert.equal(ctx.data.hidden, true);
    assert.equal(patches.some((patch) => patch.hidden === false), false);
  } finally {
    delete require.cache[require.resolve(componentPath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});

test("tab icons use geometry-locked Pencil SVG pairs without sprite cropping", () => {
  for (const iconName of iconNames) {
    const inactive = fs.readFileSync(path.join(imageDir, `${iconName}.svg`), "utf8");
    const active = fs.readFileSync(path.join(imageDir, `${iconName}-active.svg`), "utf8");
    const inactivePath = inactive.match(/<path transform="translate\(0 960\)" d="([^"]+)"\/>/);
    const activePath = active.match(/<path transform="translate\(0 960\)" d="([^"]+)"\/>/);

    for (const svg of [inactive, active]) {
      assert.match(svg, /width="18" height="18"/);
      assert.match(svg, /data-library="Material Symbols Rounded"/);
      assert.match(svg, /data-weight="300"/);
      assert.match(svg, /viewBox="0 0 960 960"/);
      assert.doesNotMatch(svg, /stroke=/);
    }
    assert.match(inactive, /fill="#111827"/);
    assert.match(active, /fill="#F59E0B"/);
    assert.ok(inactivePath);
    assert.ok(activePath);
    assert.equal(inactivePath[1], activePath[1], `${iconName} states must share one exact path`);
  }
});

test("all four tab states use one geometry and one selected-state rule", () => {
  const wxml = fs.readFileSync(path.join(tabDir, "index.wxml"), "utf8");
  const indexes = [...wxml.matchAll(/data-index="(\d)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(indexes, [0, 1, 2, 3]);
  for (const index of indexes) {
    assert.match(wxml, new RegExp(`selected === ${index} \\? 'tab-item--active'`));
    assert.match(wxml, new RegExp(`selected === ${index} \\? 'tab-icon-glyph--hidden'`));
    assert.match(wxml, new RegExp(`selected === ${index} \\? 'tab-label--active'`));
  }
});

test("tools tab icon uses the Pencil widgets glyph instead of grid_view", () => {
  const svg = fs.readFileSync(path.join(imageDir, "tab-tools-material-rounded.svg"), "utf8");

  assert.match(svg, /<path[^>]* d="M648\.4-500\.07 500\.83-647\.63/);
  assert.match(svg, /671\.23-790 546\.46-665\.23l124\.77 124\.38/);
  assert.doesNotMatch(svg, /M180-180v-240h240v240H180/);
});

test("four tab routes and selected states stay aligned", () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../app.json"), "utf8"));
  const expected = [
    ["pages/activity_list/activity_list", "activity_list/activity_list.js", 0],
    ["pages/tools/tools", "tools/tools.js", 1],
    ["pages/history/history", "history/history.js", 2],
    ["pages/profile/profile", "profile/profile.js", 3]
  ];

  assert.equal(appJson.tabBar.custom, true);
  assert.deepEqual(
    appJson.tabBar.list.map((item) => item.pagePath),
    expected.map(([route]) => route)
  );

  for (const [, relativeFile, selected] of expected) {
    const pageJs = fs.readFileSync(path.join(__dirname, "../pages", relativeFile), "utf8");
    assert.match(pageJs, new RegExp(`patchTabBarIfNeeded\\(this, \\{[\\s\\S]*?selected: ${selected}`));
  }
});

test("all four tab pages rely on the single framework custom-tab-bar implementation", () => {
  const pageNames = ["activity_list", "tools", "history", "profile"];
  const duplicateTabSelector = /\.(?:tab-items-wrap|tab-item|tab-item--active|tab-icon|tab-icon-glyph|tab-label|tab-label--active)\b/;

  for (const pageName of pageNames) {
    const pageDir = path.join(__dirname, `../pages/${pageName}`);
    const wxml = fs.readFileSync(path.join(pageDir, `${pageName}.wxml`), "utf8");
    const wxss = fs.readFileSync(path.join(pageDir, `${pageName}.wxss`), "utf8");

    assert.doesNotMatch(wxml, /<custom-tab-bar\b|id="qa-custom-tab-bar"/);
    assert.doesNotMatch(wxss, duplicateTabSelector);
  }
});

test("tab selection follows the visible route without mutating the page being left", () => {
  const componentPath = path.join(tabDir, "index.js");
  const previousGlobals = {
    Component: global.Component,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx
  };
  let definition;
  let currentRoute = "pages/profile/profile";
  let switchedUrl = "";
  let vibrationCount = 0;
  const app = { globalData: { tabBarSelected: 1, userRole: "user" } };

  try {
    global.Component = (value) => { definition = value; };
    global.getApp = () => app;
    global.getCurrentPages = () => [{ route: currentRoute }];
    global.wx = {
      switchTab({ url, success }) {
        switchedUrl = url;
        if (success) success();
      },
      vibrateShort() {
        vibrationCount += 1;
      }
    };
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const patches = [];
    const ctx = {
      data: { selected: 1, hidden: false, isAdmin: false },
      syncBottomSafeArea() {},
      setData(patch) {
        patches.push(patch);
        Object.assign(this.data, patch);
      }
    };

    definition.pageLifetimes.show.call(ctx);
    assert.equal(ctx.data.selected, 3);
    assert.equal(app.globalData.tabBarSelected, 3);

    patches.length = 0;
    definition.methods.onTabTap.call(ctx, {
      currentTarget: { dataset: { index: "0" } }
    });
    assert.equal(switchedUrl, "/pages/activity_list/activity_list");
    assert.equal(app.globalData.tabBarSelected, 0);
    assert.equal(vibrationCount, 1);
    assert.deepEqual(patches, []);

    currentRoute = "pages/activity_list/activity_list";
    definition.pageLifetimes.show.call(ctx);
    assert.equal(ctx.data.selected, 0);

    definition.methods.onTabTap.call(ctx, {
      currentTarget: { dataset: { index: "0" } }
    });
    assert.equal(vibrationCount, 1);
  } finally {
    delete require.cache[require.resolve(componentPath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});

test("central create entry follows the four-state identity matrix", () => {
  const componentPath = path.join(tabDir, "index.js");
  const previousGlobals = {
    Component: global.Component,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx
  };
  let definition;
  const accessDialog = {
    opened: null,
    open(dialog) { this.opened = dialog; }
  };
  let currentPage = {
    route: "pages/activity_list/activity_list",
    showCreateModalCalls: 0,
    showCreateModal() { this.showCreateModalCalls += 1; },
    selectComponent(selector) {
      assert.equal(selector, "#create-access-dialog");
      return accessDialog;
    }
  };
  let switchedUrl = "";
  const app = {
    globalData: {
      userRole: null,
      isAuthenticated: false,
      accessToken: "",
      pendingOpenCreateActivity: false
    }
  };

  try {
    global.Component = (value) => { definition = value; };
    global.getApp = () => app;
    global.getCurrentPages = () => [currentPage];
    global.wx = { switchTab({ url }) { switchedUrl = url; } };
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const ctx = { data: { selected: 0 } };
    definition.methods.onCreateActivityTap.call(ctx);
    assert.equal(currentPage.showCreateModalCalls, 0, "未登录不能直接打开新建活动");
    assert.equal(accessDialog.opened.type, "login", "未登录点击必须展示原因弹窗");
    assert.equal(accessDialog.opened.title, "尚未登录");
    assert.equal(accessDialog.opened.confirmText, "去登录");

    Object.assign(app.globalData, { userRole: "guest", isAuthenticated: false, accessToken: "guest-token" });
    definition.methods.onCreateActivityTap.call(ctx);
    assert.equal(currentPage.showCreateModalCalls, 0, "游客不能直接打开新建活动");
    assert.equal(accessDialog.opened.type, "permission", "游客点击必须展示权限弹窗");
    assert.equal(accessDialog.opened.title, "暂无创建权限");
    assert.equal(accessDialog.opened.confirmText, "去获取权限");

    Object.assign(app.globalData, { userRole: "user", isAuthenticated: true, accessToken: "user-token" });
    definition.methods.onCreateActivityTap.call(ctx);
    assert.equal(currentPage.showCreateModalCalls, 1, "普通用户可直接打开首页抽屉");

    currentPage = { route: "pages/tools/tools" };
    Object.assign(app.globalData, { userRole: "admin", isAuthenticated: true, accessToken: "admin-token" });
    definition.methods.onCreateActivityTap.call(ctx);
    assert.equal(switchedUrl, "/pages/activity_list/activity_list");
    assert.equal(app.globalData.pendingOpenCreateActivity, true, "管理员跨 Tab 后由首页消费打开请求");
    assert.equal(app.globalData.tabBarHidden, true, "跨 Tab 打开前先隐藏底部栏，避免切页闪现");
  } finally {
    delete require.cache[require.resolve(componentPath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});
