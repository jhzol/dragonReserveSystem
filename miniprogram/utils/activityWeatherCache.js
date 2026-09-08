const { getApiEnvironment } = require("../services/config");

const STORAGE_KEY = "activityWeatherCacheV1";
const MAX_ENTRIES = 30;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function formatDate(value) {
  const text = String(value || "");
  return text.slice(0, 10);
}

function buildWeatherCacheKey(activity) {
  const env = getApiEnvironment();
  const id = activity && (activity._id || activity.id) || "";
  const start = activity && (activity.startTime || activity.start_time) || "";
  const longitude = activity && (activity.locationLongitude ?? activity.location_longitude) || "";
  const latitude = activity && (activity.locationLatitude ?? activity.location_latitude) || "";
  return `${env}:${id}:${formatDate(start)}:${Number(longitude).toFixed(4)}:${Number(latitude).toFixed(4)}`;
}

function readStore() {
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    return value && typeof value === "object" ? value : {};
  } catch (_err) {
    return {};
  }
}

function writeStore(store) {
  try {
    wx.setStorageSync(STORAGE_KEY, store);
  } catch (_err) {
    // Local cache is optional and must never affect page rendering.
  }
}

function prune(store, now = Date.now()) {
  const entries = Object.entries(store)
    .filter(([, entry]) => entry && Number(entry.savedAt) > now - MAX_AGE_MS)
    .sort((a, b) => Number(b[1].savedAt) - Number(a[1].savedAt))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(entries);
}

function parseUntil(weather) {
  const raw = weather && (weather.validUntil || weather.valid_until);
  const value = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function hasSameSource(entry, activity) {
  return entry && entry.key === buildWeatherCacheKey(activity);
}

function readActivityWeather(activity, now = Date.now()) {
  const entry = readStore()[buildWeatherCacheKey(activity)];
  if (!hasSameSource(entry, activity) || !entry.weather || entry.weather.available !== true) return null;
  const validUntil = parseUntil(entry.weather);
  return validUntil > now ? entry.weather : null;
}

function writeActivityWeather(activity, weather, now = Date.now()) {
  if (!weather || weather.available !== true || parseUntil(weather) <= now) return;
  const key = buildWeatherCacheKey(activity);
  const store = prune(readStore(), now);
  store[key] = { key, savedAt: now, weather };
  writeStore(prune(store, now));
}

function clearActivityWeather(activity, now = Date.now()) {
  const key = buildWeatherCacheKey(activity);
  const store = readStore();
  if (!Object.prototype.hasOwnProperty.call(store, key)) return;
  delete store[key];
  writeStore(prune(store, now));
}

function resolveActivityWeather(activity, now = Date.now()) {
  const serverWeather = activity && activity.weather;
  if (serverWeather && typeof serverWeather === "object") {
    if (serverWeather.available === true) writeActivityWeather(activity, serverWeather, now);
    else clearActivityWeather(activity, now);
    return serverWeather;
  }
  return readActivityWeather(activity, now);
}

module.exports = {
  STORAGE_KEY,
  buildWeatherCacheKey,
  readActivityWeather,
  writeActivityWeather,
  clearActivityWeather,
  resolveActivityWeather,
  _prune: prune
};
