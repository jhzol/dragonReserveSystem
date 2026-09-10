const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHomeCardMediaLoader } = require('../utils/homeCardMediaLoader');

function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    now: () => now, timers,
    set: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clear: (key) => timers.delete(key),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      now = end;
    }
  };
}
function harness() {
  const c = clock(), requests = [], logs = [], tabCalls = [], prefetchCalls = [];
  let definition;
  const app = { globalData: {} };
  const wx = { nextTick: fn => fn(), getImageInfo: req => requests.push(req), getStorageSync: () => "" };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/activity_list/activity_list.js'), 'utf8'), {
    Page: p => { definition = p; }, getApp: () => app, wx, console,
    Date: class extends Date { static now() { return c.now(); } },
    setTimeout: c.set, clearTimeout: c.clear,
    require(name) {
      if (name.endsWith("/homeCardImagePriority")) return require("../utils/homeCardImagePriority");
      if (name.endsWith("/homeImagePreparation")) return require("../utils/homeImagePreparation");
      if (name.endsWith('/homePresentationDiagnostics')) return {
        createHomePresentationDiagnostics: opts => require('../utils/homePresentationDiagnostics').createHomePresentationDiagnostics({ ...opts, now: c.now, setTimer: c.set, clearTimer: c.clear })
      };
      if (name.endsWith('/homeCardMediaLoader')) return {
        createHomeCardMediaLoader: opts => createHomeCardMediaLoader({ ...opts, setTimer: c.set, clearTimer: c.clear })
      };
      return { createTraceId: () => "test-home-view", logInfo: (...args) => logs.push(args), logError: (...args) => logs.push(args), summarizeError: String,
        setCachedActivityList() {}, cancelScheduledPrefetch() {}, schedulePrefetchSignedUpList() { prefetchCalls.push(c.now()); }, patchTabBarIfNeeded() {} };
    }
  });
  const page = { ...definition, data: structuredClone(definition.data),
    _pageVisible: true, _homeFirstFrameReady: false, _coldStartTabEntrancePending: true,
    _homeReadyImages: new Map(), _homeEnteredMediaKeys: new Set(), _loadedCardGlassUrls: new Set(),
    _setTabBarHidden: (...args) => tabCalls.push(args),
    setData(patch, cb) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let obj = this.data;
        for (const part of parts.slice(0, -1)) obj = obj[part];
        obj[parts.at(-1)] = value;
      }
      if (cb) cb();
    }
  };
  function setGroups(groups) {
    page.setData({ ...page._prepareColdStartCardPresentation({ joined: [], accepting: [], notStarted: [], ended: [], ...groups }), homeListLoading: false });
    page._scheduleColdStartCardEntrance();
  }
  const ready = (url) => {
    const req = requests.find(r => r.src === url);
    assert.ok(req, `preloaded ${url} without swiper callbacks`);
    req.success({ path: `/local/${url}` });
  };
  return { page, c, requests, logs, tabCalls, prefetchCalls, app, setGroups, ready };
}
const big = (id, cover = `cover-${id}`, glass = `glass-${id}`) => ({ _id: String(id), largeCardBgImageUrl: cover, largeCardGlassImageUrl: glass });
const small = id => ({ _id: String(id), smallCardBgImageUrl: `small-${id}` });

test('Tab appears after first frame even when the activity request never returns', () => {
  const h = harness();
  h.page.onReady(); h.c.advance(400);
  assert.equal(h.page.data.homeListLoading, true);
  assert.equal(h.page._coldStartTabEntrancePending, false);
  assert.deepEqual(h.tabCalls.map(x => x[0]), [false]);
  assert.equal(h.tabCalls[0][1].animate, true);
});

test('a missing glass callback never blocks other cards or the Tab, even after 60 seconds', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({ joined: [big(1), big(2), big(3)], ended: [small(4)] });
  h.ready('cover-1'); h.ready('glass-1'); h.ready('small-4');
  h.ready('cover-2'); // glass-2 intentionally never resolves
  h.ready('cover-3'); h.ready('glass-3');
  h.c.advance(60000);
  assert.deepEqual(h.page.data.groupedActivities.joined.map(x => x._homeMediaReady), [true, false, true]);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
  assert.equal(h.page._coldStartTabEntrancePending, false);
  assert.equal(h.page.data.groupedActivities.joined[1].largeCardGlassImageUrl, 'glass-2');
});

test('image errors leave only that card as a skeleton; eventual native success releases it', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.ready('cover-1');
  h.requests.find(r => r.src === 'glass-1').fail({ errMsg: 'offline' });
  h.page.onCardGlassError({ currentTarget: { dataset: { activityId: '1', url: 'glass-1' } } });
  h.c.advance(60000);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  h.page.onCardGlassLoaded({ currentTarget: { dataset: { activityId: '1', url: 'glass-1' } } });
  h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
});

test('refresh/reordering retains revealed cards, while a changed cover waits for the new URL', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1), big(2)] });
  h.ready('cover-1'); h.ready('glass-1'); h.ready('cover-2'); h.ready('glass-2'); h.c.advance(17);
  h.setGroups({ joined: [big(2), big(1)] });
  assert.ok(h.page.data.groupedActivities.joined.every(x => x._homeMediaReady));
  h.setGroups({ joined: [big(1, 'new-cover', 'new-glass')] });
  h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  h.ready('new-cover'); h.ready('new-glass'); h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
});

test('old URL completions cannot reveal a replacement cover', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.setGroups({ joined: [big(1, 'new-cover', 'new-glass')] });
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
});

test('unload cancels timers and ignores late image callbacks', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.page.onUnload();
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(60000);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  assert.equal(h.c.timers.size, 0);
});

test('pagination prepares newly appended cards without resetting existing cards', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1)] });
  h.ready('small-1'); h.c.advance(17);
  h.page._allEndedActivities = [small(1), small(2)];
  h.page.loadMoreEndedActivities();
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, false);
  h.ready('small-2'); h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, true);
});

