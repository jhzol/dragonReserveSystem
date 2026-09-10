const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeCardMediaLoader } = require('../utils/homeCardMediaLoader');
function harness(options = {}) {
  let now = 0, id = 0;
  const timers = new Map(), started = [], ready = [], errors = [];
  const loader = createHomeCardMediaLoader({
    timeoutMs: 15, hardTimeoutMs: 125, retryDelayMs: 1,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: key => timers.delete(key),
    load: (url, ok, fail) => {
      const request = { url, ok, fail, cancelled: false };
      started.push(request);
      return () => { request.cancelled = true; fail(new Error('abort')); };
    },
    onReady: (url, path) => ready.push({ url, path }), onError: url => errors.push(url),
    ...options
  });
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = end;
  }
  return { loader, advance, started, ready, errors, timers };
}
test('real failure after soft timeout retries and can recover without navigation', () => {
  const h = harness(); h.loader.enqueue(['a']); h.advance(120);
  h.started[0].fail(new Error('combined preparation failed')); h.advance(1);
  assert.equal(h.started.length, 2);
  h.started[1].ok('local');
  assert.deepEqual(h.ready, [{ url: 'a', path: 'local' }]);
  h.advance(1000); assert.equal(h.started.length, 2); assert.equal(h.timers.size, 0);
});
test('soft timeout alone does not start a duplicate request; late success still wins', () => {
  const h = harness(); h.loader.enqueue(['a']); h.advance(100);
  assert.equal(h.started.length, 1); h.started[0].ok('late'); h.advance(1000);
  assert.equal(h.started.length, 1); assert.equal(h.ready.length, 1); assert.equal(h.timers.size, 0);
});
test('missing callbacks have a finite deadline and bounded retry count', () => {
  const h = harness(); h.loader.enqueue(['a']); h.advance(1000);
  assert.equal(h.started.length, 3);
  assert.ok(h.started.every(r => r.cancelled));
  assert.equal(h.ready.length, 0); assert.equal(h.timers.size, 0);
});
test('disposal cancels pending retries and active hard deadlines', () => {
  for (const failed of [false, true]) {
    const h = harness(); h.loader.enqueue(['a']); h.advance(20);
    if (failed) h.started[0].fail(new Error('failed'));
    h.loader.dispose(); h.advance(1000);
    assert.equal(h.started.length, 1); assert.equal(h.timers.size, 0);
    h.started[0].ok('obsolete'); assert.equal(h.ready.length, 0);
  }
});
test('manual retry invalidates old callbacks and replaces automatic retry', () => {
  const h = harness(); h.loader.enqueue(['a']); h.advance(20);
  h.started[0].fail(new Error('terminal failure'));
  h.loader.enqueue(['a'], { retryFailed: true });
  h.started[0].ok('obsolete'); h.started[1].ok('current'); h.advance(1000);
  assert.deepEqual(h.ready, [{ url: 'a', path: 'current' }]); assert.equal(h.started.length, 2);
});
test('permanent immediate failures stop after initial attempt plus two retries', () => {
  const h = harness(); h.loader.enqueue(['a']);
  for (let i = 0; i < 3; i++) { h.started[i].fail(new Error('failed')); h.advance(3); }
  h.advance(1000); assert.equal(h.started.length, 3); assert.equal(h.timers.size, 0);
});
test('synchronous failure schedules exactly one retry and does not keep a stale cancel handle', () => {
  let calls = 0, cancels = 0;
  const h = harness({ load: (u, ok, fail) => { calls++; fail(new Error('failed')); return () => cancels++; } });
  h.loader.enqueue(['a']); h.advance(1000); h.loader.dispose();
  assert.equal(calls, 3); assert.equal(cancels, 0); assert.equal(h.timers.size, 0);
});
test('automatic recovery follows the latest visible-card priority', () => {
  const h = harness({ concurrency: 1 });
  h.loader.enqueue(['a', 'b', 'c']);
  h.started[0].fail(new Error('failed'));
  h.loader.enqueue(['c', 'a', 'b'], { prioritize: true });
  h.advance(1);
  h.started[1].ok('b-local');
  assert.equal(h.started[2].url, 'c');
  h.started[2].ok('c-local');
  assert.equal(h.started[3].url, 'a');
  h.started[3].ok('a-local');
  h.advance(1000);
  assert.equal(h.timers.size, 0);
});
test('exhaustion is reported once and obsolete callbacks cannot resurrect a failed card', () => {
  const exhausted = [];
  const h = harness({ onExhausted: url => exhausted.push(url) });
  h.loader.enqueue(['a']);
  h.advance(1000);
  for (const request of h.started) {
    request.fail(new Error('late failure'));
    request.ok('obsolete-success');
  }
  assert.deepEqual(exhausted, ['a']);
  assert.deepEqual(h.ready, []);
  h.loader.enqueue(['a'], { retryFailed: true });
  h.started[3].ok('recovered');
  assert.deepEqual(h.ready, [{ url: 'a', path: 'recovered' }]);
  assert.equal(h.timers.size, 0);
});
test('disposal inside timeout notification leaves no hard deadline or queued work', () => {
  let h;
  h = harness({ concurrency: 1, onError: () => h.loader.dispose() });
  h.loader.enqueue(['a', 'b']);
  h.advance(1000);
  assert.equal(h.started.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.started[0].cancelled, true);
});
test('soft timeout telemetry retains the occupied slot until completion', () => {
  const stages = [], timers = [], callbacks = [];
  const loader = createHomeCardMediaLoader({concurrency:1, onReady(){},onError(){},
    onStage:(url,name,details)=>stages.push({url,name,...details}),
    setTimer:fn=>{timers.push(fn);return timers.length;},clearTimer(){},
    load:(url,ok,fail,context)=>{callbacks.push({ok,fail,context});}
  });
  loader.enqueue(['a','b']);
  timers[0]();
  assert.equal(callbacks.length, 1);
  const timeout = stages.find(e=>e.name === 'logical_timeout');
  assert.equal(timeout.logicalActive,1);
  assert.equal(timeout.outstandingPreparations,1);
  assert.equal(timeout.slotRetained,true);
  callbacks[0].ok('late');
  const started = stages.find(e=>e.url === 'b' && e.name === 'worker_started');
  assert.equal(started.logicalActive,1);
  assert.equal(started.outstandingPreparations,1);
  assert.ok(stages.some(e=>e.url==='a' && e.name==='attempt_succeeded' && e.attempt===1));
  loader.dispose();
  assert.ok(stages.some(e=>e.url==='b' && e.name==='page_cancelled'));
});


