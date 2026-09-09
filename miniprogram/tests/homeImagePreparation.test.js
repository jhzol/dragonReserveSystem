const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareHomeImage } = require('../utils/homeImagePreparation');
const { createHomeCardMediaLoader } = require('../utils/homeCardMediaLoader');
function harness() {
  const stages = [], ready = [], failed = [], inspections = [];
  let request, headers, progress, aborted = 0;
  const cancel = prepareHomeImage({ url: 'https://example.test/image.jpg',
    setTimer: () => 0, clearTimer() {},
    wxApi: { downloadFile: r => { request = r; return { abort: () => aborted++, onHeadersReceived: fn => headers = fn, onProgressUpdate: fn => progress = fn }; },
      getImageInfo: r => inspections.push(r) },
    stage: (name, data) => stages.push({ name, data }), ready: p => ready.push(p), failed: e => failed.push(e) });
  return { stages, ready, failed, inspections, cancel, request: () => request, headers: () => headers(), progress: r => progress(r), aborted: () => aborted };
}
test('download and local inspection are separate, readiness waits for inspection', () => {
  const h = harness(); h.headers(); h.progress({ totalBytesWritten: 123, totalBytesExpectedToWrite: 456 });
  h.request().success({ statusCode: 200, tempFilePath: 'wxfile://download' });
  assert.equal(h.ready.length, 0); assert.equal(h.inspections[0].src, 'wxfile://download');
  h.inspections[0].success({ path: 'wxfile://decoded', width: 1200, height: 1400 });
  assert.deepEqual(h.ready, ['wxfile://decoded']);
  assert.deepEqual(h.stages.map(s => s.name), ['disk_cache_bypassed','download_started','headers_received','download_progress','download_complete','image_info_started','image_info_complete']);
});
test('download API failure retains combined path and labels it explicitly', () => {
  const h = harness(); h.request().fail({ errMsg: 'domain denied' });
  assert.equal(h.inspections[0].src, 'https://example.test/image.jpg');
  assert.ok(h.stages.some(s => s.name === 'download_failed_combined_fallback'));
});
test('HTTP error does not inspect an error body or mark ready', () => {
  const h = harness(); h.request().success({ statusCode: 404, tempFilePath: 'error-body' });
  assert.equal(h.inspections.length, 0); assert.equal(h.ready.length, 0); assert.equal(h.failed.length, 1);
});
test('disposal aborts download and ignores late callbacks', () => {
  const h = harness(); h.cancel(); h.request().success({ statusCode: 200, tempFilePath: 'late' });
  h.request().fail({}); assert.equal(h.aborted(), 1); assert.equal(h.inspections.length, 0);
});
test('logical timeout retains request for late success but disposal still cancels it', () => {
  let timeout, success, aborted = 0; const ready = [];
  const loader = createHomeCardMediaLoader({ setTimer: (fn, ms) => { if (ms === 15000) timeout = fn; return ms; }, clearTimer() {},
    load: (u, ok) => { success = ok; return () => aborted++; }, onError() {}, onReady: u => ready.push(u) });
  loader.enqueue(['a']); timeout(); assert.equal(aborted, 0); success('local');
  assert.deepEqual(ready, ['a']); loader.dispose();
});

test('failure diagnostics classify domain errors without exposing raw URLs', () => {
  const h = harness();
  h.request().fail({ errMsg: 'url not in domain list https://secret.test/a?token=private' });
  const phase = h.stages.find(s => s.name === 'download_failed_combined_fallback');
  assert.equal(phase.data.errorCode, 1);
  assert.deepEqual(phase.data.profile, {profileAvailable: false});
  assert.equal(JSON.stringify(h.stages).includes('private'), false);
});
test('local image information failure is classified and does not mark ready', () => {
  const h = harness();
  h.request().success({ statusCode: 200, tempFilePath: 'wxfile://download' });
  h.inspections[0].fail({ errMsg: 'getImageInfo:fail timeout' });
  assert.equal(h.ready.length, 0);
  assert.equal(h.failed.length, 1);
  assert.equal(h.stages.find(s => s.name === 'image_info_failed').data.errorCode, 2);
});
test('download profile uses an explicit privacy allowlist and enables collection', () => {
  const stages = [];
  prepareHomeImage({url: 'https://test/a', ready() {}, failed() {}, stage: (name, details) => stages.push({name, details}), wxApi: {
    downloadFile(options) {
      assert.equal(options.enableProfile, true);
      options.success({statusCode:200, tempFilePath:'/tmp/a', profile:{queueStart:1, queueEnd:20, peerIP:'private', protocol:'h2', socketReused:true}});
    }, getImageInfo(options) {options.success({path: '/tmp/a', width:100,height:100});}
  }});
  const profile = stages.find(s => s.name === 'download_complete').details.profile;
  assert.equal(profile.queueEnd, 20); assert.equal(profile.protocol, 'h2');
  assert.equal(profile.peerIP, undefined);
});

