/** Bounded image preparation, independent of swiper's rendered item window.
 * A timeout releases the worker, never marks an image ready or installs a fallback.
 */
function createHomeCardMediaLoader({ load, onReady, onError, concurrency = 3, timeoutMs = 15000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  const jobs = new Map();
  const queue = [];
  let active = 0;
  let disposed = false;

  function pump() {
    while (!disposed && active < concurrency && queue.length) {
      const job = queue.shift();
      if (job.state !== 'queued') continue;
      job.state = 'loading';
      active += 1;
      let finished = false;
      const finish = (error, path) => {
        if (finished || disposed) return;
        finished = true;
        clearTimer(job.timer);
        active -= 1;
        job.cancel = null;
        job.state = error ? 'failed' : 'ready';
        if (error) onError(job.url, error);
        else onReady(job.url, path || job.url);
        pump();
      };
      job.timer = setTimer(() => {
        const cancel = job.cancel;
        finish(new Error('image preparation timeout'));
        if (typeof cancel === "function") cancel();
      }, timeoutMs);
      try {
        job.cancel = load(job.url, (path) => finish(null, path), (error) => finish(error || new Error('image preparation failed')));
      } catch (error) {
        finish(error);
      }
    }
  }

  return {
    enqueue(urls, { retryFailed = false } = {}) {
      for (const url of new Set(urls.filter(Boolean))) {
        let job = jobs.get(url);
        if (!job) {
          job = { url, state: 'queued' };
          jobs.set(url, job);
          queue.push(job);
        } else if (retryFailed && job.state === 'failed') {
          job.state = 'queued';
          queue.push(job);
        }
      }
      pump();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      for (const job of jobs.values()) {
        clearTimer(job.timer);
        if (typeof job.cancel === "function") job.cancel();
      }
    }
  };
}

module.exports = { createHomeCardMediaLoader };
