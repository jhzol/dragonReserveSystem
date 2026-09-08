const { patchTabBarIfNeeded } = require("../../utils/tabBarSync");
const { getBottomSafeAreaRpx } = require("../../utils/safeArea");

Page({
  data: {
    statusBarHeight: 0,
    bottomSafeAreaRpx: 0
  },

  onLoad() {
    let statusBarHeight = 0;
    try {
      const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
      statusBarHeight = Number(info.statusBarHeight) || 0;
    } catch (e) {}
    this.setData({ statusBarHeight });
  },

  onShow() {
    this.setData({ bottomSafeAreaRpx: getBottomSafeAreaRpx() });
    patchTabBarIfNeeded(this, { selected: 1 });
  },

  onBoardGameTap() {
    wx.showToast({
      title: "黑黑正在做，别催",
      icon: "none",
      duration: 1800
    });
  },

  onChwaziTap() {
    wx.navigateTo({ url: "/pages/chwazi/chwazi" });
  }
});
