# Hands-free for Hark: errands that earn the right to skip a confirmation

**Live demo:** https://mohith26.github.io/hark-hands-free/

Unofficial concept demo by Mohith Gajjela. Not affiliated with Hark. Synthetic data.

## What it is

Hark asks before Handoff spends money or acts in your name, and its terms let you grant *standing permission* for a category of purchases. That leaves a gap: nobody can say which categories are actually safe to stop confirming, or notice when one stops being safe.

Hands-free is a Home panel in Hark Pro that answers both questions with statistics:

1. **Certify.** Every confirmation a user taps is already a labeled example: the plan was approved as-is, or it was edited, declined or fixed afterwards. For each kind of errand (pay a FasTrak toll, refill a Walgreens prescription, order dinner on DoorDash...) Hark picks a cutoff on Handoff's own self-check score. Runs at or above the cutoff go hands-free. A cutoff is only used if an exact binomial test shows, with 95% confidence, that hands-free mistakes stay under the user's limit (1 in 50, 1 in 100 or 1 in 200).
2. **Watch.** A CUSUM change detector follows every hands-free run and pauses the errand when mistakes jump, for example when a site changes its checkout and Handoff's self-check does not notice.
3. **Explain.** Errands that are close get an honest "about N more confirmed runs" estimate; errands where Handoff is not good enough yet are told that more data will not help.

On the demo log (83.5k labeled runs, then a 3-week replay of 35k runs, limit 1 in 100):

| | Value |
|---|---|
| Errands certified | 10 of 12 (9 running, 1 paused) |
| Confirmations skipped in the replay | 79% (28,141 of 35,405 runs) |
| Hands-free runs that needed a fix | 0.51% (143 of 28,141), limit 1% |
| Walgreens checkout change (Nov 3) | paused the same day after 78 hands-free refills (6 needed a fix); 29 mistakes avoided through Nov 8 |
| A flat "90% sure" rule instead | 1.00% overall, but 3.8% wrong DoorDash orders and 4.9% wrong Ticketmaster purchases |
| Not yet certified | DoorDash dinner: about 275 more confirmed orders; Ticketmaster: asks first (1.8% mistakes even at the strictest cutoff) |

Every number on the page is computed in the browser from the seeded log by `src/`. Change the limit with the chips in the first panel, or click any errand row.

## How it works

- `src/autonomy.js`
  - `certify(runs, {alpha, delta})`: Learn-then-Test (Angelopoulos, Bates, Candes, Jordan, Lei 2021). For each cutoff on a grid fixed in advance (13 values, 0.80 to 0.995) it tests H0: P(mistake | score >= cutoff) > alpha with an exact one-sided binomial test, Bonferroni-corrected over the grid (each test at delta/13). Any rejected cutoff is certified; the loosest one is kept because it skips the most confirmations. Conditional on the number of runs above a cutoff, those runs are an i.i.d. sample from the conditional distribution, so the binomial test is exact under exchangeability.
  - `clopperPearsonUpper`: the 95% bound shown per errand.
  - `runsNeeded`: how many runs at the currently observed rate until the test would pass (`null` when the observed rate is already above the limit).
  - `cusumPath / cusumThreshold`: Bernoulli CUSUM for a shift from the limit to 5x the limit. The alarm threshold is set by simulation for an in-control average run length of 50,000 runs.
- `src/generate.js`: seeded synthetic fleet log, Aug 17 to Nov 8 2026. Each run is clean or hits a snag (2FA wall, sold-out item, changed page). Handoff's self-check is informative but miscalibrated, differently per errand (nearly honest on tolls, overconfident on ticketing and food orders). On Nov 3 Walgreens "redesigns" its checkout: snags jump from 4% to 45% while the self-check barely moves.
- `src/analysis.js`: certifies on runs before Oct 19, replays Oct 19 to Nov 8 with the certified cutoffs and the change detector, and compares with a flat 0.9 cutoff.
- `index.html`, `styles.css`, `app.js`: the Hark Pro Home view (live-sky backdrop, Home / Chat / Projects switcher, Action Buttons, frosted Panels) rebuilt from Hark's own launch imagery. Certified errands show up in Action Buttons as done ("Paid your FasTrak toll · on its own").

## Tests

```
node --test test/autonomy.test.mjs
node scripts/report.mjs        # prints every headline number at limits 1/50, 1/100, 1/200
```

9 tests: binomial CDF against a direct sum; Clopper-Pearson against the closed form; nested risk curve; **the guarantee itself** (300 simulated calibration sets with a known error curve where the 0.80 cutoff is unsafe: certified cutoffs exceed the limit in at most 5% of sets, observed 0%); loosest-cutoff selection and refusal when Handoff is too weak; `runsNeeded` is exact (N passes, N-1 does not); CUSUM in-control run length and fast detection; generator determinism; and an end-to-end check that the Walgreens drift is caught on or after the redesign with no false alarms elsewhere.

## Honest limitations

- Synthetic data. Real labels are noisier: a user may approve a slightly wrong order, or edit a correct one for a new reason. The method needs a clear "needed a fix" signal, and Hark would have to decide what counts.
- Fleet-level certification. A certificate pooled across users can hide a user whose errands are harder (an unusual pharmacy, a picky dinner order). Per-user or per-site certificates are the natural next step and need hierarchical pooling to stay data-efficient.
- The guarantee is per errand at 95% confidence, so about 1 in 20 certified errands can land over the limit by chance. In this log, OpenTable bookings did (1.22% in the replay against a 1% limit; its calibration bound was 0.99%). The page says so.
- Exchangeability: the guarantee assumes future runs look like the calibration runs. That assumption is exactly what breaks on a site redesign, which is why the change detector exists. It catches large shifts quickly, small ones slowly (at a 1-in-200 limit the Walgreens pause takes 467 refills).
- Bonferroni over 13 cutoffs is conservative. Fixed-sequence or graph-based testing would certify a little more.
- Fonts: Hark uses GT Standard (commercial); the demo substitutes Instrument Sans. Brand marks in Action Buttons are simple lettered circles, not real logos.

## Novelty note

Checked Nov 10 2026: hark.com (Introducing Hark Pro, Introducing Hark Handoff, Using Hark Pro FAQ, iMessage/RCS post, security, terms), press coverage and third-party reviews of Hark Pro. Hark ships user-granted standing permissions per category and confirmation-before-purchase by default. I found no statistically certified autonomy, error-rate guarantee, or automatic pause on drift. Competing assistants (Meta Muse, OpenAI's agent) ask for approval per action. The closest research idea is conformal "ask for help" for robot planners (KnowNo, Ren et al. 2023); this applies the same spirit to web-agent errands with a conditional-risk guarantee and drift monitoring.
