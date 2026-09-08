const { request: baseRequest } = require("./request");
const cacheManager = require("./cacheManager");
const myActivitiesCache = require("../utils/myActivitiesCache");
const historyStatsCache = require("../utils/historyStatsCache");

let listActivitiesInFlight = null;
let listMyActivitiesInFlight = null;

function request(options) {
  return baseRequest({ ...options, apiVersion: 2 });
}

function invalidateActivityCaches({ clearMyActivities = false } = {}) {
  cacheManager.clearCachedActivityList();
  historyStatsCache.clear();
  if (!clearMyActivities) return;
  const userId = wx.getStorageSync("userId") || "";
  myActivitiesCache.removeForUser(userId);
}

function listActivities() {
  if (listActivitiesInFlight) return listActivitiesInFlight;

  const pending = request({ url: "/activities" });
  const coalesced = pending.finally(() => {
    if (listActivitiesInFlight === coalesced) listActivitiesInFlight = null;
  });
  listActivitiesInFlight = coalesced;
  return coalesced;
}

function listMyActivities() {
  const token = wx.getStorageSync("accessToken") || "";
  if (listMyActivitiesInFlight && listMyActivitiesInFlight.token === token) {
    return listMyActivitiesInFlight.promise;
  }

  const entry = { token, promise: null };
  const pending = request({ url: "/activities/me/signed-up" });
  entry.promise = pending.finally(() => {
    if (listMyActivitiesInFlight === entry) listMyActivitiesInFlight = null;
  });
  listMyActivitiesInFlight = entry;
  return entry.promise;
}

function listActivityCovers() {
  return request({ url: "/activity-covers" });
}

function getActivity(activityId) {
  return request({ url: `/activities/${activityId}` });
}

function getActivitySharePreview(activityId) {
  return request({ url: `/activities/${activityId}/share-preview`, timeout: 20000 });
}

function createActivity(payload) {
  return request({
    url: "/activities",
    method: "POST",
    data: payload
  }).then((result) => {
    invalidateActivityCaches();
    return result;
  });
}

function updateActivity(activityId, payload) {
  return request({
    url: `/activities/${activityId}`,
    method: "PATCH",
    data: payload
  }).then((result) => {
    invalidateActivityCaches();
    return result;
  });
}

function signupActivity(activityId) {
  return request({
    url: `/activities/${activityId}/signup`,
    method: "POST"
  }).then((result) => {
    invalidateActivityCaches({ clearMyActivities: true });
    return result;
  });
}

function cancelActivity(activityId) {
  return request({
    url: `/activities/${activityId}/cancel`,
    method: "POST"
  }).then((result) => {
    invalidateActivityCaches({ clearMyActivities: true });
    return result;
  });
}

function removeParticipant(activityId, participantId) {
  return request({
    url: `/activities/${activityId}/participants/${participantId}`,
    method: "DELETE"
  }).then((result) => {
    invalidateActivityCaches({ clearMyActivities: true });
    return result;
  });
}

function checkinActivity(activityId, payload) {
  return request({
    url: `/activities/${activityId}/checkin`,
    method: "POST",
    data: payload
  }).then((result) => {
    invalidateActivityCaches({ clearMyActivities: true });
    return result;
  });
}

function adminCheckinParticipant(activityId, participantId) {
  return request({
    url: `/activities/${activityId}/participants/${participantId}/admin-checkin`,
    method: "POST"
  }).then((result) => {
    invalidateActivityCaches();
    return result;
  });
}

function adminCancelCheckinParticipant(activityId, participantId) {
  return request({
    url: `/activities/${activityId}/participants/${participantId}/admin-checkin`,
    method: "DELETE"
  }).then((result) => {
    invalidateActivityCaches();
    return result;
  });
}

module.exports = {
  listActivities,
  listMyActivities,
  listActivityCovers,
  getActivity,
  getActivitySharePreview,
  createActivity,
  updateActivity,
  cancelActivity,
  signupActivity,
  removeParticipant,
  checkinActivity,
  adminCheckinParticipant,
  adminCancelCheckinParticipant
};
