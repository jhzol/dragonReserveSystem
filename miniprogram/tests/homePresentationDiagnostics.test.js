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
    clearTimer: id => timers.delete(id), sampleNormal: false, ...overrides });
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
  const h = setup(); h.advance(8000); h.recorder.swipe();
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
  const h = setup(); h.recorder.snapshot('native_media_error'); const sample = h.events[0];
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
test('attempt evidence remains separate across retries and long pending sessions keep reporting', () => {
  const h = setup();
  h.recorder.phase('https://cdn.test/a?secret=1', 'download_progress', {attempt: 1, bytes: 500});
  h.recorder.phase('https://cdn.test/a?secret=1', 'attempt_failed', {attempt: 1, logicalActive: 2, outstandingPreparations: 5});
  h.recorder.phase('https://cdn.test/a?secret=1', 'attempt_succeeded', {attempt: 2});
  const events = h.events.filter(e => e.event === 'home_media_attempt');
  assert.equal(events[0].evidence.bytes, 500);
  assert.equal(events[0].evidence.outstandingPreparations, 5);
  assert.equal(events[1].evidence.bytes, undefined);
  assert.equal(events[0].url, 'https://cdn.test/a');
  h.advance(10 * 60000);
  assert.equal(h.events.filter(e => e.reason === 'pending_heartbeat').length, 3);
  h.recorder.stop(); assert.equal(h.timers.size, 0);
});
test('network subscription records changes and is removed on page hide', () => {
  let listener, removed;
  const h = setup({wxApi: {onNetworkStatusChange(fn) {listener = fn;}, offNetworkStatusChange(fn) {removed = fn;}}});
  listener({networkType: '4g', isConnected: true});
  assert.equal(h.events.at(-1).networkType, '4g');
  h.recorder.stop(); assert.equal(removed, listener);
});

function finishHealthyHome(h) {
  const card = h.page.data.groupedActivities.joined[0];
  for (const [role, url] of [['cover',card.largeCardBgImageUrl],['glass',card.largeCardGlassImageUrl]]) {
    h.recorder.phase(url, 'disk_cache_hit', {attempt:1});
    h.recorder.phase(url, 'attempt_succeeded', {attempt:1});
    h.page._homeReadyImages.set(url,'local');
    h.recorder.media(url,role,'loaded',{activityId:card._id,group:'joined'});
  }
  card._homeMediaReady = true; h.page.data.homeListLoading = false;
  h.recorder.check();
}
test('healthy unsampled visit emits only one compact summary, no periodic/layout/swipe/success logs', () => {
  const h=setup(); let probes=0;
  h.page.createSelectorQuery=()=>{probes++; throw Error('not needed');};
  assert.equal(h.events.length,0);
  finishHealthyHome(h);
  h.recorder.swipe(); h.advance(600000); h.recorder.stop();
  assert.equal(h.events.length,1);
  assert.equal(h.events[0].reason,'all_ready_state_committed');
  assert.deepEqual(h.events[0].cards,[]);
  assert.deepEqual(h.events[0].totals,{succeeded:2,failed:0,cacheHits:2,cacheMisses:0,cacheInvalid:0});
  assert.equal(probes,0); assert.equal(h.timers.size,0);
});
test('normal session sampling retains successful attempts; failures and recovery are never sampled away', () => {
  const sampled=setup({sampleNormal:true}); finishHealthyHome(sampled);
  assert.equal(sampled.events.filter(e=>e.event==='home_media_attempt').length,2);
  const h=setup(); const url='https://cdn.test/slow';
  h.recorder.phase(url,'download_started',{attempt:1,requestId:'hm-example'});
  h.recorder.phase(url,'logical_timeout',{attempt:1});
  h.recorder.phase(url,'retry_scheduled',{attempt:1});
  h.recorder.phase(url,'attempt_succeeded',{attempt:1});
  const attempts=h.events.filter(e=>e.event==='home_media_attempt');
  assert.deepEqual(attempts.map(e=>e.stage),['logical_timeout','attempt_succeeded']);
  assert.equal(attempts[1].evidence.requestId,'hm-example');
  assert.ok('retry_scheduled' in attempts[1].evidence);
});
test('hidden offscreen native callbacks do not create perpetual false alarms', () => {
  const h=setup(); finishHealthyHome(h);
  const card=h.page.data.groupedActivities.joined[0];
  h.page._homeVisibilityKnown=true;
  h.page._homeVisibleCardKeys=new Set(['["joined","42"]']);
  h.page.data.groupedActivities.joined.push({...card,_id:'offscreen'});
  h.advance(600000);
  assert.equal(h.events.length,1);
});
test('cache-invalid evidence and early decode errors survive cleanup', () => {
  const h=setup(); h.recorder.phase('https://cdn.test/a','disk_cache_invalid',{attempt:1});
  h.recorder.phase('https://cdn.test/a','attempt_succeeded',{attempt:1});
  assert.equal(h.events[0].stage,'attempt_succeeded');
  assert.ok('disk_cache_invalid' in h.events[0].evidence);
  h.recorder.snapshot('native_media_error',{summary:'decode error'});
  assert.equal(h.events.at(-1).summary,'decode error');
});
test('legacy duplicate scanner and per-card success emitters are removed from page', () => {
  const source=require('node:fs').readFileSync(require.resolve('../pages/activity_list/activity_list'),'utf8');
  assert.doesNotMatch(source, /_startCardMediaDiagnostics|_cardMediaDiagWarnTimer|activity_card_presentation_ready|activity_card_media_loaded|activity_card_glass_load_failed/);
  assert.match(source, /snapshot\("glass_error"/);
  assert.match(source, /snapshot\("video_waiting"/);
});

test('successful preparation taking eight seconds is retained even outside normal sample', () => {
  const h=setup(); h.recorder.phase('https://cdn.test/a','worker_started',{attempt:1});
  h.recorder.phase('https://cdn.test/a','download_started',{attempt:1,requestId:'hm-slow'});
  h.advance(8000); h.recorder.phase('https://cdn.test/a','attempt_succeeded',{attempt:1});
  const event=h.events.find(e=>e.event==='home_media_attempt');
  assert.equal(event.slowAttempt,true); assert.equal(event.normalSampled,false);
  assert.equal(event.evidence.requestId,'hm-slow');
});
test('image cache outcomes are separate from list cache and included without normal sampling', () => {
  const h=setup(); h.recorder.list('cache');
  h.recorder.phase('https://test/a','disk_cache_hit',{attempt:1});
  h.recorder.phase('https://test/a','disk_cache_hit',{attempt:1});
  h.recorder.phase('https://test/b','disk_cache_miss',{attempt:1});
  h.recorder.phase('https://test/c','disk_cache_timeout',{attempt:1});
  h.recorder.phase('https://test/d','disk_cache_bypassed',{attempt:1});
  h.recorder.snapshot('all_ready_state_committed');
  const e=h.events.at(-1);
  assert.equal(e.listCacheUsed,true); assert.equal(e.imageCache.used,true);
  assert.equal(e.imageCache.checked,3); assert.equal(e.imageCache.hits,1);
  assert.equal(e.imageCache.hitRate,1/3); assert.equal(e.imageCache.timeout,1);
  assert.equal(e.imageCache.bypassed,1); assert.equal(e.normalSampled,false);
});
test('unobserved image cache is not incorrectly reported as a cache miss', () => {
  const h=setup(); h.recorder.snapshot('all_ready_state_committed');
  assert.equal(h.events.at(-1).imageCache.status,'not_observed');
  assert.equal(h.events.at(-1).imageCache.hitRate,null);
});
