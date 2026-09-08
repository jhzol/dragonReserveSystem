const { takeActivityCoverPreviewSession } = require("../../utils/activityCoverPreviewSession");

const RETURN_TRANSITION_COMMIT_MS = 34;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function wrapPreviewIndex(index, length) {
  const count = Math.max(0, Number(length) || 0);
  if (!count) return 0;
  return ((Number(index) || 0) % count + count) % count;
}

function getPreviewNavigationMetrics(windowInfo, menuButtonRect) {
  const statusBarHeight = Math.max(0, finiteNumber(windowInfo && windowInfo.statusBarHeight) || 20);
  const menuTop = finiteNumber(menuButtonRect && menuButtonRect.top);
  const menuHeight = finiteNumber(menuButtonRect && menuButtonRect.height);
  let titleBarHeight = 44;

  if (menuTop !== null && menuHeight !== null && menuHeight > 0 && menuTop >= statusBarHeight) {
    titleBarHeight = Math.max(menuHeight, (menuTop - statusBarHeight) * 2 + menuHeight);
  }

  return {
    previewStatusBarHeightPx: Math.round(statusBarHeight * 100) / 100,
    previewTitleBarHeightPx: Math.round(titleBarHeight * 100) / 100,
    previewNavBarHeightPx: Math.round((statusBarHeight + titleBarHeight) * 100) / 100
  };
}

Page({
  data: {
    previewArtist: { artworks: [] },
    previewArtwork: null,
    previewArtworkIndex: 0,
    previewStatusBarHeightPx: 44,
    previewTitleBarHeightPx: 44,
    previewNavBarHeightPx: 88
  },

  onLoad() {
    let windowInfo = {};
    let menuButtonRect = {};
    try {
      windowInfo = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
      menuButtonRect = typeof wx.getMenuButtonBoundingClientRect === "function"
        ? wx.getMenuButtonBoundingClientRect()
        : {};
    } catch (error) {}

    const session = takeActivityCoverPreviewSession();
    const artist = session && session.artist;
    const artworkIndex = Math.max(0, Number(session && session.artworkIndex) || 0);
    const artwork = artist && artist.artworks && artist.artworks[artworkIndex];
    if (!artist || !artwork) {
      wx.showToast({ title: "封面预览已失效", icon: "none" });
      wx.nextTick(() => wx.navigateBack());
      return;
    }

    this._openerEventChannel = typeof this.getOpenerEventChannel === "function"
      ? this.getOpenerEventChannel()
      : null;
    this.setData({
      ...getPreviewNavigationMetrics(windowInfo, menuButtonRect),
      previewArtist: artist,
      previewArtwork: artwork,
      previewArtworkIndex: artworkIndex
    });
  },

  closePreview() {
    this.closeWithoutReturnTransition();
  },

  closeWithoutReturnTransition(beforeBack) {
    if (this._closeTimer) return;
    if (this._openerEventChannel && typeof this._openerEventChannel.emit === "function") {
      this._openerEventChannel.emit("disableActivityCoverPreviewReturnTransition");
    }
    this._closeTimer = setTimeout(() => {
      this._closeTimer = null;
      if (typeof beforeBack === "function") beforeBack();
      wx.navigateBack();
    }, RETURN_TRANSITION_COMMIT_MS);
  },

  onUnload() {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
  },

  onPreviewChange(e) {
    const current = Number(e.detail && e.detail.current) || 0;
    const artist = this.data.previewArtist;
    if (!artist || !artist.artworks[current]) return;
    this.setData({
      previewArtworkIndex: current,
      previewArtwork: artist.artworks[current]
    });
  },

  movePreview(e) {
    const delta = Number(e.currentTarget.dataset.delta) || 0;
    const artist = this.data.previewArtist;
    if (!artist || !artist.artworks.length) return;
    const next = wrapPreviewIndex(this.data.previewArtworkIndex + delta, artist.artworks.length);
    if (next !== this.data.previewArtworkIndex) {
      this.setData({ previewArtworkIndex: next, previewArtwork: artist.artworks[next] });
    }
  },

  confirmPreviewCover() {
    const artwork = this.data.previewArtwork;
    if (!artwork) return;
    this.closeWithoutReturnTransition(() => {
      if (this._openerEventChannel && typeof this._openerEventChannel.emit === "function") {
        this._openerEventChannel.emit("selectActivityCover", artwork);
      }
    });
  }
});

module.exports = { getPreviewNavigationMetrics, wrapPreviewIndex };
