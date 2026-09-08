const test = require("node:test");
const assert = require("node:assert/strict");

global.wx = {
  _store: {},
  getStorageSync(key) { return this._store[key]; },
  setStorageSync(key, value) { this._store[key] = value; }
};

const cache = require("../utils/activityWeatherCache");

function activity(overrides = {}) {
  return {
    _id: 12,
    startTime: "2026-09-07T10:00:00",
    locationLongitude: 116.40744,
    locationLatitude: 39.90424,
    ...overrides
  };
}

test("weather cache isolates activity date and normalized location", () => {
  const a = activity();
  const b = activity({ startTime: "2026-09-08T10:00:00" });
  const c = activity({ locationLatitude: 39.90524 });
  assert.notEqual(cache.buildWeatherCacheKey(a), cache.buildWeatherCacheKey(b));
  assert.notEqual(cache.buildWeatherCacheKey(a), cache.buildWeatherCacheKey(c));
});

test("weather cache returns only still-valid available server snapshots", () => {
  wx._store = {};
  const a = activity();
  const now = Date.parse("2026-09-04T10:00:00Z");
  cache.writeActivityWeather(a, { available: true, valid_until: "2026-09-04T11:00:00Z", condition: "晴" }, now);
  assert.equal(cache.readActivityWeather(a, now).condition, "晴");
  assert.equal(cache.readActivityWeather(a, Date.parse("2026-09-04T12:00:00Z")), null);
});

test("explicit unavailable server state clears an obsolete cached weather result", () => {
  wx._store = {};
  const a = activity();
  const now = Date.parse("2026-09-04T10:00:00Z");
  cache.writeActivityWeather(a, { available: true, valid_until: "2026-09-04T11:00:00Z", condition: "晴" }, now);
  const weather = cache.resolveActivityWeather({ ...a, weather: { available: false, status: "forecast_out_of_range" } }, now);
  assert.equal(weather.status, "forecast_out_of_range");
  assert.equal(cache.readActivityWeather(a, now), null);
});
