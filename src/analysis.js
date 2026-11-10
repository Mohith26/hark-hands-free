// Puts the pieces together for the demo: certify each errand type on the labeled
// (confirmation-gated) history, then replay the live window with those cutoffs,
// a raw-confidence baseline, and the drift monitor.
import { certify, realized, cusumAlarm, cusumThreshold, GRID } from './autonomy.js';
import { ERRANDS, TIMELINE, mulberry32 } from './generate.js';

export const NAIVE_CUTOFF = 0.9; // "trust Handoff when it says it's 90% sure"
export const CUSUM = { shiftFactor: 5, targetARL: 50000 }; // alarm when errors run ~5x the target

export function analyze(runs, { alpha = 0.01, delta = 0.05 } = {}) {
  const live = TIMELINE.liveFrom;
  const byErrand = new Map(ERRANDS.map(e => [e.id, { cal: [], live: [] }]));
  for (const r of runs) byErrand.get(r.errand)[r.day < live ? 'cal' : 'live'].push(r);

  const p0 = alpha, p1 = Math.min(0.5, CUSUM.shiftFactor * alpha);
  const h = cusumThreshold(p0, p1, CUSUM.targetARL, mulberry32(7), 120);

  const rows = ERRANDS.map(e => {
    const { cal, live: lv } = byErrand.get(e.id);
    const cert = certify(cal, { alpha, delta, grid: GRID });
    const row = { errand: e, calN: cal.length, liveN: lv.length, cert };
    row.naive = realized(lv, NAIVE_CUTOFF);
    if (cert.certified) {
      // Replay the live window: runs >= lambda go hands-free until the monitor alarms.
      const auto = lv.filter(r => r.conf >= cert.lambda);
      const mon = cusumAlarm(auto.map(r => r.err), p0, p1, h);
      const stopAt = mon.alarmAt >= 0 ? mon.alarmAt + 1 : auto.length;
      const ran = auto.slice(0, stopAt);
      const errs = ran.reduce((s, r) => s + r.err, 0);
      row.live = {
        handsFree: ran.length, errs, rate: ran.length ? errs / ran.length : 0,
        asked: lv.length - ran.length, coverage: lv.length ? ran.length / lv.length : 0,
        alarm: mon.alarmAt >= 0 ? { index: mon.alarmAt, run: auto[mon.alarmAt], errsBefore: errs, window: ran.slice(-12) } : null,
        cusum: mon.path.slice(0, Math.min(auto.length, stopAt + 20)),
        autoRuns: auto,
        status: mon.alarmAt >= 0 ? 'paused' : 'handsfree',
      };
      // Without the monitor, how many hands-free mistakes would the drift have caused?
      const all = realized(lv, cert.lambda);
      row.live.withoutMonitor = { n: all.n, k: all.k };
      if (e.drift && row.live.alarm) {
        const since = ran.filter(r => r.day >= e.drift.from);
        row.live.drift = {
          from: e.drift.from, note: e.drift.note,
          runsSinceChange: since.length, errsSinceChange: since.reduce((s, r) => s + r.err, 0),
          avoided: all.k - errs, // mistakes the remaining hands-free runs would have made
          pausedOn: row.live.alarm.run.day,
        };
      }
    } else {
      row.live = { handsFree: 0, errs: 0, rate: 0, asked: lv.length, coverage: 0, status: cert.runsNeeded != null ? 'almost' : 'asks' };
    }
    return row;
  });

  // Fleet totals for the live window.
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const liveTotal = sum(r => r.liveN);
  const hf = sum(r => r.live.handsFree), hfErr = sum(r => r.live.errs);
  const naiveN = sum(r => r.naive.n), naiveK = sum(r => r.naive.k);
  const certifiedRows = rows.filter(r => r.cert.certified);
  const totals = {
    calTotal: sum(r => r.calN), liveTotal,
    handsFree: hf, handsFreeErr: hfErr, handsFreeRate: hf ? hfErr / hf : 0,
    confirmationsSkipped: liveTotal ? hf / liveTotal : 0,
    naive: { n: naiveN, k: naiveK, rate: naiveN ? naiveK / naiveN : 0, coverage: liveTotal ? naiveN / liveTotal : 0 },
    certifiedCount: certifiedRows.length, errandCount: rows.length,
    activeCount: rows.filter(r => r.live.status === 'handsfree').length,
    pausedCount: rows.filter(r => r.live.status === 'paused').length,
    worstLiveRate: Math.max(0, ...certifiedRows.filter(r => r.live.status === 'handsfree').map(r => r.live.rate)),
    h, p0, p1,
  };
  return { rows, totals, alpha, delta };
}
