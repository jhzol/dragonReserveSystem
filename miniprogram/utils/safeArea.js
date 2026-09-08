/**
 * 读取微信运行时底部安全区，并统一换算成 rpx。
 * 原型底部设计保留区为 390px 画布下的 24px，即 46.15385rpx。
 * 真实设备上报值优先；仅 Android / HarmonyOS 明确上报 0 时使用这块设计留白兜底。
 * 此兜底不是系统安全区，也不展示 iOS Home Indicator。
 */
const ANDROID_BOTTOM_SAFE_AREA_FALLBACK_RPX = 46.15385;

function getWindowInfoCompat() {
  try {
    if (typeof wx.getWindowInfo === "function") return wx.getWindowInfo();
    if (typeof wx.getSystemInfoSync === "function") return wx.getSystemInfoSync();
  } catch (error) {}
  return {};
}

function getDeviceInfoCompat() {
  try {
    if (typeof wx.getDeviceInfo === "function") return wx.getDeviceInfo();
  } catch (error) {}
  return {};
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundRpx(value) {
  return Math.round(value * 100) / 100;
}

function getBottomSafeAreaPx(info) {
  const windowHeight = finiteNumber(info && info.windowHeight);
  const safeAreaInsetsBottom = finiteNumber(info && info.safeAreaInsets && info.safeAreaInsets.bottom);
  if (safeAreaInsetsBottom !== null) return Math.max(0, safeAreaInsetsBottom);

  const safeAreaBottom = finiteNumber(info && info.safeArea && info.safeArea.bottom);
  if (windowHeight !== null && safeAreaBottom !== null) {
    return Math.max(0, windowHeight - safeAreaBottom);
  }

  return 0;
}

function isAndroidDevice(deviceInfo, windowInfo) {
  const platform = String(
    (deviceInfo && deviceInfo.platform) || (windowInfo && windowInfo.platform) || ""
  ).toLowerCase();
  const system = String(
    (deviceInfo && deviceInfo.system) || (windowInfo && windowInfo.system) || ""
  ).toLowerCase();
  return platform === "android" ||
    system.indexOf("android") >= 0 ||
    system.indexOf("harmonyos") >= 0;
}

function resolveBottomSafeAreaRpx(windowInfo, deviceInfo) {
  const windowWidth = finiteNumber(windowInfo && windowInfo.windowWidth);
  const reportedBottomPx = getBottomSafeAreaPx(windowInfo);
  if (windowWidth && reportedBottomPx > 0) {
    return roundRpx(reportedBottomPx * 750 / windowWidth);
  }
  if (isAndroidDevice(deviceInfo, windowInfo)) {
    return roundRpx(ANDROID_BOTTOM_SAFE_AREA_FALLBACK_RPX);
  }
  return 0;
}

function buildSafeAreaDiagnostic() {
  const windowInfo = getWindowInfoCompat();
  const deviceInfo = getDeviceInfoCompat();
  const windowWidth = finiteNumber(windowInfo.windowWidth);
  const reportedBottomPx = getBottomSafeAreaPx(windowInfo);
  const reportedBottomRpx = windowWidth && reportedBottomPx > 0
    ? roundRpx(reportedBottomPx * 750 / windowWidth)
    : 0;
  const resolvedBottomRpx = resolveBottomSafeAreaRpx(windowInfo, deviceInfo);

  return {
    platform: deviceInfo.platform || windowInfo.platform || "",
    brand: deviceInfo.brand || "",
    model: deviceInfo.model || "",
    system: deviceInfo.system || windowInfo.system || "",
    pixelRatio: windowInfo.pixelRatio,
    screenWidth: windowInfo.screenWidth,
    screenHeight: windowInfo.screenHeight,
    windowWidth: windowInfo.windowWidth,
    windowHeight: windowInfo.windowHeight,
    screenTop: windowInfo.screenTop,
    statusBarHeight: windowInfo.statusBarHeight,
    safeAreaInsets: windowInfo.safeAreaInsets || null,
    safeArea: windowInfo.safeArea || null,
    computedBottomPx: reportedBottomPx,
    computedBottomRpx: reportedBottomRpx,
    resolvedBottomRpx,
    androidFallbackApplied: reportedBottomPx <= 0 && isAndroidDevice(deviceInfo, windowInfo)
  };
}

function getBottomSafeAreaRpx() {
  const windowInfo = getWindowInfoCompat();
  const deviceInfo = getDeviceInfoCompat();
  return resolveBottomSafeAreaRpx(windowInfo, deviceInfo);
}

module.exports = {
  ANDROID_BOTTOM_SAFE_AREA_FALLBACK_RPX,
  getWindowInfoCompat,
  getDeviceInfoCompat,
  getBottomSafeAreaPx,
  isAndroidDevice,
  resolveBottomSafeAreaRpx,
  buildSafeAreaDiagnostic,
  getBottomSafeAreaRpx
};
