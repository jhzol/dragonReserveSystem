const { getApiBaseUrl } = require("./config");
const { createDiagnosticOutbox } = require("./diagnosticOutbox");

function createTraceId(prefix = "trace") {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

let realtimeLogger;
let realtimeLoggerReady = false;
let cachedSystemMeta;
let clientDiagnosticSessionId;
const backendUploadThrottleMap = new Map();
const wechatAnalyticsTransportThrottleMap = new Map();
let diagnosticOutbox;

function resumeDiagnosticUploads() {
  if (typeof wx === "undefined" || !wx) return;
  try {
    if (!diagnosticOutbox) diagnosticOutbox = createDiagnosticOutbox({
      wxApi: wx, getApiBaseUrl, createId: () => createTraceId("diag"),
      onFailure: summary => reportRealtime("error", "diagnostic_upload_fail", { summary })
    });
    diagnosticOutbox.resume();
  } catch (_) { /* Diagnostic delivery must not interrupt the app. */ }
}

function getClientDiagnosticSessionId() {
  if (!clientDiagnosticSessionId) {
    clientDiagnosticSessionId = createTraceId("sess");
  }
  return clientDiagnosticSessionId;
}

function summarizeError(err) {
  if (!err) return "unknown error";
  const msg = err.message || err.errMsg || err.code || "";
  const parts = [];
  if (msg) parts.push(String(msg));
  if (err.errno !== undefined && err.errno !== "") {
    parts.push(`errno:${err.errno}`);
  }
  if (err.statusCode) {
    parts.push(`status:${err.statusCode}`);
  }
  if (parts.length) return parts.join(" ");
  return err.statusCode || "unknown error";
}

function getRealtimeLogger() {
  if (realtimeLoggerReady) return realtimeLogger;
  realtimeLoggerReady = true;
  try {
    if (typeof wx !== "undefined" && wx && typeof wx.getRealtimeLogManager === "function") {
      realtimeLogger = wx.getRealtimeLogManager();
    }
  } catch (err) {
    realtimeLogger = null;
  }
  return realtimeLogger;
}

function shouldReportRealtime(event) {
  return (
    event === "home_presentation_snapshot" ||
    event === "request_fail" ||
    event === "activity_card_presentation_pending" ||
    event === "activity_card_presentation_ready" ||
    event === "activity_card_media_scan" ||
    event === "activity_card_media_pending" ||
    event === "activity_card_media_stalled" ||
    event === "activity_card_media_error" ||
    event === "activity_card_video_waiting" ||
    event === "activity_card_media_all_resolved" ||
    event === "page_error" ||
    event === "diagnostic_upload_fail"
  );
}

function shouldUploadBackend(event) {
  return (
    event === "home_presentation_snapshot" ||
    event === "request_fail" ||
    event === "request_slow" ||
    event === "page_error" ||
    event === "activity_card_media_stalled" ||
    event === "activity_card_media_error" ||
    event === "activity_card_video_waiting"
  );
}

function getRuntimeEnvironment() {
  const apiUrl = String(getApiBaseUrl() || "").toLowerCase();
  return /(?:127\.0\.0\.1|localhost|192\.168\.)/.test(apiUrl) ? "test" : "production";
}

function normalizeRealtimeValue(value, depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (depth >= 3) {
    return typeof value === "string" ? value.slice(0, 160) : String(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => normalizeRealtimeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const next = {};
    Object.keys(value).slice(0, 20).forEach((key) => {
      next[key] = normalizeRealtimeValue(value[key], depth + 1);
    });
    return next;
  }
  if (typeof value === "string") {
    return value.length > 300 ? `${value.slice(0, 297)}...` : value;
  }
  return value;
}

function getCurrentPageRoute() {
  try {
    if (typeof getCurrentPages !== "function") return "";
    const pages = getCurrentPages();
    if (!pages || !pages.length) return "";
    return pages[pages.length - 1].route || "";
  } catch (err) {
    return "";
  }
}

function getSystemMeta() {
  if (cachedSystemMeta) return cachedSystemMeta;
  try {
    const device = typeof wx.getDeviceInfo === "function" ? wx.getDeviceInfo() : {};
    const appInfo = typeof wx.getAppBaseInfo === "function" ? wx.getAppBaseInfo() : {};
    cachedSystemMeta = {
      clientVersion: appInfo.version || "",
      baseLibVersion: appInfo.SDKVersion || "",
      systemType: device.platform || "",
      brand: device.brand || "",
      model: device.model || "",
      system: device.system || ""
    };
  } catch (err) {
    cachedSystemMeta = {
      clientVersion: "",
      baseLibVersion: "",
      systemType: "",
      brand: "",
      model: "",
      system: ""
    };
  }
  return cachedSystemMeta;
}

function shouldThrottleBackendUpload(event, payload) {
  const signature = JSON.stringify({
    event,
    traceId: payload && payload.traceId,
    reason: payload && payload.reason,
    activityId: payload && payload.activityId,
    mediaType: payload && payload.mediaType,
    group: payload && payload.group,
    url: payload && payload.url,
    summary: payload && payload.summary,
    duration: payload && payload.duration,
    pendingImages: payload && payload.pendingImages,
    pendingVideos: payload && payload.pendingVideos
  });
  const now = Date.now();
  const prev = backendUploadThrottleMap.get(signature) || 0;
  if (now - prev < 1500) {
    return true;
  }
  backendUploadThrottleMap.set(signature, now);
  if (backendUploadThrottleMap.size > 200) {
    const entries = Array.from(backendUploadThrottleMap.entries()).sort((a, b) => a[1] - b[1]);
    entries.slice(0, 50).forEach(([key]) => backendUploadThrottleMap.delete(key));
  }
  return false;
}

function shouldThrottleWechatAnalyticsTransport(payload) {
  const signature = JSON.stringify({
    traceId: payload && payload.traceId,
    reason: payload && payload.reason,
    apiPath: payload && payload.apiPath,
    errMsg: payload && payload.errMsg,
    networkType: payload && payload.networkType
  });
  const now = Date.now();
  const prev = wechatAnalyticsTransportThrottleMap.get(signature) || 0;
  if (now - prev < 8000) {
    return true;
  }
  wechatAnalyticsTransportThrottleMap.set(signature, now);
  if (wechatAnalyticsTransportThrottleMap.size > 200) {
    const entries = Array.from(wechatAnalyticsTransportThrottleMap.entries()).sort((a, b) => a[1] - b[1]);
    entries.slice(0, 50).forEach(([key]) => wechatAnalyticsTransportThrottleMap.delete(key));
  }
  return false;
}

/**
 * 微信官方自定义分析：wx.request 传输层失败（如 errcode -101）。
 * 需在小程序后台「统计 → 自定义分析」中配置同名事件 network_request_fail 及属性（或按后台要求调整）。
 * 属性值须为字符串。
 */
function reportTransportFailToWechatAnalytics(payload) {
  if (typeof wx === "undefined" || typeof wx.reportAnalytics !== "function") return;
  if (shouldThrottleWechatAnalyticsTransport(payload || {})) return;
  const p = payload || {};
  try {
    wx.reportAnalytics("network_request_fail", {
      api_path: String(p.apiPath || "").slice(0, 200),
      method: String(p.method || ""),
      err_msg: String(p.errMsg || "").slice(0, 200),
      api_host: String(p.apiHost || "").slice(0, 100),
      trace_id: String(p.traceId || "").slice(0, 100),
      network_type: String(p.networkType || "").slice(0, 32),
      is_weak: p.isWeak ? "1" : "0",
      err_no: String(p.errNo !== undefined && p.errNo !== null ? p.errNo : "").slice(0, 32)
    });
  } catch (err) {
    // ignore
  }
}

/**
 * wx.request 传输层失败时：补全网络类型、机型、会话等后再打日志与自定义分析，便于区分「弱网 / Wi‑Fi / 蜂窝」与机型。
 */
function logRequestTransportFail(ctx, rawErr) {
  const errMsg = (rawErr && rawErr.errMsg) || "";
  const errNo = rawErr && rawErr.errno;
  const meta = getSystemMeta();
  const sessionId = getClientDiagnosticSessionId();

  const buildPayload = (networkType, isWeak) => ({
    url: ctx.url,
    method: ctx.method,
    traceId: ctx.traceId,
    requestId: ctx.traceId,
    duration: ctx.duration,
    statusCode: 0,
    sessionId,
    networkType: networkType || "",
    isWeak: !!isWeak,
    errNo: errNo !== undefined && errNo !== null ? errNo : "",
    brand: meta.brand,
    model: meta.model,
    system: meta.system,
    summary: summarizeError({ errMsg, errno: errNo, message: errMsg })
  });

  const emit = (networkType, isWeak) => {
    const payload = buildPayload(networkType, isWeak);
    logError("request_fail", payload);
    reportTransportFailToWechatAnalytics({
      traceId: ctx.traceId,
      apiPath: ctx.url,
      method: ctx.method,
      apiHost: ctx.apiHost,
      errMsg,
      networkType: payload.networkType,
      isWeak: payload.isWeak,
      errNo: payload.errNo
    });
  };

  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    emit("", false);
  }, 3000);

  try {
    wx.getNetworkType({
      success(res) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        emit(res.networkType, res.isWeak);
      },
      fail() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        emit("", false);
      }
    });
  } catch (e) {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      emit("", false);
    }
  }
}