test('Tab remains hidden while create drawer is open, independently of media', () => {
  const h = harness(); h.page.data.showCreateForm = true; h.page.onReady(); h.c.advance(400);
  assert.equal(h.tabCalls.length, 0);
  assert.equal(h.page._coldStartTabEntrancePending, false);
});

test('shimmer stops updating after all cards are ready and resumes for new cards', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1)] });
  h.ready('small-1'); h.c.advance(2000);
  assert.equal(h.page._skeletonShimmerTimer, null);
  h.setGroups({ ended: [small(1), small(2)] });
  assert.ok(h.page._skeletonShimmerTimer);
});

test('loader retains slow-transfer slots without premature success or duplicate retry', () => {
  const c = clock(), started = [], ready = [], failed = [];
  const loader = createHomeCardMediaLoader({ concurrency: 2, timeoutMs: 100, setTimer: c.set, clearTimer: c.clear,
    load: (url, success, failure) => started.push({ url, success, failure }),
    onReady: url => ready.push(url), onError: url => failed.push(url) });
  loader.enqueue(['a', 'b', 'c', 'a']);
  assert.deepEqual(started.map(x => x.url), ['a', 'b']);
  started[1].success('b');
  assert.deepEqual(started.map(x => x.url), ['a', 'b', 'c']);
  c.advance(100);
  assert.deepEqual(ready, ['b']);
  assert.deepEqual(failed, ['a', 'c']);
  loader.enqueue(['a'], { retryFailed: true });
  assert.equal(started.length, 3);
  started[0].success('late-a');
  started[0].success('duplicate-a');
  assert.deepEqual(ready, ['b', 'a']);
  loader.dispose();
});


test('hide/show resumes unfinished images without resetting cards already shown', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1), small(2)] });
  h.ready('small-1'); h.c.advance(400);
  const staleRequest = h.requests.find(r => r.src === 'small-2');
  h.page.onHide();
  assert.ok(h.page._homeImageLoader);
  assert.equal(h.page._skeletonShimmerTimer, null);
  staleRequest.success({ path: '/stale/small-2' });
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, false);
  h.page.syncGuestState = () => {};
  h.page.loadActivityListByCachePolicy = () => {};
  h.page.consumePendingCreateActivity = () => {};
  h.page.onShow();
  const resumedRequests = h.requests.filter(r => r.src === 'small-2');
  assert.equal(resumedRequests.length, 1);
  assert.equal(h.requests.filter(r => r.src === 'small-1').length, 1);
  h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.ended[1]._homeCoverSrc, '/stale/small-2');
  assert.ok(h.page.data.groupedActivities.ended.every(x => x._homeMediaReady));
  assert.equal(h.tabCalls.at(-1)[0], false);
});


test('late success after timeout reveals its card without needing a native callback', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1)] });
  h.c.advance(16000);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, false);
  h.ready('small-1'); h.c.advance(20);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
});

test('activity form forwards completed close to its parent, but not after reopening', () => {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/activity-form-sheet/index.js'), 'utf8'), {
    Component: d => { definition = d; }, require: () => require("../utils/activityForm"),
  });
  const events = [];
  const ctx = { properties: { visible: false }, setData: (patch, cb) => { if (cb) cb(); }, triggerEvent: e => events.push(e) };
  definition.methods.onContainerAfterLeave.call(ctx);
  assert.deepEqual(events, ['afterleave']);
  const h = harness();
  h.page.data.createFormContainerRendered = true;
  h.page.data.showCreateForm = false;
  h.page.onCreateFormAfterLeave();
  assert.equal(h.page.data.createFormContainerRendered, false);
  assert.equal(h.tabCalls.at(-1)[0], false);
  ctx.properties.visible = true;
  definition.methods.onContainerAfterLeave.call(ctx);
  assert.equal(events.length, 1);
});

test('homepage close restores Tab even if native page-container never emits afterleave', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1)] });
  h.page.data.createFormContainerRendered = true; h.page.data.showCreateForm = true;
  h.page.closeCreateForm(); h.c.advance(399);
  assert.equal(h.page.data.createFormContainerRendered, true);
  h.c.advance(1);
  assert.equal(h.page.data.createFormContainerRendered, false);
  assert.equal(h.tabCalls.at(-1)[0], false);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, false);
  const count = h.tabCalls.length; h.page.onCreateFormAfterLeave();
  assert.equal(h.tabCalls.length, count);
});
test('normal native close cancels watchdog and a reopened form is not dismissed', () => {
  const h = harness();
  h.page.data.createFormContainerRendered = true; h.page.data.showCreateForm = true;
  h.page.closeCreateForm(); h.page.onCreateFormAfterLeave();
  const count = h.tabCalls.length; h.c.advance(500);
  assert.equal(h.tabCalls.length, count);
  h.page.data.createFormContainerRendered = true; h.page.data.showCreateForm = true;
  h.page.closeCreateForm(); h.page.data.showCreateForm = true; h.c.advance(500);
  assert.equal(h.page.data.createFormContainerRendered, true);
  assert.equal(h.tabCalls.length, count);
});
test('closing a hidden homepage form does not change another pages Tab', () => {
  const h = harness(); h.page.data.createFormContainerRendered = true;
  h.page.data.showCreateForm = true; h.page.closeCreateForm();
  h.page._pageVisible = false; h.c.advance(500);
  assert.equal(h.page.data.createFormContainerRendered, false);
  assert.equal(h.tabCalls.length, 0);
});

