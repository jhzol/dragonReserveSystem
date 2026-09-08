const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const componentPath = path.join(__dirname, "../components/create-access-dialog/index.js");

test("create access dialog buttons close and route to the requested Profile action", () => {
  const previousGlobals = {
    Component: global.Component,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx
  };
  let definition;
  let switchedUrl = "";
  let permissionModalCalls = 0;
  let loginCalls = 0;
  let emittedConfirm = null;
  const tabMaskCalls = [];
  const tabBar = {
    setModalMaskVisible(visible, opacity) {
      tabMaskCalls.push({ visible, opacity });
    }
  };
  let currentPage = {
    route: "pages/activity_list/activity_list",
    getTabBar() { return tabBar; }
  };
  const app = {
    globalData: {
      pendingCreateAccessAction: "",
      tabBarSelected: 0
    }
  };

  try {
    global.Component = (value) => { definition = value; };
    global.getApp = () => app;
    global.getCurrentPages = () => [currentPage];
    global.wx = {
      switchTab({ url }) { switchedUrl = url; }
    };
    delete require.cache[require.resolve(componentPath)];
    require(componentPath);

    const ctx = {
      data: {
        visible: false,
        type: "",
        title: "",
        message: "",
      confirmText: "",
      confirmBehavior: "navigate"
      },
      setData(patch) { Object.assign(this.data, patch); },
      triggerEvent(name, detail) { emittedConfirm = { name, detail }; }
    };

    definition.methods.open.call(ctx, {
      type: "permission",
      title: "暂无创建权限",
      message: "当前账号为游客。",
      confirmText: "去获取权限"
    });
    assert.equal(ctx.data.visible, true);
    assert.deepEqual(tabMaskCalls.at(-1), { visible: true, opacity: undefined });
    definition.methods.close.call(ctx);
    assert.equal(ctx.data.visible, false, "取消按钮必须立即关闭弹窗");
    assert.deepEqual(tabMaskCalls.at(-1), { visible: false, opacity: undefined });

    definition.methods.open.call(ctx, {
      type: "permission",
      title: "暂无创建权限",
      message: "当前账号为游客。",
      confirmText: "去获取权限"
    });
    definition.methods.confirm.call(ctx);
    assert.equal(ctx.data.visible, false);
    assert.deepEqual(tabMaskCalls.at(-1), { visible: false, opacity: undefined });
    assert.equal(switchedUrl, "/pages/profile/profile", "去获取权限必须切换到我的页面");
    assert.equal(app.globalData.pendingCreateAccessAction, "permission");
    assert.equal(app.globalData.tabBarSelected, 3);

    currentPage = {
      route: "pages/profile/profile",
      getTabBar() { return tabBar; },
      openPermissionModal() { permissionModalCalls += 1; },
      startRegister() { loginCalls += 1; }
    };
    ctx.data.type = "permission";
    definition.methods.confirm.call(ctx);
    assert.equal(permissionModalCalls, 1, "已在我的页面时应直接打开获取权限弹窗");

    ctx.data.type = "login";
    definition.methods.confirm.call(ctx);
    assert.equal(loginCalls, 1, "未登录状态应直接进入登录流程");

    definition.methods.open.call(ctx, {
      type: "cancelActivity",
      title: "确认取消活动？",
      message: "取消后将无法报名和签到。",
      confirmText: "确认取消",
      confirmBehavior: "emit"
    });
    definition.methods.confirm.call(ctx);
    assert.deepEqual(emittedConfirm, {
      name: "confirm",
      detail: { type: "cancelActivity" }
    }, "业务确认弹窗应发出事件，不执行页面跳转");
    assert.equal(switchedUrl, "/pages/profile/profile");
  } finally {
    delete require.cache[require.resolve(componentPath)];
    for (const [key, value] of Object.entries(previousGlobals)) {
      if (value === undefined) delete global[key];
      else global[key] = value;
    }
  }
});