function uploadBackendLog(level, event, payload) {
  if (!shouldUploadBackend(event)) return;
  if (typeof wx === "undefined" || !wx || typeof wx.request !== "function") return;
  let token;
  try { token = wx.getStorageSync("accessToken"); } catch (_) { return; }
  if (!token) return;
  if (shouldThrottleBackendUpload(event, payload || {})) return;

  const systemMeta = getSystemMeta();
  if (!diagnosticOutbox) resumeDiagnosticUploads();
  try {
    if (diagnosticOutbox) diagnosticOutbox.enqueue({
      event, level,
      traceId: (payload && payload.traceId) || "",
      sessionId: (payload && payload.sessionId) || getClientDiagnosticSessionId(),
      page: getCurrentPageRoute(),
      clientVersion: systemMeta.clientVersion,
      baseLibVersion: systemMeta.baseLibVersion,
      systemType: systemMeta.systemType,
      payload: { environment: getRuntimeEnvironment(), ...normalizeRealtimeValue(payload || {}) }
    });
  } catch (_) { /* Storage/request failures must not affect page rendering. */ }
}

function logPageError(operation, err, context = {}) {
  const summary = summarizeError(err);
  logError("page_error", {
    operation: String(operation || "unknown").slice(0, 100),
    summary,
    traceId: (err && err.traceId) || "",
    ...normalizeRealtimeValue(context)
  });
}

function reportRealtime(level, event, payload) {
  if (!shouldReportRealtime(event)) return;
  const logger = getRealtimeLogger();
  if (!logger || typeof logger[level] !== "function") return;

  try {
    logger[level](
      {
        event,
        ...normalizeRealtimeValue(payload || {})
      },
      `[mini] ${event}`
    );
  } catch (err) {
    // Swallow realtime logging failures so normal app flow is never affected.
  }
}

function logInfo(event, payload) {
  console.info(`[mini] ${event}`, payload || {});
  reportRealtime("info", event, payload);
  uploadBackendLog("info", event, payload);
}

function logError(event, payload) {
  console.error(`[mini] ${event}`, payload || {});
  reportRealtime("error", event, payload);
  uploadBackendLog("error", event, payload);
}

module.exports = {
  resumeDiagnosticUploads,
  createTraceId,
  summarizeError,
  logInfo,
  logError,
  logPageError,
  reportTransportFailToWechatAnalytics,
  logRequestTransportFail,
  getClientDiagnosticSessionId
};
