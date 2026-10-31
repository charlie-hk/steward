// The part that makes "runs unattended" true.
//
// drain() empties the queue and returns. A service has to stay up, keep
// checking, and above all stop properly: a worker killed mid-job is exactly
// the crash the whole project is about, so shutdown finishes the job in hand
// before letting the process exit.
class Runner {
  constructor(worker, { pollMs = 500, onCycle = null } = {}) {
    this.worker = worker;
    this.pollMs = pollMs;
    this.onCycle = onCycle;
    this.running = false;
    this.busy = null;        // the promise of the cycle currently in flight
    this.wake = null;        // resolves the sleep early when stopping
    this.cycles = 0;
    this.processed = 0;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.loop = this.#run();
    return this;
  }

  async #run() {
    while (this.running) {
      this.busy = this.worker.drain();
      try {
        const n = await this.busy;
        this.processed += n;
        this.cycles += 1;
        if (this.onCycle) this.onCycle({ processed: n, total: this.processed });
      } catch (err) {
        // A broken cycle must not kill the service. The job-level failure path
        // is inside the worker; this catches the queue itself misbehaving.
        if (this.onCycle) this.onCycle({ error: err });
      } finally {
        this.busy = null;
      }
      if (!this.running) break;
      await this.#sleep(this.pollMs);
    }
  }

  #sleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
    });
  }

  // Stop accepting new work, let the job in flight finish, then return. The
  // caller can close the database safely once this resolves.
  async stop() {
    this.running = false;
    if (this.wake) this.wake();
    if (this.busy) await this.busy.catch(() => {});
    await this.loop;
  }

  // Run until the queue has nothing left to do, for scripts and tests.
  async untilIdle(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { pending = 0, in_progress: active = 0 } = this.worker.queue.counts();
      if (pending === 0 && active === 0 && this.cycles > 0) return true;
      await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  }
}

module.exports = { Runner };
