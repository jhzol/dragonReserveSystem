const test = require('node:test');
const assert = require('node:assert/strict');
const { createHomeImageDiskCache, MAX_BYTES } = require('../utils/homeImageDiskCache');
const { prepareHomeImage, invalidateHomeImageCache } = require('../utils/homeImagePreparation');
function fixture() {
  const files = new Map([['temp', Buffer.alloc(12)]]);
  const fs = {};
  let failCopy = false;
  for (const name of ['mkdir','readFile','writeFile','rename','readdir','stat','copyFile','unlink']) fs[name] = args => {
    try {
      let result = {};
      if (name === 'readFile') { if (!files.has(args.filePath)) throw Error('missing'); result.data = files.get(args.filePath).toString(); }
      if (name === 'writeFile') files.set(args.filePath, Buffer.from(args.data));
      if (name === 'rename') { files.set(args.newPath, files.get(args.oldPath)); files.delete(args.oldPath); }
      if (name === 'readdir') result.files = [...files.keys()].filter(p => p.startsWith(args.dirPath + '/')).map(p => p.slice(args.dirPath.length+1));
      if (name === 'stat') { if (!files.has(args.path)) throw Error('missing'); result.stats = { size: files.get(args.path).length }; }
      if (name === 'copyFile') { if (failCopy) throw Error('disk full'); files.set(args.destPath, Buffer.from(files.get(args.srcPath))); }
      if (name === 'unlink') { if (!files.has(args.filePath)) throw Error('missing'); files.delete(args.filePath); }
      args.success(result);
    } catch (e) { args.fail(e); }
  };
  const wxApi = { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => fs };
  return { files, fs, wxApi, full: () => { failCopy = true; } };
}
test('100MB budget, exact pixels retained, process restart reuse', async () => {
  assert.equal(MAX_BYTES, 100000000);
  const h=fixture(); const c=createHomeImageDiskCache(h.wxApi);
  assert.equal(await c.put('https://a?v=1','temp'),true);
  const path=await createHomeImageDiskCache(h.wxApi).get('https://a?v=1');
  assert.deepEqual(h.files.get(path), h.files.get('temp'));
  assert.equal(await c.get('https://a?v=2'),null);
});
test('LRU eviction respects budget and never deletes unrelated files', async () => {
  const h=fixture(); h.files.set('/user/avatar',Buffer.alloc(1)); let now=1;
  let c=createHomeImageDiskCache(h.wxApi,{maxBytes:24,now:()=>now++});
  await c.put('a','temp'); await c.put('b','temp'); await c.put('c','temp');
  c=createHomeImageDiskCache(h.wxApi,{maxBytes:24,now:()=>now++});
  assert.equal(await c.get('a'),null); assert.ok(await c.get('b')); assert.ok(await c.get('c'));
  assert.ok(h.files.has('/user/avatar'));
  assert.equal([...h.files].filter(([p])=>p.endsWith('.bin')).reduce((s,[,b])=>s+b.length,0),24);
});
test('pinned displayed files are not evicted; new cache writes may be skipped', async () => {
  const h=fixture(); const c=createHomeImageDiskCache(h.wxApi,{maxBytes:12});
  await c.put('a','temp'); const p=await c.get('a');
  assert.equal(await c.put('b','temp'),false); assert.ok(h.files.has(p));
});
test('expired same URL refreshes without stale entry shadowing', async () => {
  const h=fixture(); let now=0; const c=createHomeImageDiskCache(h.wxApi,{maxAgeMs:10,now:()=>now});
  await c.put('a','temp'); now=11; assert.equal(await c.get('a'),null);
  await c.put('a','temp'); assert.ok(await c.get('a'));
});
test('disk full, missing API and oversize fail safely',async()=>{
  const h=fixture(); h.full(); const c=createHomeImageDiskCache(h.wxApi);
  assert.equal(await c.put('a','temp'),false);
  assert.equal(createHomeImageDiskCache({}),null);
  assert.equal(await createHomeImageDiskCache(fixture().wxApi,{maxBytes:1}).put('a','temp'),false);
});
test('corrupt index recovers owned orphan only; missing cached file can be replaced',async()=>{
  const h=fixture(); h.files.set('/user/home-image-cache-v1/index.json',Buffer.from('broken'));
  h.files.set('/user/home-image-cache-v1/img-orphan.bin',Buffer.alloc(1));
  h.files.set('/user/home-image-cache-v1/business.jpg',Buffer.alloc(1));
  const c=createHomeImageDiskCache(h.wxApi); await c.put('a','temp');
  assert.ok(h.files.has('/user/home-image-cache-v1/business.jpg')); assert.ok(!h.files.has('/user/home-image-cache-v1/img-orphan.bin'));
  h.files.delete(await c.get('a')); assert.equal(await c.get('a'),null);
  await c.put('a','temp'); assert.ok(await c.get('a'));
});
const tick = () => new Promise(r=>setImmediate(r));
test('preparation cache hit does not download, native invalidation forces next transfer',async()=>{
  const h=fixture(); let downloads=0;
  h.wxApi.getImageInfo = r=>r.success({path:r.src,width:10,height:10});
  h.wxApi.downloadFile = r=>{downloads++; r.success({statusCode:200,tempFilePath:'temp'}); return {};};
  const run=()=>new Promise((ready,failed)=>prepareHomeImage({wxApi:h.wxApi,url:'https://a',ready,failed}));
  assert.equal(await run(),'temp'); await tick();
  assert.match(await run(),/home-image-cache/); assert.equal(downloads,1);
  await invalidateHomeImageCache(h.wxApi,'https://a'); await run(); assert.equal(downloads,2);
});
test('decode failure falls back to download; cancellation suppresses late cache hit',async()=>{
  const h=fixture(); await createHomeImageDiskCache(h.wxApi).put('https://a','temp');
  let downloads=0;
  h.wxApi.getImageInfo=r=>r.src.includes('cache')?r.fail({}):r.success({path:r.src});
  h.wxApi.downloadFile=r=>{downloads++;r.success({statusCode:200,tempFilePath:'temp'});return {};};
  await new Promise((ready,failed)=>prepareHomeImage({wxApi:h.wxApi,url:'https://a',ready,failed}));
  assert.equal(downloads,1); await tick();
  let ready=0; const cancel=prepareHomeImage({wxApi:h.wxApi,url:'https://a',ready:()=>ready++,failed:()=>{}}); cancel(); await tick();
  assert.equal(ready,0); assert.equal(downloads,1);
});
test('invalidation during delayed copy cannot resurrect bad file',async()=>{
  const h=fixture();const original=h.fs.copyFile;let release;
  h.fs.copyFile=args=>{release=()=>original(args);};
  const c=createHomeImageDiskCache(h.wxApi);const save=c.put('a','temp');await tick();
  const invalidated=c.invalidate('a');release();await save;await invalidated;
  assert.equal(await c.get('a'),null);
});
test('hung filesystem cannot prevent network readiness',async()=>{
  const h=fixture();h.fs.mkdir=()=>{};let downloads=0;
  h.wxApi.getImageInfo=r=>r.success({path:r.src});
  h.wxApi.downloadFile=r=>{downloads++;r.success({statusCode:200,tempFilePath:'temp'});return {};};
  const path=await new Promise((ready,failed)=>prepareHomeImage({wxApi:h.wxApi,url:'https://hung',ready,failed}));
  assert.equal(path,'temp');assert.equal(downloads,1);
});
test('devtools http://tmp is a local file, real remote URLs are not saved',async()=>{
 const h=fixture();h.files.set('http://tmp/image.jpg',Buffer.alloc(12));
 const c=createHomeImageDiskCache(h.wxApi);
 assert.equal(await c.put('a','http://tmp/image.jpg'),true);
 assert.equal(await c.put('b','https://example.com/image.jpg'),false);
});

