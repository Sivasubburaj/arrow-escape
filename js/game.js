/* Arrow Escape — rendering, input and game flow. */
'use strict';

const THEMES = {
  sunset: { name: 'Sunset', colors: ['#ff5d73', '#1fbfae', '#ff9f1c', '#8c5cf6'] },
  ocean: { name: 'Ocean', colors: ['#3a86ff', '#06b98f', '#ff8c42', '#ef476f'] },
  candy: { name: 'Candy', colors: ['#ff5fa2', '#2fc4c0', '#f7b32b', '#9d6bff'] },
  neon: { name: 'Neon', colors: ['#ff2e88', '#00e5c4', '#ffd60a', '#a77dff'], glow: true },
};
const THEME_ORDER = Object.keys(THEMES);
const LEVEL_COUNT = 150;

const TIPS = {
  1: 'Tap an arrow to send it flying off the board.',
  2: 'An arrow can only escape if nothing is in its way.',
  3: 'Blocked arrows slide up to the obstacle and stop, and that can trap others!',
  4: 'Clear the board with no slips for 3 stars. Undo is always free.',
  6: 'Stuck? The hint shows a safe move, but counts as a slip.',
};
const PERFECT = ['Perfect escape!', 'Flawless!', 'Brilliant!', 'Pure genius!'];
const GOOD = ['Nice work!', 'Cleared!', 'Well played!', 'Escaped!'];

const ICON = {
  lock: '<svg class="ic" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  soundOn: '<svg class="ic" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  soundOff: '<svg class="ic" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
};

/* ---------- save data ---------- */

const SAVE_KEY = 'arrow-escape-v1';
const save = { unlocked: 1, stars: {}, theme: 'sunset', sound: true };

function loadSave() {
  try {
    Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {});
  } catch (e) { /* storage unavailable: play without saving */ }
}

function writeSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

/* ---------- state ---------- */

const $ = id => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const fxCanvas = $('fx');
const fxCtx = fxCanvas.getContext('2d');

const view = { w: 0, h: 0, dpr: 1, cell: 40, ox: 0, oy: 0 };
let palette = { board: '#fff', cell: '#eee', ink: '#333' };
let sprites = {};
let sparks = [];   // board-space particles
let confetti = []; // full-screen particles
let lastFrame = performance.now();
let toastTimer = 0;

const G = {
  level: 1, rows: 0, cols: 0, arrows: [], grid: null, history: [],
  moves: 0, slips: 0, par: 0, remaining: 0,
  combo: 0, lastExit: 0, hintId: -1, hintT0: 0, hoverId: -1,
  won: false, stuck: false, checkTimer: 0,
};

const starsFor = slips => (slips === 0 ? 3 : slips <= 2 ? 2 : 1);
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const buzz = pattern => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ } };

/* ---------- level flow ---------- */

function startLevel(n) {
  const lvl = createLevel(n);
  const now = performance.now();
  Object.assign(G, {
    level: n, rows: lvl.rows, cols: lvl.cols, history: [], moves: 0, slips: 0,
    par: lvl.arrows.length, remaining: lvl.arrows.length, combo: 0,
    hintId: -1, hoverId: -1, won: false, stuck: false,
  });
  G.grid = new Int16Array(lvl.rows * lvl.cols).fill(-1);
  G.arrows = lvl.arrows.map((a, id) => {
    G.grid[a.r * lvl.cols + a.c] = id;
    return {
      id, r: a.r, c: a.c, d: a.d, alive: true, anim: null,
      bonkT0: 0, flashT0: 0, popT0: now + 80 + (a.r + a.c) * 35, hov: 0,
    };
  });
  clearTimeout(G.checkTimer);
  sparks = [];
  layout();
  updateHud();
  setStuck(false);
  $('modal-win').classList.remove('open');
  show('game');
  if (TIPS[n]) showToast(TIPS[n], 5000);
  else hideToast();
}

