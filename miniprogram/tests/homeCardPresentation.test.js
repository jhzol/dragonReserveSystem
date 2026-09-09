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
  const c = clock(), requests = [], logs = [], tabCalls = [];
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
        cancelScheduledPrefetch() {}, patchTabBarIfNeeded() {} };
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
  return { page, c, requests, logs, tabCalls, app, setGroups, ready };
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
  h.page.data.allEndedActivities = [small(1), small(2)];
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
  h.c.advance(32); assert.equal(h.requests.length, 0);
  h.c.advance(88);
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