test('visibility observer promotes newly visible queued cards and ignores events after hide', () => {
  const h = harness(), observers = [];
  h.page.createIntersectionObserver = () => {
    const obs = { relativeTo() { return this; }, relativeToViewport() { return this; },
      observe(selector, cb) { this.cb = cb; }, disconnect() { this.disconnected = true; } };
    observers.push(obs); return obs;
  };
  h.page.onReady(); h.setGroups({ ended: [small(1),small(2),small(3),small(4),small(5)] });
  const observer = observers.at(-1);
  observer.cb({ dataset: { group: 'ended', activityId: '5' }, intersectionRatio: 0.5 });
  h.c.advance(31); assert.equal(h.requests.length, 0);
  h.c.advance(1);
  assert.equal(h.requests.at(-1).src, 'small-5');
  h.page.onHide(); const count = h.requests.length;
  assert.equal(observer.disconnected, true);
  observer.cb({ dataset: { group: 'ended', activityId: '4' }, intersectionRatio: 1 });
  h.c.advance(1000); assert.equal(h.requests.length, count);
});
test('unsupported visibility observer still loads cards instead of blocking the queue', () => {
  const h = harness(); h.page.createIntersectionObserver = () => { throw new Error('unsupported'); };
  h.page.onReady(); h.setGroups({ ended: [small(1)] });
  h.ready('small-1'); h.c.advance(20);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
});

test('exhausted card stops shimmering and tap retries only its missing image', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({ joined: [big(1)], ended: [small(2)] });
  h.ready('cover-1'); h.ready('small-2');
  for (let attempt = 0; attempt < 3; attempt++) {
    h.requests.filter(r => r.src === 'glass-1').at(-1).fail({ errMsg: 'offline' });
    h.c.advance(3000);
  }
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaError, true);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
  assert.equal(h.page._skeletonShimmerTimer, null);
  const before = h.requests.length;
  const focused = JSON.stringify(h.page.data.focusedCardIndex);
  h.page.onRetryHomeCard({ currentTarget: { dataset: { group: 'joined', activityId: '1' } } });
  assert.equal(h.requests.length, before + 1);
  assert.equal(h.requests.at(-1).src, 'glass-1');
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaError, false);
  h.requests.at(-1).success({ path: '/local/recovered-glass' }); h.c.advance(20);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
  assert.equal(JSON.stringify(h.page.data.focusedCardIndex), focused);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
});

test('exhaustion updates all cards sharing a URL, but ignores already-ready images', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({ joined: [big(1, 'shared'), big(2, 'shared')] });
  h.page._setHomeImageExhausted('shared', true);
  assert.ok(h.page.data.groupedActivities.joined.every(c => c._homeMediaError));
  h.page._markHomeImageReady('shared', '/local/shared');
  h.c.advance(17);
  assert.ok(h.page.data.groupedActivities.joined.every(c => !c._homeMediaError));
  h.page._setHomeImageExhausted('shared', true);
  assert.ok(h.page.data.groupedActivities.joined.every(c => !c._homeMediaError));
});

test('retry ignores unknown cards and hidden pages', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1)] });
  const count = h.requests.length;
  h.page.onRetryHomeCard({ currentTarget: { dataset: { group: 'unknown', activityId: '1' } } });
  h.page._pageVisible = false;
  h.page.onRetryHomeCard({ currentTarget: { dataset: { group: 'ended', activityId: '1' } } });
  assert.equal(h.requests.length, count);
});

test('returning to an exhausted page retains explicit retry without redownloading ready images', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({ joined: [big(1)], ended: [small(2)] });
  h.ready('cover-1'); h.ready('small-2');
  for (let i = 0; i < 3; i++) {
    h.requests.filter(r => r.src === 'glass-1').at(-1).fail({ errMsg: 'offline' });
    h.c.advance(3000);
  }
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaError, true);
  const oldRequest = h.requests.filter(r => r.src === 'glass-1').at(-1);
  h.page.onHide();
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaError, false);
  const before = h.requests.length;
  h.c.advance(400000);
  assert.equal(h.requests.length, before);
  h.page._pageVisible = true;
  h.page._prepareHomeCardImages();
  assert.equal(h.requests.length, before);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaError, true);
  h.page.onRetryHomeCard({ currentTarget: { dataset: { group: 'joined', activityId: '1' } } });
  assert.equal(h.requests.length, before + 1);
  assert.equal(h.requests.at(-1).src, 'glass-1');
  oldRequest.success({ path: '/obsolete' });
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  h.requests.at(-1).success({ path: '/recovered' });
  h.c.advance(20);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
});

test('explicit refresh clears exhausted state and restarts the failed image', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1)] });
  for (let i = 0; i < 3; i++) {
    h.requests.at(-1).fail({ errMsg: 'offline' }); h.c.advance(3000);
  }
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaError, true);
  const before = h.requests.length;
  h.page._prepareHomeCardImages({ retryFailed: true });
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaError, false);
  assert.equal(h.requests.length, before + 1);
  h.requests.at(-1).success({ path: '/refreshed' }); h.c.advance(20);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
});

test('hidden completion caches only active images, keeps queue paused, and unload rejects late results', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({ ended: [small(1), small(2), small(3), small(4), small(5)] });
  assert.equal(h.requests.length, 1);
  h.ready('small-1');
  assert.equal(h.requests.length, 4);
  h.page.onHide();
  const hiddenData = JSON.stringify(h.page.data.groupedActivities);
  h.ready('small-2');
  assert.equal(h.requests.length, 4);
  assert.equal(JSON.stringify(h.page.data.groupedActivities), hiddenData);
  assert.equal(h.page._homeReadyImages.get('small-2'), '/local/small-2');
  h.page.onUnload();
  h.ready('small-3');
  assert.equal(h.page._homeReadyImages.has('small-3'), false);
  assert.equal(h.page._homeImageLoader, null);
  h.c.advance(400000);
  assert.equal(h.requests.length, 4);
});

