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

test('loader bounds concurrency; a timed-out job frees a slot without reporting success', () => {
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
  assert.equal(started.length, 4);
  started[0].success('late-a');
  assert.deepEqual(ready, ['b']);
  started[3].success('a');
  assert.deepEqual(ready, ['b', 'a']);
  loader.dispose();
});


test('hide/show resumes unfinished images without resetting cards already shown', () => {
  const h = harness(); h.page.onReady(); h.setGroups({ ended: [small(1), small(2)] });
  h.ready('small-1'); h.c.advance(400);
  const staleRequest = h.requests.find(r => r.src === 'small-2');
  h.page.onHide();
  assert.equal(h.page._homeImageLoader, null);
  assert.equal(h.page._skeletonShimmerTimer, null);
  staleRequest.success({ path: '/stale/small-2' });
  assert.equal(h.page.data.groupedActivities.ended[1]._homeMediaReady, false);
  h.page.syncGuestState = () => {};
  h.page.loadActivityListByCachePolicy = () => {};
  h.page.consumePendingCreateActivity = () => {};
  h.page.onShow();
  const resumedRequests = h.requests.filter(r => r.src === 'small-2');
  assert.equal(resumedRequests.length, 2);
  assert.equal(h.requests.filter(r => r.src === 'small-1').length, 1);
  resumedRequests[1].success({ path: '/local/small-2' }); h.c.advance(17);
  assert.ok(h.page.data.groupedActivities.ended.every(x => x._homeMediaReady));
  assert.equal(h.tabCalls.at(-1)[0], false);
});
