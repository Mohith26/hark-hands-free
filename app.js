import { generate, ERRANDS, TIMELINE } from './src/generate.js';
import { analyze, NAIVE_CUTOFF } from './src/analysis.js';
import { clopperPearsonUpper } from './src/autonomy.js';

const RUNS = generate();
const LIMITS = [{ a: 0.02, label: '1 in 50' }, { a: 0.01, label: '1 in 100' }, { a: 0.005, label: '1 in 200' }];
const params = new URLSearchParams(location.search);
const state = {
  alpha: LIMITS.some(l => String(l.a) === params.get('limit')) ? +params.get('limit') : 0.01,
  sel: ERRANDS.some(e => e.id === params.get('errand')) ? params.get('errand') : 'dinner',
};
const cache = new Map();
const getA = a => { if (!cache.has(a)) cache.set(a, analyze(RUNS, { alpha: a })); return cache.get(a); };

// ---------- formatting ----------
const nf = new Intl.NumberFormat('en-US');
const n = x => nf.format(x);
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const pct2 = x => `${(x * 100).toFixed(2)}%`;
const day = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const limitLabel = a => LIMITS.find(l => l.a === a).label;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function mark(e, cls = '') {
  if (e.mark === 'ups') return `<span class="mark ups ${cls}" style="background:${e.color}">ups</span>`;
  return `<span class="mark ${cls}" style="background:${e.color};color:${e.ink || '#fff'}">${e.mark}</span>`;
}
const icon = name => `<i data-lucide="${name}"></i>`;

// ---------- tooltip ----------
const tip = document.getElementById('tip');
document.addEventListener('mousemove', ev => {
  const t = ev.target.closest('[data-tip]');
  if (!t) { tip.classList.remove('on'); return; }
  tip.innerHTML = t.getAttribute('data-tip');
  tip.classList.add('on');
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  tip.style.left = x + 'px'; tip.style.top = (ev.clientY + 16) + 'px';
});

// ---------- Action Buttons ----------
function renderActions(A) {
  const pick = ['toll', 'dinner', 'ups', 'rx', 'checkin', 'tickets'];
  const html = pick.map(id => {
    const r = A.rows.find(x => x.errand.id === id), e = r.errand;
    const hf = r.live.status === 'handsfree';
    const via = { toll: '', dinner: ' on', ups: '', rx: ' at', checkin: '', tickets: ' on' }[id];
    if (hf) {
      return `<div class="act done" data-tip="${esc(e.site)}: certified hands-free. Ran on its own; ${pct2(r.live.rate)} of these needed a fix in the last 3 weeks.">
        <span class="verb">${icon('check')}${e.done}</span><span class="rest">${e.text}${via}</span>${mark(e)}<span class="rest">${e.site}</span><span class="hf">&middot;&nbsp;on its own</span></div>`;
    }
    return `<div class="act"><span class="verb">${e.verb}</span><span class="rest">${e.text}${via}</span>${mark(e)}<span class="rest">${e.site}</span></div>`;
  }).join('');
  document.getElementById('actions').innerHTML = html;
}