function nativeImageEvent(id, url, mediaSrc, group = 'joined') {
  return { currentTarget: { dataset: { activityId: String(id), group, url, mediaSrc } }, detail: { errMsg: 'local image decode failed' } };
}
test('native cover failure retries only the broken resource and keeps the other card and Tab ready', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1), big(2)] });
  for (const url of ['cover-1', 'glass-1', 'cover-2', 'glass-2']) h.ready(url);
  h.c.advance(400);
  h.page.onCardBgError(nativeImageEvent(1, 'cover-1', '/local/cover-1'));
  const cards = h.page.data.groupedActivities.joined;
  assert.equal(cards[0]._homeMediaReady, false); assert.equal(cards[0]._homeCoverSrc, '');
  assert.equal(cards[0]._homeGlassSrc, '/local/glass-1'); assert.equal(cards[1]._homeMediaReady, true);
  assert.equal(h.page._coldStartTabEntrancePending, false);
  h.c.advance(1000);
  const retries = h.requests.filter(r => r.src === 'cover-1'); assert.equal(retries.length, 2);
  retries[1].success({ path: '/local/fixed-cover' }); h.c.advance(17);
  assert.equal(cards[0]._homeMediaReady, true); assert.equal(cards[0]._homeCoverSrc, '/local/fixed-cover');
  assert.equal(h.requests.filter(r => r.src === 'glass-1').length, 1);
});
test('native glass failure uses bounded retries and exposes the existing manual retry control', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(400);
  for (let i = 0; i < 3; i++) {
    const card = h.page.data.groupedActivities.joined[0];
    h.page.onCardGlassError(nativeImageEvent(1, 'glass-1', card._homeGlassSrc));
    if (i < 2) {
      h.c.advance((i + 1) * 1000);
      h.requests.filter(r => r.src === 'glass-1').at(-1).success({ path: `/local/glass-retry-${i}` });
      h.c.advance(17);
    }
  }
  const card = h.page.data.groupedActivities.joined[0];
  assert.equal(card._homeMediaReady, false); assert.equal(card._homeMediaError, true);
  h.c.advance(60000); assert.equal(h.requests.filter(r => r.src === 'glass-1').length, 3);
  h.page.onRetryHomeCard(nativeImageEvent(1, 'glass-1', '', 'joined'));
  assert.equal(h.requests.filter(r => r.src === 'glass-1').length, 4);
  h.requests.at(-1).success({ path: '/local/good-glass' }); h.c.advance(17);
  assert.equal(card._homeMediaReady, true); assert.equal(card._homeMediaError, false);
});
test('callbacks from replaced native images cannot invalidate or resurrect the current resource', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(400);
  const oldEvent = nativeImageEvent(1, 'cover-1', '/local/cover-1');
  h.page.onCardBgError(oldEvent); h.page.onCardBgLoaded(oldEvent);
  assert.equal(h.page._homeReadyImages.has('cover-1'), false);
  h.c.advance(1000); h.requests.at(-1).success({ path: '/local/new-cover' }); h.c.advance(17);
  h.page.onCardBgError(oldEvent); h.c.advance(10000);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
  assert.equal(h.page._homeReadyImages.get('cover-1'), '/local/new-cover');
  assert.equal(h.requests.filter(r => r.src === 'cover-1').length, 2);
});
test('a native error while hidden invalidates cache without setData and recovers after returning', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(400); h.page.onHide();
  const setData = h.page.setData;
  h.page.setData = () => { throw new Error('hidden page mutation'); };
  assert.doesNotThrow(() => h.page.onCardBgError(nativeImageEvent(1, 'cover-1', '/local/cover-1')));
  h.c.advance(1000); assert.equal(h.requests.length, 2);
  assert.equal(h.page._homeReadyImages.has('cover-1'), false);
  h.page.setData = setData; h.page._pageVisible = true; h.page._prepareHomeCardImages();
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  assert.equal(h.requests.length, 3); h.requests.at(-1).success({ path: '/local/returned-cover' }); h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
});
test('every native cover and glass element identifies the actual source for stale callback isolation', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/activity_list/activity_list.wxml'), 'utf8');
  const images = wxml.match(/<image\s[^>]*binderror="onCard(?:Bg|Glass)Error"[^>]*\/>/g) || [];
  assert.equal(images.length, 5);
  for (const image of images) assert.match(image, /data-media-src="\{\{item\._home(?:Cover|Glass)Src\}\}"/);
});

test('one broken URL shared by large and small cards is downloaded only once for recovery', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)], accepting: [{ _id: '2', smallCardBgImageUrl: 'cover-1' }] });
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(400);
  h.page.onCardBgError(nativeImageEvent(2, 'cover-1', '/local/cover-1', 'accepting'));
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, false);
  assert.equal(h.page.data.groupedActivities.accepting[0]._homeMediaReady, false);
  h.page.onCardBgError(nativeImageEvent(1, 'cover-1', '/local/cover-1'));
  h.c.advance(1000); assert.equal(h.requests.filter(r => r.src === 'cover-1').length, 2);
  h.requests.at(-1).success({ path: '/local/shared-fixed' }); h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.accepting[0]._homeMediaReady, true);
});
test('recovery completed while hidden is reused on return without a third download', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.ready('cover-1'); h.ready('glass-1'); h.c.advance(400);
  h.page.onCardBgError(nativeImageEvent(1, 'cover-1', '/local/cover-1')); h.c.advance(1000);
  h.page.onHide(); h.requests.at(-1).success({ path: '/local/hidden-fixed' });
  assert.equal(h.page._homeReadyImages.get('cover-1'), '/local/hidden-fixed');
  h.page._pageVisible = true; h.page._prepareHomeCardImages(); h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeCoverSrc, '/local/hidden-fixed');
  assert.equal(h.requests.filter(r => r.src === 'cover-1').length, 2);
});

