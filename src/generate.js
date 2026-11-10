// Seeded synthetic Handoff run log. Every number in the demo is computed from this.
//
// Each run is one errand Handoff carried out across the Hark fleet. Before the
// live window every run was confirmation-gated, so each has a label: approved
// as-is (err = 0) or needed a fix at the confirmation step / afterwards (err = 1).
// Handoff also emits a self-check score `conf` before asking. That score is
// informative but miscalibrated, and the miscalibration differs by errand type
// (overconfident on ticketing and food orders, nearly honest on tolls).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const sigmoid = x => 1 / (1 + Math.exp(-x));
const DAY = 86400000;

// Each run either goes cleanly or hits a "snag" (2FA wall, sold-out item, changed
// page, ambiguous request). snag: share of runs that hit one. Handoff's self-check
// score is s = a*z + b + noise; b > 0 means overconfident, noise = how poorly it
// separates snags from clean runs. weekly: fleet runs per week.
// Verb/object text mirror Hark's own Action Buttons.
export const ERRANDS = [
  { id: 'toll', done: 'Paid',      verb: 'Pay',       text: 'your FasTrak toll',      site: 'FasTrak',       mark: 'F', color: '#1f6fb5', weekly: 1500, snag: 0.020, a: 0.80, b: 0.3, noise: 0.7 },
  { id: 'checkin', done: 'Checked in',   verb: 'Check in',  text: 'for your flight',        site: 'United',        mark: 'U', color: '#1c3f94', weekly: 1300, snag: 0.030, a: 0.80, b: 0.4, noise: 0.8 },
  { id: 'ups', done: 'Authorized',       verb: 'Authorize', text: 'your UPS delivery',      site: 'UPS',           mark: 'ups', color: '#3b1f12', weekly: 1050, snag: 0.025, a: 0.80, b: 0.3, noise: 0.8 },
  { id: 'lunch', done: 'Topped up',     verb: 'Top up',    text: 'the lunch card',         site: 'MySchoolBucks', mark: 'M', color: '#2a8a4a', weekly: 800,  snag: 0.030, a: 0.80, b: 0.4, noise: 0.9 },
  { id: 'bill', done: 'Paid',      verb: 'Pay',       text: 'your PG&E bill',         site: 'PG&E',          mark: 'P', color: '#0b5aa2', weekly: 750,  snag: 0.040, a: 0.80, b: 0.4, noise: 0.9 },
  { id: 'rx', done: 'Refilled',        verb: 'Refill',    text: 'your prescriptions',     site: 'Walgreens',     mark: 'W', color: '#e31837', weekly: 900,  snag: 0.040, a: 0.80, b: 0.4, noise: 0.9,
    drift: { from: '2026-11-03', snag: 0.45, note: 'Walgreens changed its refill checkout' } },
  { id: 'receipts', done: 'Uploaded',  verb: 'Upload',    text: 'your receipts',          site: 'Ramp',          mark: 'R', color: '#c8e62e', ink: '#1a1a1a', weekly: 600, snag: 0.060, a: 0.75, b: 0.7, noise: 1.1 },
  { id: 'table', done: 'Booked',     verb: 'Book',      text: 'a table for 2',          site: 'OpenTable',     mark: 'O', color: '#da3743', weekly: 700,  snag: 0.080, a: 0.70, b: 1.0, noise: 1.3 },
  { id: 'groceries', done: 'Reordered', verb: 'Reorder',   text: 'your weekly groceries',  site: 'Instacart',     mark: 'I', color: '#0aad0a', weekly: 650,  snag: 0.120, a: 0.65, b: 1.3, noise: 1.5 },
  { id: 'cancel', done: 'Canceled',    verb: 'Cancel',    text: 'an unused subscription', site: 'Subscriptions', mark: 'S', color: '#6b6b70', weekly: 380,  snag: 0.140, a: 0.60, b: 1.5, noise: 1.6 },
  { id: 'dinner', done: 'Ordered',    verb: 'Order',     text: 'dinner',                 site: 'DoorDash',      mark: 'D', color: '#ff3008', weekly: 1100, snag: 0.170, a: 0.55, b: 1.9, noise: 1.8 },
  { id: 'tickets', done: 'Bought',   verb: 'Buy',       text: 'concert tickets',        site: 'Ticketmaster',  mark: 'T', color: '#026cdf', weekly: 260,  snag: 0.220, a: 0.50, b: 2.3, noise: 2.0 },
];
const CLEAN = { mu: 6.8, sd: 1.0 }, SNAG = { mu: 0.2, sd: 1.3 };

export const TIMELINE = {
  start: '2026-08-17',     // first labeled run
  liveFrom: '2026-10-19',  // certification computed on everything before this date; hands-free from here on
  end: '2026-11-08',       // last day in the log (inclusive)
  today: '2026-11-09',
};

export function generate(seed = 20261109) {
  const rng = mulberry32(seed);
  const t0 = Date.parse(TIMELINE.start + 'T00:00:00Z');
  const t1 = Date.parse(TIMELINE.end + 'T00:00:00Z');
  const days = Math.round((t1 - t0) / DAY) + 1;
  const runs = [];
  let id = 0;
  for (const e of ERRANDS) {
    const driftT = e.drift ? Date.parse(e.drift.from + 'T00:00:00Z') : Infinity;
    for (let d = 0; d < days; d++) {
      const t = t0 + d * DAY;
      const dow = new Date(t).getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const growth = 0.75 + 0.5 * (d / days); // fleet grew after the Oct 6 launch
      const lam = (e.weekly / 7) * growth * (weekend ? 0.8 : 1.08);
      // Poisson via normal approximation (lam is in the tens to hundreds)
      const count = Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss(rng)));
      for (let j = 0; j < count; j++) {
        const snagP = t >= driftT ? e.drift.snag : e.snag; // redesign: many more snags
        const m = rng() < snagP ? SNAG : CLEAN;
        const z = m.mu + m.sd * gauss(rng);
        const q = sigmoid(z);
        const s = e.a * z + e.b + e.noise * gauss(rng);
        const conf = Math.round(sigmoid(s) * 1000) / 1000;
        const err = rng() < q ? 0 : 1;
        runs.push({ id: id++, errand: e.id, day: new Date(t).toISOString().slice(0, 10), ts: t + Math.floor(rng() * DAY), conf, err });
      }
    }
  }
  runs.sort((a, b) => a.ts - b.ts);
  return runs;
}
