// Time Machine — game logic
const ROUNDS = 10;

const $ = (id) => document.getElementById(id);
const screens = ['landing', 'game', 'reveal', 'results'];
function show(name) {
  screens.forEach((s) => $('screen-' + s).classList.toggle('active', s === name));
}

// Deterministic PRNG so each scenario's chart noise is stable.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Interpolate keyframes into a noisy daily-looking series.
function buildSeries(keyframes, points, rng, noiseAmp) {
  const out = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    let k = 0;
    while (k < keyframes.length - 2 && keyframes[k + 1][0] < t) k++;
    const [t0, v0] = keyframes[k];
    const [t1, v1] = keyframes[k + 1];
    const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    const eased = f * f * (3 - 2 * f);
    let v = v0 + (v1 - v0) * eased;
    if (i !== 0 && i !== points - 1) v *= 1 + (rng() - 0.5) * noiseAmp;
    out.push(v);
  }
  return out;
}

function pathFrom(series, x0, x1, yMin, yMax, H) {
  const n = series.length;
  const pts = series.map((v, i) => {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    const y = 12 + (H - 24) * (1 - (v - yMin) / (yMax - yMin));
    return [x, y];
  });
  return {
    d: pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '),
    last: pts[pts.length - 1],
    first: pts[0],
  };
}

const W = 640, H = 260, CUT = 460; // pre-history takes 0..CUT, aftermath CUT..620

// Real baked closes when available (prices.js); keyframe fallback otherwise (Enron).
function seriesFor(scenario) {
  if (scenario.realPre) return { pre: scenario.realPre, post: scenario.realPost };
  const real = typeof REAL_PRICES !== 'undefined' && REAL_PRICES[scenario.id];
  if (real) return { pre: real.pre, post: real.post };
  const rng = mulberry32(seedFrom(scenario.id));
  const pre = buildSeries(scenario.pre, 90, rng, 0.05);
  const post = buildSeries(scenario.post, 24, rng, 0.045);
  post[0] = pre[pre.length - 1];
  return { pre, post };
}

function outcomeFor(scenario) {
  if (scenario.pct !== undefined) return scenario.pct;
  const real = typeof REAL_PRICES !== 'undefined' && REAL_PRICES[scenario.id];
  return real ? real.pct : scenario.outcomePct;
}

function renderChart(svg, scenario, withPost, animate) {
  const { pre, post } = seriesFor(scenario);

  const all = withPost ? pre.concat(post) : pre;
  const yMin = Math.min(...all) * 0.94;
  const yMax = Math.max(...all) * 1.06;

  const preP = pathFrom(pre, 16, CUT, yMin, yMax, H);
  let html = '';
  // grid lines
  for (let g = 1; g <= 3; g++) {
    const y = (H / 4) * g;
    html += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#26261f" stroke-width="1"/>`;
  }
  // cutoff line
  html += `<line x1="${CUT}" y1="8" x2="${CUT}" y2="${H - 8}" stroke="#57564c" stroke-width="1" stroke-dasharray="4 5"/>`;
  // pre path
  html += `<path d="${preP.d}" fill="none" stroke="#e8e4d5" stroke-width="2.5" stroke-linejoin="round"/>`;
  html += `<circle cx="${preP.last[0]}" cy="${preP.last[1]}" r="4" fill="#f5c542"/>`;

  if (withPost) {
    const up = outcomeFor(scenario) >= 0;
    const postP = pathFrom(post, CUT, W - 20, yMin, yMax, H);
    const color = up ? '#b6f04a' : '#ff8a76';
    const lenGuess = 400;
    html += `<path d="${postP.d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"
      ${animate ? `stroke-dasharray="${lenGuess}" stroke-dashoffset="${lenGuess}"><animate attributeName="stroke-dashoffset" from="${lenGuess}" to="0" dur="1.4s" fill="freeze" calcMode="spline" keySplines="0.3 0 0.4 1"/></path>` : '/>'}`;
    html += `<circle cx="${postP.last[0]}" cy="${postP.last[1]}" r="4" fill="${color}">
      ${animate ? '<animate attributeName="opacity" from="0" to="1" begin="1.2s" dur="0.3s" fill="freeze"/>' : ''}</circle>`;
  }
  svg.innerHTML = html;
}

// ---- random mystery rounds sliced from full ticker histories ----
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function fmtDate(yyyymmdd) {
  const s = String(yyyymmdd);
  return MONTHS[+s.slice(4, 6) - 1] + ' ' + s.slice(0, 4);
}

