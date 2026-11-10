import { generate } from '../src/generate.js';
import { analyze } from '../src/analysis.js';
const alphas = process.argv[2] ? [parseFloat(process.argv[2])] : [0.02, 0.01, 0.005];
const runs = generate();
console.log('runs', runs.length);
for (const alpha of alphas) {
  const t0 = Date.now(); const A = analyze(runs, { alpha });
  console.log(`\n=== alpha ${alpha} (${Date.now()-t0} ms) h=${A.totals.h}`);
  for (const r of A.rows) {
    const c = r.cert;
    console.log(r.errand.id.padEnd(10), 'cal', r.calN, 'live', r.liveN, r.live.status.padEnd(9),
      c.certified ? `lam ${c.lambda} cov ${(c.coverage*100).toFixed(1)}% err ${(c.errRate*100).toFixed(2)}% ub ${(c.upper*100).toFixed(2)}%` : `near ${c.nearest && c.nearest.lambda} r ${(c.nearest? c.nearest.errRate*100:0).toFixed(2)}% need ${c.runsNeeded}`,
      '| live hf', r.live.handsFree, 'errs', r.live.errs, (r.live.rate*100).toFixed(2)+'%', r.live.alarm ? `ALARM at auto#${r.live.alarm.index} ${r.live.alarm.run.day} wo-mon ${r.live.withoutMonitor.k}/${r.live.withoutMonitor.n}` : '',
      '| naive', r.naive.n, r.naive.k, (r.naive.rate*100).toFixed(2)+'%');
  }
  const T = A.totals;
  console.log('TOTAL live', T.liveTotal, 'hf', T.handsFree, 'skipped', (T.confirmationsSkipped*100).toFixed(1)+'%', 'hf err', T.handsFreeErr, (T.handsFreeRate*100).toFixed(2)+'%', 'naive', T.naive.n, T.naive.k, (T.naive.rate*100).toFixed(2)+'%', 'naive cov', (T.naive.coverage*100).toFixed(1)+'%', 'certified', T.certifiedCount);
}