test('timeout and network failure return to retry queue without a hidden remote download', () => {
  for (const errMsg of ['downloadFile:fail timeout', 'downloadFile:fail network disconnected']) {
    const h = harness();
    h.request().fail({ errMsg });
    assert.equal(h.failed.length, 1);
    assert.equal(h.inspections.length, 0);
    assert.ok(h.stages.some(s => s.name === 'download_failed'));
    h.request().success({ statusCode: 200, tempFilePath: 'obsolete' });
    assert.equal(h.inspections.length, 0);
    assert.equal(h.ready.length, 0);
  }
});

test('timed-out transfer retries through loader and recovers without remote inspection', () => {
  let now = 0, sequence = 0;
  const timers = new Map(), requests = [], inspections = [], ready = [], stages = [];
  const loader = createHomeCardMediaLoader({
    setTimer: (fn, delay) => { const id = ++sequence; timers.set(id, {fn, at: now + delay}); return id; },
    clearTimer: id => timers.delete(id), onError() {}, onReady: (url, path) => ready.push(path),
    onStage: (url, name, data) => stages.push({name, ...data}),
    load: (url, ok, fail, context) => prepareHomeImage({url, ready: ok, failed: fail,
      stage: context.report, wxApi: {
        downloadFile: options => { requests.push(options); return {abort() {}}; },
        getImageInfo: options => inspections.push(options)
      }
    })
  });
  const advance = ms => {
    const end = now + ms;
    while (true) {
      const entry = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = end;
  };
  loader.enqueue(['https://example.test/a.jpg']);
  advance(60000);
  requests[0].fail({errMsg: 'downloadFile:fail timeout'});
  assert.equal(inspections.length, 0);
  advance(1000);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[0].header['X-Request-Id'], requests[1].header['X-Request-Id']);
  requests[1].success({statusCode:200, tempFilePath:'wxfile://recovered'});
  inspections[0].success({path:'wxfile://recovered', width:1200, height:1200});
  assert.deepEqual(ready, ['wxfile://recovered']);
  assert.ok(stages.some(s => s.name === 'retry_scheduled' && s.attempt === 1));
  assert.ok(stages.some(s => s.name === 'attempt_succeeded' && s.attempt === 2));
  advance(200000);
  assert.equal(timers.size, 0);
  assert.equal(requests.length, 2);
  loader.dispose();
});

