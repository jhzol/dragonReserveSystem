/** Bounded image preparation, independent of swiper's rendered item window.
 * A soft deadline is diagnostic only: the in-flight preparation retains its slot.
 * A terminal callback or hard deadline releases it; no fallback image is installed.
 */
function createHomeCardMediaLoader({ load, onReady, onError, concurrency = 3, timeoutMs = 15000,
  onStage = () => {}, onExhausted = () => {}, maxRetries = 2, retryDelayMs = 1000, hardTimeoutMs = 125000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const jobs = new Map();
  const queue = [];
  let active = 0;
  const outstanding = new Set();
  let disposed = false;
  let paused = false;
  let ranks = new Map();
  let foreground = new Set();

  function cancelJob(job) {
    const cancel = job.cancel;
    job.cancel = null;
    if (typeof cancel !== 'function') return;
    try { cancel(); } catch (_) {
      // Native abort is best effort. One SDK exception must not prevent
      // other jobs from being cleaned up or a replacement from being queued.
      report(job.url, 'cancellation_failed');
    }
  }

  function sortQueue() {
    queue.sort((a, b) => (ranks.get(a.url) ?? Infinity) - (ranks.get(b.url) ?? Infinity));
  }

  function scheduleRetry(job) {
    if (disposed) return;
    if (job.retries >= maxRetries) { report(job.url, 'retry_exhausted'); onExhausted(job.url); return; }
    job.retries += 1;
    report(job.url, 'retry_scheduled', { retryDelayMs: retryDelayMs * job.retries });
    job.retryTimer = setTimer(() => {
      job.retryTimer = null;
      if (disposed || job.state !== "failed") return;
      job.state = "queued";
      queue.push(job);
      sortQueue();
      pump();
    }, retryDelayMs * job.retries);
  }

  function report(url, name, extra = {}) { const job = jobs.get(url); try { onStage(url, name, { attempt: job?.attempt || 0, retries: job?.retries || 0, logicalActive: active, outstandingPreparations: outstanding.size, queued: queue.length, ...extra }); } catch (_) {} }

  function pump() {
    while (!disposed && !paused && active < concurrency && queue.length) {
      // Only foreground work may start while an unexpired foreground attempt
      // is pending. Failure/soft timeout opens the gate, but retains active slots.
      const gated = [...foreground].some(url => {
        const item = jobs.get(url);
        return item && !item.gateReleased && (item.state === 'queued' || item.state === 'loading');
      });
      const index = gated ? queue.findIndex(item => foreground.has(item.url)) : 0;
      if (index < 0) break;
      const [job] = queue.splice(index, 1);
      if (job.state !== 'queued') continue;
      job.state = 'loading';
      active += 1;
      let timedOut = false;
      let settled = false;
      const attempt = (job.attempt || 0) + 1;
      job.attempt = attempt;
      const key = {}; outstanding.add(key); job.outstandingKey = key;
      report(job.url, 'worker_started');
      const finish = (error, path) => {
        if (disposed || job.attempt !== attempt || settled) return;
        settled = true;
        clearTimer(job.timer);
        clearTimer(job.hardTimer);
        outstanding.delete(key);
        active -= 1;
        job.cancel = null;
        job.state = error ? 'failed' : 'ready';
        job.gateReleased = true;
        report(job.url, error ? 'attempt_failed' : 'attempt_succeeded');
        if (error) {
          onError(job.url, error);
          scheduleRetry(job);
        } else {
          if (timedOut) report(job.url, 'late_success');
          onReady(job.url, path || job.url);
        }
        pump();
      };
      // Waiting longer is not completion. Do not free a slot, start a second
      // transfer or allow manual retry to replace an actively progressing file.
      job.timer = setTimer(() => {
        if (disposed || settled || job.attempt !== attempt) return;
        timedOut = true;
        job.gateReleased = true;
        report(job.url, 'logical_timeout', { slotRetained: true });
        onError(job.url, new Error('image preparation timeout'));
        pump();
      }, timeoutMs);
      job.hardTimer = setTimer(() => {
        if (disposed || settled || job.attempt !== attempt) return;
        report(job.url, 'hard_timeout');
        // Request cancellation before freeing the slot. A native callback may
        // run synchronously here, so finish() remains idempotent.
        cancelJob(job);
        finish(new Error('image preparation hard timeout'));
      }, Math.max(timeoutMs, hardTimeoutMs));
      try {
        const cancel = load(job.url, (path) => finish(null, path), (error) => finish(error || new Error('image preparation failed')), { attempt, report: (name, details) => report(job.url, name, { ...details, attempt }) });
        if (!settled && !disposed && job.attempt === attempt) job.cancel = cancel;
      } catch (error) {
        finish(error);
      }
    }
  }

  return {
    // Hiding a page stops new work, not transfers that already have bytes.
    // Existing deadlines remain active so hidden work cannot live forever.
    pause() { paused = true; },
    resume() { if (disposed) return; paused = false; pump(); },
    enqueue(urls, { retryFailed = false, prioritize = false, foregroundUrls } = {}) {
      if (disposed) return;
      if (foregroundUrls !== undefined) foreground = new Set(foregroundUrls.filter(Boolean));
      for (const url of new Set(urls.filter(Boolean))) {
        let job = jobs.get(url);
        if (!job) {
          job = { url, state: 'queued', retries: 0 };
          jobs.set(url, job);
          queue.push(job);
          report(url, 'queued');
        } else if (retryFailed && job.state === 'failed') {
          report(url, 'manual_retry');
          outstanding.delete(job.outstandingKey);
          job.attempt = (job.attempt || 0) + 1;
          clearTimer(job.hardTimer);
          clearTimer(job.retryTimer);
          job.retries = 0;
          cancelJob(job);
          job.state = 'queued';
          queue.push(job);
          report(url, 'queued');
        }
      }
      if (prioritize) {
        ranks = new Map();
        urls.forEach((url, index) => { if (!ranks.has(url)) ranks.set(url, index); });
        sortQueue();
      }
      pump();
    },
    // A prepared local file can still be rejected by the native image view.
    // Share the transfer retry budget; repeated decode failures must not loop.
    invalidateReady(url) {
      const job = jobs.get(url);
      if (disposed || !job || job.state !== 'ready') return false;
      job.state = 'failed';
      report(url, 'native_invalidated');
      scheduleRetry(job);
      return true;
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const job of jobs.values()) {
        outstanding.delete(job.outstandingKey);
        if (job.state !== 'ready') report(job.url, 'page_cancelled');
        clearTimer(job.timer);
        clearTimer(job.hardTimer);
        clearTimer(job.retryTimer);
        cancelJob(job);
      }
    }
  };
}

module.exports = { createHomeCardMediaLoader };
