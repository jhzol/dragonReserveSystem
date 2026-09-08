const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const sheets = [
  {
    wxml: "components/activity-form-sheet/index.wxml",
    js: "components/activity-form-sheet/index.js",
    containerId: "qaActivityFormContainer",
    surfaceId: "qaActivityFormSurface",
    duration: 240,
    closeHandler: "onClose"
  },
  {
    wxml: "components/date-time-picker-sheet/index.wxml",
    js: "components/date-time-picker-sheet/index.js",
    containerId: "qaDateTimePickerContainer",
    surfaceId: "qaDateTimePickerSurface",
    duration: 220,
    closeHandler: "onClose"
  },
  {
    wxml: "components/activity-type-picker-sheet/index.wxml",
    js: "components/activity-type-picker-sheet/index.js",
    containerId: "qaActivityTypePickerContainer",
    surfaceId: "qaActivityTypePickerSurface",
    duration: 220,
    closeHandler: "onClose"
  },
  {
    wxml: "components/participants-drawer/index.wxml",
    js: "components/participants-drawer/index.js",
    containerId: "qaParticipantsDrawer",
    surfaceId: "qaParticipantsSurface",
    duration: 240,
    closeHandler: "onMaskTap"
  }
];

test("activity drawers keep native page-container fallbacks without draggable-sheet or Worklet", () => {
  sheets.forEach(({ wxml: wxmlPath, js: jsPath, containerId, surfaceId, duration, closeHandler }) => {
    const wxml = read(wxmlPath);
    const surfacePath = containerId === "qaActivityFormContainer"
      ? "components/activity-form-sheet/surface.wxml"
      : containerId === "qaDateTimePickerContainer"
        ? "components/date-time-picker-sheet/surface.wxml"
        : containerId === "qaActivityTypePickerContainer"
          ? "components/activity-type-picker-sheet/surface.wxml"
          : "";
    const expandedWxml = surfacePath ? `${wxml}\n${read(surfacePath)}` : wxml;
    const js = read(jsPath);
    if (containerId === "qaActivityFormContainer") {
      assert.match(wxml, /<view class="activity-form-sheet-root [^"]*activity-form-sheet-root--route-embedded[^"]*">[\s\S]*<block wx:if="{{routeEmbedded && visible}}">/);
      assert.match(wxml, /<page-container[\s\S]*wx:if="{{!routeEmbedded && containerRendered}}"/);
    } else if (containerId === "qaDateTimePickerContainer" || containerId === "qaActivityTypePickerContainer") {
      assert.match(wxml, /<block wx:if="{{embedded && containerRendered}}">/);
      assert.match(wxml, /<page-container[\s\S]*wx:if="{{!embedded && containerRendered}}"/);
    } else {
      assert.match(wxml, /^<page-container\b/);
      assert.match(wxml, /wx:if="{{containerRendered}}"/);
    }
    assert.match(wxml, new RegExp(`id="${containerId}"`));
    assert.match(wxml, /show="{{containerVisible}}"/);
    assert.match(wxml, /position="bottom"/);
    assert.match(wxml, /overlay="{{true}}"/);
    assert.match(wxml, new RegExp(`duration="${duration}"`));
    if (containerId === "qaActivityFormContainer") {
      assert.match(js, /routeEmbedded:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/);
    }
    assert.match(wxml, /close-on-slide-down="{{false}}"/);
    assert.match(wxml, new RegExp(`bind:clickoverlay="${closeHandler}"`));
    assert.match(expandedWxml, new RegExp(`id="${surfaceId}"`));
    assert.doesNotMatch(expandedWxml, /draggable-sheet|root-portal|worklet:onsizeupdate|associative-container/);
    assert.match(js, /containerVisible:\s*false/);
    assert.match(js, /containerRendered:\s*false/);
    assert.match(js, /onContainerAfterLeave/);
    assert.doesNotMatch(js, /wx\.worklet|applyAnimatedStyle|runOnJS|skylineSheet|scrollTo\(/);
  });
});

test("page-container owns overlay, geometry and entrance animation while scroll bodies fill the inner panel", () => {
  const activityWxml = read("components/activity-form-sheet/index.wxml");
  const pickerWxml = read("components/date-time-picker-sheet/index.wxml");
  const typeWxml = read("components/activity-type-picker-sheet/index.wxml");
  const participantsWxml = read("components/participants-drawer/index.wxml");
  const activityCss = read("components/activity-form-sheet/index.wxss");
  const pickerCss = read("components/date-time-picker-sheet/index.wxss");
  const typeCss = read("components/activity-type-picker-sheet/index.wxss");
  const participantsCss = read("components/participants-drawer/index.wxss");

  [activityWxml, pickerWxml, typeWxml, participantsWxml].forEach((wxml) => {
    assert.match(wxml, /overlay-style="background: rgba\(/);
    assert.match(wxml, /custom-style="[^"]*height:/);
    assert.match(wxml, /bind:afterleave="onContainerAfterLeave"/);
  });
  assert.match(activityWxml, /custom-style="height: {{panelHeightRpx}}rpx;[^\"]*border-radius: 46\.15rpx 46\.15rpx 0 0;/);
  assert.match(activityCss, /\.activity-sheet-panel\s*\{[^}]*height:\s*100%;[^}]*max-height:\s*100%;/s);
  assert.match(activityCss, /\.activity-sheet-body\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*0;/s);
  assert.match(pickerWxml, /custom-style="height: 761\.54rpx;[^\"]*bottom: {{bottomOffsetRpx}}rpx;[^\"]*border-radius: 46\.15rpx 46\.15rpx 0 0;/);
  assert.match(typeWxml, /custom-style="height: 914rpx;[^\"]*border-radius: 48rpx 48rpx 0 0;/);
  assert.match(participantsWxml, /custom-style="height: {{drawerHeightRpx}}rpx;[^\"]*border-radius: 46\.15rpx 46\.15rpx 0 0;/);
  assert.match(participantsCss, /\.drawer-sheet\s*\{[^}]*height:\s*100%;/s);
  assert.match(participantsCss, /\.drawer-body\s*\{[^}]*flex:\s*1 1 0;[^}]*height:\s*0;[^}]*padding:\s*15\.38rpx 30\.77rpx 0;[^}]*display:\s*flex;/s);
  assert.match(participantsWxml, /<view class="drawer-table-head">[\s\S]*<scroll-view[\s\S]*id="qaParticipantListScroll"/);

  [activityCss, pickerCss, typeCss, participantsCss].forEach((wxss) => {
    assert.doesNotMatch(wxss, /@keyframes/);
  });
});

test("activity form embeds create and edit pickers in one full-height container", () => {
  const formWxml = read("components/activity-form-sheet/index.wxml");
  const listWxml = read("pages/activity_list/activity_list.wxml");
  const detailWxml = read("pages/activity_detail/activity_detail.wxml");
  assert.match(formWxml, /<activity-cover-picker-sheet[\s\S]*visible="{{coverPickerVisible}}"/);
  assert.match(formWxml, /<date-time-picker-sheet[\s\S]*visible="{{pickerVisible}}"/);
  assert.match(formWxml, /bottom-offset-rpx="{{routeEmbedded \? 323\.08 : 0}}"/);
  assert.match(listWxml, /<page-container[\s\S]*id="qaActivityCreateContainer"[\s\S]*show="{{showCreateForm}}"[\s\S]*position="bottom"/);
  assert.match(listWxml, /id="qaActivityCreateContainer"[\s\S]*custom-style="height: 100%; background: transparent; border-radius: 0; overflow: hidden;"/);
  assert.match(listWxml, /<activity-form-sheet[\s\S]*id="qaActivityCreateForm"[\s\S]*style="display: block; width: 100%; height: 100%;"[\s\S]*route-embedded="{{true}}"/);
  assert.doesNotMatch(listWxml, /qaActivityCreateDateTimePicker|createDateTimePickerVisible|external-date-time-picker/);
  assert.doesNotMatch(listWxml, /qaActivityCreateTypePicker/);
  assert.match(detailWxml, /<page-container[\s\S]*id="qaActivityEditContainer"[\s\S]*show="{{showActivityForm}}"[\s\S]*custom-style="height: 100%; background: transparent; border-radius: 0; overflow: hidden;"/);
  assert.match(detailWxml, /<activity-form-sheet[\s\S]*id="qaActivityFormSheet"[\s\S]*style="display: block; width: 100%; height: 100%;"[\s\S]*route-embedded="{{true}}"[\s\S]*mode="edit"/);
  assert.doesNotMatch(detailWxml, /qaEditDateTimePickerSheet|external-date-time-picker|bindopendatetimepicker/);
});

test("create secondary pickers stay on the same page without drawer z-index", () => {
  const formWxml = read("components/activity-form-sheet/index.wxml");
  const formJs = read("components/activity-form-sheet/index.js");
  const listWxml = read("pages/activity_list/activity_list.wxml");
  const datePickerWxml = read("components/date-time-picker-sheet/index.wxml");
  const coverPickerWxml = read("components/activity-cover-picker-sheet/index.wxml");
  assert.doesNotMatch(formJs, /suspended\(suspended\)/);
  assert.match(formWxml, /<date-time-picker-sheet[\s\S]*wx:if="{{!externalDateTimePicker}}"/);
  assert.match(formWxml, /<activity-cover-picker-sheet[\s\S]*visible="{{coverPickerVisible}}"/);
  assert.match(formWxml, /<date-time-picker-sheet[\s\S]*embedded="{{routeEmbedded}}"/);
  assert.match(formWxml, /<activity-cover-picker-sheet[\s\S]*embedded="{{routeEmbedded}}"/);
  assert.match(datePickerWxml, /<block wx:if="{{embedded && containerRendered}}">/);
  assert.match(coverPickerWxml, /<block wx:if="{{embedded && containerRendered}}">/);
  assert.doesNotMatch(coverPickerWxml, /cover-sheet-embedded-root--suspended/);
  assert.match(coverPickerWxml, /show="{{containerVisible}}"/);
  assert.match(datePickerWxml, /picker-sheet-embedded-panel \{\{containerVisible \? 'picker-sheet-embedded-panel--visible' : ''\}\}/);
  assert.match(coverPickerWxml, /cover-sheet-embedded-panel \{\{containerVisible \? 'cover-sheet-embedded-panel--visible' : ''\}\}/);
  assert.match(formWxml, /class="activity-form-sheet-dismiss-area"/);
  assert.match(formWxml, /activity-form-sheet-root--route-embedded/);
  assert.match(read("components/activity-form-sheet/index.wxss"), /\.activity-form-sheet-root--route-embedded\s*\{[^}]*height:\s*100vh;/s);
  assert.match(formWxml, /<date-time-picker-sheet[\s\S]*id="qaDateTimePickerSheet"[\s\S]*embedded="{{routeEmbedded}}"/);
  assert.doesNotMatch(listWxml, /qaActivityCreateDateTimePicker/);
  assert.doesNotMatch(listWxml, /qaActivityCreateTypePicker/);
  assert.doesNotMatch(datePickerWxml, /z-index="/);
  assert.doesNotMatch(coverPickerWxml, /z-index="/);
});

test("home opens the create form on one page, hides Tab during its lifecycle, and does not use a route", () => {
  const listJs = read("pages/activity_list/activity_list.js");
  const listWxml = read("pages/activity_list/activity_list.wxml");
  const appJson = JSON.parse(read("app.json"));

  assert.match(listJs, /showCreateModal\(\)\s*\{[\s\S]*?createFormContainerRendered:\s*true[\s\S]*?showCreateForm:\s*false[\s\S]*?wx\.nextTick\(\(\) => this\.setData\(\{ showCreateForm: true \}\)\)/);
  assert.match(listJs, /submitCreateActivity\(e\)\s*\{[\s\S]*?activityService\.createActivity\(payload\)/);
  assert.doesNotMatch(listJs, /wx\.navigateTo\(\{[\s\S]*activity_create/);
  assert.doesNotMatch(appJson.pages.join("\n"), /pages\/activity_create\/activity_create/);
  assert.match(listWxml, /id="qaActivityCreateContainer"[\s\S]*?bind:afterleave="onCreateFormAfterLeave"/);
  assert.match(listJs, /showCreateModal\(\)\s*\{[\s\S]*?_setTabBarHidden\(true\)/);
  assert.match(listJs, /onCreateFormAfterLeave\(\)\s*\{[\s\S]*?_setTabBarHidden\(false, \{ animate: true \}\)/);
  assert.match(listJs, /onShow\(\)\s*\{[\s\S]*?_setTabBarHidden\(!!\([\s\S]*?this\.data\.createFormContainerRendered[\s\S]*?this\.data\.showCreateForm[\s\S]*?this\._coldStartTabEntrancePending[\s\S]*?\)\)/);
  assert.match(listJs, /onHide\(\)\s*\{[\s\S]*?keepTabBarHidden\s*=\s*!!\([\s\S]*?this\.data\.createFormContainerRendered[\s\S]*?this\.data\.showCreateForm[\s\S]*?\)[\s\S]*?_setTabBarHidden\(keepTabBarHidden\)/);
  assert.match(listJs, /_setTabBarHidden\(hidden,[\s\S]*?app\.globalData\.tabBarHidden\s*=\s*nextHidden/);
  assert.doesNotMatch(listJs, /_syncTabBarVisibility/);
});
