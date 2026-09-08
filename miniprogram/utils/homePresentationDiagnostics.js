/** Bounded observations only: never changes card readiness or retries media. */
function createHomePresentationDiagnostics({ page, wxApi, emit, traceId, now = Date.now,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const started = now(), timers = [], media = new Map(), nativeMedia = new Map();
  const nativeKey = (url, role, meta) => JSON.stringify([String(meta.activityId), meta.group, role, url]);
  let stopped = false, settled = false, swipeCount = 0;
  const reasonCounts = new Map();
  let layout = "not_measured";
  let listStage = 'not_started', cacheUsed = false, listError = '';
  const stages = {};
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
          ready: !!item._homeMediaReady, cover: state(cover, 'cover'), glass: state(glass, 'glass'),
          video: state(item.bgVideoUrl, 'video'), coverUrl: safeUrl(cover), glassUrl: safeUrl(glass) });
      });
    });
    return result;
  }
  function snapshot(reason, extra = {}) {
    if (stopped) return;
    const count = reasonCounts.get(reason) || 0;
    if (count >= 3) return;
    reasonCounts.set(reason, count + 1);
    safe(() => {
      const cards = rows(), pending = cards.filter(c => !c.ready);
      const samples = cards.slice().sort((a, b) => Number(a.ready) - Number(b.ready) || Number(b.focused) - Number(a.focused)).slice(0, 8);
      const tab = typeof page.getTabBar === 'function' ? page.getTabBar() : null;
      emit('home_presentation_snapshot', {
        traceId, reason, duration: now() - started, listStage, cacheUsed, listError,
        listLoading: !!page.data.homeListLoading, total: cards.length, pending: pending.length,
        tabHidden: tab ? !!tab.data.hidden : null, tabPending: !!page._coldStartTabEntrancePending,
        networkType: runtime.networkType, device, swipeCount, layout,
        cards: samples, stages: { ...stages }, ...extra
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
          timers.push(setTimer(() => measure('ready_layout'), 700));
        }
      });
    },
    swipe() {
      swipeCount += 1;
      if (swipeCount <= 2) {
        snapshot('swiper_change');
        timers.push(setTimer(() => { snapshot('after_swipe'); measure('swipe_layout'); }, 700));
      }
    },
    stop() { if (stopped) return; snapshot('page_hide'); stopped = true; timers.forEach(clearTimer); media.clear(); nativeMedia.clear(); }
  };
  snapshot('page_enter');
  [8000, 15000, 60000].forEach(ms => timers.push(setTimer(() => {
    snapshot(`checkpoint_${ms}`);
    if (ms === 15000) measure("checkpoint_layout");
  }, ms)));
  return api;
}
module.exports = { createHomePresentationDiagnostics };
