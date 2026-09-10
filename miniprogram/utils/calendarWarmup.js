/**
 * 在首页活动列表拉取成功后，空闲预取「已报名活动」写入 myActivitiesCache，减少切到日程 Tab 时冷启动等待。
 */
const activityService = require("../services/activity");
const myActivitiesCache = require("./myActivitiesCache");

const PREFETCH_MIN_INTERVAL_MS = 45 * 1000;
const PREFETCH_IDLE_DELAY_MS = 350;

let _inflight = null;
let _scheduledTimer = null;

function cancelScheduledPrefetch() {
  if (_scheduledTimer) {
    clearTimeout(_scheduledTimer);
    _scheduledTimer = null;
  }
}

function schedulePrefetchSignedUpList(app) {
  cancelScheduledPrefetch();
  _scheduledTimer = setTimeout(() => {
    _scheduledTimer = null;
    prefetchSignedUpList(app);
  }, PREFETCH_IDLE_DELAY_MS);
}

function prefetchSignedUpList(app) {
  const token = app.globalData.accessToken || wx.getStorageSync("accessToken");
  const uid = String(app.globalData.userId || wx.getStorageSync("userId") || "").trim();
  if (!token || !uid) return null;

  const now = Date.now();
  const payload = myActivitiesCache.readPayload(uid);
  if (payload && now - payload.savedAt < PREFETCH_MIN_INTERVAL_MS) {
    return null;
  }
  if (_inflight && _inflight.uid === uid && _inflight.token === token) return _inflight.promise;

  const entry = { uid, token, promise: null };
  entry.promise = activityService
    .listMyActivities()
    .then((list) => {
      const currentToken = app.globalData.accessToken || wx.getStorageSync("accessToken");
      const currentUid = String(app.globalData.userId || wx.getStorageSync("userId") || "").trim();
      if (currentToken === token && currentUid === uid) myActivitiesCache.writeRawList(uid, list || []);
    })
    .catch(() => {})
    .finally(() => {
      if (_inflight === entry) _inflight = null;
    });
  _inflight = entry;
  return entry.promise;
}

module.exports = {
  prefetchSignedUpList,
  schedulePrefetchSignedUpList,
  cancelScheduledPrefetch,
};