test('initial offscreen callback cannot release background before visible batch; no callbacks has bounded fallback', () => {
  for (const callbacks of [true, false]) {
    const h = harness(); let cb;
    h.page.createIntersectionObserver = () => ({relativeTo() {return this;}, relativeToViewport() {return this;}, observe(_, fn) {cb=fn;}, disconnect() {}});
    h.page.onReady(); h.setGroups({ended:[small(1),small(2),small(3)]});
    if (callbacks) cb({dataset:{group:'ended',activityId:'3'}, intersectionRatio:0});
    h.c.advance(32); assert.equal(h.requests.length,0);
    if (callbacks) cb({dataset:{group:'ended',activityId:'2'}, intersectionRatio:0.1});
    h.c.advance(88);
    assert.deepEqual(h.requests.map(r=>r.src), [callbacks ? 'small-2' : 'small-1']);
    h.page.onUnload(); h.c.advance(400000); assert.equal(h.c.timers.size,0);
  }
});

test('rows enter simultaneously, stagger within each row, and survive refresh with missing media', () => {
  const h = harness(); h.page._homeFirstFrameReady = true;
  h.page._homeVisibilityKnown = true;
  const groups = {joined:[big('j1'),big('j2')],accepting:[small('a1'),small('a2')],ended:[small('e1'),small('e2')]};
  h.page._homeVisibleCardKeys = new Set(Object.entries(groups).flatMap(([g,cs])=>cs.map(c=>JSON.stringify([g,c._id]))));
  h.page.setData(h.page._prepareColdStartCardPresentation(groups));
  h.page._startHomeSlotEntrance(); h.c.advance(200);
  for (const cards of Object.values(h.page.data.groupedActivities)) {
    assert.equal(cards[0]._homeSlotEntered,true);
    assert.equal(cards[1]._homeSlotEntered,false);
  }
  h.page.setData(h.page._prepareColdStartCardPresentation(groups));
  h.c.advance(199);
  for (const cards of Object.values(h.page.data.groupedActivities)) assert.equal(cards[1]._homeSlotEntered,false);
  h.c.advance(1);
  for (const cards of Object.values(h.page.data.groupedActivities)) {
    assert.equal(cards[1]._homeSlotEntered,true);
    assert.equal(cards[1]._homeMediaReady,false);
  }
  h.page._finishColdStartCardEntrance(); h.page._startHomeSlotEntrance();
  for (const cards of Object.values(h.page.data.groupedActivities)) assert.equal(cards[1]._homeSlotEntered,true);
});


test('initial exposure collects partial neighbours before 120ms without visibility render patches', () => {
  const h = harness(); let observer;
  h.page.createIntersectionObserver = () => (observer = {
    relativeTo() { return this; }, relativeToViewport() { return this; },
    observe(selector, cb) { this.cb = cb; }, disconnect() {}
  });
  h.page.onReady(); h.setGroups({ ended: [small(1), small(2), small(3)] });
  observer.cb({dataset: {group: 'ended', activityId: '1'}, intersectionRatio: 1});
  h.c.advance(20);
  observer.cb({dataset: {group: 'ended', activityId: '2'}, intersectionRatio: 0.1});
  h.c.advance(31); assert.equal(h.requests.length, 0);
  h.c.advance(1);
  assert.deepEqual(h.requests.map(r => r.src), ['small-1', 'small-2']);
  assert.equal(Object.hasOwn(h.page.data.groupedActivities.ended[2], "_homeVisible"), false);
  observer.cb({dataset: {group: 'ended', activityId: '3'}, intersectionRatio: 0.5});
  h.c.advance(32);
  assert.equal(Object.hasOwn(h.page.data.groupedActivities.ended[2], "_homeVisible"), false);
  h.page.onUnload(); assert.equal(h.c.timers.size, 0);
});

test('missing initial exposure callback falls back at 120ms', () => {
  const h = harness();
  h.page.createIntersectionObserver = () => ({ relativeTo() {return this;},
    relativeToViewport() {return this;}, observe() {}, disconnect() {} });
  h.page.onReady(); h.setGroups({ ended: [small(1)] });
  h.c.advance(119); assert.equal(h.requests.length, 0);
  h.c.advance(1); assert.equal(h.requests[0].src, 'small-1');
});


test('same-frame completions share one update and touch only indexed cards', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({joined: [big(1, 'shared', 'glass')], ended: [{_id:'2', smallCardBgImageUrl:'shared'}, small(3)]});
  h.c.advance(40);
  const patches = [], original = h.page.setData;
  h.page.setData = function(patch, cb) { patches.push(patch); original.call(this, patch, cb); };
  h.page._markHomeImageReady('shared', '/local/shared');
  h.page._markHomeImageReady('glass', '/local/glass');
  assert.equal(patches.length, 0);
  h.c.advance(17);
  assert.equal(patches.length, 1);
  assert.equal(h.page.data.groupedActivities.joined[0]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, false);
  assert.ok(Object.keys(patches[0]).every(key => !key.startsWith('groupedActivities.ended[1]')));
});

test('queued ready frame resolves reordered and replaced cards through rebuilt index', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ended:[small(1),small(2)]});
  h.page._markHomeImageReady('small-1', '/local/one');
  h.setGroups({ended:[small(2),small(1),{_id:'3',smallCardBgImageUrl:'new'}]});
  h.c.advance(17);
  assert.equal(h.page.data.groupedActivities.ended[1]._homeCoverSrc, '/local/one');
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, true);
  assert.equal(h.page.data.groupedActivities.ended[0]._homeMediaReady, false);
  assert.equal(h.page.data.groupedActivities.ended[2]._homeMediaReady, false);
});


test('extras wait for foreground media, not animation or background cards', () => {
  const h = harness(); h.page.onReady();
  h.setGroups({ ended: [small(1), small(2)] });
  h.page._homePrefetchPending = true;
  h.page._maybePrefetchHomeExtras(); assert.equal(h.prefetchCalls.length, 0);
  h.ready('small-1'); h.c.advance(17);
  assert.deepEqual(h.prefetchCalls, [17]);
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, false);
  h.page._maybePrefetchHomeExtras(); assert.equal(h.prefetchCalls.length, 1);
});

