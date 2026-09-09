const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rankHomeCardImages, cardVisibilityKey } = require('../utils/homeCardImagePriority');
const { createHomeCardMediaLoader } = require('../utils/homeCardMediaLoader');
const small = id => ({ _id: id, smallCardBgImageUrl: `cover-${id}` });
const big = id => ({ _id: id, largeCardBgImageUrl: `cover-${id}`, largeCardGlassImageUrl: `glass-${id}` });
test('visible card cover and glass precede adjacent cards and offscreen sections', () => {
  const ranked = rankHomeCardImages({ groups: { joined: [big(1), big(2), big(3)], ended: [small(4)] },
    visible: new Set([cardVisibilityKey('joined', 2)]), visibilityKnown: true });
  assert.deepEqual(ranked.slice(0, 2), [{ url: 'cover-2', priority: 0 }, { url: 'glass-2', priority: 0 }]);
  assert.equal(ranked.at(-1).url, 'cover-4');
  assert.equal(ranked.at(-1).priority, 2);
});
test('partially visible neighboring cards also have highest priority', () => {
  const result = rankHomeCardImages({ groups: { ended: [small(1), small(2), small(3), small(4)] },
    visible: new Set([cardVisibilityKey('ended', 1), cardVisibilityKey('ended', 2)]), visibilityKnown: true });
  assert.deepEqual(result.map(x => x.priority), [0, 0, 1, 2]);
});
test('initial fallback favors leading rows; observation absence does not block offscreen work', () => {
  const groups = { joined: [big(1)], accepting: [small(2)], ended: [small(3)] };
  const result = rankHomeCardImages({ groups });
  assert.deepEqual(result.map(x => x.priority), [0, 0, 0, 2]);
  assert.equal(rankHomeCardImages({ groups, visibilityKnown: true }).length, 4);
});
test('shared images deduplicate at their highest priority and empty groups are safe', () => {
  const result = rankHomeCardImages({ groups: { joined: [], ended: [small(1), small(1)] },
    focused: { ended: 100 }, visible: new Set([cardVisibilityKey('ended', 1)]), visibilityKnown: true });
  assert.deepEqual(result, [{ url: 'cover-1', priority: 0 }]);
  assert.deepEqual(rankHomeCardImages({ groups: {} }), []);
});
test('reprioritization changes only queued order, retaining three active requests', () => {
  const started = [], callbacks = new Map(); let cancelled = 0;
  const loader = createHomeCardMediaLoader({ load: (url, ok) => {
    started.push(url); callbacks.set(url, ok); return () => cancelled++;
  }, setTimer: () => 1, clearTimer() {}, onReady() {}, onError() {} });
  loader.enqueue(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(started, ['a', 'b', 'c']);
  loader.enqueue(['f', 'e', 'd', 'a', 'b', 'c'], { prioritize: true });
  assert.deepEqual(started, ['a', 'b', 'c']); assert.equal(cancelled, 0);
  callbacks.get('a')('local-a'); assert.equal(started.at(-1), 'f');
  callbacks.get('b')('local-b'); assert.equal(started.at(-1), 'e');
  callbacks.get('c')('local-c'); assert.equal(started.at(-1), 'd');
  assert.equal(new Set(started).size, 6);
  loader.dispose();
});
test('cover templates cannot bypass the queue with remote fallback URLs', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../pages/activity_list/activity_list.wxml'), 'utf8');
  assert.doesNotMatch(wxml, /src="\{\{item\.(?:largeCardBgImageUrl|smallCardBgImageUrl|largeCardGlassImageUrl)/);
  assert.doesNotMatch(wxml, /_home(?:Cover|Glass)Src\s*\|\|/);
  assert.equal((wxml.match(/data-group="(?:joined|accepting|notStarted|ended)" data-activity-id="\{\{item\._id\}\}">/g) || []).length, 4);
  assert.match(wxml, /src="\{\{item\._homeCoverSrc\}\}"\s+mode="aspectFill"/);
});

function gatedFixture() {
  const started = [], callbacks = new Map(), timers = [];
  const loader = createHomeCardMediaLoader({
    load(url, ready, fail) { started.push(url); callbacks.set(url, { ready, fail }); },
    onReady() {}, onError() {}, maxRetries: 1,
    setTimer(fn, ms) { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer(t) { if (t) t.cleared = true; }
  });
  return { loader, started, callbacks, timers };
}
test('foreground completion gates background even with free slots', () => {
  const h = gatedFixture();
  h.loader.enqueue(['a','b','c','d'], { foregroundUrls: ['a'] });
  assert.deepEqual(h.started, ['a']);
  h.callbacks.get('a').ready('/local/a');
  assert.deepEqual(h.started, ['a','b','c','d']);
  h.loader.dispose();
});
test('foreground failure releases gate during retry backoff', () => {
  const h = gatedFixture();
  h.loader.enqueue(['a','b'], { foregroundUrls: ['a'] });
  h.callbacks.get('a').fail(Error('offline'));
  assert.deepEqual(h.started, ['a','b']);
  h.timers.find(t => t.ms === 1000).fn();
  assert.deepEqual(h.started, ['a','b','a']);
  h.loader.dispose();
});
test('soft timeout opens gate without freeing its concurrency slot', () => {
  const h = gatedFixture();
  h.loader.enqueue(['a','b','c','d'], { foregroundUrls: ['a'] });
  h.timers.find(t => t.ms === 15000).fn();
  assert.deepEqual(h.started, ['a','b','c']);
  h.callbacks.get('a').ready('/late/a');
  assert.deepEqual(h.started, ['a','b','c','d']);
  h.loader.dispose();
});
test('newly exposed work jumps ahead without cancelling active jobs; pause is respected', () => {
  const h = gatedFixture();
  h.loader.enqueue(['a','b','c','d'], { foregroundUrls: ['a'] });
  h.loader.pause();
  h.loader.enqueue(['d','c','b','a'], { prioritize: true, foregroundUrls: ['d'] });
  assert.deepEqual(h.started, ['a']);
  h.loader.resume();
  assert.deepEqual(h.started, ['a','d']);
  h.callbacks.get('d').ready('/local/d');
  assert.deepEqual(h.started, ['a','d','c','b']);
  h.loader.dispose();
  h.loader.enqueue(['e'], { foregroundUrls: [] });
  assert.equal(h.started.includes('e'), false);
});
test('synchronous ready callbacks do not deadlock foreground gating', () => {
  const started = [];
  const loader = createHomeCardMediaLoader({load(url, ready) { started.push(url); ready(url); }, onReady() {}, onError() {}});
  loader.enqueue(['b','a','c'], {foregroundUrls:['a']});
  assert.deepEqual(started,['a','b','c']);
  loader.dispose();
});