test('pause preserves in-flight progress and prevents queued downloads until resume', () => {
  const h = harness({ concurrency: 1 });
  h.loader.enqueue(['a', 'b']); h.loader.pause();
  assert.equal(h.started[0].cancelled, false);
  h.started[0].ok('local-a');
  assert.equal(h.started.length, 1);
  assert.deepEqual(h.ready, [{ url: 'a', path: 'local-a' }]);
  h.loader.enqueue(['a', 'b', 'c'], { prioritize: true });
  assert.equal(h.started.length, 1);
  h.loader.resume();
  assert.equal(h.started[1].url, 'b');
  h.started[1].ok('local-b'); h.started[2].ok('local-c');
  assert.equal(h.started.filter(r => r.url === 'a').length, 1);
  assert.equal(h.timers.size, 0);
});
test('hidden failure retains bounded retry without starting a background retry', () => {
  const h = harness({ concurrency: 1 });
  h.loader.enqueue(['a']); h.loader.pause();
  h.started[0].fail(new Error('network')); h.advance(10);
  assert.equal(h.started.length, 1);
  h.loader.resume(); assert.equal(h.started.length, 2);
  h.started[1].ok('recovered'); assert.equal(h.ready.length, 1);
  assert.equal(h.timers.size, 0);
});
test('pause retains hard deadline and dispose prevents later resume', () => {
  const h = harness({ concurrency: 1 });
  h.loader.enqueue(['a', 'b']); h.loader.pause(); h.advance(1000);
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].cancelled, true);
  h.loader.dispose(); h.loader.resume(); h.advance(1000);
  assert.equal(h.started.length, 1); assert.equal(h.timers.size, 0);
});


test('throwing native cancellation cannot interrupt disposal of remaining downloads', () => {
  const cancelled = [], stages = [];
  const h = harness({ load: url => () => { cancelled.push(url); throw new Error('SDK abort exception'); },
    onStage: (url, stage) => stages.push({ url, stage }) });
  h.loader.enqueue(['a', 'b', 'c', 'd']);
  assert.doesNotThrow(() => h.loader.dispose());
  assert.deepEqual(cancelled, ['a', 'b', 'c']);
  assert.equal(h.timers.size, 0);
  assert.equal(stages.filter(s => s.stage === 'cancellation_failed').length, 3);
  h.loader.resume(); h.advance(1000);
  assert.deepEqual(cancelled, ['a', 'b', 'c']);
});
test('manual retry cannot replace an in-flight request even if abort would throw', () => {
  const requests = [];
  const h = harness({ load: (url, ok) => { requests.push(ok); return () => { throw new Error('SDK abort'); }; } });
  h.loader.enqueue(['a']); h.advance(15);
  assert.doesNotThrow(() => h.loader.enqueue(['a'], { retryFailed: true }));
  assert.equal(requests.length, 1);
  requests[0]('recovered');
  assert.deepEqual(h.ready, [{ url: 'a', path: 'recovered' }]);
  assert.equal(h.timers.size, 0);
});

