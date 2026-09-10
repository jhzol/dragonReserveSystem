/** Owned image files only. No synchronous storage and no changes to source pixels. */
const MAX_BYTES = 100 * 1000 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const instances = new WeakMap();
function createHomeImageDiskCache(wxApi, { maxBytes = MAX_BYTES, now = Date.now, maxAgeMs = MAX_AGE_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let fs;
  try { fs = wxApi.getFileSystemManager(); } catch (_) { return null; }
  if (!wxApi.env?.USER_DATA_PATH || !['mkdir', 'readFile', 'writeFile', 'rename', 'readdir', 'stat', 'copyFile', 'unlink'].every(k => typeof fs[k] === 'function')) return null;
  const dir = `${wxApi.env.USER_DATA_PATH}/home-image-cache-v1`;
  let entries = [], disabled = false, sequence = 0, chain = Promise.resolve();
  let initialization, persistTimer = null, accessVersion = 0, savedAccessVersion = 0;
  const invalid = new Set(), pinned = new Set(), removing = new Set(), generations = new Map();
  const call = (method, args) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { disabled = true; reject(new Error('cache IO timeout')); }, 1200);
    try { fs[method]({ ...args, success: r => { clearTimeout(timer); resolve(r); }, fail: e => { clearTimeout(timer); reject(e); } }); }
    catch (e) { clearTimeout(timer); reject(e); }
  });
  const owned = name => /^img-[a-z0-9-]+\.bin$/.test(name);
  const remove = async name => {
    if (!owned(name)) throw new Error('unowned file');
    // Mark before asynchronous unlink: foreground readers must not acquire a
    // path already selected for eviction. Other cache hits remain unblocked.
    removing.add(name);
    try { return await call('unlink', { filePath: `${dir}/${name}` }); }
    finally { removing.delete(name); }
  };
  const persist = async () => {
    if (persistTimer !== null) { clearTimer(persistTimer); persistTimer = null; }
    const version = accessVersion;
    await call('writeFile', { filePath: `${dir}/index.next`, data: JSON.stringify(entries), encoding: 'utf8' });
    await call('rename', { oldPath: `${dir}/index.next`, newPath: `${dir}/index.json` });
    savedAccessVersion = version;
    if (accessVersion !== version) scheduleAccessPersist();
  };
  async function init() {
    try { await call('mkdir', { dirPath: dir, recursive: true }); } catch (e) { if (disabled) throw e; }
    try {
      const result = await call('readFile', { filePath: `${dir}/index.json`, encoding: 'utf8' });
      const parsed = JSON.parse(result.data);
      const seen = new Set();
      if (Array.isArray(parsed)) entries = parsed.filter(e => {
        if (!e || typeof e.url !== 'string' || !owned(e.name) || seen.has(e.name) ||
          !Number.isFinite(e.size) || e.size <= 0 || !Number.isFinite(e.saved) || !Number.isFinite(e.used)) return false;
        seen.add(e.name); return true;
      });
    } catch (e) { if (disabled) throw e; }
    const listing = await call('readdir', { dirPath: dir });
    const live = new Set(listing.files);
    entries = entries.filter(e => live.has(e.name));
    const indexed = new Set(entries.map(e => e.name));
    // Recover only our own interrupted writes; never traverse or delete business files.
    for (const name of live) if (owned(name) && !indexed.has(name)) await remove(name);
  }
  function ensureInitialized() {
    if (!initialization) initialization = init();
    return initialization;
  }
  function scheduleAccessPersist() {
    if (persistTimer !== null || disabled) return;
    persistTimer = setTimer(() => {
      persistTimer = null;
      serial(async () => { if (accessVersion !== savedAccessVersion) await persist(); });
    }, 200);
    if (persistTimer && typeof persistTimer.unref === 'function') persistTimer.unref();
  }
  if (typeof wxApi.onAppHide === 'function') wxApi.onAppHide(() => {
    if (accessVersion !== savedAccessVersion) serial(persist);
  });
  function serial(fn, fallback) {
    const task = chain.then(async () => { if (disabled) return fallback; await ensureInitialized(); return fn(); }).catch(() => fallback);
    chain = task.then(() => {}); return task;
  }
  return {
    async get(url) {
      // Reads do not wait behind copies/index writes. Pin before stat so eviction
      // cannot remove the file while a foreground read is in progress.
      try {
        if (disabled) return null;
        await ensureInitialized();
        if (disabled || invalid.has(url)) return null;
        const generation = generations.get(url) || 0;
        const e = [...entries].reverse().find(x => x.url === url);
        if (!e || removing.has(e.name) || now() - e.saved >= maxAgeMs || now() < e.saved) return null;
        pinned.add(e.name);
        try {
          const r = await call('stat', { path: `${dir}/${e.name}` });
          if (r.stats.size !== e.size) throw new Error('cache size mismatch');
        } catch (_) { invalid.add(url); pinned.delete(e.name); return null; }
        if (invalid.has(url) || generation !== (generations.get(url) || 0) || !entries.includes(e)) return null;
        e.used = now(); accessVersion++;
        scheduleAccessPersist();
        return `${dir}/${e.name}`;
      } catch (_) { return null; }
    },
    invalidate(url) {
      generations.set(url, (generations.get(url) || 0) + 1);
      invalid.add(url); // Immediately block racing reads/saves before queued disk work.
      return serial(async () => {
        const old = entries.filter(e => e.url === url);
        for (const e of old) { await remove(e.name); pinned.delete(e.name); }
        entries = entries.filter(e => e.url !== url); await persist();
      });
    },
    put(url, path) {
      // A new validated download may replace an invalidated entry. A save already
      // in flight before invalidation must not resurrect the rejected file.
      const generation = generations.get(url) || 0;
      const wasInvalid = invalid.has(url);
      invalid.delete(url);
      return serial(async () => {
        if ((generations.get(url) || 0) !== generation || invalid.has(url) || !path || (/^https?:/.test(path) && !/^http:\/\/(tmp|usr)\//.test(path))) return false;
        const size = (await call('stat', { path })).stats.size;
        if (!Number.isFinite(size) || size <= 0 || size > maxBytes) return false;
        if (!wasInvalid && entries.some(e => e.url === url && now() >= e.saved && now() - e.saved < maxAgeMs)) return true;
        // Expired or missing entries must not shadow the replacement on next launch.
        if (entries.some(e => e.url === url && pinned.has(e.name))) return false;
        for (const e of entries.filter(e => e.url === url)) {
          try { await remove(e.name); } catch (error) {
            const listing = await call('readdir', { dirPath: dir });
            if (listing.files.includes(e.name)) throw error;
          }
          entries = entries.filter(x => x !== e); pinned.delete(e.name);
        }
        let total = entries.reduce((sum, e) => sum + e.size, 0);
        for (const e of [...entries].sort((a, b) => a.used - b.used)) {
          if (total + size <= maxBytes) break;
          if (pinned.has(e.name)) continue;
          await remove(e.name); entries = entries.filter(x => x !== e); total -= e.size;
        }
        if (total + size > maxBytes) return false;
        const name = `img-${now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}.bin`;
        await call('copyFile', { srcPath: path, destPath: `${dir}/${name}` });
        if (invalid.has(url) || (generations.get(url) || 0) !== generation) { await remove(name); return false; }
        entries.push({ url, name, size, saved: now(), used: now() });
        // New file ownership must remain dirty if its first index write fails.
        // App hide can then retry without requiring another cache hit.
        accessVersion++;
        await persist(); return true;
      }, false);
    }
  };
}
function getHomeImageDiskCache(wxApi) {
  if (!wxApi || typeof wxApi !== 'object') return null;
  if (!instances.has(wxApi)) instances.set(wxApi, createHomeImageDiskCache(wxApi));
  return instances.get(wxApi);
}
module.exports = { MAX_BYTES, MAX_AGE_MS, createHomeImageDiskCache, getHomeImageDiskCache };