function tap(a) {
  if (G.won || !a.alive) return;
  const now = performance.now();
  const res = slide(G.grid, G.rows, G.cols, a.r, a.c, a.d);
  G.hintId = -1;

  if (!res.exit && res.dist === 0) {
    G.slips++;
    G.combo = 0;
    a.bonkT0 = now;
    G.arrows[res.blocker].flashT0 = now;
    Sound.bonk();
    buzz(30);
    updateHud();
    return;
  }

  const from = visual(a, now);
  G.history.push({ id: a.id, r: a.r, c: a.c });
  G.moves++;
  G.grid[a.r * G.cols + a.c] = -1;

  if (res.exit) {
    const travel = res.dist + 3;
    a.alive = false;
    a.anim = {
      type: 'exit', t0: now, dur: 120 + 32 * travel, x0: from.x, y0: from.y,
      x1: a.c + DC[a.d] * travel, y1: a.r + DR[a.d] * travel,
    };
    G.remaining--;
    G.combo = now - G.lastExit < 1500 ? G.combo + 1 : 0;
    G.lastExit = now;
    Sound.exit(G.combo);
    buzz(12);
    if (G.remaining === 0) {
      G.won = true;
      setTimeout(onWin, 550);
    }
  } else {
    // A half-way slide is never needed for a perfect clear, so it's a slip.
    G.slips++;
    G.combo = 0;
    a.r = res.r;
    a.c = res.c;
    G.grid[a.r * G.cols + a.c] = a.id;
    a.anim = {
      type: 'slide', t0: now, dur: 120 + 45 * res.dist, x0: from.x, y0: from.y, x1: a.c, y1: a.r,
    };
    Sound.slide();
    buzz(10);
  }
  updateHud();
  scheduleCheck();
}

function undo() {
  if (G.won) return;
  const h = G.history.pop();
  if (!h) return;
  const now = performance.now();
  const a = G.arrows[h.id];
  const from = visual(a, now);
  if (a.alive) G.grid[a.r * G.cols + a.c] = -1;
  else { a.alive = true; G.remaining++; }
  a.r = h.r;
  a.c = h.c;
  G.grid[a.r * G.cols + a.c] = a.id;
  a.anim = { type: 'undo', t0: now, dur: 240, x0: from.x, y0: from.y, x1: a.c, y1: a.r, a0: from.alpha };
  G.moves--;
  G.combo = 0;
  G.hintId = -1;
  Sound.undo();
  updateHud();
  setStuck(false);
  scheduleCheck();
}

function hint() {
  if (G.won || !G.rows) return;
  const res = solveCurrent(60000);
  if (res.status === 'stuck') { setStuck(true); return; }
  let id = res.id;
  if (id === undefined) {
    const free = G.arrows.find(a => a.alive && slide(G.grid, G.rows, G.cols, a.r, a.c, a.d).exit);
    id = free ? free.id : -1;
  }
  if (id < 0) return;
  if (G.hintId !== id) G.slips++;
  G.hintId = id;
  G.hintT0 = performance.now();
  Sound.hint();
  updateHud();
}

function solveCurrent(limit) {
  const alive = G.arrows.filter(a => a.alive);
  const res = solve(G.rows, G.cols, alive.map(a => ({ r: a.r, c: a.c, d: a.d })), limit);
  if (res.status === 'solvable' && res.move >= 0) res.id = alive[res.move].id;
  return res;
}

// After each move, quietly check whether the board can still be cleared.
function scheduleCheck() {
  clearTimeout(G.checkTimer);
  G.checkTimer = setTimeout(() => {
    if (G.won || G.remaining === 0) return;
    if (solveCurrent(20000).status === 'stuck') setStuck(true);
  }, 380);
}

function setStuck(on) {
  if (G.stuck === on) return;
  G.stuck = on;
  $('btn-undo').classList.toggle('pulse', on);
  if (on) showToast('No way out from here. Undo a few moves!', 0);
  else hideToast();
}

