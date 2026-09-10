const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiagnosticOutbox, STORAGE_KEY, MAX_ENTRIES, MAX_BYTES, MAX_AGE_MS } = require('../services/diagnosticOutbox');
function setup(storage = new Map(), overrides = {}) {
  let time = 100000, id = 0, timerId = 0, endpoint = 'https://test.local/api/v1';
  const requests = [], timers = new Map(), failures = [];
  storage.set('userId', 'u1'); storage.set('accessToken', 'private-token');
  let network;
  const wxApi = { getStorageSync: key => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    request: req => requests.push(req), onNetworkStatusChange: fn => { network = fn; } };
  const outbox = createDiagnosticOutbox({wxApi, getApiBaseUrl: () => endpoint, createId: () => `id-${time}-${++id}`,
    now: () => time, setTimer: (fn, delay) => { timers.set(++timerId, {fn, at: time + delay}); return timerId; },
    clearTimer: id => timers.delete(id), onFailure: msg => failures.push(msg), ...overrides });
  const advance = ms => { const end = time + ms; for (;;) {
    const next = [...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
    if (!next) break; timers.delete(next[0]); time=next[1].at; next[1].fn();
  } time=end; };
  return {outbox, storage, wxApi, requests, timers, failures, advance, network: () => network({isConnected:true}),
    endpoint: value => { endpoint = value; }};
}
const body = {event:'home_presentation_snapshot', traceId:'home-1', sessionId:'session-1', payload:{reason:'checkpoint_15000'}};
const ack = req => req.success({statusCode:200, data:{stored:true}});
test('persist before dispatch, restore after restart, stable event ID and remove only after server acknowledgement', () => {
  const a=setup(); a.outbox.enqueue(body); const original=a.storage.get(STORAGE_KEY)[0];
  assert.equal(a.requests.length,0); a.advance(1200); a.requests[0].fail({errMsg:'offline'});
  assert.equal(a.storage.get(STORAGE_KEY).length,1);
  const b=setup(a.storage); b.outbox.resume(); b.advance(1200);
  assert.equal(b.requests[0].data.events[0].payload.diagnosticEventId, original.id);
  assert.equal(b.requests[0].data.events[0].traceId, 'home-1');
  ack(b.requests[0]); assert.deepEqual(b.storage.get(STORAGE_KEY), []);
});
test('retries back off and stop, new logs do not bypass backoff, network recovery resumes', () => {
  const h=setup(); h.outbox.enqueue(body); h.advance(1200);
  h.requests[0].fail({errMsg:'offline'});
  h.outbox.enqueue(body); h.outbox.resume(); h.advance(4999); assert.equal(h.requests.length,1);
  h.advance(1); h.requests[1].fail({errMsg:'offline'});
  h.advance(30000); h.requests[2].fail({errMsg:'offline'});
  h.advance(120000); h.requests[3].fail({errMsg:'offline'});
  h.outbox.enqueue(body); h.advance(1000000); assert.equal(h.requests.length,4);
  h.network(); h.advance(1200); assert.equal(h.requests.length,5);
  ack(h.requests[4]); assert.equal(h.storage.get(STORAGE_KEY).length,0);
});
test('account and API isolation, current token only; no tokens or signed URLs stored', () => {
  const h=setup(); h.outbox.enqueue({...body, payload:{accessToken:'secret', url:'https://cdn/image?signature=secret', summary:'Bearer private-token'}});
  const stored=JSON.stringify(h.storage.get(STORAGE_KEY));
  assert.ok(!stored.includes('private-token')); assert.ok(!stored.includes('secret'));
  h.storage.set('userId','u2'); h.advance(1200); assert.equal(h.requests.length,0);
  h.storage.set('userId','u1'); h.endpoint('https://other.local/api/v1'); h.outbox.resume(); h.advance(1200); assert.equal(h.requests.length,0);
  h.endpoint('https://test.local/api/v1'); h.storage.set('accessToken','fresh-token'); h.outbox.resume(); h.advance(1200);
  assert.equal(h.requests[0].header.Authorization, 'Bearer fresh-token');
});
test('expiration, count/byte caps, and malformed stored entries are bounded', () => {
  const h=setup(); for(let i=0;i<100;i++) h.outbox.enqueue({...body,payload:{values:Array(64).fill('x'.repeat(2000))}});
  const entries=h.storage.get(STORAGE_KEY);
  assert.ok(entries.length<=MAX_ENTRIES); assert.ok(JSON.stringify(entries).length*2<=MAX_BYTES);
  h.advance(MAX_AGE_MS+1); h.outbox.resume(); assert.equal(h.storage.get(STORAGE_KEY).length,0);
  const storage=new Map([[STORAGE_KEY,[null,{id:'broken'},'bad']]]);
  assert.doesNotThrow(()=>setup(storage)); assert.equal(storage.get(STORAGE_KEY).length,0);
});
test('malformed ack and synchronous request/storage errors never delete records or break business code', () => {
  const h=setup(); h.outbox.enqueue(body); h.advance(1200);
  h.requests[0].success({statusCode:200, data:{}}); assert.equal(h.storage.get(STORAGE_KEY).length,1);
  h.wxApi.request=()=>{throw Error('request unavailable');}; h.advance(5000);
  assert.equal(h.storage.get(STORAGE_KEY).length,1);
  h.wxApi.setStorageSync=()=>{throw Error('quota full');};
  assert.doesNotThrow(()=>h.outbox.enqueue(body)); assert.ok(h.failures.length>0);
});
test('serialized batches cap at eight; late duplicate callbacks cannot remove new entries', () => {
  const h=setup(); for(let i=0;i<10;i++) h.outbox.enqueue(body); h.advance(1200);
  assert.equal(h.requests.length,1); assert.equal(h.requests[0].data.events.length,8);
  h.advance(10000); assert.equal(h.requests.length,1);
  ack(h.requests[0]); h.advance(1200); assert.equal(h.requests[1].data.events.length,2);
  ack(h.requests[0]); assert.equal(h.storage.get(STORAGE_KEY).length,2);
  ack(h.requests[1]); assert.equal(h.storage.get(STORAGE_KEY).length,0);
});
test('anonymous home diagnostics use a bounded separate endpoint without account attribution', () => {
  const h=setup(); h.storage.delete('accessToken'); h.storage.delete('userId');
  h.outbox.enqueue(body); h.outbox.enqueue({event:'request_fail'}); h.advance(1200);
  assert.equal(h.requests.length,1);
  assert.match(h.requests[0].url,/anonymous-client-logs\/batch$/);
  assert.equal(h.requests[0].header.Authorization,undefined);
  assert.equal(h.requests[0].data.events.length,1);
  ack(h.requests[0]); assert.equal(h.storage.get(STORAGE_KEY).length,0);
});
test('upload includes queue eviction and previous transport failure counters', () => {
  const h=setup(); for(let i=0;i<80;i++) h.outbox.enqueue(body);
  h.advance(1200); assert.ok(h.requests[0].data.events[0].payload.delivery.dropped >= 16);
  h.requests[0].fail({errMsg:'offline'}); h.advance(5000);
  assert.equal(h.requests[1].data.events[0].payload.delivery.uploadFailures,1);
});
test('logs created before login stay anonymous when delivered after login', () => {
  const h=setup(); h.storage.delete('accessToken'); h.storage.delete('userId');
  h.outbox.enqueue(body); h.storage.set('accessToken','new-token'); h.storage.set('userId','u2');
  h.advance(1200); assert.match(h.requests[0].url,/anonymous-client-logs\/batch$/);
  assert.equal(h.requests[0].header.Authorization,undefined);
});
test('normal successes coalesce disk writes and share a single upload batch', () => {
  const h = setup(); let writes = 0;
  const save = h.wxApi.setStorageSync;
  h.wxApi.setStorageSync = (...args) => { writes++; save(...args); };
  for (let i=0;i<6;i++) h.outbox.enqueue({...body, payload:{reason:'all_ready_state_committed'}});
  assert.equal(writes,0); h.advance(200); assert.equal(writes,1);
  h.advance(1000); assert.equal(h.requests.length,1); assert.equal(h.requests[0].data.events.length,6);
});
test('an error immediately persists pending normal summaries without waiting for debounce', () => {
  const h = setup();
  h.outbox.enqueue({...body,payload:{reason:'all_ready_state_committed'}});
  h.outbox.enqueue(body);
  assert.equal(h.storage.get(STORAGE_KEY).length,2);
  h.advance(1200); assert.equal(h.requests.length,1);
});

test('empty startup/resume do not write storage; unchanged flush does not rewrite queue', () => {
  let writes = 0;
  const wxApi = {getStorageSync: () => undefined, setStorageSync: () => writes++};
  const empty = createDiagnosticOutbox({wxApi, getApiBaseUrl: () => 'test'});
  empty.resume(); empty.resume(); assert.equal(writes, 0);
  const h = setup(); const save = h.wxApi.setStorageSync;
  h.wxApi.setStorageSync = (...args) => { writes++; save(...args); };
  h.outbox.enqueue(body); assert.equal(writes, 1);
  h.outbox.resume(); h.advance(1200); assert.equal(writes, 1);
  ack(h.requests[0]); assert.equal(writes, 2);
});
