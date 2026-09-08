const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageDir = path.join(__dirname, "../pages/profile");
const wxml = fs.readFileSync(path.join(pageDir, "profile.wxml"), "utf8");
const wxss = fs.readFileSync(path.join(pageDir, "profile.wxss"), "utf8");
const js = fs.readFileSync(path.join(pageDir, "profile.js"), "utf8");

test("permission dialogs use the prototype prompt and danger variants", () => {
  assert.match(wxml, /id="qa-add-permission-dialog"[\s\S]*?dialog-prompt\.svg[\s\S]*?添加权限/);
  assert.match(wxml, /id="qa-add-permission-input"[\s\S]*?bindinput="onPermissionInput"[\s\S]*?bindconfirm="submitPermission"/);
  assert.match(wxml, /id="qa-delete-permission-dialog"[\s\S]*?dialog-danger\.svg[\s\S]*?确认删除权限？/);
  assert.match(wxml, /permission-dialog-button--danger[\s\S]*?确认删除/);
  assert.doesNotMatch(js, /removePermission\(\)\s*\{\s*wx\.showModal/);
});

test("permission dialog dimensions and colors match the shared modal specification", () => {
  assert.match(wxss, /\.permission-dialog\s*\{[\s\S]*?padding:\s*38\.46154rpx[\s\S]*?gap:\s*30\.76923rpx[\s\S]*?border-radius:\s*30\.76923rpx[\s\S]*?box-shadow:\s*0 19\.23077rpx 53\.84615rpx rgba\(0, 0, 0, 0\.15\)/);
  assert.match(wxss, /\.permission-dialog-input\s*\{[\s\S]*?height:\s*84\.61538rpx[\s\S]*?border-radius:\s*23\.07692rpx[\s\S]*?background:\s*#f5f5f5/);
  assert.match(wxss, /\.permission-dialog-button--danger\s*\{[\s\S]*?background:\s*#ef4444/);
  assert.match(fs.readFileSync(path.join(__dirname, "../images/dialog-danger.svg"), "utf8"), /stroke="#DC2626"/);
});

test("permission dialog actions keep input validation, service calls, and tab masking", () => {
  assert.match(js, /openPermissionModal\(\)\s*\{[\s\S]*?showPermissionModal:\s*true[\s\S]*?syncProfileTabBarModalMask\(this, true\)/);
  assert.match(js, /submitPermission\(\)\s*\{[\s\S]*?请输入邀请码[\s\S]*?userService\.updateMyRole\(input\)/);
  assert.match(js, /removePermission\(\)\s*\{[\s\S]*?showDeletePermissionModal:\s*true[\s\S]*?syncProfileTabBarModalMask\(this, true\)/);
  assert.match(js, /confirmDeletePermission\(\)\s*\{[\s\S]*?userService\.clearMyRole\(\)[\s\S]*?showDeletePermissionModal:\s*false[\s\S]*?syncProfileTabBarModalMask\(this, false\)/);
});

test("permission prompt and danger actions execute their real page handlers", async () => {
  const pagePath = path.join(pageDir, "profile.js");
  const userService = require(path.join(__dirname, "../services/user"));
  const previousGlobals = {
    Page: global.Page,
    getApp: global.getApp,
    wx: global.wx
  };
  const originalUpdateMyRole = userService.updateMyRole;
  const originalClearMyRole = userService.clearMyRole;
  let pageDefinition;
  let updatedInviteCode = "";
  let clearCalls = 0;
  const masks = [];
  const toasts = [];
  const app = {
    globalData: {},
    applyCurrentUser() {}
  };

  try {
    global.Page = (definition) => { pageDefinition = definition; };
    global.getApp = () => app;
    global.wx = {
      nextTick(callback) { callback(); },
      showToast(options) { toasts.push(options); }
    };
    userService.updateMyRole = (input) => {
      updatedInviteCode = input;
      return Promise.resolve({ id: 1 });
    };
    userService.clearMyRole = () => {
      clearCalls += 1;
      return Promise.resolve({ id: 1 });
    };
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);

    const ctx = {
      data: {
        showPermissionModal: false,
        showDeletePermissionModal: false,
        permissionInput: "",
        permissionSubmitting: false,
        permissionRemoving: false,
        isGuest: false
      },
      setData(patch) { Object.assign(this.data, patch); },
      getTabBar() {
        return {
          setModalMaskVisible(visible, opacity) { masks.push({ visible, opacity }); }
        };
      }
    };

    pageDefinition.openPermissionModal.call(ctx);
    assert.equal(ctx.data.showPermissionModal, true);
    assert.deepEqual(masks.at(-1), { visible: true, opacity: undefined });

    pageDefinition.submitPermission.call(ctx);
    assert.equal(toasts.at(-1).title, "请输入邀请码");

    ctx.data.permissionInput = "  guild-code  ";
    pageDefinition.submitPermission.call(ctx);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(updatedInviteCode, "guild-code");
    assert.equal(ctx.data.showPermissionModal, false);
    assert.equal(ctx.data.isGuest, false);

    pageDefinition.removePermission.call(ctx);
    assert.equal(ctx.data.showDeletePermissionModal, true);
    pageDefinition.closeDeletePermissionModal.call(ctx);
    assert.equal(ctx.data.showDeletePermissionModal, false);

    pageDefinition.removePermission.call(ctx);
    pageDefinition.confirmDeletePermission.call(ctx);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(clearCalls, 1);
    assert.equal(ctx.data.showDeletePermissionModal, false);
    assert.equal(ctx.data.isGuest, true);
    assert.deepEqual(masks.at(-1), { visible: false, opacity: undefined });
  } finally {
    userService.updateMyRole = originalUpdateMyRole;
    userService.clearMyRole = originalClearMyRole;
    delete require.cache[require.resolve(pagePath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});
