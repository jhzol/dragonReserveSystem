const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture() {
  const app = {globalData: {accessToken: 'a', userId: '1'}};
  const requests = [], writes = [], timers = new Map();
  let id = 0;
  const mod = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/calendarWarmup.js'), 'utf8'), {
    module: mod, Date, wx:{getStorageSync:()=>''},
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key=>timers.delete(key),
    require: name => name.includes('services/activity') ? {
      listMyActivities:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))
    } : {readPayload:()=>null, writeRawList:(...args)=>writes.push(args)}
  });
  return {app, requests, writes, timers, api:mod.exports};
}
test('warmup coalesces same owner; changed owner does not reuse or persist old response', async()=>{
  const h=fixture(); const a=h.api.prefetchSignedUpList(h.app);
  assert.equal(h.api.prefetchSignedUpList(h.app),a);
  h.app.globalData={accessToken:'b',userId:'2'};
  const b=h.api.prefetchSignedUpList(h.app);
  assert.equal(h.requests.length,2);
  h.requests[0].resolve([{id:'old'}]); await a;
  assert.equal(h.writes.length,0);
  assert.equal(h.api.prefetchSignedUpList(h.app),b);
  h.requests[1].resolve([{id:'new'}]); await b;
  assert.equal(h.writes.length,1); assert.equal(h.writes[0][0],'2');
});
test('hidden-page cancellation and guest warmup make no request; failure permits retry',async()=>{
  const h=fixture(); h.api.schedulePrefetchSignedUpList(h.app);
  h.api.cancelScheduledPrefetch(); assert.equal(h.timers.size,0);
  h.app.globalData={}; assert.equal(h.api.prefetchSignedUpList(h.app),null);
  assert.equal(h.requests.length,0);
  h.app.globalData={accessToken:'a',userId:'1'};
  const p=h.api.prefetchSignedUpList(h.app); h.requests[0].reject(Error('offline')); await p;
  const next=h.api.prefetchSignedUpList(h.app); assert.equal(h.requests.length,2);
  h.requests[1].resolve([]); await next; assert.equal(h.writes.length,1);
});

test('actual activity service shares signed-up request between warmup and calendar caller', async () => {
  const requests = [];
  let token = 'a';
  const serviceModule = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/activity.js'), 'utf8'), {
    module: serviceModule, wx:{getStorageSync:()=>token},
    require: name => name === './request' ? {request: options=>new Promise(resolve=>requests.push({options,resolve}))} : {}
  });
  const service = serviceModule.exports;
  const warmupModule = {exports:{}};
  const writes = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/calendarWarmup.js'), 'utf8'), {
    module:warmupModule, Date, setTimeout, clearTimeout, wx:{getStorageSync:()=>''},
    require: name=>name.includes('services/activity') ? service : {readPayload:()=>null,writeRawList:(...args)=>writes.push(args)}
  });
  const app={globalData:{userId:'1',accessToken:'a'}};
  const warm=warmupModule.exports.prefetchSignedUpList(app);
  const direct=service.listMyActivities();
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.apiVersion,2);
  requests[0].resolve([{id:1}]);
  assert.deepEqual(await direct,[{id:1}]); await warm;
  assert.equal(writes.length,1);
  const next=service.listMyActivities();
  token='b'; const other=service.listMyActivities();
  assert.equal(requests.length,3);
  requests[1].resolve([]); requests[2].resolve([]); await Promise.all([next,other]);
});