test('failed foreground card releases extras, while hidden page cannot prefetch', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ended:[small(1)]});
  h.page._homePrefetchPending = true;
  h.page._setHomeImageExhausted('small-1', true);
  assert.equal(h.prefetchCalls.length, 1);
  h.page._homePrefetchPending = true; h.page.onHide();
  h.page._maybePrefetchHomeExtras(); assert.equal(h.prefetchCalls.length, 1);
});

test('presentation removes full duplicate payloads but keeps counts and render fields', () => {
  const h = harness();
  const full = {...big(1), title:'title', participants:[{id:1},{id:2}],
    activityCover:{large:'unused'}, avatarList:[{url:'unused'}],
    showAvatarCluster:true, cardAvatars:[{url:'avatar',name:'unused',id:1}]};
  const card = h.page._prepareColdStartCardPresentation({joined:[full]}).groupedActivities.joined[0];
  assert.equal(card.participantCount,2); assert.equal(card.title,'title');
  for (const key of ['participants','avatarList','activityCover']) assert.equal(key in card,false);
  assert.equal(card.cardAvatars[0].url,'avatar'); assert.equal('name' in card.cardAvatars[0],false);
  assert.equal(full.participants.length,2);
  for (const key of ['activityList','filteredList','allEndedActivities']) assert.equal(key in h.page.data,false);
});


test('identical responses skip processing; changed card updates without replacing unaffected card', async () => {
  const h = harness(); let processed = 0;
  h.page.processActivityList = raw => { processed++; return {list:raw}; };
  const list = [1,2].map(id=>({...small(id),name:`card${id}`,status:'已结束',participants:[]}));
  await h.page.loadActivityList({responsePromise:Promise.resolve(list)});
  const first = h.page.data.groupedActivities.ended[0];
  const patches = [], original = h.page.setData;
  h.page.setData = function(patch,cb) { patches.push(patch); original.call(this,patch,cb); };
  await h.page.loadActivityList({responsePromise:Promise.resolve(structuredClone(list))});
  assert.equal(processed,1); assert.equal(patches.length,0);
  list[1].name='changed'; list[1].participants=[{id:'new'}];
  await h.page.loadActivityList({responsePromise:Promise.resolve(list)});
  assert.equal(processed,2);
  assert.equal(h.page.data.groupedActivities.ended[0],first);
  assert.equal(h.page.data.groupedActivities.ended[1].name,'changed');
  assert.equal(h.page.data.groupedActivities.ended[1].participantCount,1);
  assert.ok(!patches.some(patch=>'groupedActivities' in patch));
});

test('same response reprocesses at a time boundary and after account change', async () => {
  const h=harness(); let processed=0;
  const list=[{...small(1),name:'event',startTime:'1970-01-01 00:01',status:'未开始',participants:[]}];
  h.page.processActivityList=raw=>{processed++; return {list:raw};};
  await h.page.loadActivityList({responsePromise:Promise.resolve(list)});
  h.page._nextListStatusAt=10;
  h.c.advance(10);
  await h.page.loadActivityList({responsePromise:Promise.resolve(list)});
  assert.equal(processed,2);
  h.page.data.myUserId='other';
  await h.page.loadActivityList({responsePromise:Promise.resolve(list)});
  assert.equal(processed,3);
});

test('avatar fallback updates the displayed last-three avatar rather than an earlier participant', () => {
  const { page } = harness();
  const avatars = Array.from({length: 6}, (_, i) => ({url: `avatar-${i}`}));
  const activity = {_id: 61, avatarList: avatars, cardAvatars: avatars.slice(-3)};
  page._activityList = [activity];
  let commits = 0;
  page._commitHomeList = () => { commits++; };
  page.onAvatarError({currentTarget: {dataset: {activityId: '61', index: 2}}});
  assert.equal(commits, 1);
  assert.equal(activity.avatarList[2].url, 'avatar-2');
  assert.equal(activity.cardAvatars[2], activity.avatarList[5]);
  assert.equal(activity.cardAvatars[2].isDefault, true);
  page.onAvatarError({currentTarget: {dataset: {activityId: '61', index: -1}}});
  assert.equal(commits, 1);
});

test('touch promotion updates image priority without controlling skeleton visibility', () => {
  const h = harness(); let observer;
  h.page.createIntersectionObserver = () => (observer = {
    relativeTo() { return this; }, relativeToViewport() { return this; },
    observe(selector, cb) { this.cb = cb; }, disconnect() {}
  });
  h.page.onReady(); h.setGroups({ joined: [big(1), big(2), big(3)] });
  observer.cb({ dataset: { group: 'joined', activityId: '1' }, intersectionRatio: 1 });
  h.c.advance(32);
  assert.equal(h.page._homeVisibleCardKeys.has(JSON.stringify(["joined", "2"])), false);
  h.page.onGroupSwiperChange({currentTarget: {dataset: {group: 'joined'}}, detail: {current: 1, source: 'touch'}});
  assert.equal(h.page._homeVisibleCardKeys.has(JSON.stringify(["joined", "2"])), true);
  assert.equal(h.page._homeVisibleCardKeys.has(JSON.stringify(["joined", "1"])), false);
  observer.cb({ dataset: { group: 'joined', activityId: '3' }, intersectionRatio: 0.1 });
  h.c.advance(32);
  assert.equal(h.page._homeVisibleCardKeys.has(JSON.stringify(["joined", "3"])), true);
  h.page.onUnload(); assert.equal(h.c.timers.size, 0);
});