// ---------- Panel 1: hands-free summary ----------
function niceMax(v) { const steps = [0.01, 0.02, 0.03, 0.05, 0.06, 0.08, 0.1, 0.15, 0.2]; return steps.find(s => s >= v) || v; }
function chartByErrand(A) {
  const W = 516, H = 196, padR = 44, padB = 34, top = 8;
  const rows = A.rows;
  const ymax = niceMax(Math.max(A.alpha * 1.5, ...rows.map(r => r.naive.rate)));
  const y = v => top + (H - padB - top) * (1 - v / ymax);
  const gw = (W - padR) / rows.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mistake rate by errand">`;
  for (const t of [0, ymax / 2, ymax]) {
    s += `<line x1="0" x2="${W - padR + 6}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(27,28,31,.08)" />`;
    if (Math.abs(y(t) - y(A.alpha)) > 12) s += `<text x="${W}" y="${y(t) + 4}" text-anchor="end">${(t * 100).toFixed(t * 100 % 1 ? 1 : 0)}%</text>`;
  }
  rows.forEach((r, i) => {
    const cx = gw * i + gw / 2, e = r.errand;
    const nv = r.naive.rate, hv = r.live.handsFree ? r.live.rate : null;
    const t = `<b>${esc(e.verb)} ${esc(e.text)} · ${esc(e.site)}</b><br>Flat ${NAIVE_CUTOFF * 100}% rule: ${pct2(nv)} needed a fix (${n(r.naive.k)} of ${n(r.naive.n)})<br>` +
      (hv == null ? 'Hands-free: not certified, still asks first' : `Hands-free: ${pct2(hv)} (${n(r.live.errs)} of ${n(r.live.handsFree)})${r.live.status === 'paused' ? ', paused ' + day(r.live.alarm.run.day) : ''}`);
    s += `<g data-tip="${esc(t)}"><rect x="${cx - gw / 2}" y="${top}" width="${gw}" height="${H - top}" fill="transparent"/>`;
    s += `<rect x="${cx - 7}" y="${y(nv)}" width="5" height="${Math.max(2, y(0) - y(nv))}" rx="2.5" fill="var(--bar)"/>`;
    if (hv != null) s += `<rect x="${cx + 2}" y="${y(hv)}" width="5" height="${Math.max(2, y(0) - y(hv))}" rx="2.5" fill="var(--bar-dark)"/>`;
    else s += `<circle cx="${cx + 4.5}" cy="${y(0) - 2}" r="2.2" fill="var(--ink-3)"/>`;
    s += `<g transform="translate(${cx - 10},${H - 24})"><circle cx="10" cy="10" r="10" fill="${e.color}"/><text x="10" y="13.5" text-anchor="middle" style="fill:${e.ink || '#fff'};font-size:${e.mark === 'ups' ? 7 : 10}px;font-weight:600">${e.mark}</text></g></g>`;
  });
  s += `<line x1="0" x2="${W - padR + 6}" y1="${y(A.alpha)}" y2="${y(A.alpha)}" stroke="var(--ink-2)" stroke-dasharray="4 4" stroke-width="1.2"/>`;
  s += `<text x="${W}" y="${y(A.alpha) + 4}" text-anchor="end" style="fill:var(--ink-2)">limit</text>`;
  return s + '</svg>';
}
function renderHandsFree(A) {
  const T = A.totals;
  const el = document.getElementById('p-handsfree');
  el.innerHTML = `
    <div class="ph"><span class="glyph">${icon('mouse-pointer-click')}</span><span class="grow">Hands-free • Last 3 weeks</span></div>
    <p class="lead"><strong>${T.activeCount} of ${T.errandCount} errands</strong> now run without asking${T.pausedCount ? `, ${T.pausedCount} paused` : ''}. <strong>${pct(T.confirmationsSkipped, 0)} of confirmations</strong> skipped since ${day(TIMELINE.liveFrom)}.</p>
    <div class="rule"></div>
    <div class="stats">
      <div class="stat"><div class="k">Needed a fix</div><div class="v">${pct2(T.handsFreeRate)}</div><div class="s">${n(T.handsFreeErr)} of ${n(T.handsFree)} hands-free runs</div></div>
      <div class="stat"><div class="k">Your limit</div><div class="v">${limitLabel(A.alpha)}</div>
        <div class="limit">${LIMITS.map(l => `<button class="chip ${l.a === A.alpha ? 'on' : ''}" data-limit="${l.a}">${l.label}</button>`).join('')}</div></div>
    </div>
    <div class="ctitle"><span>Mistakes by errand</span><span class="legend"><span><i style="background:var(--bar-dark)"></i>Hands-free</span><span><i style="background:var(--bar)"></i>Flat ${NAIVE_CUTOFF * 100}% rule</span><span><i class="dash"></i>Limit</span></span></div>
    ${chartByErrand(A)}
    <div class="btns"><button class="btn" data-scroll="p-errands">See every errand</button><button class="btn">Reply</button></div>`;
}

