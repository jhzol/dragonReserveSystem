const { getApiBaseUrl } = require("./config");
const {
  createTraceId,
  logInfo,
  logError,
  summarizeError,
  logRequestTransportFail
} = require("./logger");

const DEFAULT_REQUEST_TIMEOUT = 15000;
const SLOW_REQUEST_THRESHOLD_MS = 2000;

function estimateResponseBytes(data) {
  try {
    return JSON.stringify(data == null ? null : data).length;
  } catch (_e) {
    return 0;
  }
}

function resolveApiBaseUrl(apiVersion) {
  const baseUrl = getApiBaseUrl();
  if (!apiVersion) return baseUrl;
  return baseUrl.replace(/\/api\/v\d+\/?$/, `/api/v${apiVersion}`);
}

function request({ url, method = "GET", data, auth = true, timeout = DEFAULT_REQUEST_TIMEOUT, apiVersion }) {
  const traceId = createTraceId("req");
  const startAt = Date.now();
  const header = {
    "Content-Type": "application/json",
    "X-Request-Id": traceId
  };
  const token = wx.getStorageSync("accessToken");

  if (auth && token) {
    header.Authorization = `Bearer ${token}`;
  }

  logInfo("request_start", { url, method, traceId, timeout });

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${resolveApiBaseUrl(apiVersion)}${url}`,
      method,
      data,
      header,
      timeout,
      success(res) {
        const duration = Date.now() - startAt;
        const responseRequestId = res.header && (res.header["X-Request-Id"] || res.header["x-request-id"]);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          logInfo("request_success", {
            url,
            method,
            traceId,
            requestId: responseRequestId || traceId,
            duration,
            statusCode: res.statusCode
          });
          if (duration >= SLOW_REQUEST_THRESHOLD_MS) {
            logInfo("request_slow", {
              url,
              method,
              traceId,
              requestId: responseRequestId || traceId,
              duration,
              statusCode: res.statusCode,
              responseBytes: estimateResponseBytes(res.data)
            });
          }
          resolve(res.data);
          return;
        }

        const error = {
          statusCode: res.statusCode,
          message: (res.data && res.data.message) || "请求失败",
          body: res.data,
          traceId,
          requestId: (res.data && res.data.request_id) || responseRequestId || traceId,
          duration,
          api: url
        };
        logError("request_fail", {
          url,
          method,
          traceId,
          requestId: error.requestId,
          duration,
          statusCode: res.statusCode,
          summary: summarizeError(error)
        });
        reject(error);
      },
      fail(err) {
        const duration = Date.now() - startAt;
        const error = {
          statusCode: 0,
          message: err.errMsg || "网络请求失败",
          body: err,
          traceId,
          requestId: traceId,
          duration,
          api: url
        };
        let apiHost = "";
        try {
          apiHost = String(getApiBaseUrl() || "")
            .replace(/^https?:\/\//, "")
            .split("/")[0];
        } catch (e) {
          apiHost = "";
        }
        logRequestTransportFail(
          {
            url,
            method,
            traceId,
            duration,
            apiHost
          },
          err
        );
        reject(error);
      }
    });
  });
}

module.exports = {
  request,
  resolveApiBaseUrl,
  DEFAULT_REQUEST_TIMEOUT
};