function randomRound(usedSyms) {
  const syms = Object.keys(HISTORY).filter((s) => !usedSyms.has(s));
  const sym = syms[Math.floor(Math.random() * syms.length)];
  usedSyms.add(sym);
  const h = HISTORY[sym];
  const PRE = 252, POST = 21; // one trading year shown, one month settled
  const cut = PRE + Math.floor(Math.random() * (h.closes.length - PRE - POST - 1));
  const pre = h.closes.slice(cut - PRE, cut + 1);
  const post = h.closes.slice(cut, cut + POST + 1);
  const pct = +(((post[POST] / post[0]) - 1) * 100).toFixed(1);

  const yrPct = ((pre[PRE] / pre[0]) - 1) * 100;
  const hi = Math.max(...pre);
  const offHi = ((pre[PRE] / hi) - 1) * 100;
  const moPct = ((pre[PRE] / pre[PRE - 21]) - 1) * 100;

  let story;
  if (offHi > -2) story = 'Sitting at fresh highs';
  else if (offHi < -40) story = 'Deep in the drawdown';
  else if (moPct < -12) story = 'A brutal month on the tape';
  else if (moPct > 12) story = 'Suddenly everyone\'s favorite chart';
  else story = 'One year of tape, name withheld';

  const headlines = [
    `${yrPct >= 0 ? 'Up' : 'Down'} ${Math.abs(yrPct).toFixed(0)}% over the trailing year.`,
    offHi > -2 ? 'Trading within 2% of its 52-week high.'
               : `Trading ${Math.abs(offHi).toFixed(0)}% below its 52-week high.`,
    `The last month alone: ${moPct >= 0 ? '+' : ''}${moPct.toFixed(1)}%.`,
  ];

  return {
    id: 'rnd-' + sym + '-' + cut,
    ticker: sym.replace('-USD', ''),
    name: h.name,
    revealDate: fmtDate(h.dates[cut]),
    story, headlines,
    realPre: pre, realPost: post, pct,
    blurb: `This was ${h.name} heading into ${fmtDate(h.dates[cut])}. Over the next month the tape moved it ${pct >= 0 ? '+' : ''}${pct}%. No famous story this time — most of investing is exactly this: a chart, some context, and a coin that isn't quite fair.`,
  };
}

// Ticker -> company domain, for logo lookup (Google favicon service).
// Tickers with no living company (ENE, SPY) just keep the text badge.
const LOGO_DOMAINS = {
  AAPL: 'apple.com', MSFT: 'microsoft.com', NVDA: 'nvidia.com', AMZN: 'amazon.com',
  GOOGL: 'google.com', META: 'meta.com', TSLA: 'tesla.com', NFLX: 'netflix.com',
  AMD: 'amd.com', INTC: 'intel.com', KO: 'coca-cola.com', MCD: 'mcdonalds.com',
  DIS: 'thewaltdisneycompany.com', BA: 'boeing.com', JPM: 'jpmorganchase.com',
  XOM: 'exxonmobil.com', NKE: 'nike.com', SBUX: 'starbucks.com',
  BTC: 'bitcoin.org', GME: 'gamestop.com', ZM: 'zoom.us', CSCO: 'cisco.com',
};

function setRevealLogo(ticker) {
  const img = $('reveal-logo');
  const domain = LOGO_DOMAINS[ticker];
  img.hidden = true;
  if (!domain) return;
  img.onload = () => { img.hidden = false; };
  img.onerror = () => { img.hidden = true; };
  img.src = 'https://www.google.com/s2/favicons?domain=' + domain + '&sz=64';
}

// ---- sounds (Web Audio, no files needed) ----
let audioCtx;
function tone(freq, start, dur, type, vol) {
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  const t = audioCtx.currentTime + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
function playSound(correct) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (correct) {
      // bright two-note ding
      tone(660, 0, 0.18, 'sine', 0.6);
      tone(990, 0.12, 0.35, 'sine', 0.6);
    } else {
      // harsh buzzer
      tone(140, 0, 0.5, 'sawtooth', 0.5);
      tone(110, 0, 0.5, 'square', 0.28);
    }
  } catch (e) { /* no audio available — play silently */ }
}

// ---- game state ----
let deck = [], round = 0, results = [];