test('logout clears previous account cards and focus before a pending network response', () => {
  const h = harness();
  h.page._homeListOwner = 'previous-user';
  h.page._activityList = [big(1)];
  h.page._allEndedActivities = [small(2)];
  h.page._filteredList = [big(1)];
  h.page._focusedCardActivityIds = { joined: '1' };
  h.page._lastRawListSignature = 'previous-response';
  h.page.data.myUserId = '';
  h.page.data.groupedActivities.joined = [big(1)];
  h.page.data.focusedCardIndex.joined = 2;
  h.page.loadActivityListFromCache = () => false;
  let requested = 0;
  h.page.loadActivityList = () => { requested++; return new Promise(() => {}); };
  h.page.loadActivityListByCachePolicy();
  assert.equal(requested, 1);
  assert.equal(h.page._homeListOwner, '');
  assert.equal(h.page._activityList.length, 0);
  assert.equal(h.page._allEndedActivities.length, 0);
  assert.equal(h.page._filteredList.length, 0);
  assert.equal(h.page._lastRawListSignature, null);
  assert.equal(Object.keys(h.page._focusedCardActivityIds).length, 0);
  assert.equal(h.page.data.groupedActivities.joined.length, 0);
  assert.equal(h.page.data.focusedCardIndex.joined, 0);
  assert.equal(h.page.data.homeListLoading, true);
});


test('offscreen pending cards keep shimmer active; completion still stops it', () => {
  const h = harness();
  h.page.onReady(); h.setGroups({ joined: [big(1)] });
  h.page._homeVisibilityKnown = true;
  h.page._homeVisibleCardKeys = new Set();
  h.page._startSkeletonShimmer();
  h.c.advance(1700);
  assert.ok(h.page._skeletonShimmerTimer);
  h.page.data.groupedActivities.joined[0]._homeMediaReady = true;
  h.c.advance(1700);
  assert.equal(h.page._skeletonShimmerTimer, null);
  assert.equal(h.page.data.skeletonShimmerRunning, false);
  const template = fs.readFileSync(path.join(__dirname, '../pages/activity_list/activity_list.wxml'), 'utf8');
  assert.equal(template.includes('item._homeVisible'), false);
  h.page.onUnload();
});

test('search and filters use internal full list without sending it to render data', () => {
  const h = harness();
  h.page._activityList = [
    { _id: '1', name: '羽毛球', remark: '晚上', status: '未开始', hasSignedUp: true },
    { _id: '2', name: '桌游', remark: '周末聚会', status: '已结束', hasSignedUp: false }
  ];
  h.page.onFilterChange({ currentTarget: { dataset: { filter: '全部' } } });
  h.page.onSearchInput({ detail: { value: ' 周末 ' } });
  assert.deepEqual(h.page._filteredList.map(x => x._id), ['2']);
  h.page.onSearchInput({ detail: { value: '' } });
  h.page.onFilterChange({ currentTarget: { dataset: { filter: '我参与的' } } });
  assert.deepEqual(h.page._filteredList.map(x => x._id), ['1']);
  h.page.onFilterChange({ currentTarget: { dataset: { filter: '已结束' } } });
  assert.deepEqual(h.page._filteredList.map(x => x._id), ['2']);
  for (const key of ['activityList', 'filteredList', 'allEndedActivities']) assert.equal(Object.hasOwn(h.page.data, key), false);
  h.page.onUnload();
});

test('ended pagination reaches all internal records without duplication or resetting focus', () => {
  const h = harness();
  h.page._allEndedActivities = Array.from({length: 12}, (_, i) => small(i + 1));
  h.setGroups({ ended: h.page._allEndedActivities.slice(0, 5) });
  h.page.data.focusedCardIndex.ended = 3;
  h.page.loadMoreEndedActivities();
  assert.equal(h.page.data.groupedActivities.ended.length, 10);
  assert.equal(h.page.data.endedHasMore, true);
  assert.equal(h.page.data.focusedCardIndex.ended, 3);
  h.page.loadMoreEndedActivities();
  assert.equal(h.page.data.groupedActivities.ended.length, 12);
  assert.equal(h.page.data.endedHasMore, false);
  assert.equal(new Set(h.page.data.groupedActivities.ended.map(x => x._id)).size, 12);
  h.page.loadMoreEndedActivities();
  assert.equal(h.page.data.groupedActivities.ended.length, 12);
  assert.equal(h.page.data.focusedCardIndex.ended, 3);
  h.page.onUnload();
});

test('ended pagination with one stalled image preserves revealed cards across every page', () => {
  const h = harness();
  h.page.onReady();
  h.page._allEndedActivities = Array.from({ length: 40 }, (_, i) => small(i + 1));
  h.setGroups({ ended: h.page._allEndedActivities.slice(0, 5) });
  h.page.data.focusedCardIndex.ended = 2;
  const completed = new Set();
  for (let batch = 0; batch < 8; batch++) {
    // Complete images out of order; image 2 intentionally never calls back.
    for (let tick = 0; tick < 50; tick++) {
      for (const req of [...h.requests].reverse()) {
        if (req.src === 'small-2' || completed.has(req.src)) continue;
        completed.add(req.src);
        req.success({ path: `/local/${req.src}` });
      }
      h.c.advance(20);
    }
    const cards = h.page.data.groupedActivities.ended;
    assert.equal(new Set(cards.map(card => card._id)).size, cards.length);
    for (const card of cards) {
      assert.equal(card._homeMediaReady, card._id !== '2', `card ${card._id}, batch ${batch}`);
    }
    assert.equal(h.page.data.focusedCardIndex.ended, 2);
    assert.equal(h.page._coldStartTabEntrancePending, false);
    if (batch < 7) h.page.loadMoreEndedActivities();
  }
  assert.equal(h.page.data.groupedActivities.ended.length, 40);
  assert.equal(h.page.data.endedHasMore, false);
  h.page.onUnload();
  assert.equal(h.c.timers.size, 0);
});

test('cache policy refreshes exactly once after either cache result', () => {
  for (const cached of [true, false]) {
    const h = harness(), calls = [];
    h.page.loadActivityListFromCache = () => { calls.push('cache'); return cached; };
    const result = Promise.resolve();
    h.page.loadActivityList = () => { calls.push('network'); return result; };
    assert.equal(h.page.loadActivityListByCachePolicy(), result);
    assert.deepEqual(calls, ['cache', 'network']);
  }
});