function onWin() {
  const stars = starsFor(G.slips);
  save.stars[G.level] = Math.max(save.stars[G.level] || 0, stars);
  save.unlocked = Math.max(save.unlocked, Math.min(G.level + 1, LEVEL_COUNT));
  writeSave();
  hideToast();
  Sound.win();
  buzz([20, 40, 20]);
  launchConfetti();
  const titles = stars === 3 ? PERFECT : GOOD;
  $('win-title').textContent = titles[G.level % titles.length];
  const slipText = G.slips === 0 ? 'no slips' : G.slips === 1 ? '1 slip' : `${G.slips} slips`;
  $('win-stats').textContent = `${G.moves} moves · ${slipText}`;
  document.querySelectorAll('#win-stars .star').forEach((s, i) => {
    s.classList.remove('on');
    void s.offsetWidth; // restart the pop animation
    s.classList.toggle('on', i < stars);
  });
  $('win-next').hidden = G.level >= LEVEL_COUNT;
  $('modal-win').classList.add('open');
}

/* ---------- HUD, toasts, screens ---------- */

function updateHud() {
  $('hud-level').textContent = `Level ${G.level}`;
  $('hud-moves').textContent = G.moves;
  $('hud-par').textContent = G.par;
  const stars = starsFor(G.slips);
  document.querySelectorAll('#hud-stars .star').forEach((s, i) => s.classList.toggle('on', i < stars));
}

function showToast(text, ms) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('toast').classList.remove('show');
}

function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  if (name === 'home') $('play-level').textContent = `Level ${save.unlocked}`;
}

function renderLevels() {
  const grid = $('level-grid');
  const frag = document.createDocumentFragment();
  let total = 0;
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const st = save.stars[n] || 0;
    total += st;
    const b = document.createElement('button');
    b.className = 'lvl';
    if (n > save.unlocked) {
      b.classList.add('locked');
      b.disabled = true;
      b.innerHTML = ICON.lock;
      b.setAttribute('aria-label', `Level ${n}, locked`);
    } else {
      if (n === save.unlocked) b.classList.add('current');
      b.innerHTML = `<b>${n}</b><span class="mini-stars">${[0, 1, 2].map(i => `<i class="${i < st ? 'on' : ''}"></i>`).join('')}</span>`;
      b.setAttribute('aria-label', `Level ${n}, ${st} stars`);
      b.addEventListener('click', () => { Sound.click(); startLevel(n); });
    }
    frag.appendChild(b);
  }
  grid.replaceChildren(frag);
  $('star-total').textContent = total;
  show('levels');
  const current = grid.querySelector('.current');
  if (current) current.scrollIntoView({ block: 'center' });
}

function applyTheme(name) {
  save.theme = name;
  document.body.dataset.theme = name;
  const colors = THEMES[name].colors;
  colors.forEach((c, i) => document.body.style.setProperty(`--c${i}`, c));
  const cs = getComputedStyle(document.body);
  palette = {
    board: cs.getPropertyValue('--board').trim(),
    cell: cs.getPropertyValue('--cell').trim(),
    ink: cs.getPropertyValue('--ink').trim(),
  };
  document.querySelector('meta[name="theme-color"]').content = cs.getPropertyValue('--bg1').trim();
  $('theme-name').textContent = THEMES[name].name;
  sprites = {};
}

function updateSoundIcon() {
  $('btn-sound').innerHTML = save.sound ? ICON.soundOn : ICON.soundOff;
}

/* ---------- layout & drawing ---------- */

function resize() {
  const wrap = $('board-wrap');
  view.w = wrap.clientWidth;
  view.h = wrap.clientHeight;
  view.dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
  fxCanvas.width = Math.round(window.innerWidth * view.dpr);
  fxCanvas.height = Math.round(window.innerHeight * view.dpr);
  layout();
}