// ---------- Panel 2: drift monitor ----------
function chartCusum(r, A) {
  const W = 516, H = 180, padR = 44, padB = 26, top = 12;
  // show the last ~700 hands-free refills up to a few runs after the alarm
  const start = Math.max(0, r.live.alarm.index - 700);
  const path = r.live.cusum.slice(start), autos = r.live.autoRuns.slice(start, start + path.length);
  const h = A.totals.h, ymax = h * 1.25;
  const x = i => (W - padR) * i / (path.length - 1);
  const y = v => top + (H - padB - top) * (1 - Math.min(v, ymax) / ymax);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Change detector">`;
  s += `<line x1="0" x2="${W - padR + 6}" y1="${y(0)}" y2="${y(0)}" stroke="rgba(27,28,31,.08)"/>`;
  // a thin grey tick for every hands-free refill that needed a fix
  autos.forEach((a, i) => { if (a.err) s += `<rect x="${x(i) - 1}" y="${y(0) - 16}" width="2" height="16" rx="1" fill="var(--bar)"/>`; });
  const di = autos.findIndex(a => a.day >= r.errand.drift.from);
  if (di >= 0) s += `<line x1="${x(di)}" x2="${x(di)}" y1="${top}" y2="${y(0)}" stroke="rgba(27,28,31,.18)"/><text x="${x(di) - 6}" y="${top + 10}" text-anchor="end" style="fill:var(--ink-2)">Checkout changed</text>`;
  s += `<line x1="0" x2="${W - padR + 6}" y1="${y(h)}" y2="${y(h)}" stroke="var(--ink-2)" stroke-dasharray="4 4" stroke-width="1.2"/><text x="${W}" y="${y(h) + 4}" text-anchor="end" style="fill:var(--ink-2)">pause</text>`;
  const pts = path.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  s += `<polyline points="${pts}" fill="none" stroke="var(--bar-dark)" stroke-width="1.6" stroke-linejoin="round"/>`;
  const ai = r.live.alarm.index - start;
  s += `<circle cx="${x(ai)}" cy="${y(path[ai])}" r="4" fill="var(--ink)"/>`;
  // date labels
  const seen = new Set(); const marks = [];
  autos.forEach((a, i) => { const wk = a.day; if (!seen.has(wk) && ['2026-10-27', '2026-10-30', '2026-11-02'].includes(wk)) { seen.add(wk); marks.push([i, wk]); } });
  for (const [i, d] of marks) s += `<text x="${x(i)}" y="${H - 4}">${d.slice(5, 7)}/${d.slice(8)}</text>`;
  return s + '</svg>';
}
function renderDrift(A) {
  const r = A.rows.find(x => x.live.status === 'paused' && x.live.drift);
  const el = document.getElementById('p-drift');
  if (!r) { el.innerHTML = `<div class="ph"><span class="grow">Watching • Nothing paused</span></div><p class="lead">No certified errand has drifted at this limit.</p>`; return; }
  const d = r.live.drift, e = r.errand;
  el.innerHTML = `
    <div class="ph">${mark(e, 'sm')}<span class="grow">${e.site} • Paused ${day(d.pausedOn)}</span></div>
    <p class="lead">Refills are <strong>asking first</strong> again. ${e.site} changed its checkout on ${day(d.from)}, and <strong>${d.errsSinceChange} of ${d.runsSinceChange}</strong> hands-free refills since then needed a fix.</p>
    <div class="rule"></div>
    <div class="stats">
      <div class="stat"><div class="k">Paused after</div><div class="v">${d.runsSinceChange}<small>refills</small></div><div class="s">since the change; first alarm in ${n(r.live.alarm.index + 1)} hands-free refills since ${day(TIMELINE.liveFrom)}</div></div>
      <div class="stat"><div class="k">Mistakes avoided</div><div class="v">${d.avoided}</div><div class="s">through ${day(TIMELINE.end)}, if refills had kept running</div></div>
    </div>
    <div class="ctitle"><span>Change detector</span><span class="legend"><span><i style="background:var(--bar-dark);width:12px;height:2px;vertical-align:3px"></i>Evidence of a change</span><span><i style="background:var(--bar)"></i>Needed a fix</span></span></div>
    ${chartCusum(r, A)}
    <div class="btns"><button class="btn">Review ${d.errsSinceChange} refills</button><button class="btn">Keep asking</button></div>`;
}