test('finishing completed slot entrances does not resubmit unchanged cards', () => {
  const h = harness();
  h.setGroups({ joined: [big(1), big(2)] });
  h.page._homeSlotEntranceDone = true;
  h.page.data.groupedActivities.joined.forEach(item => { item._homeSlotEntered = true; });
  const patches = [], original = h.page.setData;
  h.page.setData = function(patch, cb) { patches.push(patch); original.call(this, patch, cb); };
  h.page._finishColdStartCardEntrance();
  assert.equal(patches.length, 0);
  h.page.data.groupedActivities.joined[1]._homeSlotEntered = false;
  h.page._finishColdStartCardEntrance();
  assert.deepEqual(Object.keys(patches[0]), ['groupedActivities.joined[1]._homeSlotEntered']);
  assert.equal(h.page.data.groupedActivities.joined[1]._homeSlotEntered, true);
  for (const card of h.page.data.groupedActivities.joined) assert.equal('_homeSlotDelay' in card, false);
});

test('a ready image awaiting its entrance keeps its stationary skeleton shimmering', () => {
  const h = harness();
  h.page._homeFirstFrameReady = true;
  h.page.data.homeListLoading = false;
  h.page.data.groupedActivities = { joined: [{ _homeMediaReady: true, _homeSlotEntered: false }] };
  h.page._startSkeletonShimmer();
  assert.equal(h.page.data.skeletonShimmerRunning, true);
  h.c.advance(1600);
  assert.equal(h.page.data.skeletonShimmerRunning, true);
  h.page.data.groupedActivities.joined[0]._homeSlotEntered = true;
  h.c.advance(1500);
  assert.equal(h.page.data.skeletonShimmerRunning, false);
  assert.equal(h.page._skeletonShimmerTimer, null);
});

test('all cards enter in row order regardless of exposure or pending visibility collection', () => {
  for (const known of [true, false]) {
    const h = harness();
    h.page._homeFirstFrameReady = true;
    h.page._homeVisibilityKnown = known;
    h.page._homeVisibilityCollecting = true;
    h.page._homeVisibleCardKeys = new Set([JSON.stringify(['ended', '2'])]);
    h.page.data.focusedCardIndex.ended = 1;
    h.page.setData(h.page._prepareColdStartCardPresentation({ ended: [small(1), small(2), small(3)] }));
    h.page._startHomeSlotEntrance();
    const states = () => h.page.data.groupedActivities.ended.map(item => item._homeSlotEntered);
    assert.deepEqual(states(), [false, false, false]);
    h.c.advance(200);
    assert.deepEqual(states(), [true, false, false]);
    h.c.advance(200);
    assert.deepEqual(states(), [true, true, false]);
    h.c.advance(200);
    assert.deepEqual(states(), [true, true, true]);
    h.page._startHomeSlotEntrance();
    assert.deepEqual(states(), [true, true, true]);
  }
});

test('offscreen cards download and become ready without any further swipe or exposure event', () => {
  const h = harness(); let observer;
  h.page.createIntersectionObserver = () => (observer = {
    relativeTo() { return this; }, relativeToViewport() { return this; },
    observe(selector, cb) { this.cb = cb; }, disconnect() {}
  });
  h.page.onReady();
  h.setGroups({ joined: [big(1), big(2), big(3)] });
  observer.cb({ dataset: { group: 'joined', activityId: '1' }, intersectionRatio: 1 });
  h.c.advance(120);
  h.ready('cover-1'); h.ready('glass-1');
  // No swipe and no further observer callbacks: completion pumps the queue.
  h.ready('cover-2'); h.ready('glass-2');
  h.ready('cover-3'); h.ready('glass-3');
  h.c.advance(2200);
  assert.deepEqual(h.page.data.groupedActivities.joined.map(card => card._homeMediaReady), [true, true, true]);
  assert.deepEqual(h.page.data.groupedActivities.joined.map(card => card._homeSlotEntered), [true, true, true]);
  h.page.onUnload();
});

test('entrance interval supports live tuning including zero, with invalid values falling back', () => {
  for (const [value, expected] of [[200, 200], [0, 0], [-1, 200], [NaN, 200]]) {
    const h = harness();
    h.page._homeFirstFrameReady = true;
    h.page._homeCardEntranceIntervalMs = value;
    h.page.setData(h.page._prepareColdStartCardPresentation({ joined: [big(1), big(2)] }));
    h.page._startHomeSlotEntrance();
    h.c.advance(199 + expected);
    assert.equal(h.page.data.groupedActivities.joined[1]._homeSlotEntered, false);
    h.c.advance(1);
    assert.equal(h.page.data.groupedActivities.joined[1]._homeSlotEntered, true);
  }
});

test('first entrance delay can be tuned independently of adjacent-card interval', () => {
  for (const [value, expected] of [[500, 500], [0, 0], [-1, 200], [NaN, 200]]) {
    const h = harness();
    h.page._homeFirstFrameReady = true;
    h.page._homeCardFirstEntranceDelayMs = value;
    h.page._homeCardEntranceIntervalMs = 200;
    h.page.setData(h.page._prepareColdStartCardPresentation({ joined: [big(1), big(2)] }));
    h.page._startHomeSlotEntrance();
    if (expected > 0) {
      h.c.advance(expected - 1);
      assert.equal(h.page.data.groupedActivities.joined[0]._homeSlotEntered, false);
      h.c.advance(1);
    } else h.c.advance(0);
    assert.equal(h.page.data.groupedActivities.joined[0]._homeSlotEntered, true);
    assert.equal(h.page.data.groupedActivities.joined[1]._homeSlotEntered, false);
    h.c.advance(200);
    assert.equal(h.page.data.groupedActivities.joined[1]._homeSlotEntered, true);
  }
});