function layout() {
  if (!G.rows || !view.w) return;
  const pad = Math.max(20, Math.min(view.w, view.h) * 0.05);
  const top = 44; // room for the toast
  view.cell = Math.max(24, Math.min((view.w - pad * 2) / G.cols, (view.h - pad * 2 - top) / G.rows, 92));
  view.ox = (view.w - view.cell * G.cols) / 2;
  view.oy = top + (view.h - top - view.cell * G.rows) / 2;
  sprites = {};
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = v => Math.round(v + (target - v) * p);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// Arrow tiles are pre-rendered once per direction, then just stamped.
function arrowSprite(d) {
  if (sprites[d]) return sprites[d];
  const theme = THEMES[save.theme];
  const color = theme.colors[d];
  const s = view.cell * 0.84 * view.dpr;
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(s * 1.5);
  const g = cv.getContext('2d');
  g.translate(cv.width / 2, cv.height / 2);
  const h = s / 2, r = s * 0.26;

  if (theme.glow) { g.shadowColor = color; g.shadowBlur = s * 0.28; }
  else { g.shadowColor = 'rgba(0,0,0,0.2)'; g.shadowBlur = s * 0.12; g.shadowOffsetY = s * 0.07; }
  g.fillStyle = shade(color, -0.28);
  roundRect(g, -h, -h + s * 0.07, s, s, r);
  g.fill();
  g.shadowColor = 'transparent';

  const grad = g.createLinearGradient(0, -h, 0, h);
  grad.addColorStop(0, shade(color, 0.22));
  grad.addColorStop(1, color);
  g.fillStyle = grad;
  roundRect(g, -h, -h, s, s, r);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.22)';
  roundRect(g, -h + s * 0.1, -h + s * 0.07, s * 0.8, s * 0.26, r * 0.6);
  g.fill();

  g.rotate((d * Math.PI) / 2);
  g.shadowColor = 'rgba(0,0,0,0.18)';
  g.shadowBlur = s * 0.04;
  g.strokeStyle = '#fff';
  g.lineWidth = s * 0.12;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(0, s * 0.24);
  g.lineTo(0, -s * 0.2);
  g.moveTo(-s * 0.19, -s * 0.01);
  g.lineTo(0, -s * 0.21);
  g.lineTo(s * 0.19, -s * 0.01);
  g.stroke();

  sprites[d] = cv;
  return cv;
}

function boardSprite() {
  if (sprites.board) return sprites.board;
  const { w, h, dpr, cell, ox, oy } = view;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const pad = cell * 0.16;
  g.shadowColor = 'rgba(0,0,0,0.14)';
  g.shadowBlur = 28;
  g.shadowOffsetY = 10;
  g.fillStyle = palette.board;
  roundRect(g, ox - pad, oy - pad, cell * G.cols + pad * 2, cell * G.rows + pad * 2, cell * 0.32);
  g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = palette.cell;
  const cs = cell * 0.84;
  for (let r = 0; r < G.rows; r++) {
    for (let c = 0; c < G.cols; c++) {
      roundRect(g, ox + c * cell + (cell - cs) / 2, oy + r * cell + (cell - cs) / 2, cs, cs, cs * 0.26);
      g.fill();
    }
  }
  sprites.board = cv;
  return cv;
}

// Where an arrow should be drawn right now, in cell units.
function visual(a, now) {
  let x = a.c, y = a.r, alpha = a.alive ? 1 : 0, scale = 1;
  const m = a.anim;
  if (m) {
    const t = Math.min(1, (now - m.t0) / m.dur);
    const e = m.type === 'exit' ? t * t * 0.55 + t * 0.45 : m.type === 'slide' ? easeOutBack(t) : easeOutCubic(t);
    x = m.x0 + (m.x1 - m.x0) * e;
    y = m.y0 + (m.y1 - m.y0) * e;
    if (m.type === 'exit') {
      alpha = 1 - Math.max(0, (t - 0.45) / 0.55);
      if (!m.burst && (x < -0.5 || y < -0.5 || x > G.cols - 0.5 || y > G.rows - 0.5)) {
        m.burst = true;
        burst(view.ox + (x + 0.5) * view.cell, view.oy + (y + 0.5) * view.cell, THEMES[save.theme].colors[a.d], a.d);
      }
    } else if (m.type === 'undo') {
      alpha = m.a0 + (1 - m.a0) * e;
    }
    if (t >= 1) a.anim = null;
  }
  if (a.bonkT0) {
    const t = (now - a.bonkT0) / 320;
    if (t < 1) {
      const off = Math.sin(t * Math.PI * 4) * (1 - t) * 0.14;
      x += DC[a.d] * off;
      y += DR[a.d] * off;
    } else a.bonkT0 = 0;
  }
  if (now < a.popT0) scale = 0;
  else if (now - a.popT0 < 380) scale = easeOutBack((now - a.popT0) / 380);
  scale *= 1 + 0.07 * a.hov;
  return { x, y, alpha, scale };
}

