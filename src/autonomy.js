// Earned hands-free: decide which kinds of Handoff errands can run without a
// confirmation, with a statistical guarantee on how often they go wrong.
//
// Core idea (Learn then Test, Angelopoulos et al. 2021): every confirmation a
// user taps today is a labeled example (approved as-is, or needed a fix). For
// one errand type we pick a confidence cutoff lambda for Handoff's own
// self-check score. Runs scoring >= lambda would run hands-free. For each
// candidate lambda on a fixed grid we test
//     H0(lambda): P(needs a fix | score >= lambda) > alpha
// with an exact one-sided binomial test, Bonferroni-corrected over the grid.
// Any lambda whose null is rejected is certified: with probability >= 1-delta
// (over the calibration data) the error rate of hands-free runs is <= alpha.
// We keep the loosest certified lambda, which skips the most confirmations.
//
// After certification a Bernoulli CUSUM watches live hands-free outcomes and
// pauses the errand type when the error rate shifts up (for example a site
// redesign that Handoff's self-check does not notice).

export const GRID = [0.8, 0.85, 0.88, 0.9, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98, 0.985, 0.99, 0.995]; // fixed before seeing data

// ---------- small numeric helpers ----------
const LOG_FACT_CACHE = [0];
function logFact(n) {
  for (let i = LOG_FACT_CACHE.length; i <= n; i++) LOG_FACT_CACHE[i] = LOG_FACT_CACHE[i - 1] + Math.log(i);
  return LOG_FACT_CACHE[n];
}
function logChoose(n, k) { return logFact(n) - logFact(k) - logFact(n - k); }

// P(X <= k) for X ~ Binomial(n, p), computed in log space (stable for n in the tens of thousands).
export function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const lp = Math.log(p), lq = Math.log1p(-p);
  let m = -Infinity; const terms = [];
  for (let i = 0; i <= k; i++) { const t = logChoose(n, i) + i * lp + (n - i) * lq; terms.push(t); if (t > m) m = t; }
  let s = 0; for (const t of terms) s += Math.exp(t - m);
  return Math.min(1, Math.exp(m + Math.log(s)));
}

// One-sided upper confidence bound for a binomial proportion (Clopper-Pearson):
// the largest p with P(X <= k | n, p) >= 1 - conf.
export function clopperPearsonUpper(k, n, conf = 0.95) {
  if (n === 0) return 1;
  if (k >= n) return 1;
  const a = 1 - conf;
  let lo = k / n, hi = 1;
  for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (binomCdf(k, n, mid) > a) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ---------- certification ----------
// runs: [{ conf: number in [0,1], err: 0|1 }]
export function riskCurve(runs, grid = GRID) {
  const sorted = runs.map(r => [r.conf, r.err]).sort((a, b) => b[0] - a[0]);
  const out = [];
  let i = 0, n = 0, k = 0;
  const desc = [...grid].sort((a, b) => b - a);
  for (const lam of desc) {
    while (i < sorted.length && sorted[i][0] >= lam) { n++; k += sorted[i][1]; i++; }
    out.push({ lambda: lam, n, k });
  }
  return out.sort((a, b) => a.lambda - b.lambda);
}

export function certify(runs, { alpha = 0.01, delta = 0.05, grid = GRID } = {}) {
  const total = runs.length;
  const dEff = delta / grid.length; // Bonferroni over the grid
  const curve = riskCurve(runs, grid).map(c => ({ ...c, p: c.n ? binomCdf(c.k, c.n, alpha) : 1 }));
  const certifiedSet = curve.filter(c => c.p <= dEff);
  let best = null;
  for (const c of certifiedSet) if (!best || c.lambda < best.lambda) best = c; // loosest = lowest lambda
  const result = { total, alpha, delta, dEff, curve, certified: !!best };
  if (best) {
    Object.assign(result, {
      lambda: best.lambda, n: best.n, k: best.k,
      coverage: total ? best.n / total : 0,
      errRate: best.n ? best.k / best.n : 0,
      upper: clopperPearsonUpper(best.k, best.n, 1 - dEff),
    });
  } else {
    // Closest threshold: lowest empirical error among thresholds with >= 30 runs.
    let near = null;
    for (const c of curve) if (c.n >= 30 && (!near || c.k / c.n < near.k / near.n || (c.k / c.n === near.k / near.n && c.n > near.n))) near = c;
    result.nearest = near ? { lambda: near.lambda, n: near.n, k: near.k, errRate: near.k / near.n } : null;
    result.runsNeeded = near ? runsNeeded(near.k, near.n, alpha, dEff) : null;
  }
  return result;
}

// If the observed error rate r at a threshold is below alpha, how many runs at that
// threshold (in total) until the test would certify, assuming the rate stays at r?
// Returns null when r >= alpha (more data cannot help: Handoff is not good enough yet).
export function runsNeeded(k, n, alpha, dEff) {
  const r = n ? k / n : 0;
  if (r >= alpha) return null;
  const test = N => binomCdf(Math.floor(r * N), N, alpha) <= dEff;
  if (test(n)) return 0;
  let hi = Math.max(2 * n, 64);
  while (!test(hi)) { hi *= 2; if (hi > 5e6) return null; }
  let lo = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (test(mid)) hi = mid; else lo = mid; }
  return hi - n;
}

// ---------- drift monitor ----------
// Bernoulli CUSUM for a shift in error rate from p0 to p1 (p1 > p0).
export function cusumPath(errs, p0, p1) {
  const up = Math.log(p1 / p0), down = Math.log((1 - p1) / (1 - p0));
  const path = []; let s = 0;
  for (const e of errs) { s = Math.max(0, s + (e ? up : down)); path.push(s); }
  return path;
}
export function cusumAlarm(errs, p0, p1, h) {
  const path = cusumPath(errs, p0, p1);
  const idx = path.findIndex(v => v >= h);
  return { path, alarmAt: idx };
}
// Average run length to a (false) alarm when the true rate is p, by simulation.
export function cusumARL(p, p0, p1, h, rng, sims = 200, cap = 200000) {
  const up = Math.log(p1 / p0), down = Math.log((1 - p1) / (1 - p0));
  let tot = 0;
  for (let s = 0; s < sims; s++) {
    let v = 0, t = 0;
    while (t < cap) { t++; v = Math.max(0, v + (rng() < p ? up : down)); if (v >= h) break; }
    tot += t;
  }
  return tot / sims;
}
// Smallest h (to 0.05) whose in-control ARL is at least targetARL.
export function cusumThreshold(p0, p1, targetARL, rng, sims = 150) {
  let lo = 0.5, hi = 12;
  for (let it = 0; it < 14; it++) {
    const mid = (lo + hi) / 2;
    if (cusumARL(p0, p0, p1, mid, rng, sims) >= targetARL) hi = mid; else lo = mid;
  }
  return Math.ceil(hi * 20) / 20;
}

// ---------- evaluation helpers ----------
export function realized(runs, lambda) {
  let n = 0, k = 0;
  for (const r of runs) if (r.conf >= lambda) { n++; k += r.err; }
  return { n, k, rate: n ? k / n : 0, coverage: runs.length ? n / runs.length : 0 };
}
