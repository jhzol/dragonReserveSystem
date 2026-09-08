const TAB_GLASS_TUNING = Object.freeze({
  // 微信模糊算法与 Pencil 视觉强度不同，按当前实机观感使用 12rpx
  blurRadiusRpx: 12,
  blurLayerOpacity: 1,
  whiteFillOpacity: 0.4
});

const ACTIVITY_LIST_ROUTE = "pages/activity_list/activity_list";
const { getBottomSafeAreaRpx, getWindowInfoCompat } = require("../utils/safeArea");

const TAB_URLS = [
  "/pages/activity_list/activity_list",
  "/pages/tools/tools",
  "/pages/history/history",
  "/pages/profile/profile"
];

function getCurrentTabState() {
  try {
    const pages = getCurrentPages();
    const top = pages[pages.length - 1];
    const route = top && top.route ? String(top.route) : "";
    return {
      route,
      selected: route ? TAB_URLS.indexOf(`/${route}`) : -1
    };
  } catch (e) {
    return { route: "", selected: -1 };
  }
}

function setGlobalTabSelected(selected) {
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.tabBarSelected = selected;
  } catch (e) {}
}

function canCreateActivity(app) {
  const globalData = app && app.globalData ? app.globalData : {};
  const role = String(globalData.userRole || "");
  const token = String(globalData.accessToken || "");
  return !!globalData.isAuthenticated && !!token && (role === "user" || role === "admin");
}

function getCreateAccessDialog(app) {
  const globalData = app && app.globalData ? app.globalData : {};
  const role = String(globalData.userRole || "");
  const token = String(globalData.accessToken || "");
  if (!token) {
    return {
      type: "login",
      title: "尚未登录",
      message: "登录后才能新建活动。",
      confirmText: "去登录"
    };
  }
  if (role === "guest" || !globalData.isAuthenticated) {
    return {
      type: "permission",
      title: "暂无创建权限",
      message: "当前账号为游客，请先获取访问权限后再新建活动。",
      confirmText: "去获取权限"
    };
  }
  return {
    type: "permission",
    title: "暂无创建权限",
    message: "当前账号没有创建活动的权限，请前往「我的」页面查看。",
    confirmText: "去我的"
  };
}

function getGlobalTabHidden() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.tabBarHidden);
  } catch (e) {
    return false;
  }
}

function getGlobalHomeTabEntrancePending() {
  try {
    const app = getApp();
    return !!(app && app.globalData && app.globalData.homeTabEntrancePending);
  } catch (e) {
    return false;
  }
}

function setGlobalTabHidden(hidden) {
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.tabBarHidden = !!hidden;
  } catch (e) {}
}

function shouldKeepTabHidden(route) {
  /*
   * 自定义 TabBar 可能比页面栈更早 attached。此时 route 为空，不能把它解释为
   * “非首页”并提前显示，否则首页 onLoad 随后再隐藏时会产生一次可见闪帧。
   */
  if (!route) return true;
  return route === ACTIVITY_LIST_ROUTE &&
    (getGlobalTabHidden() || getGlobalHomeTabEntrancePending());
}

function vibrateTabSelection() {
  if (typeof wx === "undefined" || typeof wx.vibrateShort !== "function") return;
  const fallback = () => {
    try { wx.vibrateShort(); } catch (e) {}
  };
  try {
    wx.vibrateShort({ type: "light", fail: fallback });
  } catch (e) {
    fallback();
  }
}

function getBottomSafeAreaCssPx() {
  const info = getWindowInfoCompat();
  const windowWidth = Number(info && info.windowWidth);
  if (!(windowWidth > 0)) return 0;
  return Math.round(getBottomSafeAreaRpx() * windowWidth / 750 * 100) / 100;
}

function syncSelectedFromCurrentRoute(component) {
  const state = getCurrentTabState();
  if (state.selected < 0) return state;
  setGlobalTabSelected(state.selected);
  if (Number(component.data.selected) !== state.selected) {
    component.setData({ selected: state.selected });
  }
  return state;
}