function draw(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const { w, h, dpr, cell, ox, oy } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!G.rows || !w) return;
  ctx.drawImage(boardSprite(), 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawHint(now);

  for (const a of G.arrows) {
    a.hov += ((a.alive && a.id === G.hoverId ? 1 : 0) - a.hov) * Math.min(1, dt * 14);
    const v = visual(a, now);
    if (v.alpha <= 0.01 || v.scale <= 0.01) continue;
    const img = arrowSprite(a.d);
    const size = (img.width / dpr) * v.scale;
    const cx = ox + (v.x + 0.5) * cell;
    const cy = oy + (v.y + 0.5) * cell;
    ctx.globalAlpha = v.alpha;
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.globalAlpha = 1;
    if (a.flashT0) {
      const t = (now - a.flashT0) / 500;
      if (t < 1) {
        const s = cell * 0.94 * (1 + 0.12 * t);
        ctx.strokeStyle = `rgba(255,59,92,${1 - t})`;
        ctx.lineWidth = cell * 0.08;
        roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.28);
        ctx.stroke();
      } else a.flashT0 = 0;
    }
  }

  drawParticles(ctx, sparks, dt, h);
}

function drawHint(now) {
  const a = G.arrows[G.hintId];
  if (!a || !a.alive) return;
  const { cell, ox, oy } = view;
  const cx = ox + (a.c + 0.5) * cell;
  const cy = oy + (a.r + 0.5) * cell;
  const res = slide(G.grid, G.rows, G.cols, a.r, a.c, a.d);
  const len = (res.exit ? res.dist + 1 : res.dist) * cell;
  const pulse = 0.5 + 0.5 * Math.sin((now - G.hintT0) / 160);

  ctx.save();
  ctx.strokeStyle = palette.ink;
  ctx.globalAlpha = 0.35 + 0.35 * pulse;
  ctx.lineWidth = cell * 0.07;
  ctx.lineCap = 'round';
  ctx.setLineDash([cell * 0.02, cell * 0.2]);
  ctx.lineDashOffset = -now / 25;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + DC[a.d] * len, cy + DR[a.d] * len);
  ctx.stroke();
  ctx.setLineDash([]);
  const s = cell * (1.02 + 0.08 * pulse);
  ctx.lineWidth = cell * 0.06;
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, s * 0.3);
  ctx.stroke();
  ctx.restore();
}

/* ---------- particles ---------- */

function burst(px, py, color, d) {
  const base = Math.atan2(DR[d], DC[d]);
  for (let i = 0; i < 14; i++) {
    const ang = base + (Math.random() - 0.5) * 1.8;
    const speed = 80 + Math.random() * 260;
    sparks.push({
      x: px, y: py, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: 0, max: 0.4 + Math.random() * 0.35, size: 2 + Math.random() * 3.5,
      color, drag: 0.03, g: 0, kind: 'dot',
    });
  }
}

function launchConfetti() {
  const colors = THEMES[save.theme].colors.concat(['#ffffff', '#ffd23f']);
  const W = window.innerWidth, H = window.innerHeight;
  for (let i = 0; i < 140; i++) {
    confetti.push({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.6,
      vx: (Math.random() - 0.5) * 120, vy: 120 + Math.random() * 180,
      life: 0, max: 3 + Math.random() * 1.5, size: 6 + Math.random() * 6,
      color: colors[(Math.random() * colors.length) | 0], drag: 0.6, g: 60,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, kind: 'paper',
    });
  }
}

