const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomePresentationDiagnostics } = require('../utils/homePresentationDiagnostics');
function setup(overrides = {}) {
  let time = 0, id = 0;
  const timers = new Map(), events = [];
  const page = { data: { homeListLoading: true, focusedCardIndex: { joined: 0 }, groupedActivities: { joined: [
    { _id: '42', largeCardBgImageUrl: 'https://cdn.test/cover.jpg?token=secret', largeCardGlassImageUrl: 'https://cdn.test/glass.jpg', _homeMediaReady: false }
  ] } }, _homeReadyImages: new Map(), getTabBar: () => ({ data: { hidden: false } }) };
  const recorder = createHomePresentationDiagnostics({page, wxApi: {}, traceId: 'view-1', now: () => time,
    emit: (event, data) => events.push({ event, ...data }), setTimer: (fn, delay) => { timers.set(++id, { fn, at: time + delay }); return id; },
    clearTimer: id => timers.delete(id), ...overrides });
  const advance = ms => { const end = time + ms; for (;;) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a,b)=>a[1].at-b[1].at)[0];
    if (!next) break; timers.delete(next[0]); time = next[1].at; next[1].fn();
  } time = end; };
  return { page, recorder, events, timers, advance };
}
test('checkpoints distinguish missing list from missing glass, with trace and native/preload evidence', () => {
  const h = setup(); h.recorder.list('request_pending'); h.advance(8000);
  assert.equal(h.events.at(-1).listStage, 'request_pending');
  assert.equal(h.events.at(-1).listLoading, true);
  h.page.data.homeListLoading = false; h.recorder.list('list_processed');
  const cover = h.page.data.groupedActivities.joined[0].largeCardBgImageUrl;
  h.page._homeReadyImages.set(cover, 'local'); h.recorder.media(cover, 'preload', 'loaded');
  h.advance(7000);
  const e = h.events.at(-1);
  assert.equal(e.traceId, 'view-1'); assert.equal(e.pending, 1); assert.equal(e.tabHidden, false);
  assert.match(e.cards[0].cover, /prepared;native=no_callback;preload=loaded@8000ms/);
  assert.match(e.cards[0].glass, /pending;native=no_callback/);
  assert.equal(e.cards[0].coverUrl, 'https://cdn.test/cover.jpg');
});
test('swipe snapshots preserve before/after state, callbacks and elapsed time', () => {
  const h = setup(); h.recorder.swipe();
  h.recorder.media('https://cdn.test/glass.jpg', 'glass', 'loaded', {activityId:'42', group:'joined'});
  h.page.data.groupedActivities.joined[0]._homeMediaReady = true;
  h.advance(700);
  assert.equal(h.events.find(x=>x.reason === 'swiper_change').pending, 1);
  assert.equal(h.events.find(x=>x.reason === 'after_swipe').pending, 0);
});
test('snapshot errors are isolated, repeated errors bounded and hide clears checkpoints', () => {
  const h = setup(); for (let i = 0; i < 100; i++) h.recorder.snapshot('glass_error');
  assert.equal(h.events.filter(x=>x.reason === 'glass_error').length, 3);
  h.recorder.stop(); const count = h.events.length; h.advance(60000);
  assert.equal(h.events.length, count); assert.equal(h.timers.size, 0);
  const bad = setup({ emit: () => { throw Error('logging unavailable'); } });
  assert.doesNotThrow(() => { bad.recorder.check(); bad.recorder.snapshot('test'); bad.recorder.stop(); });
});
test('settled is recorded once and cache usage survives background refresh', () => {
  const h = setup(); h.recorder.list('cache'); h.recorder.list('request_pending');
  h.page.data.homeListLoading = false; h.page.data.groupedActivities.joined[0]._homeMediaReady = true;
  h.recorder.check(); h.recorder.check();
  assert.equal(h.events.filter(x=>x.reason === 'all_ready_state_committed').length, 1);
  assert.equal(h.events.at(-1).cacheUsed, true);
});
test('logger uploads snapshots through existing batch transport with correlation and intact card evidence', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const requests = [], realtime = [], timers = [];
  const sandbox = { module: {exports:{}}, console: {info(){},error(){}}, setTimeout: fn => timers.push(fn), clearTimeout(){},
    require: name => name === './diagnosticOutbox' ? {
      createDiagnosticOutbox: opts => require('../services/diagnosticOutbox').createDiagnosticOutbox({ ...opts, setTimer: fn => timers.push(fn), clearTimer(){} })
    } : ({getApiBaseUrl: () => 'https://example.test/api/v1'}),
    getCurrentPages: () => [{route:'pages/activity_list/activity_list'}],
    wx: {getStorageSync: key => key === 'userId' ? '42' : key === 'accessToken' ? 'test-token' : [], setStorageSync(){}, request: req => requests.push(req), getRealtimeLogManager: () => ({info: p=>realtime.push(p)})} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../services/logger'), 'utf8'), sandbox);
  const h = setup(); const sample = h.events[0];
  sandbox.module.exports.logInfo('home_presentation_snapshot', sample);
  timers.forEach(fn=>fn());
  const body = requests[0].data.events[0];
  assert.equal(body.traceId, 'view-1'); assert.equal(body.event, 'home_presentation_snapshot');
  assert.equal(body.payload.cards[0].activityId, '42');
  assert.equal(body.payload.cards[0].ready, false);
  assert.equal(body.payload.cards[0].focused, true);
  assert.match(body.payload.cards[0].glass, /pending;native=no_callback/);
  assert.equal(realtime.length, 1);
  assert.ok(!JSON.stringify(body).includes('secret'));
});
test('layout probe captures nodes without equating geometry to visible pixels, and late probes stop on hide', () => {
  const h = setup(); let callback;
  h.page.createSelectorQuery = () => {
    const q = { selectAll: () => q, boundingClientRect: () => q, exec: cb => { callback = cb; } }; return q;
  };
  h.advance(15000);
  callback([[{ width: 304, height: 437, left: 22, top: 160 }], [{}]]);
  assert.equal(h.events.at(-1).reason, 'checkpoint_layout');
  assert.equal(h.events.at(-1).layout.skeletonNodes, 1);
  assert.equal(h.events.at(-1).pending, 1);
  h.recorder.stop(); const count = h.events.length;
  callback([[], []]); assert.equal(h.events.length, count);
});
test('native callbacks are isolated by card, group, role and URL; only preload is shared', () => {
  const h = setup(); const original = h.page.data.groupedActivities.joined[0];
  h.page.data.groupedActivities.joined.push({ ...original, _id: '43' });
  h.page.data.groupedActivities.accepting = [{ ...original, smallCardBgImageUrl: original.largeCardBgImageUrl }];
  const url = original.largeCardBgImageUrl;
  h.recorder.media(url, 'preload', 'loaded');
  h.recorder.media(url, 'cover', 'loaded', {activityId:'42', group:'joined'});
  h.recorder.media('old-url', 'glass', 'loaded', {activityId:'42', group:'joined'});
  h.recorder.snapshot('test');
  const cards = h.events.at(-1).cards;
  assert.match(cards.find(c=>c.group === 'joined' && c.activityId === '42').cover, /native=loaded/);
  assert.match(cards.find(c=>c.activityId === '43').cover, /native=no_callback;preload=loaded/);
  assert.match(cards.find(c=>c.group === 'accepting').cover, /native=no_callback;preload=loaded/);
  assert.match(cards.find(c=>c.activityId === '42').glass, /native=no_callback/);
});
