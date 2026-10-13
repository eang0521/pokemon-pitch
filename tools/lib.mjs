// Shared helpers for the headless tools: run many matches in parallel on every CPU core.
//   const results = await runMatches(jobs)   // jobs: [{ home, away, seed, options, override }]
// Each result: { score, pens, teams: stats.teams, players: stats.players, log? }
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { Match } from '../js/match.js';

export function playJob(job) {
  const m = new Match(job.home, job.away, job.seed, { frames: false, ...(job.options || {}) });
  if (job.override) m.depth[job.override.side].synOverride = job.override, m.sim.refreshSide(m.sim.sides[job.override.side]);
  m.playToEnd();
  return { score: m.score, pens: m.pens || null, teams: m.stats.teams, players: job.wantPlayers ? m.stats.players : undefined, log: job.wantLog ? m.log : undefined };
}

export function runMatches(jobs, { threads = Math.max(1, availableParallelism() - 1), onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    let next = 0, done = 0, live = 0;
    const n = Math.min(threads, jobs.length);
    if (!n) return resolve(results);
    for (let w = 0; w < n; w++) {
      const worker = new Worker(new URL(import.meta.url), { workerData: { worker: true } });
      live++;
      const feed = () => {
        if (next >= jobs.length) { worker.postMessage(null); return; }
        const i = next++;
        worker.postMessage({ i, job: jobs[i] });
      };
      worker.on('message', ({ i, res }) => { results[i] = res; done++; onProgress?.(done, jobs.length); feed(); });
      worker.on('error', reject);
      worker.on('exit', () => { if (--live === 0) resolve(results); });
      feed();
    }
  });
}

if (!isMainThread && workerData?.worker) {
  parentPort.on('message', (msg) => {
    if (!msg) { process.exit(0); }
    parentPort.postMessage({ i: msg.i, res: playJob(msg.job) });
  });
}