test('native rejection invalidates a ready resource and consumes the existing retry budget', () => {
  const exhausted = [];
  const h = harness({ onExhausted: url => exhausted.push(url) });
  h.loader.enqueue(['a']); h.started[0].ok('bad-1');
  assert.equal(h.loader.invalidateReady('a'), true);
  assert.equal(h.loader.invalidateReady('a'), false);
  h.advance(1); h.started[1].ok('bad-2');
  assert.equal(h.loader.invalidateReady('a'), true);
  h.advance(2); h.started[2].ok('bad-3');
  assert.equal(h.loader.invalidateReady('a'), true);
  h.advance(1000);
  assert.deepEqual(exhausted, ['a']);
  assert.equal(h.started.length, 3);
  h.loader.enqueue(['a'], { retryFailed: true });
  assert.equal(h.started.length, 4);
  h.started[3].ok('fixed'); assert.equal(h.timers.size, 0);
});
test('native rejection cannot duplicate an in-flight job or restart disposed work', () => {
  const h = harness(); h.loader.enqueue(['a']);
  assert.equal(h.loader.invalidateReady('a'), false);
  assert.equal(h.loader.invalidateReady('unknown'), false);
  h.started[0].ok('bad'); h.loader.pause();
  assert.equal(h.loader.invalidateReady('a'), true);
  h.advance(10); assert.equal(h.started.length, 1);
  h.loader.resume(); assert.equal(h.started.length, 2);
  h.started[1].ok('fixed'); h.loader.dispose();
  assert.equal(h.loader.invalidateReady('a'), false);
  h.advance(1000); assert.equal(h.started.length, 2);
});

test('three slow transfers retain all slots after soft timeout and next visible image wins', () => {
  const h = harness({ concurrency: 3 });
  h.loader.enqueue(['a', 'b', 'c', 'd', 'e', 'f']);
  h.advance(60);
  h.loader.enqueue(['f', 'e', 'd', 'c', 'b', 'a'], { prioritize: true, retryFailed: true });
  assert.deepEqual(h.started.map(r => r.url), ['a', 'b', 'c']);
  assert.ok(h.started.every(r => !r.cancelled));
  h.started[1].ok('b-local');
  assert.deepEqual(h.started.map(r => r.url), ['a', 'b', 'c', 'f']);
  h.started[1].ok('duplicate'); h.started[1].fail(new Error('late'));
  assert.deepEqual(h.ready, [{ url: 'b', path: 'b-local' }]);
  assert.equal(h.started.length, 4);
  h.loader.dispose(); assert.equal(h.timers.size, 0);
});

for (const mode of ['sync', 'delayed', 'throw']) {
  test(`hard deadline cancels before opening next slot: ${mode}`, () => {
    const events = [], callbacks = [];
    const h = harness({ concurrency: 1, load(url, ok, fail) {
      events.push(`start:${url}`); callbacks.push({ ok, fail });
      return () => {
        events.push(`cancel:${url}`);
        if (mode === 'sync') fail(new Error('aborted'));
        if (mode === 'throw') throw new Error('SDK abort exception');
      };
    }});
    h.loader.enqueue(['a', 'b']); h.advance(125);
    assert.deepEqual(events, ['start:a', 'cancel:a', 'start:b']);
    callbacks[0].ok('obsolete'); callbacks[0].fail(new Error('late abort'));
    assert.equal(h.ready.length, 0);
    callbacks[1].ok('b-local'); h.advance(1);
    assert.equal(events.filter(e => e === 'start:a').length, 2);
    callbacks[2].ok('a-local'); h.advance(1000);
    assert.deepEqual(h.ready.map(r => r.url), ['b', 'a']);
    assert.equal(h.timers.size, 0);
  });
}

test('terminal error observer disposal does not start queued work or retries', () => {
  let h;
  h = harness({ concurrency: 1, onError: () => h.loader.dispose() });
  h.loader.enqueue(['a', 'b']); h.started[0].fail(new Error('network'));
  h.advance(1000);
  assert.equal(h.started.length, 1); assert.equal(h.timers.size, 0);
});
