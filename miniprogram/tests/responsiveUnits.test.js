const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const miniprogramDir = path.join(__dirname, "..");

function collectWxssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectWxssFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".wxss") ? [fullPath] : [];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("visual WXSS dimensions use rpx except approved px cases", () => {
  for (const file of collectWxssFiles(miniprogramDir)) {
    let source = stripComments(fs.readFileSync(file, "utf8"));
    const relative = path.relative(miniprogramDir, file);

    if (relative === path.join("pages", "history", "history.wxss")) {
      source = source
        .replace(/max-width:\s*480px;/g, "")
        .replace(/@media\s*\(min-width:\s*414px\)/g, "");
    }
    if (relative === path.join("pages", "activity_list", "activity_list.wxss")) {
      source = source.replace(/border:\s*1px dashed/g, "border: dashed");
    }
    if (relative === path.join("pages", "activity_detail", "activity_detail.wxss")) {
      source = source.replace(/radial-gradient\(circle\s+420px\s+at/g, "radial-gradient(circle at");
    }
    if (relative === path.join("custom-tab-bar", "index.wxss")) {
      const fixedTabPixelValues = source.match(/(?:top|width|height|font-size|line-height|border-radius):\s*\d+px;|padding:\s*\d+px\s+7\.69231rpx;/g) || [];
      assert.deepEqual(
        fixedTabPixelValues,
        [
          "height: 52px;",
          "padding: 4px 7.69231rpx;",
          "border-radius: 26px;",
          "height: 44px;",
          "border-radius: 22px;",
          "height: 44px;",
          "width: 34px;",
          "height: 26px;",
          "border-radius: 8px;",
          "width: 16px;",
          "height: 16px;",
          "top: 5px;",
          "width: 18px;",
          "height: 18px;",
          "width: 18px;",
          "height: 18px;",
          "top: 25px;",
          "height: 14px;",
          "font-size: 10px;",
          "line-height: 14px;"
        ],
        "custom tab vertical geometry must use the exact Pencil pixel values"
      );
      source = source.replace(/(?:top|width|height|font-size|line-height|border-radius):\s*\d+px;|padding:\s*\d+px\s+7\.69231rpx;/g, "");
    }

    assert.doesNotMatch(
      source,
      /(^|[^a-zA-Z])[-+]?(?:\d+(?:\.\d*)?|\.\d+)px\b/m,
      `${relative} contains an unapproved visual px value`
    );
  }
});

test("calendar timeline keeps rpx rendering aligned with px scroll coordinates", () => {
  const js = fs.readFileSync(path.join(miniprogramDir, "pages/activity_calendar/activity_calendar.js"), "utf8");
  const wxml = fs.readFileSync(path.join(miniprogramDir, "pages/activity_calendar/activity_calendar.wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(miniprogramDir, "pages/activity_calendar/activity_calendar.wxss"), "utf8");

  assert.match(js, /const HOUR_HEIGHT_RPX = 115\.38;/);
  assert.match(js, /const TIMELINE_DEFAULT_SCROLL_TOP_RPX = 946\.15385;/);
  assert.match(js, /`top:\$\{topRpx\}rpx`/);
  assert.match(js, /`height:\$\{heightRpx\}rpx`/);
  assert.match(js, /this\._hourHeightPx = \(HOUR_HEIGHT_RPX \/ 750\) \* winW;/);
  assert.match(wxml, /top: calc\(\{\{statusBarHeight\}\}px \+ 84\.61538rpx\)/);
  assert.match(wxml, /top: calc\(\{\{statusBarHeight\}\}px \+ 221\.15385rpx\)/);
  assert.ok(
    wxml.indexOf('class="timeline-sticky-header"') < wxml.indexOf('class="timeline-above-scroll-gap"') &&
      wxml.indexOf('class="timeline-above-scroll-gap"') < wxml.indexOf('class="timeline-grid-body"'),
    "calendar's 12px gap must sit between the date header and the time grid"
  );
  assert.match(wxss, /\.week-strip\s*\{[\s\S]*?height:\s*136\.53846rpx;/);
  assert.match(wxss, /\.week-strip-page\s*\{[\s\S]*?height:\s*136\.53846rpx;[\s\S]*?padding:\s*0 46\.15385rpx 15\.38462rpx;/);
  assert.match(wxss, /\.week-day-strip\s*\{[\s\S]*?width:\s*69\.23077rpx;[\s\S]*?gap:\s*11\.53846rpx;/);
  assert.match(
    wxss,
    /\.timeline-days-clip\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-width:\s*0;/,
    "the moving day strip must fill only the space to the right of the fixed time axis"
  );
  assert.match(wxss, /\.time-axis-head\s*\{[\s\S]*?width:\s*96\.15385rpx;[\s\S]*?height:\s*94\.23077rpx;/);
  assert.match(wxss, /\.day-titles-strip-cell\s*\{[\s\S]*?height:\s*94\.23077rpx;/);
  assert.match(wxss, /\.timeline-above-scroll-gap\s*\{[\s\S]*?height:\s*23\.08rpx;/);
  assert.match(wxss, /\.hour-text\s*\{[\s\S]*?top:\s*-14\.42308rpx;[\s\S]*?width:\s*73\.07692rpx;/);
  assert.match(wxss, /\.calendar-event\s*\{[\s\S]*?box-shadow:/);
  assert.match(wxss, /\.hour-row\s*\{[\s\S]*?height:\s*115\.38rpx;/);
  assert.match(wxss, /\.grid-hour\s*\{[\s\S]*?height:\s*115\.38rpx;/);
});