Component({
  lifetimes: {
    attached() {
      const state = syncSelectedFromCurrentRoute(this);
      this.syncBottomSafeArea();
      const shouldHide = shouldKeepTabHidden(state.route);
      if (this.data.hidden !== shouldHide) {
        this.setData({ hidden: shouldHide, entering: false });
      }
      if (state.selected >= 0) return;
      try {
        const app = getApp();
        const selected = app && app.globalData && Number(app.globalData.tabBarSelected);
        if (Number.isInteger(selected) && selected !== Number(this.data.selected)) {
          this.setData({ selected });
        }
      } catch (e) {}
    },

    detached() {
      if (this._tabEnterStartTimer) clearTimeout(this._tabEnterStartTimer);
      this._tabEnterStartTimer = null;
    }
  },

  data: {
    selected: 0,
    isAdmin: false,
    /** 供全屏弹层控制；重新显示时可选择执行一次自底向上的入场。 */
    hidden: true,
    entering: false,
    tabGlassBlurRadiusRpx: TAB_GLASS_TUNING.blurRadiusRpx,
    tabGlassBlurOpacity: TAB_GLASS_TUNING.blurLayerOpacity,
    tabGlassFillOpacity: TAB_GLASS_TUNING.whiteFillOpacity,
    safeBottomPx: 0,
    modalMaskVisible: false,
    modalMaskOpacity: 0.4
  },

  pageLifetimes: {
    show() {
      this.syncBottomSafeArea();
      const { route } = syncSelectedFromCurrentRoute(this);
      const shouldHide = shouldKeepTabHidden(route);
      if (this.data.hidden !== shouldHide) {
        this.setData({ hidden: shouldHide, entering: false });
      }

      const isAdmin = getApp().globalData.userRole === "admin";
      if (this.data.isAdmin !== isAdmin) {
        this.setData({ isAdmin });
      }
    }
  },

  methods: {
    setHidden(hidden, { animate = false } = {}) {
      const nextHidden = !!hidden;
      setGlobalTabHidden(nextHidden);
      if (this._tabEnterStartTimer) {
        clearTimeout(this._tabEnterStartTimer);
        this._tabEnterStartTimer = null;
      }

      if (nextHidden) {
        if (!this.data.hidden || this.data.entering) {
          this.setData({ hidden: true, entering: false });
        }
        return;
      }

      if (!animate) {
        if (this.data.hidden || this.data.entering) {
          this.setData({ hidden: false, entering: false });
        }
        return;
      }

      this.setData({ hidden: false, entering: true }, () => {
        const startEntrance = () => {
          this._tabEnterStartTimer = setTimeout(() => {
            this._tabEnterStartTimer = null;
            if (!this.data.hidden) this.setData({ entering: false });
          }, 16);
        };
        if (typeof wx !== "undefined" && typeof wx.nextTick === "function") wx.nextTick(startEntrance);
        else startEntrance();
      });
    },

    syncBottomSafeArea() {
      const safeBottomPx = getBottomSafeAreaCssPx();
      if (safeBottomPx !== Number(this.data.safeBottomPx)) {
        this.setData({ safeBottomPx });
      }
    },

    setGlassTuning({ blurRadiusRpx, blurLayerOpacity, whiteFillOpacity } = {}) {
      const patch = {};
      if (Number.isFinite(Number(blurRadiusRpx))) {
        patch.tabGlassBlurRadiusRpx = Math.max(0, Number(blurRadiusRpx));
      }
      if (Number.isFinite(Number(blurLayerOpacity))) {
        patch.tabGlassBlurOpacity = Math.min(1, Math.max(0, Number(blurLayerOpacity)));
      }
      if (Number.isFinite(Number(whiteFillOpacity))) {
        patch.tabGlassFillOpacity = Math.min(1, Math.max(0, Number(whiteFillOpacity)));
      }
      if (Object.keys(patch).length) this.setData(patch);
    },

    setModalMaskVisible(visible, opacity = 0.4) {
      const nextVisible = !!visible;
      const nextOpacity = Math.min(1, Math.max(0, Number(opacity) || 0.4));
      if (this.data.modalMaskVisible === nextVisible && this.data.modalMaskOpacity === nextOpacity) return;
      this.setData({
        modalMaskVisible: nextVisible,
        modalMaskOpacity: nextOpacity
      });
    },

    blockTabInteraction() {},

    onTabTap(e) {
      const index = Number.parseInt(e.currentTarget.dataset.index, 10);
      if (!TAB_URLS[index] || index === this.data.selected) return;

      const previousSelected = Number(this.data.selected);
      setGlobalTabSelected(index);
      wx.switchTab({
        url: TAB_URLS[index],
        success: vibrateTabSelection,
        fail: () => setGlobalTabSelected(previousSelected)
      });
    },

    onCreateActivityTap() {
      const app = getApp();
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const currentPage = pages.length ? pages[pages.length - 1] : null;
      if (!canCreateActivity(app)) {
        const dialog = getCreateAccessDialog(app);
        const dialogComponent = currentPage && typeof currentPage.selectComponent === "function"
          ? currentPage.selectComponent("#create-access-dialog")
          : null;
        if (dialogComponent && typeof dialogComponent.open === "function") {
          dialogComponent.open(dialog);
        }
        return;
      }

      const currentRoute = currentPage && currentPage.route ? String(currentPage.route) : "";
      if (currentRoute === ACTIVITY_LIST_ROUTE && typeof currentPage.showCreateModal === "function") {
        app.globalData.pendingOpenCreateActivity = false;
        currentPage.showCreateModal();
        return;
      }

      app.globalData.pendingOpenCreateActivity = true;
      setGlobalTabHidden(true);
      setGlobalTabSelected(0);
      wx.switchTab({
        url: TAB_URLS[0],
        fail: () => {
          app.globalData.pendingOpenCreateActivity = false;
          setGlobalTabHidden(false);
        }
      });
    }
  }
});
