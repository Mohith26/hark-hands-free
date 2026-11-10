import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binomCdf, clopperPearsonUpper, certify, riskCurve, runsNeeded, cusumAlarm, cusumARL, cusumThreshold, GRID } from '../src/autonomy.js';
import { generate, mulberry32, ERRANDS, TIMELINE } from '../src/generate.js';
import { analyze, NAIVE_CUTOFF } from '../src/analysis.js';

function choose(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }

test('binomCdf matches a direct sum and handles edge cases', () => {
  for (const [k, n, p] of [[0, 10, 0.1], [3, 20, 0.25], [7, 30, 0.5], [2, 400, 0.01]]) {
    let s = 0; for (let i = 0; i <= k; i++) s += choose(n, i) * p ** i * (1 - p) ** (n - i);
    assert.ok(Math.abs(binomCdf(k, n, p) - s) < 1e-10, `${k},${n},${p}`);
  }
  assert.equal(binomCdf(-1, 5, 0.3), 0);
  assert.equal(binomCdf(5, 5, 0.3), 1);
  // large n stays finite and sensible
  const v = binomCdf(30, 10000, 0.005);
  assert.ok(v > 1e-4 && v < 1e-2); // mean 50, sd ~7: about 2.8 sd below
});

test('Clopper-Pearson upper bound matches closed form for zero errors', () => {
  const ub = clopperPearsonUpper(0, 100, 0.95);
  assert.ok(Math.abs(ub - (1 - 0.05 ** (1 / 100))) < 1e-6);
  assert.ok(clopperPearsonUpper(5, 1000, 0.95) > 0.005);
});

test('risk curve is nested: fewer runs as the cutoff rises', () => {
  const rng = mulberry32(1);
  const runs = Array.from({ length: 2000 }, () => ({ conf: rng(), err: rng() < 0.05 ? 1 : 0 }));
  const c = riskCurve(runs);
  for (let i = 1; i < c.length; i++) { assert.ok(c[i].n <= c[i - 1].n); assert.ok(c[i].k <= c[i - 1].k); }
  assert.equal(c[0].n, runs.filter(r => r.conf >= GRID[0]).length);
});

// Known-truth simulation: conf ~ U(0.5, 1); P(err | conf) = 0.12 * (1 - conf).
// True conditional risk above lambda = mean of that over [lambda, 1] = 0.06 * (1 - lambda).
// With alpha = 1% the boundary is lambda* = 0.833: grid point 0.80 is unsafe (1.2%), 0.85 is safe (0.9%).
const trueRisk = lam => 0.06 * (1 - lam);
function drawCal(rng, n) {
  return Array.from({ length: n }, () => { const c = 0.5 + 0.5 * rng(); return { conf: c, err: rng() < 0.12 * (1 - c) ? 1 : 0 }; });
}

test('certification guarantee: chosen cutoff has true error <= alpha in >= 1 - delta of datasets', () => {
  const alpha = 0.01, delta = 0.05; let bad = 0, cert = 0; const R = 300;
  const rng = mulberry32(42);
  for (let r = 0; r < R; r++) {
    const res = certify(drawCal(rng, 20000), { alpha, delta });
    if (res.certified) { cert++; if (trueRisk(res.lambda) > alpha) bad++; }
  }
  assert.ok(cert > R * 0.5, `certified only ${cert}`);
  assert.ok(bad / R <= delta, `violations ${bad}/${R}`);
});

test('certify picks the loosest certified cutoff and refuses when Handoff is not good enough', () => {
  const rng = mulberry32(5);
  const res = certify(drawCal(rng, 20000), { alpha: 0.01 });
  assert.ok(res.certified);
  const certifiedLams = res.curve.filter(c => c.p <= res.dEff).map(c => c.lambda);
  assert.equal(res.lambda, Math.min(...certifiedLams));
  const hard = Array.from({ length: 5000 }, () => ({ conf: 0.999, err: rng() < 0.05 ? 1 : 0 }));
  const r2 = certify(hard, { alpha: 0.01 });
  assert.equal(r2.certified, false);
  assert.equal(r2.runsNeeded, null);
});

test('runsNeeded: adding that many runs at the same error rate makes the test pass, one fewer does not', () => {
  const alpha = 0.01, dEff = 0.05 / GRID.length;
  const k = 3, n = 800; // 0.375% observed
  const m = runsNeeded(k, n, alpha, dEff);
  assert.ok(m > 0);
  const r = k / n;
  assert.ok(binomCdf(Math.floor(r * (n + m)), n + m, alpha) <= dEff);
  assert.ok(binomCdf(Math.floor(r * (n + m - 1)), n + m - 1, alpha) > dEff);
  assert.equal(runsNeeded(20, 1000, alpha, dEff), null);
});

test('CUSUM: threshold gives the target in-control run length and catches a large shift fast', () => {
  const h = cusumThreshold(0.01, 0.05, 20000, mulberry32(9), 120);
  const arl0 = cusumARL(0.01, 0.01, 0.05, h, mulberry32(10), 200);
  assert.ok(arl0 > 20000 * 0.8, `ARL0 ${arl0}`);
  const arl1 = cusumARL(0.08, 0.01, 0.05, h, mulberry32(11), 400);
  assert.ok(arl1 < 120, `ARL1 ${arl1}`);
  const { alarmAt } = cusumAlarm([...Array(500).fill(0), ...Array(50).fill(1)], 0.01, 0.05, h);
  assert.ok(alarmAt >= 500 && alarmAt < 510);
});

test('generator is deterministic and matches the timeline', () => {
  const a = generate(), b = generate();
  assert.equal(a.length, b.length);
  assert.deepEqual(a.slice(0, 50), b.slice(0, 50));
  assert.equal(a[0].day >= TIMELINE.start, true);
  assert.equal(a[a.length - 1].day <= TIMELINE.end, true);
  assert.equal(new Set(a.map(r => r.errand)).size, ERRANDS.length);
});

test('end to end on the demo log: drift caught, guarantee holds in aggregate, flat cutoff is uneven', () => {
  const A = analyze(generate(), { alpha: 0.01 });
  const rx = A.rows.find(r => r.errand.id === 'rx');
  assert.equal(rx.live.status, 'paused');
  assert.ok(rx.live.drift.pausedOn >= rx.errand.drift.from, 'no alarm before the redesign');
  assert.ok(rx.live.drift.avoided > 10);
  for (const r of A.rows) if (r.errand.id !== 'rx' && r.cert.certified) assert.equal(r.live.alarm, null, `false alarm on ${r.errand.id}`);
  assert.ok(A.totals.handsFreeRate <= 0.01);
  assert.ok(A.totals.confirmationsSkipped > 0.5);
  const naiveRates = A.rows.map(r => r.naive.rate);
  assert.ok(Math.max(...naiveRates) > 0.03 && Math.min(...naiveRates) < 0.005, 'a flat cutoff gives very uneven error rates');
  assert.equal(NAIVE_CUTOFF, 0.9);
  // every certified errand's own calibration bound is under alpha
  for (const r of A.rows) if (r.cert.certified) assert.ok(r.cert.upper <= 0.01 + 1e-9);
});
