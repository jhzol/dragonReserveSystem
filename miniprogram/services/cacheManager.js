const { getApiBaseUrl } = require("./config");
const KEY_ACTIVITY_LIST_CACHE = "activityListCache";

function cacheKey(key) {
  const api = String(getApiBaseUrl() || "default").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${key}:${api || "default"}`;
}

function _safeGet(key, fallback = null) {
  try {
    const value = wx.getStorageSync(key);
    return value == null || value === "" ? fallback : value;
  } catch (_e) {
    return fallback;
  }
}

function _safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (_e) {}
}

function getCachedActivityList() {
  return _safeGet(cacheKey(KEY_ACTIVITY_LIST_CACHE), null);
}

function setCachedActivityList(list, userId = "") {
  _safeSet(cacheKey(KEY_ACTIVITY_LIST_CACHE), {
    list: Array.isArray(list) ? list : [],
    userId: String(userId || ""),
    updatedAt: Date.now()
  });
}

function clearCachedActivityList() {
  try {
    wx.removeStorageSync(cacheKey(KEY_ACTIVITY_LIST_CACHE));
  } catch (_e) {}
}

module.exports = {
  getCachedActivityList,
  setCachedActivityList,
  clearCachedActivityList
};