function progressHarness({ synchronousAbort = false, abortThrows = false } = {}) {
  let now = 0, id = 0, request, progress, aborted = 0;
  const timers = new Map(), failed = [], ready = [], stages = [], inspections = [];
  const cancel = prepareHomeImage({ url:'https://example.test/stalled.jpg',
    progressIdleMs:15,
    setTimer: (fn, delay) => { const key=++id; timers.set(key,{at:now+delay,fn}); return key; },
    clearTimer: key => timers.delete(key),
    ready: path => ready.push(path), failed: e => failed.push(e), stage: (name, data) => stages.push({name,...data}),
    wxApi: {
      downloadFile: options => { request=options; return {
        onProgressUpdate: fn => progress=fn,
        abort() { aborted++; if (synchronousAbort) request.fail({errMsg:'downloadFile:fail abort'}); if (abortThrows) throw new Error('abort failed'); }
      }; },
      getImageInfo: options => inspections.push(options)
    }
  });
  return {cancel, failed, ready, stages, inspections, timers, request:()=>request, aborted:()=>aborted,
    progress: bytes => progress({totalBytesWritten:bytes,totalBytesExpectedToWrite:1000}),
    advance(ms) {
      const end=now+ms;
      while (true) {
        const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if (!next) break;
        now=next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now=end;
    }
  };
}
test('partially transferred image with no new bytes fails once and aborts without fallback', () => {
  for (const options of [{},{synchronousAbort:true},{abortThrows:true}]) {
    const h=progressHarness(options);
    h.progress(100); h.advance(14); assert.equal(h.failed.length,0);
    h.advance(1); assert.equal(h.failed.length,1); assert.equal(h.aborted(),1);
    assert.equal(h.inspections.length,0);
    assert.ok(h.stages.some(s=>s.name==='download_progress_idle' && s.bytes===100));
    h.request().success({statusCode:200,tempFilePath:'obsolete'});
    h.request().fail({errMsg:'downloadFile:fail timeout'});
    assert.equal(h.failed.length,1); assert.equal(h.ready.length,0); assert.equal(h.inspections.length,0);
    assert.equal(h.timers.size,0);
  }
});
test('continuing byte progress preserves slow transfer beyond an idle window', () => {
  const h=progressHarness();
  for (let bytes=100;bytes<=900;bytes+=100) { h.progress(bytes); h.advance(14); }
  assert.equal(h.failed.length,0); assert.equal(h.aborted(),0);
  h.request().success({statusCode:200,tempFilePath:'wxfile://slow'});
  h.inspections[0].success({path:'wxfile://slow',width:1200,height:1200});
  h.advance(100); assert.deepEqual(h.ready,['wxfile://slow']); assert.equal(h.timers.size,0);
});
test('repeated or decreasing byte counts do not postpone idle recovery', () => {
  const h=progressHarness(); h.progress(100); h.advance(10);
  h.progress(100); h.progress(99); h.advance(5);
  assert.equal(h.failed.length,1); assert.equal(h.aborted(),1);
});
test('absent progress and zero progress are not mistaken for a stalled transfer', () => {
  const h=progressHarness(); h.advance(100); h.progress(0); h.advance(100);
  assert.equal(h.failed.length,0); assert.equal(h.aborted(),0); assert.equal(h.timers.size,0); h.cancel();
});
test('success, failure and disposal clear idle timer before subsequent callbacks', () => {
  for (const end of ['success','failure','cancel']) {
    const h=progressHarness(); h.progress(100);
    if (end==='success') h.request().success({statusCode:200,tempFilePath:'local'});
    if (end==='failure') h.request().fail({errMsg:'downloadFile:fail timeout'});
    if (end==='cancel') h.cancel();
    assert.equal(h.timers.size,0);
    h.progress(200); h.advance(100);
    assert.equal(h.failed.length,end==='failure'?1:0);
    assert.equal(h.aborted(),end==='cancel'?1:0);
  }
});

test('queue plus downloader: byte progress past 15 seconds keeps three slots and hide/show reuses transfers', () => {
  let now = 0, nextId = 0, pending = 0, peak = 0;
  const timers = new Map(), requests = [], inspections = [], ready = [], stages = [];
  const setTimer = (fn, delay) => { const id = ++nextId; timers.set(id, {fn, at: now + delay}); return id; };
  const clearTimer = id => timers.delete(id);
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  }
  const wxApi = {
    downloadFile(options) {
      let ended = false;
      const finish = () => { if (!ended) { ended = true; pending--; } };
      const r = { url: options.url, aborted: false,
        complete() { finish(); options.success({statusCode:200,tempFilePath:`wxfile://${requests.indexOf(r)}`}); },
        abort() { r.aborted = true; finish(); options.fail({errMsg:'downloadFile:fail abort'}); }
      };
      requests.push(r); pending++; peak = Math.max(peak, pending);
      return { abort: r.abort, onProgressUpdate: cb => r.progress = bytes => cb({totalBytesWritten:bytes,totalBytesExpectedToWrite:1000000}) };
    },
    getImageInfo(options) { inspections.push(options.src); options.success({path:options.src,width:1200,height:1200}); }
  };
  const loader = createHomeCardMediaLoader({ concurrency:3, setTimer, clearTimer, onError(){},
    onReady:(url,path)=>ready.push({url,path}), onStage:(url,name,data)=>stages.push({url,name,...data}),
    load:(url,ok,fail,context)=>prepareHomeImage({wxApi,url,ready:ok,failed:fail,stage:context.report,setTimer,clearTimer})
  });
  const urls = ['a','b','c','d','e','f'].map(x=>`https://example.test/${x}.jpg`);
  loader.enqueue(urls);
  for (let step=1;step<=4;step++) {
    for (const r of requests) r.progress(step*100000);
    advance(10000);
  }
  assert.equal(requests.length,3); assert.equal(peak,3);
  assert.equal(stages.filter(s=>s.name==='logical_timeout' && s.slotRetained).length,3);
  loader.pause(); requests[0].complete();
  assert.equal(ready.length,1); assert.equal(requests.length,3);
  loader.enqueue([urls[5],...urls],{prioritize:true,retryFailed:true});
  assert.equal(requests.length,3);
  loader.resume(); assert.equal(requests[3].url,urls[5]);
  requests[1].complete(); requests[2].complete();
  for (const r of requests.slice(3)) r.complete();
  assert.equal(ready.length,6); assert.equal(peak,3);
  assert.equal(new Set(requests.map(r=>r.url)).size,6);
  assert.ok(inspections.every(src=>src.startsWith('wxfile://')));
  assert.ok(requests.every(r=>!r.aborted));
  loader.dispose(); advance(200000); assert.equal(timers.size,0);
});
