/* ═══════════════════════════════════════════════════════════════════
   solver.js — the math core.
   Reduces the "psychic lottery guarantee" to SET COVER and solves it
   with greedy approximation + randomized restarts + redundancy pruning.
   Pure logic, no DOM. Exposed as window.Solver.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const Solver = (() => {

  /* ---------- combinatorics ---------- */

  function comb(n, r) {
    if (r < 0 || r > n) return 0;
    r = Math.min(r, n - r);
    let out = 1;
    for (let i = 0; i < r; i++) out = (out * (n - i)) / (i + 1);
    return Math.round(out);
  }

  /* All r-subsets of {0..n-1} as 32-bit masks (requires n <= 30). */
  function subsetMasks(n, r) {
    const total = comb(n, r);
    const out = new Uint32Array(total);
    if (total === 0) return out;
    const idx = new Array(r);
    for (let i = 0; i < r; i++) idx[i] = i;
    let p = 0;
    while (true) {
      let m = 0;
      for (let i = 0; i < r; i++) m |= (1 << idx[i]);
      out[p++] = m >>> 0;
      let i = r - 1;
      while (i >= 0 && idx[i] === n - r + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let x = i + 1; x < r; x++) idx[x] = idx[x - 1] + 1;
    }
    return out;
  }

  /* popcount via 16-bit lookup table */
  const POP = new Uint8Array(1 << 16);
  for (let i = 1; i < (1 << 16); i++) POP[i] = POP[i >> 1] + (i & 1);
  const pop = (x) => POP[x & 0xffff] + POP[(x >>> 16) & 0xffff];

  const yieldToUI = () => new Promise((res) => setTimeout(res, 0));

  /* How many j-scenarios one ticket protects:
     sum over i = l..min(k,j) of C(k,i) * C(n-k, j-i)  */
  function coveragePerTicket(n, k, j, l) {
    let s = 0;
    for (let i = l; i <= Math.min(k, j); i++) s += comb(k, i) * comb(n - k, j - i);
    return s;
  }

  /* Cost estimate (ticket-scenario pairs per greedy pass) — used by the
     UI to keep the browser inside a sane compute budget. */
  function costEstimate(n, k, j) {
    return comb(n, k) * comb(n, j);
  }

  /* ---------- core greedy pass ----------
     scen/tick: Uint32Array of masks. noise > 0 makes the pass randomized
     (for restarts). Reports progress through onOps(opsDone).            */
  async function greedyPass(scen, tick, l, noise, onOps) {
    const nq = scen.length, nt = tick.length;
    const covered = new Uint8Array(nq);
    let remaining = nq;
    const chosen = [];
    const unc = new Uint32Array(nq);
    let ops = 0, opsSinceYield = 0;

    while (remaining > 0) {
      let u = 0;
      for (let q = 0; q < nq; q++) if (!covered[q]) unc[u++] = scen[q];

      let bestScore = -1, bestTi = -1;
      for (let ti = 0; ti < nt; ti++) {
        const T = tick[ti];
        let g = 0;
        for (let x = 0; x < u; x++) if (pop(T & unc[x]) >= l) g++;
        const score = noise > 0 ? g * (1 + noise * Math.random()) : g;
        if (score > bestScore) { bestScore = score; bestTi = ti; }
        opsSinceYield += u;
        if (opsSinceYield > 3_000_000) {
          ops += opsSinceYield; opsSinceYield = 0;
          if (onOps) onOps(ops);
          await yieldToUI();
        }
      }
      ops += opsSinceYield; opsSinceYield = 0;

      chosen.push(bestTi);
      const T = tick[bestTi];
      for (let q = 0; q < nq; q++) {
        if (!covered[q] && pop(T & scen[q]) >= l) { covered[q] = 1; remaining--; }
      }
      if (onOps) onOps(ops);
    }
    return chosen;
  }

  /* Remove tickets whose every scenario is already covered twice. */
  function prune(chosen, scen, tick, l) {
    const nq = scen.length;
    const cnt = new Uint16Array(nq);
    const list = chosen.slice();
    for (const ti of list) {
      const T = tick[ti];
      for (let q = 0; q < nq; q++) if (pop(T & scen[q]) >= l) cnt[q]++;
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = list.length - 1; i >= 0; i--) {
        const T = tick[list[i]];
        let redundant = true;
        for (let q = 0; q < nq; q++) {
          if (pop(T & scen[q]) >= l && cnt[q] < 2) { redundant = false; break; }
        }
        if (redundant) {
          for (let q = 0; q < nq; q++) if (pop(T & scen[q]) >= l) cnt[q]--;
          list.splice(i, 1);
          changed = true;
        }
      }
    }
    return list;
  }

  /* Independent verifier — must never trust the optimizer. */
  function verify(chosenMasks, scen, l) {
    for (let q = 0; q < scen.length; q++) {
      const S = scen[q];
      let ok = false;
      for (let c = 0; c < chosenMasks.length; c++) {
        if (pop(chosenMasks[c] & S) >= l) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  }

  /* ---------- public entry point ----------
     numbers : the psychic's actual numbers (sorted array)
     k       : numbers per ticket
     j       : promised correct numbers ("at least j of numbers drawn")
     l       : matches needed for a prize
     onProgress(frac, label) : UI callback
     Returns { tickets, count, lowerBound, scenarios, fullWheel,
               verified, restarts, ms }                                */
  async function solve(numbers, k, j, l, onProgress) {
    const t0 = performance.now();
    const n = numbers.length;
    if (n > 30) throw new Error('At most 30 psychic numbers are supported.');
    if (k > n) throw new Error('Tickets need ' + k + ' numbers but the psychic only picked ' + n + '.');
    if (j > n) throw new Error('The psychic cannot promise ' + j + ' correct numbers out of only ' + n + '.');
    if (l > j) throw new Error('No guarantee possible: a prize needs ' + l + ' matches but only ' + j + ' are promised.');

    const scen = subsetMasks(n, j);
    const tick = subsetMasks(n, k);
    const nq = scen.length, nt = tick.length;
    const perTicket = coveragePerTicket(n, k, j, l);
    const lowerBound = Math.max(1, Math.ceil(nq / perTicket));

    /* Rough total-ops budget for the progress bar: a full greedy run costs
       about nt * nq * H, where H ≈ expected number of "sweep-equivalents". */
    const passCost = nt * nq;
    const restarts = passCost <= 30_000_000 ? 6 : (passCost <= 120_000_000 ? 2 : 1);
    const opsBudget = passCost * 5 * restarts;
    let opsBase = 0;

    let best = null;
    for (let r = 0; r < restarts; r++) {
      const noise = r === 0 ? 0 : 0.5;
      let lastOps = 0;
      const chosen = await greedyPass(scen, tick, l, noise, (ops) => {
        lastOps = ops;
        if (onProgress) {
          const frac = Math.min(0.98, (opsBase + ops) / opsBudget);
          onProgress(frac, r === 0 ? 'Running greedy set cover…'
                                   : `Randomized restart ${r} of ${restarts - 1}…`);
        }
      });
      opsBase += lastOps || passCost;
      const pruned = prune(chosen, scen, tick, l);
      if (!best || pruned.length < best.length) best = pruned;
      if (best.length <= lowerBound) break;   // provably optimal — stop early
    }

    const chosenMasks = best.map((ti) => tick[ti]);
    const verified = verify(chosenMasks, scen, l);

    /* masks → actual numbers */
    const tickets = chosenMasks.map((m) => {
      const t = [];
      for (let b = 0; b < n; b++) if (m & (1 << b)) t.push(numbers[b]);
      return t;
    });
    tickets.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] || 0) - (b[2] || 0));

    if (onProgress) onProgress(1, 'Done');
    return {
      tickets,
      count: tickets.length,
      lowerBound,
      scenarios: nq,
      candidates: nt,
      fullWheel: nt,
      verified,
      restarts,
      ms: Math.round(performance.now() - t0),
    };
  }

  return { solve, comb, costEstimate, coveragePerTicket, subsetMasks, pop, verify };
})();

if (typeof module !== 'undefined') module.exports = Solver; // for node-based tests
