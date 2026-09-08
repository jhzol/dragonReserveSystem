function syncTabBarModalMask(visible) {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const currentPage = pages.length ? pages[pages.length - 1] : null;
  const tabBar = currentPage && typeof currentPage.getTabBar === "function"
    ? currentPage.getTabBar()
    : null;
  if (tabBar && typeof tabBar.setModalMaskVisible === "function") {
    tabBar.setModalMaskVisible(visible);
  }
}

Component({
  data: {
    visible: false,
    type: "",
    title: "",
    message: "",
    confirmText: "",
    confirmBehavior: "navigate"
  },

  methods: {
    open(options = {}) {
      this.setData({
        visible: true,
        type: String(options.type || "permission"),
        title: String(options.title || "暂无创建权限"),
        message: String(options.message || "当前账号没有创建活动的权限。"),
        confirmText: String(options.confirmText || "去我的"),
        confirmBehavior: options.confirmBehavior === "emit" ? "emit" : "navigate"
      });
      syncTabBarModalMask(true);
    },

    close() {
      this.setData({ visible: false });
      syncTabBarModalMask(false);
    },

    stopPropagation() {},

    stopTouchMove() {},

    confirm() {
      const type = String(this.data.type || "permission");
      const confirmBehavior = String(this.data.confirmBehavior || "navigate");
      this.setData({ visible: false });
      syncTabBarModalMask(false);

      if (confirmBehavior === "emit") {
        this.triggerEvent("confirm", { type });
        return;
      }

      const app = getApp();
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const currentPage = pages.length ? pages[pages.length - 1] : null;
      const currentRoute = currentPage && currentPage.route ? String(currentPage.route) : "";

      if (currentRoute === "pages/profile/profile") {
        if (type === "login" && typeof currentPage.startRegister === "function") {
          currentPage.startRegister();
        } else if (type === "permission" && typeof currentPage.openPermissionModal === "function") {
          currentPage.openPermissionModal();
        }
        return;
      }

      if (app && app.globalData) {
        app.globalData.pendingCreateAccessAction = type;
        app.globalData.tabBarSelected = 3;
      }
      wx.switchTab({
        url: "/pages/profile/profile",
        fail: () => {
          if (app && app.globalData) app.globalData.pendingCreateAccessAction = "";
        }
      });
    }
  }
});
