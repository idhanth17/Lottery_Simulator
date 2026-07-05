# 🔮 Psychic Lottery Optimizer

An interactive, in-browser solver for the **"psychic modeling" problem** from Steven Skiena's
*Algorithm Design Manual* — plus a full lottery simulator to prove the math live.

> A psychic gives you `n` numbers and swears **at least `j`** of them will be on the winning draw.
> Tickets hold `k` numbers, and matching **`l` or more** wins a prize.
> **What is the smallest set of tickets that makes a prize mathematically guaranteed?**

**Live demo:** https://idhanth17.github.io/Lottery_Simulator/

## ✨ What it does

1. **Design the lottery** — pool size, balls drawn, ticket size, the psychic's promise `j`, and the
   prize threshold `l`. Everything is parameterized; classic 6-from-44 with a 15-number psychic is
   just the default.
2. **Pick the psychic's numbers** on an interactive board (any count the compute budget allows —
   not just 15).
3. **Optimize** — the browser computes a minimal guaranteed ticket set, shows the proven lower
   bound, the savings vs. a full wheel, and independently **verifies** every worst-case scenario
   before showing results.
4. **Draw night** — animated ball draw with two modes:
   - 🎲 **Honest universe**: fully random draw (watch the psychic flop).
   - 🔮 **Psychic delivers**: the promise is honoured — and the guarantee *never* loses.
   Win/lose banners, confetti, streak stats, and a "guarantee record" tracker that shows the
   guarantee holding at 100% whenever the psychic is right.

## 📐 The math

Since every ticket uses only the psychic's `n` numbers, the only thing that matters on draw night
is *which* of those numbers come true. The worst case is exactly `j` of them, so there are
`C(n, j)` scenarios to defend against, and a ticket "covers" a scenario if it shares ≥ `l` numbers
with it. Choosing the fewest tickets whose coverage spans all scenarios is the classic NP-hard
**set cover** problem.

The solver ([js/solver.js](js/solver.js)) runs entirely client-side:

- **Bitmask representation** — scenarios and tickets are 32-bit masks; coverage tests are a single
  `AND` + popcount (16-bit lookup table).
- **Greedy approximation** (pick the ticket covering the most unprotected scenarios) — the
  classical `ln(n)`-approximation for set cover, chunked with `setTimeout` yields so the UI stays
  live, with progress reporting.
- **Randomized restarts** — noisy greedy re-runs when the instance is small enough, keeping the
  best result.
- **Redundancy pruning** — drops any ticket whose scenarios are all covered twice.
- **Counting lower bound** — `⌈C(n,j) / Σᵢ₌ₗ C(k,i)·C(n−k, j−i)⌉`; when the greedy answer meets
  it, the result is labelled *provably optimal*.
- **Independent verifier** — a separate exhaustive check over every scenario runs before results
  are shown. The optimizer is never trusted.

### The classic instance (Skiena's war story)

For `n=15, k=6, j=4, l=3` (the book's psychic): **17 tickets**, verified, versus 5,005 for the full
wheel — with a proven lower bound of 7. Skiena's team initially mis-modelled the problem as
"cover every 3-subset" and needed roughly twice as many tickets; the modeling fix (*cover every
4-subset at intersection ≥ 3*) is the entire moral of the war story.

| Approach | Tickets |
|---|---|
| Full wheel (every 6-of-15 combo) | 5,005 |
| Wrong model — cover all 455 triples | ~34 |
| **Correct model — greedy + prune (this app)** | **17** |
| Proven lower bound | 7 |

## 🗂 Project structure

```
index.html        — single-page app shell
css/style.css     — design system (dark casino theme, no framework)
js/solver.js      — pure math core: combinatorics, greedy set cover, prune, verify
js/app.js         — UI state machine, picker, draw animation, confetti
tests/solver.test.js — node-based correctness tests for the solver
```

No dependencies, no build step. Open `index.html` or serve the folder statically.

```bash
# run locally
python -m http.server 8123
# run solver tests
node tests/solver.test.js
```

## 🧠 Ideas for taking it further

- Exact ILP with symmetry breaking to close the 7–17 gap on the classic instance.
- Web Worker + WASM solver for larger `n`.
- Simulated-annealing local search below the greedy answer.
- Cost/prize economics: show that even guaranteed wins lose money (the real lottery lesson).

---
*Built as an algorithms portfolio project. Not gambling advice — psychics remain unverified.* 🔮
