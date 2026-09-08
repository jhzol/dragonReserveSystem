const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const toolsDir = path.join(__dirname, "../pages/tools");
const imageDir = path.join(__dirname, "../images");
const toolsPagePath = path.join(toolsDir, "tools.js");

function loadToolsPageDefinition() {
  const previousPage = global.Page;
  let definition;
  try {
    global.Page = (value) => { definition = value; };
    delete require.cache[require.resolve(toolsPagePath)];
    require(toolsPagePath);
  } finally {
    if (previousPage === undefined) delete global.Page;
    else global.Page = previousPage;
  }
  return definition;
}

test("tools page geometry and typography follow the current Pencil frame", () => {
  const wxml = fs.readFileSync(path.join(toolsDir, "tools.wxml"), "utf8");
  const wxss = fs.readFileSync(path.join(toolsDir, "tools.wxss"), "utf8");

  assert.match(wxml, /class="tools-watermark"[^>]*activity-home-logo\.png/);
  assert.doesNotMatch(wxml, /class="tools-logo"/);
  assert.match(wxss, /\.tools-watermark\s*{[\s\S]*?top:\s*-55\.76923rpx;[\s\S]*?left:\s*336\.53846rpx;[\s\S]*?width:\s*621\.15385rpx;[\s\S]*?height:\s*405\.76923rpx;[\s\S]*?opacity:\s*0\.8/);
  assert.match(wxss, /\.tools-navbar-inner\s*{[\s\S]*?height:\s*84\.61538rpx/);
  assert.match(wxss, /\.tools-title\s*{[\s\S]*?color:\s*#000000;[\s\S]*?font-size:\s*46\.15385rpx;[\s\S]*?font-weight:\s*600/);
  assert.match(wxss, /\.tools-list\s*{[\s\S]*?margin-top:\s*53\.84615rpx;[\s\S]*?padding:\s*0 38\.46rpx;[\s\S]*?gap:\s*23\.08rpx/);
  assert.match(wxss, /\.tool-card\s*{[\s\S]*?height:\s*276\.92rpx;[\s\S]*?padding:\s*38\.46rpx 34\.62rpx;[\s\S]*?gap:\s*30\.76923rpx;[\s\S]*?border-radius:\s*38\.46rpx/);
  assert.match(wxss, /\.tool-card-icon--boardgame\s*{[\s\S]*?background:\s*#fff4d6/);
  assert.match(wxss, /\.tool-card-icon--chwazi\s*{[\s\S]*?background:\s*#e9f7f3/);
  assert.match(wxss, /\.tool-card-title\s*{[\s\S]*?color:\s*#171a24;[\s\S]*?font-size:\s*34\.62rpx;[\s\S]*?font-weight:\s*700/);
  assert.match(wxss, /\.tool-card-description\s*{[\s\S]*?color:\s*#667085;[\s\S]*?font-size:\s*25rpx/);
});

test("tools page inherits the runtime system font", () => {
  const wxss = fs.readFileSync(path.join(toolsDir, "tools.wxss"), "utf8");
  assert.doesNotMatch(wxss, /font-family\s*:/);
});

test("tools page uses the Pencil Lucide icon sizes and colors", () => {
  const dice = fs.readFileSync(path.join(imageDir, "icon-dice-5.svg"), "utf8");
  const hand = fs.readFileSync(path.join(imageDir, "icon-hand.svg"), "utf8");
  const arrow = fs.readFileSync(path.join(imageDir, "icon-arrow-up-right.svg"), "utf8");

  assert.match(dice, /width="30" height="30"/);
  assert.match(dice, /stroke="#C98518"/);
  assert.match(hand, /width="30" height="30"/);
  assert.match(hand, /stroke="#129A7B"/);
  assert.match(hand, /M18 11V6a2 2 0 0 0-2-2/);
  assert.match(arrow, /width="22" height="22"/);
  assert.match(arrow, /stroke="#98A2B3"/);
  assert.match(arrow, /stroke-width="2"/);
  assert.match(arrow, /M7 7h10v10/);
});

test("tools cards keep their existing toast and Chwazi navigation behavior", () => {
  const previousWx = global.wx;
  const calls = [];
  global.wx = {
    showToast(options) { calls.push(["toast", options]); },
    navigateTo(options) { calls.push(["navigate", options]); }
  };
  try {
    const page = loadToolsPageDefinition();
    page.onBoardGameTap();
    page.onChwaziTap();
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }

  assert.equal(calls[0][0], "toast");
  assert.equal(calls[0][1].title, "黑黑正在做，别催");
  assert.deepEqual(calls[1], ["navigate", { url: "/pages/chwazi/chwazi" }]);
});
