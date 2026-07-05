/* ═══════════════════════════════════════════════════════════════════
   app.js — UI orchestration: config → psychic picker → optimizer →
   draw-night simulator. Depends on solver.js (window.Solver).
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (x) => x.toLocaleString('en-US');

  /* ---------------- state ---------------- */
  const state = {
    cfg: { m: 44, t: 6, k: 6, j: 4, l: 3 },
    picked: new Set(),
    solution: null,
    maxStep: 1,
    sim: { mode: 'honest', plays: 0, wins: 0, lucky: 0, psychicRight: 0, guaranteeWins: 0, history: [], busy: false },
  };

  const COMPUTE_HARD_LIMIT = 4.2e8;   // ticket×scenario pairs per greedy pass
  const COMPUTE_SLOW_WARN = 6e7;

  /* ---------------- stepper / navigation ---------------- */
  const panels = [1, 2, 3, 4].map((i) => $('panel-' + i));

  function gotoStep(s) {
    state.maxStep = Math.max(state.maxStep, s);
    panels.forEach((p, i) => { p.hidden = (i + 1) !== s; });
    document.querySelectorAll('.step').forEach((el) => {
      const n = +el.dataset.step;
      el.classList.toggle('active', n === s);
      el.classList.toggle('done', n < s);
      el.disabled = n > state.maxStep;
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (s === 2) buildPickGrid();
    if (s === 4) initSimPanel();
  }

  document.querySelectorAll('.step').forEach((el) => {
    el.addEventListener('click', () => {
      const n = +el.dataset.step;
      if (n <= state.maxStep) gotoStep(n);
    });
  });
  document.querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => gotoStep(+el.dataset.goto));
  });

  function invalidateDownstream() {
    state.solution = null;
    state.maxStep = Math.min(state.maxStep, 2);
    $('btn-to-sim').disabled = true;
    $('results').hidden = true;
    resetSimStats();
  }

  /* ---------------- step 1 · configuration ---------------- */
  const cfgInputs = { m: $('inp-m'), t: $('inp-t'), k: $('inp-k'), j: $('inp-j'), l: $('inp-l') };

  document.querySelectorAll('.num-stepper button').forEach((b) => {
    b.addEventListener('click', () => {
      const inp = $(b.dataset.for);
      inp.value = (+inp.value || 0) + (+b.dataset.d);
      inp.dispatchEvent(new Event('input'));
    });
  });

  Object.values(cfgInputs).forEach((inp) =>
    inp.addEventListener('input', () => { readConfig(); invalidateDownstream(); }));

  function readConfig() {
    const c = state.cfg;
    c.m = clamp(+cfgInputs.m.value || 44, 10, 90);
    c.t = clamp(+cfgInputs.t.value || 6, 2, 10);
    c.k = clamp(+cfgInputs.k.value || 6, 2, 10);
    c.j = clamp(+cfgInputs.j.value || 4, 1, 10);
    c.l = clamp(+cfgInputs.l.value || 3, 1, 10);
    renderCfgSummary();
    return validateConfig();
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  function validateConfig() {
    const { m, t, k, j, l } = state.cfg;
    const errors = [];
    if (t > m) errors.push(`Can't draw ${t} balls from a pool of only ${m}.`);
    if (k > m) errors.push(`A ticket can't hold ${k} numbers when the pool only has ${m}.`);
    if (j > t) errors.push(`The psychic can't promise ${j} correct numbers when only ${t} are drawn.`);
    if (l > k) errors.push(`A prize can't require ${l} matches when tickets only hold ${k} numbers.`);
    if (l <= k && l <= t && j <= t && l > j)
      errors.push(`No guarantee is possible: a prize needs ${l} matches, but the psychic only promises ${j}. Raise the promise or lower the prize threshold.`);
    const box = $('cfg-error');
    box.hidden = errors.length === 0;
    box.innerHTML = errors.map((e) => `<div>⚠️ ${e}</div>`).join('');
    return errors.length === 0;
  }

  function renderCfgSummary() {
    const { m, t, k, j, l } = state.cfg;
    $('cfg-summary').innerHTML = `
      <div class="cfg-head"><span class="cfg-icon">📋</span><span>Your game</span></div>
      <p class="cfg-desc big">Draw <b>${t}</b> balls from <b>1–${m}</b>.
      Tickets hold <b>${k}</b> numbers.
      The psychic promises at least <b>${j}</b> hits among their numbers,
      and any ticket matching <b>${l}+</b> drawn numbers wins a prize.</p>`;
  }

  $('btn-to-picker').addEventListener('click', () => {
    if (readConfig()) gotoStep(2);
  });

  /* ---------------- step 2 · psychic number picker ---------------- */
  function buildPickGrid() {
    const { m } = state.cfg;
    [...state.picked].forEach((x) => { if (x > m) state.picked.delete(x); });
    const grid = $('pick-grid');
    grid.innerHTML = '';
    for (let i = 1; i <= m; i++) {
      const b = document.createElement('button');
      b.className = 'pick-ball' + (state.picked.has(i) ? ' on' : '');
      b.textContent = i;
      b.addEventListener('click', () => {
        if (state.picked.has(i)) state.picked.delete(i); else state.picked.add(i);
        b.classList.toggle('on');
        invalidateDownstream();
        updatePickInfo();
      });
      grid.appendChild(b);
    }
    updatePickInfo();
  }

  function updatePickInfo() {
    const n = state.picked.size;
    const { k, j } = state.cfg;
    $('pick-count').textContent = `${n} selected`;
    const minN = Math.max(k, j);
    const note = $('pick-note');
    if (n === 0) {
      note.textContent = `Pick at least ${minN} numbers (enough to fill a ticket and carry the promise).`;
      note.className = 'note';
    } else if (n < minN) {
      note.textContent = `Need at least ${minN} numbers — ${minN - n} more to go.`;
      note.className = 'note';
    } else {
      const cost = Solver.costEstimate(n, k, j);
      if (cost > COMPUTE_HARD_LIMIT) {
        note.textContent = `😅 ${n} numbers means ${fmt(Solver.comb(n, k))} candidate tickets — too heavy for a browser. Drop a few numbers.`;
        note.className = 'note bad';
      } else if (cost > COMPUTE_SLOW_WARN) {
        note.textContent = `⚡ ${fmt(Solver.comb(n, k))} candidate tickets vs ${fmt(Solver.comb(n, j))} scenarios — this could take up to a minute of number crunching.`;
        note.className = 'note warn';
      } else {
        note.textContent = `✓ ${fmt(Solver.comb(n, k))} candidate tickets vs ${fmt(Solver.comb(n, j))} worst-case scenarios. Ready when you are.`;
        note.className = 'note ok';
      }
    }
    $('pick-error').hidden = true;
  }

  $('btn-quickpick').addEventListener('click', () => {
    const { m, k, j } = state.cfg;
    const target = Math.min(15, m);
    state.picked.clear();
    const pool = Array.from({ length: m }, (_, i) => i + 1);
    shuffle(pool);
    for (let i = 0; i < Math.max(target, Math.max(k, j)); i++) state.picked.add(pool[i]);
    invalidateDownstream();
    buildPickGrid();
  });

  $('btn-clear').addEventListener('click', () => {
    state.picked.clear();
    invalidateDownstream();
    buildPickGrid();
  });

  /* ---------------- step 3 · optimizer ---------------- */
  $('btn-solve').addEventListener('click', async () => {
    const n = state.picked.size;
    const { k, j, l } = state.cfg;
    const minN = Math.max(k, j);
    const err = $('pick-error');
    if (n < minN) {
      err.textContent = `⚠️ Pick at least ${minN} numbers first.`;
      err.hidden = false;
      return;
    }
    if (Solver.costEstimate(n, k, j) > COMPUTE_HARD_LIMIT) {
      err.textContent = '⚠️ Too many numbers for in-browser optimization — remove a few.';
      err.hidden = false;
      return;
    }
    gotoStep(3);
    await runSolve();
  });

  async function runSolve() {
    const { k, j, l } = state.cfg;
    const numbers = [...state.picked].sort((a, b) => a - b);
    const prog = $('solve-progress'), bar = $('bar-fill'), status = $('solve-status');
    $('results').hidden = true;
    $('solve-error').hidden = true;
    $('btn-to-sim').disabled = true;
    prog.hidden = false;
    bar.style.width = '2%';
    status.textContent = 'Enumerating scenarios…';
    try {
      const sol = await Solver.solve(numbers, k, j, l, (frac, label) => {
        bar.style.width = Math.round(frac * 100) + '%';
        status.textContent = label;
      });
      state.solution = sol;
      prog.hidden = true;
      renderResults(sol);
      $('btn-to-sim').disabled = !sol.verified;
      state.maxStep = Math.max(state.maxStep, 3);
    } catch (e) {
      prog.hidden = true;
      const box = $('solve-error');
      box.textContent = '⚠️ ' + e.message;
      box.hidden = false;
    }
  }

  function renderResults(sol) {
    $('stat-tickets').textContent = fmt(sol.count);
    $('stat-wheel').textContent = fmt(sol.fullWheel);
    $('stat-lb').textContent = fmt(sol.lowerBound);
    $('stat-verified').textContent = sol.verified ? '✓ ' + fmt(sol.scenarios) : '✗';
    $('stat-verified-label').textContent = sol.verified
      ? 'scenarios verified — prize guaranteed'
      : 'VERIFICATION FAILED';
    const pct = (100 * (1 - sol.count / sol.fullWheel));
    $('savings-line').innerHTML =
      sol.count === sol.lowerBound
        ? `🏅 This is <b>provably optimal</b> — the counting bound says no smaller set exists. Solved in ${fmt(sol.ms)} ms.`
        : `That's <b>${pct.toFixed(1)}% fewer</b> tickets than the ${fmt(sol.fullWheel)}-ticket full wheel, and the true optimum is provably ≥ ${sol.lowerBound}. Solved in ${fmt(sol.ms)} ms.`;
    renderTicketCards($('ticket-grid'), sol.tickets, null);
    $('results').hidden = false;
  }

  function renderTicketCards(container, tickets, drawSet) {
    const { l } = state.cfg;
    container.innerHTML = '';
    tickets.forEach((t, i) => {
      const card = document.createElement('div');
      const hits = drawSet ? t.filter((x) => drawSet.has(x)).length : 0;
      const winner = drawSet && hits >= l;
      card.className = 'ticket' + (winner ? ' winner' : '') + (drawSet && !winner ? ' dud' : '');
      card.innerHTML =
        `<div class="ticket-head"><span>TICKET #${String(i + 1).padStart(2, '0')}</span>` +
        (drawSet ? `<span class="ticket-hits ${winner ? 'hit' : ''}">${hits} match${hits === 1 ? '' : 'es'}${winner ? ' · PRIZE! 🏆' : ''}</span>` : '') +
        `</div><div class="ticket-balls">` +
        t.map((x) => `<span class="ball small ${drawSet && drawSet.has(x) ? 'hit' : ''}">${x}</span>`).join('') +
        `</div>`;
      container.appendChild(card);
    });
  }

  $('btn-to-sim').addEventListener('click', () => gotoStep(4));

  /* ---------------- step 4 · draw night ---------------- */
  function initSimPanel() {
    const { m, t, j, l } = state.cfg;
    $('sim-sub').innerHTML =
      `The machine draws <b>${t}</b> balls from <b>1–${m}</b>. ` +
      `You hold <b>${state.solution.count}</b> tickets. If the psychic's promise (≥${j} hits) comes true, ` +
      `at least one ticket <em>must</em> match ${l}+ numbers. Let's see.`;
    renderTicketCards($('sim-tickets'), state.solution.tickets, null);
    $('sim-tickets-h').hidden = false;
    updateSimStats();
  }

  function resetSimStats() {
    Object.assign(state.sim, { plays: 0, wins: 0, lucky: 0, psychicRight: 0, guaranteeWins: 0, history: [], busy: false });
    if ($('history')) $('history').innerHTML = '';
    if ($('outcome')) { $('outcome').hidden = true; }
    if ($('psychic-report')) $('psychic-report').hidden = true;
    if ($('draw-balls')) $('draw-balls').innerHTML = '';
  }

  $('mode-honest').addEventListener('click', () => setMode('honest'));
  $('mode-psychic').addEventListener('click', () => setMode('psychic'));
  function setMode(mode) {
    state.sim.mode = mode;
    $('mode-honest').classList.toggle('active', mode === 'honest');
    $('mode-psychic').classList.toggle('active', mode === 'psychic');
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const r = Math.floor(Math.random() * (i + 1));
      [a[i], a[r]] = [a[r], a[i]];
    }
    return a;
  }
  const sample = (arr, n) => shuffle(arr.slice()).slice(0, n);

  function drawNumbers() {
    const { m, t, j } = state.cfg;
    const psychic = [...state.picked];
    if (state.sim.mode === 'honest') {
      return sample(Array.from({ length: m }, (_, i) => i + 1), t);
    }
    /* psychic-delivers mode: at least j psychic numbers appear */
    let hits = Math.random() < 0.6 ? j : j + Math.floor(Math.random() * (Math.min(t, psychic.length) - j + 1));
    hits = Math.min(hits, t, psychic.length);
    const others = Array.from({ length: m }, (_, i) => i + 1).filter((x) => !state.picked.has(x));
    let rest = t - hits;
    if (rest > others.length) { hits += rest - others.length; rest = others.length; }
    return shuffle(sample(psychic, hits).concat(sample(others, rest)));
  }

  $('btn-draw').addEventListener('click', async () => {
    if (state.sim.busy || !state.solution) return;
    state.sim.busy = true;
    $('btn-draw').disabled = true;
    $('outcome').hidden = true;
    $('psychic-report').hidden = true;

    const drawn = drawNumbers();
    const stage = $('draw-balls');
    stage.innerHTML = '';
    renderTicketCards($('sim-tickets'), state.solution.tickets, null);

    for (const x of drawn) {
      await wait(430);
      const b = document.createElement('span');
      b.className = 'ball big pop' + (state.picked.has(x) ? ' psychic' : '');
      b.textContent = x;
      stage.appendChild(b);
    }
    await wait(500);
    settleDraw(new Set(drawn));
    state.sim.busy = false;
    $('btn-draw').disabled = false;
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const LOSS_LINES = [
    'Time to change your psychic. 🔮📉',
    'Your psychic saw the future… of someone else. Get a refund.',
    'The spirits called in sick. New psychic, please.',
    'Astrology called — even they think your psychic is guessing.',
    'That crystal ball needs a firmware update. 🔮⚠️',
  ];

  function settleDraw(drawSet) {
    const { j, l } = state.cfg;
    const sim = state.sim;
    const psychicHits = [...state.picked].filter((x) => drawSet.has(x)).length;
    const psychicRight = psychicHits >= j;
    const bestHits = Math.max(...state.solution.tickets.map((t) => t.filter((x) => drawSet.has(x)).length));
    const won = bestHits >= l;

    sim.plays++;
    if (psychicRight) sim.psychicRight++;
    if (won) { sim.wins++; if (psychicRight) sim.guaranteeWins++; else sim.lucky++; }

    /* psychic report */
    const rep = $('psychic-report');
    rep.className = 'psychic-report ' + (psychicRight ? 'good' : 'bad');
    rep.innerHTML = psychicRight
      ? `🔮 The psychic delivered: <b>${psychicHits}</b> of their numbers drawn (promised ≥${j}).`
      : `🔮 The psychic flopped: only <b>${psychicHits}</b> of their numbers drawn (promised ≥${j}).`;
    rep.hidden = false;

    /* tickets with highlights */
    renderTicketCards($('sim-tickets'), state.solution.tickets, drawSet);

    /* outcome banner */
    const out = $('outcome');
    if (won && psychicRight) {
      out.className = 'outcome win';
      out.innerHTML = `<div class="outcome-title">🎉 WINNER — GUARANTEED! 🎉</div>
        <div class="outcome-sub">The psychic kept the promise, and the math did the rest: best ticket matched <b>${bestHits}</b> numbers. This will happen <em>every single time</em> the promise holds.</div>`;
      confettiBurst();
    } else if (won) {
      out.className = 'outcome lucky';
      out.innerHTML = `<div class="outcome-title">🍀 You won… on pure luck</div>
        <div class="outcome-sub">The psychic broke the promise, but a ticket still matched <b>${bestHits}</b>. Don't tell them — they'll take credit.</div>`;
      confettiBurst();
    } else {
      out.className = 'outcome loss';
      out.innerHTML = `<div class="outcome-title">💸 No prize this time</div>
        <div class="outcome-sub">Best ticket matched only <b>${bestHits}</b> of the needed <b>${l}</b>. ${LOSS_LINES[Math.floor(Math.random() * LOSS_LINES.length)]}<br>
        <span class="fine">Note the guarantee wasn't broken — the psychic was wrong, not the math.</span></div>`;
    }
    out.hidden = false;

    /* history + stats */
    sim.history.unshift({ won, psychicRight, psychicHits, bestHits });
    sim.history = sim.history.slice(0, 12);
    $('history').innerHTML = sim.history
      .map((h) => `<span class="hist ${h.won ? 'w' : 'l'}" title="psychic ${h.psychicHits} hits · best ticket ${h.bestHits}">${h.won ? '🎉' : '💸'}</span>`)
      .join('');
    updateSimStats();
  }

  function updateSimStats() {
    const s = state.sim;
    $('stat-plays').textContent = s.plays;
    $('stat-wins').textContent = s.wins;
    $('stat-lucky').textContent = s.lucky;
    $('stat-guarantee').textContent = s.psychicRight === 0 ? '–' : `${s.guaranteeWins}/${s.psychicRight}`;
  }

  $('btn-restart').addEventListener('click', () => {
    state.picked.clear();
    invalidateDownstream();
    state.maxStep = 1;
    gotoStep(1);
  });

  /* ---------------- confetti ---------------- */
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let confettiRunning = false;

  function confettiBurst() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#ffd166', '#f4a261', '#b892ff', '#8ac6ff', '#7bf1a8', '#ff7096'];
    for (let i = 0; i < 160; i++) {
      particles.push({
        x: canvas.width * (0.3 + 0.4 * Math.random()),
        y: canvas.height * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: -6 - Math.random() * 9,
        size: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life: 140,
      });
    }
    if (!confettiRunning) { confettiRunning = true; requestAnimationFrame(confettiTick); }
  }

  function confettiTick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = particles.filter((p) => p.life > 0 && p.y < canvas.height + 20);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.32; p.vx *= 0.99; p.rot += p.vr; p.life--;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.min(1, p.life / 40);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (particles.length > 0) requestAnimationFrame(confettiTick);
    else { confettiRunning = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }

  /* ---------------- boot ---------------- */
  readConfig();
  gotoStep(1);
})();
