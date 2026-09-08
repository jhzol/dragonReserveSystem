// Best-effort, at-least-once diagnostic delivery. IDs remain stable across retries.
// Never persist access tokens; isolate records by API endpoint and account.
const STORAGE_KEY = 'client-diagnostic-outbox-v1';
const MAX_ENTRIES = 64;
const MAX_BYTES = 256 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS = [5000, 30000, 120000];

function sanitize(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1')
    .slice(0, 2048);
  if (Array.isArray(value)) return value.slice(0, 64).map(v => sanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 50).forEach(key => {
      if (/token|authorization|password|cookie|secret/i.test(key)) return;
      result[key] = sanitize(value[key], depth + 1);
    });
    return result;
  }
  return value;
}

function createDiagnosticOutbox({ wxApi, getApiBaseUrl, createId, onFailure = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let queue = [], timer = null, inFlight = false, retry = 0, paused = false, nextAt = 0;
  const safe = fn => { try { return fn(); } catch (_) { return undefined; } };
  const report = message => safe(() => onFailure(message));
  const identity = () => ({
    owner: String(safe(() => wxApi.getStorageSync('userId')) || ''),
    token: String(safe(() => wxApi.getStorageSync('accessToken')) || ''),
    endpoint: String(safe(getApiBaseUrl) || '')
  });
  function prune() {
    const cutoff = now() - MAX_AGE_MS;
    queue = queue.filter(e => e && typeof e.id === 'string' && e.owner && e.endpoint &&
      Number.isFinite(e.createdAt) && e.createdAt >= cutoff && e.createdAt <= now() &&
      e.body && typeof e.body.event === 'string').slice(-MAX_ENTRIES);
    while (queue.length && JSON.stringify(queue).length * 2 > MAX_BYTES) queue.shift();
  }
  function persist() {
    prune();
    try { wxApi.setStorageSync(STORAGE_KEY, queue); }
    catch (_) { report('diagnostic local storage unavailable'); }
  }
  const stored = safe(() => wxApi.getStorageSync(STORAGE_KEY));
  if (Array.isArray(stored)) queue = sanitize(stored);
  persist();

  function schedule(delay = 1200) {
    if (timer !== null || inFlight || paused || !queue.length) return;
    timer = setTimer(() => { timer = null; flush(); }, Math.max(delay, nextAt - now()));
  }
  function flush() {
    if (inFlight || paused) return;
    if (now() < nextAt) { schedule(nextAt - now()); return; }
    prune();
    const current = identity();
    if (!current.owner || !current.token || !current.endpoint) return;
    const batch = queue.filter(e => e.owner === current.owner && e.endpoint === current.endpoint).slice(0, 8);
    if (!batch.length) return;
    inFlight = true;
    let finished = false;
    const complete = (success, reason) => {
      if (finished) return;
      finished = true; inFlight = false;
      if (success) {
        const ids = new Set(batch.map(e => e.id));
        queue = queue.filter(e => !ids.has(e.id));
        retry = 0; nextAt = 0; persist(); schedule();
      } else {
        // Leave the original batch on disk, including when the process exits in flight.
        persist(); report(reason || 'diagnostic upload failed');
        if (retry < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[retry++]; nextAt = now() + delay; schedule(delay);
        } else { paused = true; }
      }
    };
    try {
      wxApi.request({
        url: `${current.endpoint}/diagnostics/client-logs/batch`, method: 'POST', timeout: 5000,
        header: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` },
        data: { events: batch.map(e => e.body) },
        success: res => complete(res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.stored === true,
          `diagnostic status:${res.statusCode}; acknowledgement required`),
        fail: error => complete(false, error && error.errMsg)
      });
    } catch (error) { complete(false, error && error.message); }
  }
  function resume() {
    // Foreground/network callbacks must not bypass an active retry backoff.
    if (paused) { paused = false; retry = 0; nextAt = now() + 1200; }
    persist(); schedule();
  }
  safe(() => wxApi.onNetworkStatusChange(event => { if (event.isConnected) resume(); }));
  return {
    enqueue(body) {
      const current = identity();
      if (!current.owner || !current.token || !current.endpoint) return;
      const id = createId();
      const clean = sanitize(body);
      clean.payload = { ...(clean.payload || {}), diagnosticEventId: id, occurredAt: now() };
      queue.push({ id, owner: current.owner, endpoint: current.endpoint, createdAt: now(), body: clean });
      persist(); schedule();
    },
    resume
  };
}
module.exports = { createDiagnosticOutbox, STORAGE_KEY, MAX_ENTRIES, MAX_BYTES, MAX_AGE_MS };
