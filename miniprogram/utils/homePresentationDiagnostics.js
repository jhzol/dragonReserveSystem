/** Bounded observations only: never changes card readiness or retries media. */
function createHomePresentationDiagnostics({ page, wxApi, emit, traceId, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout,
  sampleNormal = Math.random() < 0.1 }) {
  const started = now(), timers = [], media = new Map(), nativeMedia = new Map();
  const nativeKey = (url, role, meta) => JSON.stringify([String(meta.activityId), meta.group, role, url]);
  let stopped = false, settled = false, swipeCount = 0;
  const reasonCounts = new Map();
  let layout = "not_measured";
  let listStage = 'not_started', cacheUsed = false, listError = '';
  const stages = {};
  const phases = new Map();
  const attemptRecords = new Map();
  let eventSequence = 0, heartbeatTimer, heartbeatCount = 0, hadIssue = false;
  const issueUrls = new Set();
  const totals = { succeeded: 0, failed: 0, cacheHits: 0, cacheMisses: 0, cacheInvalid: 0 };
  const counted = new Set();
  const imageCache = { checked: 0, hits: 0, misses: 0, invalid: 0, timeout: 0, errors: 0, bypassed: 0 };
  const runtime = { networkType: 'unknown' };
  const safeUrl = url => String(url || '').split(/[?#]/)[0].slice(0, 220);
  const safe = fn => { try { return fn(); } catch (_) { /* Diagnostics must not affect rendering. */ } };
  safe(() => Object.assign(runtime, wxApi.getDeviceInfo && wxApi.getDeviceInfo()));
  // Explicit allowlist: do not upload identifiers, names, tokens or raw device objects.
  const device = { model: runtime.model || '', system: runtime.system || '', platform: runtime.platform || '' };
  safe(() => {
    const info = wxApi.getAccountInfoSync();
    device.miniVersion = info.miniProgram.version || '';
    device.envVersion = info.miniProgram.envVersion || '';
  });
  safe(() => wxApi.getNetworkType({ success: r => { if (!stopped) runtime.networkType = r.networkType; } }));

  const networkChanged = event => { if (stopped) return; runtime.networkType = event.networkType || 'unknown'; snapshot('network_change', { connected: !!event.isConnected }); };
  safe(() => wxApi.onNetworkStatusChange(networkChanged));

  function rows() {
    const result = [];
    Object.keys(page.data.groupedActivities || {}).forEach(group => {
      page.data.groupedActivities[group].forEach((item, index) => {
        const cover = group === 'joined' ? item.largeCardBgImageUrl : item.smallCardBgImageUrl;
        const glass = group === 'joined' ? item.largeCardGlassImageUrl : '';
        const state = (url, role) => {
          if (!url) return 'absent';
          const native = nativeMedia.get(nativeKey(url, role, { activityId: item._id, group }));
          return `${page._homeReadyImages.has(url) ? 'prepared' : 'pending'};native=${native || 'no_callback'};preload=${media.get(url) || 'no_callback'}`;
        };
        result.push({ group, activityId: String(item._id), focused: index === (page.data.focusedCardIndex[group] || 0),
          exposed: page._homeVisibilityKnown ? !!page._homeVisibleCardKeys?.has(JSON.stringify([group, String(item._id)])) : index === (page.data.focusedCardIndex[group] || 0),
          ready: !!item._homeMediaReady, coverPhases: phases.get(cover) || {}, glassPhases: phases.get(glass) || {}, cover: state(cover, 'cover'), glass: state(glass, 'glass'),
          video: state(item.bgVideoUrl, 'video'), coverUrl: safeUrl(cover), glassUrl: safeUrl(glass) });
      });
    });
    return result;
  }
  const nativePending = cards => cards.filter(c => c.exposed && [c.cover, c.glass].some(state => /native=(no_callback|error)/.test(state))).length;
  const pendingNow = () => { const cards = rows(); return !!page.data.homeListLoading || cards.some(c => !c.ready) || nativePending(cards) > 0; };
  function snapshot(reason, extra = {}) {
    if (stopped) return;
    const passive = /^(checkpoint_|pending_heartbeat|network_change|swiper_change|page_hide)/.test(reason);
    if (passive && !pendingNow()) return;
    if (reason === 'page_hide' && !hadIssue && now() - started < 8000) return;
    if (reason === 'page_enter') return;
    if (/error|timeout|missing|checkpoint_|pending_heartbeat/.test(reason)) hadIssue = true;
    const count = reasonCounts.get(reason) || 0;
    if (count >= 3) return;
    reasonCounts.set(reason, count + 1);
    safe(() => {
      const cards = rows(), pending = cards.filter(c => !c.ready);
      const samples = cards.slice().sort((a, b) => Number(a.ready) - Number(b.ready) || Number(b.focused) - Number(a.focused)).slice(0, 8);
      const tab = typeof page.getTabBar === 'function' ? page.getTabBar() : null;
      emit('home_presentation_snapshot', {
        traceId, reason, duration: now() - started, listStage, cacheUsed, listError,
        listLoading: !!page.data.homeListLoading, total: cards.length, pending: pending.length, nativePending: nativePending(cards),
        tabHidden: tab ? !!tab.data.hidden : null, tabPending: !!page._coldStartTabEntrancePending,
        networkType: runtime.networkType, device, swipeCount, layout,
        cards: reason === 'all_ready_state_committed' ? [] : samples,
        imageCache: { ...imageCache, used: imageCache.hits > 0,
          status: imageCache.checked ? 'checked' : imageCache.bypassed ? 'bypassed' : 'not_observed',
          hitRate: imageCache.checked ? imageCache.hits / imageCache.checked : null },
        listCacheUsed: cacheUsed,
        totals: { ...totals }, normalSampleRate: 0.1, normalSampled: sampleNormal,
        stages: { ...stages }, ...extra
      });
    });
  }
  // Geometry and callbacks are evidence, not proof of compositor pixels being painted.
  function measure(reason) {
    if (stopped || typeof page.createSelectorQuery !== 'function') return;
    safe(() => {
      const query = page.createSelectorQuery();
      query.selectAll('.home-card-entrance').boundingClientRect();
      query.selectAll('.card-skeleton').boundingClientRect();
      query.exec(result => {
        if (stopped) return;
        safe(() => {
          layout = { contentNodes: (result[0] || []).length, skeletonNodes: (result[1] || []).length,
            bounds: (result[0] || []).slice(0, 6).map(r => `${r.width}x${r.height}@${r.left},${r.top}`) };
          snapshot(reason);
        });
      });
    });
  }
  const api = {
    snapshot,
    phase(url, name, details = {}) {
      if (stopped || !url) return;
      const attemptKey = `${url}|${details.attempt || 0}`;
      const counter = { attempt_succeeded: 'succeeded', attempt_failed: 'failed', disk_cache_hit: 'cacheHits', disk_cache_miss: 'cacheMisses', disk_cache_invalid: 'cacheInvalid' }[name];
      const counterKey = `${attemptKey}|${name}`;
      if (counter && !counted.has(counterKey)) {
        counted.add(counterKey); totals[counter]++;
        if (counted.size > 600) counted.delete(counted.values().next().value);
      }
      const cacheResult = { disk_cache_hit: 'hits', disk_cache_miss: 'misses', disk_cache_invalid: 'invalid', disk_cache_timeout: 'timeout', disk_cache_error: 'errors', disk_cache_bypassed: 'bypassed' }[name];
      const cacheKey = `${attemptKey}|cache_result`;
      if (cacheResult && !counted.has(cacheKey)) {
        counted.add(cacheKey); imageCache[cacheResult]++;
        if (cacheResult !== 'bypassed') imageCache.checked++;
        if (counted.size > 600) counted.delete(counted.values().next().value);
      }
      const abnormal = /failed|timeout|exhausted|invalid|progress_idle|exception/.test(name);
      if (abnormal) { hadIssue = true; issueUrls.add(url); if (issueUrls.size > 300) issueUrls.delete(issueUrls.values().next().value); }
      const history = attemptRecords.get(attemptKey) || {};
      history[name] = now() - started;
      Object.assign(history, details);
      attemptRecords.set(attemptKey, history);
      if (attemptRecords.size > 300) attemptRecords.delete(attemptRecords.keys().next().value);
      const terminal = ['attempt_failed', 'logical_timeout', 'hard_timeout', 'retry_exhausted', 'manual_retry'].includes(name);
      const slowAttempt = Number.isFinite(history.worker_started) && now() - started - history.worker_started >= 8000;
      const recovery = name === 'attempt_succeeded' && (issueUrls.has(url) || sampleNormal || slowAttempt);
      const cancelledSlow = name === 'page_cancelled' && (issueUrls.has(url) || now() - started >= 8000);
      if (terminal || recovery || cancelledSlow) {
        safe(() => emit('home_media_attempt', { traceId, schemaVersion: 2, sequence: ++eventSequence, url: safeUrl(url), stage: name, duration: now() - started, normalSampleRate: 0.1, normalSampled: sampleNormal, slowAttempt, networkType: runtime.networkType, evidence: { ...history } }));
      }
      const record = phases.get(url) || {};
      record[name] = now() - started;
      for (const key of ['bytes', 'expectedBytes', 'status', 'width', 'height', 'errorCode', 'priority', 'startPriority', 'attempt', 'retries', 'logicalActive', 'outstandingPreparations', 'queued']) {
        if (Number.isFinite(details[key])) record[key] = details[key];
      }
      phases.set(url, record);
      if (phases.size > 300) phases.delete(phases.keys().next().value);
    },
    list(stage, error) { stages[stage] = now() - started; listStage = stage; if (stage === 'cache') cacheUsed = true; listError = error ? String(error).slice(0, 120) : ''; },
    media(url, role, status, meta = {}) {
      if (stopped || !url) return;
      const value = `${String(status).slice(0, 65)}@${now() - started}ms`;
      if (role === 'preload') {
        media.set(url, value);
        if (media.size > 300) media.delete(media.keys().next().value);
      } else if (meta.activityId != null && meta.group) {
        nativeMedia.set(nativeKey(url, role, meta), value);
        if (nativeMedia.size > 600) nativeMedia.delete(nativeMedia.keys().next().value);
      }
    },
    check() {
      if (stopped) return;
      safe(() => {
        if (!settled && !page.data.homeListLoading && rows().every(c => c.ready)) {
          settled = true; snapshot('all_ready_state_committed');
          if (hadIssue) timers.push(setTimer(() => measure('ready_layout'), 700));
        }
      });
    },
    swipe() {
      swipeCount += 1;
      if (swipeCount <= 2 && now() - started >= 8000 && pendingNow()) {
        snapshot('swiper_change');
        timers.push(setTimer(() => { snapshot('after_swipe'); measure('swipe_layout'); }, 700));
      }
    },
    stop() { if (stopped) return; snapshot('page_hide'); stopped = true; safe(() => wxApi.offNetworkStatusChange(networkChanged)); timers.forEach(clearTimer); clearTimer(heartbeatTimer); attemptRecords.clear(); media.clear(); nativeMedia.clear(); phases.clear(); issueUrls.clear(); counted.clear(); }
  };
  [8000, 15000, 60000].forEach(ms => timers.push(setTimer(() => {
    snapshot(`checkpoint_${ms}`);
    if (ms === 15000 && pendingNow()) measure("checkpoint_layout");
  }, ms)));
  const heartbeat = () => { if (stopped) return; if (pendingNow()) snapshot('pending_heartbeat'); if (++heartbeatCount < 3) heartbeatTimer = setTimer(heartbeat, 60000); };
  heartbeatTimer = setTimer(heartbeat, 120000);
  return api;
}
module.exports = { createHomePresentationDiagnostics };