// ---------- Panel 3: every errand ----------
function statusPill(r) {
  const s = r.live.status;
  if (s === 'handsfree') return `<span class="pill hf">${icon('check')}Hands-free</span>`;
  if (s === 'paused') return `<span class="pill paused">${icon('pause')}Paused ${day(r.live.alarm.run.day)}</span>`;
  if (s === 'almost') return `<span class="pill almost">${n(r.cert.runsNeeded)} more runs</span>`;
  return `<span class="pill asks">Asks first</span>`;
}
function renderErrands(A) {
  const el = document.getElementById('p-errands');
  const rows = A.rows.map(r => {
    const e = r.errand, c = r.cert;
    const cov = c.certified ? c.coverage : 0;
    const bound = c.certified ? `≤ ${pct2(c.upper)}` : (c.nearest ? `<span class="grey">${pct2(clopperPearsonUpper(c.nearest.k, c.nearest.n, 1 - c.dEff))}</span>` : '–');
    const cut = c.certified ? c.lambda.toFixed(c.lambda * 100 % 1 ? 3 : 2) : '–';
    const live = r.live.handsFree ? `<span data-tip="${n(r.live.errs)} of ${n(r.live.handsFree)} hands-free runs since ${day(TIMELINE.liveFrom)}">${pct2(r.live.rate)}</span>` : '<span class="grey">–</span>';
    return `<tr data-errand="${e.id}" class="${e.id === state.sel ? 'sel' : ''}">
      <td><span class="who">${mark(e, 'sm')}<span>${e.verb} ${e.text} <span class="grey">· ${e.site}</span></span></span></td>
      <td>${statusPill(r)}</td>
      <td><span class="track"><b style="width:${(cov * 100).toFixed(1)}%"></b></span>${pct(cov, 0)}</td>
      <td class="num">${cut}</td>
      <td class="num">${bound}</td>
      <td class="num hide-sm">${n(r.calN)}</td>
      <td class="num">${live}</td></tr>`;
  }).join('');
  const T = A.totals;
  el.innerHTML = `
    <div class="ph"><span class="glyph">${icon('list-checks')}</span><span class="grow">Errands • ${T.errandCount} kinds, limit ${limitLabel(A.alpha)}</span></div>
    <table class="etable">
      <thead><tr><th>Errand</th><th>Status</th><th>Runs it handles</th><th class="num">Self-check cutoff</th><th class="num">Mistakes, 95% bound</th><th class="num hide-sm">Confirmed runs</th><th class="num">Last 3 weeks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="small note">Certified on ${n(T.calTotal)} confirmed Handoff runs (${day(TIMELINE.start)} to ${day('2026-10-18')}), then replayed on ${n(T.liveTotal)} runs from ${day(TIMELINE.liveFrom)} to ${day(TIMELINE.end)}. A run counts as a mistake if the confirmation was edited or declined, or the result had to be fixed afterwards. ${T.certifiedCount ? `The per-errand guarantee holds with 95% confidence, so about 1 in 20 certified errands can come in over the limit by chance.` : ''}</p>`;
}