test('default cache survives 24h and process restart, expires after 30 days, URL versions remain isolated', async () => {
  const { MAX_AGE_MS } = require('../utils/homeImageDiskCache');
  assert.equal(MAX_AGE_MS, 30 * 24 * 60 * 60 * 1000);
  const h = fixture(); let now = 1000;
  const cache = () => createHomeImageDiskCache(h.wxApi, { now: () => now });
  assert.equal(await cache().put('https://cover?v=old', 'temp'), true);
  now += 2 * 24 * 60 * 60 * 1000;
  assert.ok(await cache().get('https://cover?v=old'));
  assert.equal(await cache().get('https://cover?v=new'), null);
  now = 1000 + MAX_AGE_MS - 1;
  assert.ok(await cache().get('https://cover?v=old'));
  now = 1000 + MAX_AGE_MS + 1;
  assert.equal(await cache().get('https://cover?v=old'), null);
});

test('12 warm hits return before one coalesced index write, preserving restart reuse', async () => {
  const h = fixture(); let time = 1000;
  const seed = createHomeImageDiskCache(h.wxApi, {now: () => time});
  for (let i = 0; i < 12; i++) await seed.put(`url-${i}`, 'temp');
  let writes = 0, renames = 0; const tasks = new Map(); let next = 0;
  for (const name of ['writeFile', 'rename']) {
    const original = h.fs[name]; h.fs[name] = args => {
      if (name === 'writeFile') writes++; else renames++;
      original(args);
    };
  }
  const cache = createHomeImageDiskCache(h.wxApi, {now: () => ++time,
    setTimer: fn => { tasks.set(++next, fn); return next; }, clearTimer: id => tasks.delete(id)});
  const paths = await Promise.all(Array.from({length:12}, (_,i) => cache.get(`url-${i}`)));
  assert.ok(paths.every(Boolean)); assert.equal(writes, 0); assert.equal(renames, 0);
  assert.equal(tasks.size, 1); const pending = [...tasks.values()]; tasks.clear(); pending.forEach(fn => fn());
  await tick(); assert.equal(writes, 1); assert.equal(renames, 1);
  assert.ok(await createHomeImageDiskCache(h.wxApi, {now: () => time}).get('url-0'));
});
test('foreground hit bypasses an unrelated in-progress background copy', async () => {
  const h = fixture(); const c = createHomeImageDiskCache(h.wxApi);
  await c.put('existing', 'temp');
  const original = h.fs.copyFile; let release;
  h.fs.copyFile = args => { release = () => original(args); };
  const save = c.put('background', 'temp'); await tick();
  assert.ok(await c.get('existing')); release(); assert.equal(await save, true);
});