function drawParticles(g, list, dt, maxY) {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life += dt;
    if (p.life >= p.max || p.y > maxY + 40) { list.splice(i, 1); continue; }
    const drag = Math.pow(p.drag, dt);
    p.vx *= drag;
    p.vy = p.vy * drag + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = 1 - p.life / p.max;
    g.fillStyle = p.color;
    if (p.kind === 'paper') {
      p.rot += p.vr * dt;
      g.globalAlpha = Math.min(1, k * 4);
      g.save();
      g.translate(p.x + Math.sin(p.life * 4 + p.rot) * 6, p.y);
      g.rotate(p.rot);
      g.fillRect(-p.size / 2, -p.size / 4, p.size, (p.size / 2) * Math.abs(Math.cos(p.rot * 1.7)) + 1);
      g.restore();
    } else {
      g.globalAlpha = k;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

function frame(now) {
  requestAnimationFrame(frame);
  if ($('screen-game').classList.contains('active')) draw(now);
  else lastFrame = now;
  if (confetti.length || fxCanvas.dataset.dirty) {
    const dpr = view.dpr;
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawParticles(fxCtx, confetti, Math.min(0.05, 1 / 60), window.innerHeight);
    fxCanvas.dataset.dirty = confetti.length ? '1' : '';
  }
}

/* ---------- input ---------- */

function arrowAt(e) {
  const rect = canvas.getBoundingClientRect();
  const c = Math.floor((e.clientX - rect.left - view.ox) / view.cell);
  const r = Math.floor((e.clientY - rect.top - view.oy) / view.cell);
  if (r < 0 || c < 0 || r >= G.rows || c >= G.cols) return -1;
  return G.grid[r * G.cols + c];
}

canvas.addEventListener('pointerdown', e => {
  Sound.unlock();
  const id = arrowAt(e);
  if (id >= 0) tap(G.arrows[id]);
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  G.hoverId = arrowAt(e);
  canvas.style.cursor = G.hoverId >= 0 ? 'pointer' : 'default';
});
canvas.addEventListener('pointerleave', () => { G.hoverId = -1; });

$('btn-play').addEventListener('click', () => { Sound.click(); startLevel(save.unlocked); });
$('btn-levels').addEventListener('click', () => { Sound.click(); renderLevels(); });
$('levels-back').addEventListener('click', () => { Sound.click(); show('home'); });
$('game-back').addEventListener('click', () => { Sound.click(); hideToast(); renderLevels(); });
$('btn-undo').addEventListener('click', undo);
$('btn-restart').addEventListener('click', () => { Sound.click(); startLevel(G.level); });
$('btn-hint').addEventListener('click', hint);
$('win-next').addEventListener('click', () => { Sound.click(); startLevel(G.level + 1); });
$('win-replay').addEventListener('click', () => { Sound.click(); startLevel(G.level); });
$('btn-theme').addEventListener('click', () => {
  applyTheme(THEME_ORDER[(THEME_ORDER.indexOf(save.theme) + 1) % THEME_ORDER.length]);
  writeSave();
  Sound.click();
});
$('btn-sound').addEventListener('click', () => {
  save.sound = !save.sound;
  Sound.enabled = save.sound;
  updateSoundIcon();
  writeSave();
  Sound.click();
});

document.addEventListener('keydown', e => {
  if (!$('screen-game').classList.contains('active')) return;
  if ($('modal-win').classList.contains('open')) {
    if (e.key === 'Enter' && !$('win-next').hidden) startLevel(G.level + 1);
    return;
  }
  const k = e.key.toLowerCase();
  if (k === 'z' || k === 'backspace') undo();
  else if (k === 'r') startLevel(G.level);
  else if (k === 'h') hint();
  else if (k === 'escape') { hideToast(); renderLevels(); }
});

/* ---------- boot ---------- */

loadSave();
Sound.enabled = save.sound;
applyTheme(THEMES[save.theme] ? save.theme : 'sunset');
updateSoundIcon();
show('home');
new ResizeObserver(resize).observe($('board-wrap'));
window.addEventListener('resize', resize);
resize();
requestAnimationFrame(frame);

/* ---------- install as an app ---------- */

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  $('btn-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('btn-install').hidden = true;
});
$('btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('btn-install').hidden = true;
});
