const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageNames = ["activity_list", "tools", "history", "profile"];
const pageRoot = path.join(__dirname, "../pages");

function readPage(name, extension) {
  return fs.readFileSync(path.join(pageRoot, name, `${name}.${extension}`), "utf8");
}

function assertBalancedMarkup(source, name) {
  const stack = [];
  const tags = source.match(/<\/?[a-z-]+\b[^>]*>/g) || [];
  for (const tag of tags) {
    const tagName = tag.match(/^<\/?([a-z-]+)/)[1];
    if (tag.startsWith("</")) {
      assert.equal(stack.pop(), tagName, `${name}: unexpected closing tag ${tag}`);
    } else if (!tag.endsWith("/>")) {
      stack.push(tagName);
    }
  }
  assert.deepEqual(stack, [], `${name}: markup must be balanced`);
}

test("all four tab pages explicitly use Skyline and local scrolling", () => {
  for (const name of pageNames) {
    const pageJson = JSON.parse(readPage(name, "json"));
    const wxml = readPage(name, "wxml");
    assert.equal(pageJson.renderer, "skyline", `${name} renderer`);
    assert.equal(pageJson.componentFramework, "glass-easel", `${name} framework`);
    assert.equal(pageJson.navigationStyle, "custom", `${name} navigation`);
    assert.equal(pageJson.disableScroll, true, `${name} page scrolling`);
    assert.match(wxml, /<scroll-view\b[^>]*\bscroll-y\b/, `${name} needs a local vertical scroll-view`);
    assertBalancedMarkup(wxml, name);
  }
});

test("newly migrated tab pages avoid WebView-only layout rules", () => {
  for (const name of ["tools", "history", "profile"]) {
    const js = readPage(name, "js");
    const wxss = readPage(name, "wxss");
    assert.doesNotMatch(js, /\bonPageScroll\s*\(/, `${name} must not use page scroll callbacks`);
    assert.doesNotMatch(wxss, /position\s*:\s*sticky\b/);
    assert.doesNotMatch(wxss, /display\s*:\s*grid\b/);
    assert.doesNotMatch(wxss, /overflow(?:-x|-y)?\s*:\s*(?:auto|scroll)\b/);
    assert.doesNotMatch(wxss, /white-space\s*:\s*(?:pre|pre-line|pre-wrap)\b/);
    assert.doesNotMatch(wxss, /will-change\s*:\s*transform\b/);
  }
});

test("profile form and prompt dialogs keep native inputs in non-collapsing containers", () => {
  const wxml = readPage("profile", "wxml");
  assert.equal((wxml.match(/<view class="modal-body">/g) || []).length, 1);
  assert.doesNotMatch(wxml, /<scroll-view class="modal-body"/);
  assert.match(wxml, /<view[\s\S]*?class="permission-dialog"[\s\S]*?<input[\s\S]*?value="\{\{permissionInput\}\}"[\s\S]*?bindinput="onPermissionInput"/);
});

test("four tab routes and component indexes are contiguous and exclude calendar", () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../app.json"), "utf8"));
  const componentWxml = fs.readFileSync(
    path.join(__dirname, "../custom-tab-bar/index.wxml"),
    "utf8"
  );
  assert.deepEqual(
    appJson.tabBar.list.map((item) => item.pagePath),
    [
      "pages/activity_list/activity_list",
      "pages/tools/tools",
      "pages/history/history",
      "pages/profile/profile",
    ]
  );
  assert.doesNotMatch(componentWxml, /qa-tab-calendar|>日程<|data-index="4"/);
  assert.deepEqual(
    [...componentWxml.matchAll(/data-index="(\d)"/g)].map((match) => Number(match[1])),
    [0, 1, 2, 3]
  );
});