test('foreground get cannot return a file whose eviction is already in flight', async () => {
  const h = fixture();
  const c = createHomeImageDiskCache(h.wxApi, { maxBytes: 12 });
  await c.put('a', 'temp');
  const unlink = h.fs.unlink;
  let release;
  const deleting = new Promise(resolve => {
    h.fs.unlink = args => { release = () => unlink(args); resolve(); };
  });
  const saving = c.put('b', 'temp');
  await deleting;
  assert.equal(await c.get('a'), null);
  release();
  assert.equal(await saving, true);
  assert.ok(await c.get('b'));
});

test('failed deferred index write preserves usable cache and hide retries dirty access metadata', async () => {
  const h = fixture(); let hide, time = 100;
  h.wxApi.onAppHide = fn => { hide = fn; };
  const tasks = new Map(); let seq = 0;
  const c = createHomeImageDiskCache(h.wxApi, {now:()=>time,
    setTimer:fn=>{tasks.set(++seq,fn);return seq;},clearTimer:id=>tasks.delete(id)});
  await c.put('a','temp');
  const original = h.fs.writeFile; let fail = true;
  h.fs.writeFile = args => fail ? args.fail(Error('write unavailable')) : original(args);
  time = 200; assert.ok(await c.get('a'));
  const pending = [...tasks.values()]; tasks.clear(); pending.forEach(fn=>fn()); await tick();
  assert.equal(JSON.parse(h.files.get('/user/home-image-cache-v1/index.json').toString())[0].used,100);
  fail = false; hide(); await tick();
  assert.equal(JSON.parse(h.files.get('/user/home-image-cache-v1/index.json').toString())[0].used,200);
  assert.ok(await createHomeImageDiskCache(h.wxApi,{now:()=>time}).get('a'));
});

test('new download index failure is retried on hide without a cache read', async () => {
  const h = fixture(); let hide;
  h.wxApi.onAppHide = fn => { hide = fn; };
  const c = createHomeImageDiskCache(h.wxApi);
  assert.equal(await c.put('existing', 'temp'), true);
  const write = h.fs.writeFile;
  h.fs.writeFile = args => args.fail(Error('temporary index write failure'));
  assert.equal(await c.put('new-download', 'temp'), false);
  assert.equal(JSON.parse(h.files.get('/user/home-image-cache-v1/index.json')).length, 1);
  h.fs.writeFile = write;
  hide(); await tick();
  assert.equal(JSON.parse(h.files.get('/user/home-image-cache-v1/index.json')).length, 2);
  const restarted = createHomeImageDiskCache(h.wxApi);
  assert.ok(await restarted.get('new-download'));
  assert.ok(await restarted.get('existing'));
});