// ---- round timer ----
const ROUND_SECONDS = 15;
let timerId, timeLeft;
function startTimer() {
  clearInterval(timerId);
  timeLeft = ROUND_SECONDS;
  paintTimer();
  timerId = setInterval(() => {
    timeLeft--;
    paintTimer();
    if (timeLeft <= 0) {
      clearInterval(timerId);
      // time's up — the tape wins: auto-call the wrong side
      makeCall(!(outcomeFor(deck[round]) >= 0));
    }
  }, 1000);
}
function paintTimer() {
  $('round-indicator').textContent = `ROUND ${round + 1} / ${ROUNDS}`;
  const t = Math.max(timeLeft, 0);
  const big = $('big-timer');
  big.textContent = `0:${String(t).padStart(2, '0')}`;
  big.className = 'big-timer ' +
    (t > ROUND_SECONDS * 2 / 3 ? 't-green' : t > ROUND_SECONDS / 3 ? 't-yellow' : 't-red');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CURATED_PER_RUN = 5; // rest of the deck is freshly generated every run

function startRun() {
  const curated = shuffle(SCENARIOS).slice(0, Math.min(CURATED_PER_RUN, ROUNDS));
  const used = new Set();
  const randoms = Array.from({ length: ROUNDS - curated.length }, () => randomRound(used));
  deck = shuffle(curated.concat(randoms));
  round = 0;
  results = [];
  nextRound();
}

function nextRound() {
  if (round >= ROUNDS) return showResults();
  const s = deck[round];
  $('story-headline').textContent = s.story;
  $('headlines').innerHTML = s.headlines.map((h) => `<li>${h}</li>`).join('');
  renderChart($('chart'), s, false, false);
  show('game');
  startTimer();
}

function makeCall(bullish) {
  clearInterval(timerId); // stop the round clock before anything else
  const s = deck[round];
  const pct = outcomeFor(s);
  const wentUp = pct >= 0;
  const hit = bullish === wentUp;
  const dd = $('dd-check').checked;
  results.push({ hit, points: hit ? (dd ? 2 : 1) : (dd ? -1 : 0) });
  $('dd-check').checked = false;
  playSound(hit);

  $('reveal-ticker').textContent = s.name;
  setRevealLogo(s.ticker);
  $('reveal-date').textContent = s.revealDate.toUpperCase();
  $('reveal-verdict').textContent = hit ? 'Called it.' : 'History disagrees.';
  const badge = $('outcome-badge');
  badge.textContent = (wentUp ? '+' : '') + pct + '% in a month';
  badge.className = 'outcome-badge ' + (wentUp ? 'up' : 'down');
  $('reveal-blurb').textContent = s.blurb;
  $('btn-next').innerHTML = round === ROUNDS - 1
    ? 'See your run <span class="arrow">→</span>'
    : 'Next stop <span class="arrow">→</span>';
  renderChart($('chart-reveal'), s, true, true);
  show('reveal');
}

function showResults() {
  const score = results.filter((r) => r.hit).length;
  const points = results.reduce((a, r) => a + r.points, 0);
  $('round-indicator').textContent = 'TIME MACHINE';
  const line =
    score === ROUNDS ? 'Flawless. Sell the book.' :
    score >= ROUNDS * 0.8 ? 'Sharp. Very sharp.' :
    score > ROUNDS / 2 ? 'You beat the coin flip.' :
    score === ROUNDS / 2 ? 'Dead even with the coin flip.' :
    score >= ROUNDS * 0.3 ? 'The tape got you.' :
    score > 0 ? 'Rough trip through time.' :
    'Perfectly inverse. Impressive?';
  $('final-line').textContent = `${score} / ${ROUNDS} — ${line}`;
  $('result-grid').innerHTML = results
    .map((r) => `<div class="result-cell ${r.hit ? 'hit' : 'miss'}">${r.points > 1 ? '2×' : r.points < 0 ? '−1' : r.hit ? '✓' : '✕'}</div>`)
    .join('');
  $('final-sub').textContent = `${points} point${points === 1 ? '' : 's'} with double-downs. Every chart was a real moment in market history — the hard part was never the data, it was the vibes.`;
  $('copy-note').textContent = '';
  show('results');
}

function shareResult() {
  const score = results.filter((r) => r.hit).length;
  const points = results.reduce((a, r) => a + r.points, 0);
  const grid = results.map((r) => (r.hit ? '🟩' : '🟥')).join('');
  const text = `Time Machine — ${score}/${ROUNDS} (${points} pts)\n${grid}\nGuess what happened next: opentrade.live`;
  navigator.clipboard.writeText(text).then(() => {
    $('copy-note').textContent = 'Copied to clipboard.';
  }).catch(() => {
    $('copy-note').textContent = text;
  });
}

// Theme toggle — persisted across refreshes via localStorage.
function applyThemeIcon() {
  $('btn-theme').textContent =
    document.documentElement.dataset.theme === 'dark' ? '☀' : '☾';
}
$('btn-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tm-theme', next);
  applyThemeIcon();
});
applyThemeIcon();

$('btn-start').addEventListener('click', startRun);
$('btn-exit').addEventListener('click', () => {
  window.location.href = 'index.html'; // back to the games dashboard
});
$('btn-exit-reveal').addEventListener('click', () => {
  window.location.href = 'index.html';
});
$('btn-bullish').addEventListener('click', () => makeCall(true));
$('btn-bearish').addEventListener('click', () => makeCall(false));
$('btn-next').addEventListener('click', () => { round++; nextRound(); });
$('btn-again').addEventListener('click', startRun);
$('btn-share').addEventListener('click', shareResult);

// Keyboard: ← bullish, → bearish, D toggles double down, Enter advances
document.addEventListener('keydown', (e) => {
  const active = document.querySelector('.screen.active').id;
  if (active === 'screen-game') {
    if (e.key === 'ArrowLeft') $('btn-bullish').click();
    if (e.key === 'ArrowRight') $('btn-bearish').click();
    if (e.key === 'd' || e.key === 'D') $('dd-check').checked = !$('dd-check').checked;
  } else if (active === 'screen-reveal' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault(); // keep space from scrolling the page
    $('btn-next').click();
  } else if (active === 'screen-landing' && e.key === 'Enter') {
    $('btn-start').click();
  } else if (active === 'screen-results' && e.key === 'Enter') {
    $('btn-again').click();
  }
});
