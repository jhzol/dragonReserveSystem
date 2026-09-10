/** Separate download from local image inspection; never substitute a fallback image.
 * Inspection completion is not proof that the compositor has painted the image.
 */
// Numeric categories avoid persisting raw errors that can contain signed URLs.
// 1=domain configuration, 2=timeout, 3=cancelled, 4=TLS, 5=network, 6=other.
function imageErrorCode(error) {
  const message = String(error && (error.errMsg || error.message) || '').toLowerCase();
  if (/domain|url not in/.test(message)) return 1;
  if (/timeout|timed out/.test(message)) return 2;
  if (/abort|cancel/.test(message)) return 3;
  if (/ssl|tls|certificate/.test(message)) return 4;
  if (/network|connect|dns|offline/.test(message)) return 5;
  return 6;
}
function safeProfile(result) {
  const profile = result && result.profile;
  const safe = { profileAvailable: !!profile };
  if (profile) {
    for (const key of ['fetchStart', 'queueStart', 'queueEnd', 'domainLookUpStart', 'domainLookUpEnd',
      'connectStart', 'connectEnd', 'SSLconnectionStart', 'SSLconnectionEnd', 'requestStart',
      'requestEnd', 'responseStart', 'responseEnd', 'receivedBytedCount', 'sendBytesCount', 'throughputKbps']) {
      if (Number.isFinite(profile[key])) safe[key] = profile[key];
    }
    if (typeof profile.socketReused === 'boolean') safe.socketReused = profile.socketReused;
    if (['http1.1', 'h2', 'quic', 'h3', 'unknown'].includes(profile.protocol)) safe.protocol = profile.protocol;
  }
  if (Number.isFinite(result && result.errno)) safe.nativeErrno = result.errno;
  return safe;
}
// Callback counts, not socket counts. Unabortable/lost callbacks remain unknown.
let downloadTasks = 0, inspectionTasks = 0;
let requestSequence = 0;
function prepareHomeImageTransfer({ wxApi, url, ready, failed, stage = () => {},
  progressIdleMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let cancelled = false, settled = false, task;
  let downloadPending = false, inspectionPending = false;
  let progressTimer = null, receivedBytes = 0;
  const clearProgressTimer = () => { if (progressTimer !== null) clearTimer(progressTimer); progressTimer = null; };
  const finishDownload = () => { clearProgressTimer(); if (downloadPending) { downloadPending = false; downloadTasks--; } };
  const finishInspection = () => { if (inspectionPending) { inspectionPending = false; inspectionTasks--; } };
  const requestId = `hm-${Date.now().toString(36)}-${(++requestSequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const report = (name, details = {}) => { if (!cancelled && !settled) { try { stage(name, { ...details, requestId, downloadTasksAwaitingCallback: downloadTasks, inspectionTasksAwaitingCallback: inspectionTasks }); } catch (_) {} } };
  const fail = (error) => { if (!cancelled && !settled) { settled = true; failed(error); } };
  const inspect = (src) => {
    if (cancelled || settled) return;
    inspectionPending = true; inspectionTasks++;
    report('image_info_started', { inspectionSource: src === url ? 'remote_network_unobservable' : 'local' });
    try {
      wxApi.getImageInfo({ src, success: res => {
        finishInspection();
        if (cancelled || settled) return;
        report('image_info_complete', { width: res.width, height: res.height });
        settled = true; ready(res.path || src);
      }, fail: error => { finishInspection(); report('image_info_failed', { errorCode: imageErrorCode(error) }); fail(error); } });
    } catch (error) { finishInspection(); report('image_info_failed', { errorCode: imageErrorCode(error) }); fail(error); }
  };
  if (typeof wxApi.downloadFile !== 'function' || !/^https:\/\//.test(url)) {
    report('combined_preparation'); inspect(url);
  } else {
    downloadPending = true; downloadTasks++;
    report('download_started');
    try {
      task = wxApi.downloadFile({ url, timeout: 60000, enableProfile: true, header: {'X-Request-Id': requestId},
        success: res => {
          finishDownload();
          if (cancelled || settled) return;
          report('download_complete', { status: res.statusCode, profile: safeProfile(res) });
          if (res.statusCode !== 200 || !res.tempFilePath) { fail(new Error(`image download HTTP ${res.statusCode}`)); return; }
          inspect(res.tempFilePath);
        },
        fail: error => {
          finishDownload();
          if (cancelled || settled) return;
          const errorCode = imageErrorCode(error);
          // A failed transfer must return to the bounded retry queue. Starting
          // getImageInfo on the remote URL would silently download it again,
          // outside that queue's attempt accounting and download progress.
          if (errorCode === 2 || errorCode === 5) {
            report('download_failed', { errorCode, profile: safeProfile(error) });
            fail(error);
            return;
          }
          // Retain the compatibility path for domain/API-specific rejection.
          report('download_failed_combined_fallback', { errorCode, profile: safeProfile(error) }); inspect(url);
        }
      });
      if (task && typeof task.onHeadersReceived === 'function') task.onHeadersReceived((response = {}) => {
        const header = response.header || {};
        const key = Object.keys(header).find(k => k.toLowerCase() === 'x-request-id');
        const id = key && String(header[key]);
        report('headers_received', { serverRequestId: /^[a-zA-Z0-9_-]{1,100}$/.test(id || '') ? id : '', requestIdEchoed: id === requestId });
      });
      if (task && typeof task.onProgressUpdate === 'function') task.onProgressUpdate(r => {
        if (cancelled || settled || !downloadPending) return;
        report('download_progress', { bytes: r.totalBytesWritten, expectedBytes: r.totalBytesExpectedToWrite });
        // Only infer idle after observing actual transferred bytes. Missing SDK
        // progress support or repeated zeroes are not evidence of a stalled link.
        if (!Number.isFinite(r.totalBytesWritten) || r.totalBytesWritten <= receivedBytes) return;
        receivedBytes = r.totalBytesWritten;
        clearProgressTimer();
        if (!task || typeof task.abort !== 'function') return;
        progressTimer = setTimer(() => {
          progressTimer = null;
          if (cancelled || settled || !downloadPending) return;
          report('download_progress_idle', { errorCode: 2, idleMs: progressIdleMs, bytes: receivedBytes });
          // Settle before abort: SDKs may synchronously call fail from abort().
          // Keep callback accounting pending until the native callback arrives.
          settled = true;
          try { task.abort(); } catch (_) { /* Native cancellation is best effort. */ }
          failed(new Error('image download progress idle timeout'));
        }, progressIdleMs);
      });
    } catch (error) { finishDownload(); report('download_exception_combined_fallback', { errorCode: imageErrorCode(error), profile: safeProfile(error) }); inspect(url); }
  }
  return () => { report('preparation_cancel_requested', { downloadCancellation: downloadPending ? 'abort_requested_callback_pending' : 'not_pending', inspectionCancellation: inspectionPending ? 'unabortable_callback_pending' : 'not_pending' }); cancelled = true; clearProgressTimer(); if (task && typeof task.abort === 'function') task.abort(); };
}
const { getHomeImageDiskCache } = require('./homeImageDiskCache');
function invalidateHomeImageCache(wxApi, url) { return getHomeImageDiskCache(wxApi)?.invalidate(url); }
function prepareHomeImage(options) {
  const { wxApi, url, ready, stage = () => {} } = options;
  const cache = /^https:\/\//.test(url) ? getHomeImageDiskCache(wxApi) : null;
  if (!cache) {
    try { stage('disk_cache_bypassed'); } catch (_) {}
    return prepareHomeImageTransfer(options);
  }
  let cancelled = false, started = false, cancelTransfer;
  const report = name => { try { stage(name, { cacheBudgetBytes: 100000000 }); } catch (_) {} };
  const start = () => {
    if (cancelled || started) return;
    started = true; clearTimeout(deadline);
    cancelTransfer = prepareHomeImageTransfer({ ...options, ready: path => {
      if (cancelled) return;
      // Copy, never move, the temporary file currently used by the native image.
      cache.put(url, path);
      ready(path);
    } });
  };
  // Disk operations or local decode callbacks must never hold the queue forever.
  const deadline = setTimeout(() => { if (!cancelled && !started) { report('disk_cache_timeout'); start(); } }, 1500);
  cache.get(url).then(path => {
    if (cancelled || started) return;
    if (!path) { report('disk_cache_miss'); start(); return; }
    try { wxApi.getImageInfo({ src: path, success: () => {
      if (cancelled || started) return;
      started = true; clearTimeout(deadline); report('disk_cache_hit'); ready(path);
    }, fail: () => { if (cancelled || started) return; cache.invalidate(url); report('disk_cache_invalid'); start(); } }); }
    catch (_) { if (!cancelled && !started) { cache.invalidate(url); report('disk_cache_invalid'); start(); } }
  }).catch(() => { if (!cancelled && !started) { report('disk_cache_error'); start(); } });
  return () => { cancelled = true; clearTimeout(deadline); if (cancelTransfer) cancelTransfer(); };
}
module.exports = { prepareHomeImage, invalidateHomeImageCache };
