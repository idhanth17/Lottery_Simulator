/* Correctness tests for js/solver.js — run with: node tests/solver.test.js */
'use strict';
const Solver = require('../js/solver.js');

let failures = 0;
function check(name, cond) {
  console.log((cond ? '  ✓ ' : '  ✗ FAIL ') + name);
  if (!cond) failures++;
}

(async () => {
  console.log('combinatorics');
  check('C(15,4) = 1365', Solver.comb(15, 4) === 1365);
  check('C(15,6) = 5005', Solver.comb(15, 6) === 5005);
  check('C(5,0) = 1', Solver.comb(5, 0) === 1);
  check('C(5,6) = 0', Solver.comb(5, 6) === 0);
  check('subsetMasks(5,2) has 10 masks', Solver.subsetMasks(5, 2).length === 10);
  check('popcount', Solver.pop(0b101101) === 4);
  check('coveragePerTicket(15,6,4,3) = 195', Solver.coveragePerTicket(15, 6, 4, 3) === 195);

  console.log('tiny instance — Skiena Figure 1.11: n=5, k=3, j=3, l=2 needs 2 tickets');
  const tiny = await Solver.solve([1, 2, 3, 4, 5], 3, 3, 2, null);
  check('verified', tiny.verified === true);
  check('finds the optimal 2 tickets', tiny.count === 2);

  console.log('degenerate — n=k: the single possible ticket must work');
  const deg = await Solver.solve([3, 7, 9, 12, 20, 41], 6, 4, 3, null);
  check('one ticket', deg.count === 1);
  check('verified', deg.verified === true);

  console.log('classic psychic instance — n=15, k=6, j=4, l=3');
  const t0 = Date.now();
  const classic = await Solver.solve(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 6, 4, 3,
    null);
  console.log(`  (solved in ${Date.now() - t0} ms, ${classic.count} tickets, LB ${classic.lowerBound})`);
  check('verified guarantee', classic.verified === true);
  check('lower bound is 7', classic.lowerBound === 7);
  check('ticket count ≤ 20 (greedy quality)', classic.count <= 20);
  check('every ticket has 6 numbers', classic.tickets.every((t) => t.length === 6));

  console.log('guarantee sanity — brute force every scenario against returned tickets');
  const nums = classic.tickets.flat();
  const inter = (a, bSet) => a.filter((x) => bSet.has(x)).length;
  let allOk = true;
  const idx = [0, 1, 2, 3];
  const psychic = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  // enumerate all C(15,4) scenarios by index arrays
  const scen = [];
  (function rec(start, cur) {
    if (cur.length === 4) { scen.push(cur.slice()); return; }
    for (let i = start; i < 15; i++) { cur.push(psychic[i]); rec(i + 1, cur); cur.pop(); }
  })(0, []);
  for (const s of scen) {
    const sSet = new Set(s);
    if (!classic.tickets.some((t) => inter(t, sSet) >= 3)) { allOk = false; break; }
  }
  check(`all ${scen.length} scenarios win a prize`, allOk);

  console.log('impossible guarantee rejected — l > j');
  let threw = false;
  try { await Solver.solve([1, 2, 3, 4, 5, 6, 7, 8], 4, 2, 3, null); } catch { threw = true; }
  check('throws a helpful error', threw);

  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