// ---------- Panel 4: selected errand ----------
function chartRisk(r, A) {
  const W = 516, H = 176, padR = 44, padB = 30, top = 8;
  const c = r.cert, curve = c.curve.filter(p => p.n > 0);
  const ub = curve.map(p => clopperPearsonUpper(p.k, p.n, 1 - c.dEff));
  const ymax = niceMax(Math.max(A.alpha * 1.6, ...ub.map((u, i) => Math.min(u, curve[i].k / curve[i].n * 3 + A.alpha))));
  const y = v => top + (H - padB - top) * (1 - Math.min(v, ymax) / ymax);
  const gw = (W - padR) / curve.length;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mistakes by cutoff">`;
  for (const t of [0, ymax / 2, ymax]) {
    s += `<line x1="0" x2="${W - padR + 6}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(27,28,31,.08)"/>`;
    if (Math.abs(y(t) - y(A.alpha)) > 12) s += `<text x="${W}" y="${y(t) + 4}" text-anchor="end">${(t * 100).toFixed(t * 100 % 1 ? 1 : 0)}%</text>`;
  }
  curve.forEach((p, i) => {
    const cx = gw * i + gw / 2, emp = p.k / p.n, u = ub[i];
    const chosen = c.certified && p.lambda === c.lambda;
    const t = `Cutoff ${p.lambda}: ${n(p.n)} runs (${pct(p.n / c.total, 0)}), ${n(p.k)} needed a fix (${pct2(emp)}); 95% bound ${pct2(u)}${p.p <= c.dEff ? ' · certified' : ''}`;
    s += `<g data-tip="${esc(t)}"><rect x="${cx - gw / 2}" y="${top}" width="${gw}" height="${H - top}" fill="transparent"/>`;
    s += `<rect x="${cx - 2.5}" y="${y(u)}" width="5" height="${Math.max(2, y(0) - y(u))}" rx="2.5" fill="${chosen ? 'var(--bar-dark)' : 'var(--bar)'}"/>`;
    s += `<circle cx="${cx}" cy="${y(emp)}" r="2.6" fill="${chosen ? '#fff' : 'var(--ink-2)'}" ${chosen ? 'stroke="var(--ink)" stroke-width="1.4"' : ''}/>`;
    if (i % 2 === 0 || i === curve.length - 1) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${p.lambda}</text>`;
    s += '</g>';
  });
  s += `<line x1="0" x2="${W - padR + 6}" y1="${y(A.alpha)}" y2="${y(A.alpha)}" stroke="var(--ink-2)" stroke-dasharray="4 4" stroke-width="1.2"/><text x="${W}" y="${y(A.alpha) + 4}" text-anchor="end" style="fill:var(--ink-2)">limit</text>`;
  return s + '</svg>';
}
function renderNext(A) {
  const r = A.rows.find(x => x.errand.id === state.sel), e = r.errand, c = r.cert;
  const perDay = r.liveN / 21;
  let lead;
  if (r.live.status === 'handsfree') lead = `Runs hands-free whenever Handoff's self-check is at least <strong>${c.lambda}</strong>, which covers <strong>${pct(c.coverage, 0)}</strong> of runs. Mistakes stay under <strong>${pct2(c.upper)}</strong> with 95% confidence.`;
  else if (r.live.status === 'paused') lead = `Certified at a self-check cutoff of <strong>${c.lambda}</strong>, then <strong>paused on ${day(r.live.alarm.run.day)}</strong> when the change detector fired. It asks first until it earns a fresh certificate on new confirmed runs.`;
  else if (r.live.status === 'almost') lead = `Not certified yet. At a cutoff of <strong>${c.nearest.lambda}</strong>, ${pct2(c.nearest.errRate)} of runs needed a fix, under your limit but on too few runs to prove it. About <strong>${n(c.runsNeeded)} more confirmed runs</strong>, roughly ${Math.max(1, Math.round(c.runsNeeded / perDay))} day${Math.round(c.runsNeeded / perDay) > 1 ? 's' : ''} at the current pace.`;
  else lead = `Still <strong>asks first</strong>. Even at the strictest cutoff, <strong>${pct2(c.nearest.errRate)}</strong> of runs needed a fix, above your limit, so more runs alone won't certify it. Handoff itself has to get better here.`;
  document.getElementById('p-next').innerHTML = `
    <div class="ph">${mark(e, 'sm')}<span class="grow">${e.site} • ${e.verb} ${e.text}</span></div>
    <p class="lead">${lead}</p>
    <div class="ctitle"><span>Mistakes by self-check cutoff</span><span class="legend"><span><i style="background:var(--bar)"></i>95% bound</span><span><i style="width:6px;height:6px;border-radius:50%;background:var(--ink-2);vertical-align:1px"></i>Observed</span></span></div>
    ${chartRisk(r, A)}
    <p class="small">${n(r.calN)} confirmed runs. Pick another errand in the list above.</p>`;
}

function renderHow(A) {
  const dEff = A.rows[0].cert.dEff;
  document.getElementById('p-how').innerHTML = `
    <div class="ph"><span class="glyph">${icon('shield-check')}</span><span class="grow">How Hark decides</span></div>
    <div class="how">
      <p><strong>Every confirmation you tap is a labeled example.</strong> Hark learns from them which errands Handoff gets right without you.</p>
      <ol>
        <li><strong>Test 13 cutoffs</strong> on Handoff's own self-check score, fixed in advance.</li>
        <li>For each, an <strong>exact binomial test</strong> asks whether mistakes above the cutoff could exceed your limit. Each test runs at ${(dEff * 100).toFixed(2)}% so all 13 together hold 95%.</li>
        <li>Keep the <strong>loosest cutoff that passes</strong>, so Hark skips as many confirmations as it safely can.</li>
        <li>A <strong>change detector</strong> (CUSUM) watches every hands-free run and pauses the errand if mistakes jump, like after a site redesign.</li>
      </ol>
    </div>`;
}

function render() {
  const A = getA(state.alpha);
  renderActions(A); renderHandsFree(A); renderDrift(A); renderErrands(A); renderNext(A); renderHow(A);
  if (window.lucide) window.lucide.createIcons();
}
document.addEventListener('click', ev => {
  const l = ev.target.closest('[data-limit]');
  if (l) { state.alpha = +l.dataset.limit; render(); return; }
  const tr = ev.target.closest('tr[data-errand]');
  if (tr) { state.sel = tr.dataset.errand; render(); document.getElementById('p-next').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  const sc = ev.target.closest('[data-scroll]');
  if (sc) document.getElementById(sc.dataset.scroll).scrollIntoView({ behavior: 'smooth' });
});
render();
