/* Arrow Escape — level generation and solving.
 *
 * Rules: tapping an arrow slides it in the direction it points. If the way
 * to the edge is clear it flies off the board; otherwise it slides up to the
 * first arrow in its way and stops there. If that arrow is right next to it,
 * nothing moves (a "bonk").
 */
'use strict';

const DR = [-1, 0, 1, 0]; // up, right, down, left
const DC = [0, 1, 0, -1];

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// What happens if the arrow at (r, c) pointing d is tapped. grid holds arrow
// ids (-1 = empty). exit: true when it leaves the board; otherwise it stops at
// (r, c) in front of `blocker`. dist is how many cells it travels (0 = bonk).
function slide(grid, rows, cols, r, c, d) {
  let dist = 0;
  let nr = r + DR[d];
  let nc = c + DC[d];
  while (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
    const hit = grid[nr * cols + nc];
    if (hit !== -1) {
      return { exit: false, dist, r: nr - DR[d], c: nc - DC[d], blocker: hit };
    }
    dist++;
    nr += DR[d];
    nc += DC[d];
  }
  return { exit: true, dist };
}

// Places arrows one by one, each with a clear path to the edge at the moment
// it is placed. Removing them in reverse order is always a valid solution, so
// every board is solvable without a single wasted move.
function buildBoard(rows, cols, fill, rng) {
  const grid = new Int16Array(rows * cols).fill(-1);
  const arrows = [];
  const target = Math.round(rows * cols * fill);
  const cells = shuffle([...Array(rows * cols).keys()], rng);
  for (const idx of cells) {
    if (arrows.length >= target) break;
    const r = (idx / cols) | 0;
    const c = idx % cols;
    const dirs = shuffle([0, 1, 2, 3], rng).filter(d => slide(grid, rows, cols, r, c, d).exit);
    if (!dirs.length) continue;
    grid[idx] = arrows.length;
    arrows.push({ r, c, d: dirs[0] });
  }
  return arrows;
}

// Peels off every free arrow round by round to gauge difficulty.
// depth: rounds needed; free0: arrows free at the start; bait: arrows that
// would slide part-way (the tempting wrong moves); conveyor: arrows pointing
// straight at a same-direction neighbour (long lines of those are deep but
// easy to read, so they shouldn't count as hard).
function analyze(arrows, rows, cols) {
  const grid = new Int16Array(rows * cols).fill(-1);
  arrows.forEach((a, i) => { grid[a.r * cols + a.c] = i; });
  let conveyor = 0;
  for (const a of arrows) {
    const nr = a.r + DR[a.d], nc = a.c + DC[a.d];
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
    const next = grid[nr * cols + nc];
    if (next !== -1 && arrows[next].d === a.d) conveyor++;
  }
  let alive = arrows.map((_, i) => i);
  let depth = 0, free0 = 0, bait = 0;
  while (alive.length) {
    const free = [], rest = [];
    for (const i of alive) {
      const a = arrows[i];
      const res = slide(grid, rows, cols, a.r, a.c, a.d);
      if (res.exit) free.push(i);
      else {
        rest.push(i);
        if (depth === 0 && res.dist > 0) bait++;
      }
    }
    if (!free.length) return null;
    if (depth === 0) free0 = free.length;
    for (const i of free) grid[arrows[i].r * cols + arrows[i].c] = -1;
    alive = rest;
    depth++;
  }
  return { depth, free0, bait, conveyor };
}

const TIERS = [
  { upTo: 2, rows: 3, cols: 3, fill: 0.8 },
  { upTo: 6, rows: 4, cols: 4, fill: 0.85 },
  { upTo: 12, rows: 5, cols: 4, fill: 0.86 },
  { upTo: 20, rows: 5, cols: 5, fill: 0.88 },
  { upTo: 32, rows: 6, cols: 5, fill: 0.88 },
  { upTo: 46, rows: 6, cols: 6, fill: 0.9 },
  { upTo: 62, rows: 7, cols: 6, fill: 0.9 },
  { upTo: 80, rows: 7, cols: 7, fill: 0.9 },
  { upTo: 100, rows: 8, cols: 7, fill: 0.92 },
  { upTo: 125, rows: 8, cols: 8, fill: 0.92 },
  { upTo: Infinity, rows: 9, cols: 8, fill: 0.93 },
];

// Higher = harder: more rounds to clear, fewer arrows free at once, and more
// tempting arrows that would only slide part-way.
const difficulty = (info, count) =>
  info.depth + (1 - info.free0 / count) * 6 + (info.bait / count) * 3 - info.conveyor * 0.8;

// Re-aims arrows one at a time, keeping any change that leaves the board
// solvable and harder. effort (0..1) caps how many changes are kept.
function harden(arrows, rows, cols, rng, effort) {
  let budget = Math.round(effort * arrows.length * 2);
  let best = difficulty(analyze(arrows, rows, cols), arrows.length);
  for (let pass = 0; pass < 4 && budget > 0; pass++) {
    for (const i of shuffle([...arrows.keys()], rng)) {
      if (budget <= 0) break;
      const old = arrows[i].d;
      for (const d of shuffle([0, 1, 2, 3], rng)) {
        if (d === old) continue;
        arrows[i].d = d;
        const info = analyze(arrows, rows, cols);
        const score = info ? difficulty(info, arrows.length) : -1;
        if (score > best) { best = score; budget--; break; }
        arrows[i].d = old;
      }
    }
  }
  return best;
}

// Level n is always the same board. Difficulty climbs within each tier and
// eases back a little when the board grows at the start of the next one.
function createLevel(n) {
  let start = 1, tierIndex = 0;
  for (; tierIndex < TIERS.length - 1; tierIndex++) {
    if (n <= TIERS[tierIndex].upTo) break;
    start = TIERS[tierIndex].upTo + 1;
  }
  const tier = TIERS[tierIndex];
  const span = tier.upTo === Infinity ? 25 : tier.upTo - start + 1;
  const progress = span > 1 ? Math.min(1, (n - start) / (span - 1)) : 1;
  const effort = n <= 2 ? 0 : 0.04 + 0.22 * progress + 0.3 * (tierIndex / (TIERS.length - 1));
  const rng = mulberry32(n * 7919 + 101);
  let pick = null;
  for (let k = 0; k < 4; k++) {
    const fill = Math.min(0.97, tier.fill + (rng() - 0.5) * 0.1);
    const arrows = buildBoard(tier.rows, tier.cols, fill, rng);
    const score = harden(arrows, tier.rows, tier.cols, rng, effort);
    if (!pick || score > pick.score) pick = { arrows, score };
  }
  return { rows: tier.rows, cols: tier.cols, arrows: pick.arrows };
}

// Searches for a way to clear every arrow from the given positions.
// Returns { status: 'solvable', move } (index of a good next tap),
// { status: 'stuck' } or { status: 'unknown' } if the search gave up.
function solve(rows, cols, arrows, limit = 20000) {
  const n = arrows.length;
  if (n === 0) return { status: 'solvable', move: -1 };
  const pos = arrows.map(a => a.r * cols + a.c);
  const grid = new Int16Array(rows * cols).fill(-1);
  pos.forEach((p, i) => { grid[p] = i; });
  const seen = new Set();
  let nodes = 0, aborted = false, firstMove = -1;

  function dfs(left, depth) {
    if (left === 0) return true;
    const key = pos.join(',');
    if (seen.has(key)) return false;
    if (++nodes > limit) { aborted = true; return false; }
    seen.add(key);

    const exits = [], slides = [];
    for (let i = 0; i < n; i++) {
      const p = pos[i];
      if (p < 0) continue;
      const res = slide(grid, rows, cols, (p / cols) | 0, p % cols, arrows[i].d);
      if (res.exit) exits.push(i);
      else if (res.dist > 0) slides.push(i, res.r * cols + res.c);
    }
    for (const i of exits) {
      const p = pos[i];
      grid[p] = -1; pos[i] = -1;
      const ok = dfs(left - 1, depth + 1);
      grid[p] = i; pos[i] = p;
      if (ok) { if (depth === 0) firstMove = i; return true; }
      if (aborted) return false;
    }
    for (let k = 0; k < slides.length; k += 2) {
      const i = slides[k], np = slides[k + 1], p = pos[i];
      grid[p] = -1; grid[np] = i; pos[i] = np;
      const ok = dfs(left, depth + 1);
      grid[np] = -1; grid[p] = i; pos[i] = p;
      if (ok) { if (depth === 0) firstMove = i; return true; }
      if (aborted) return false;
    }
    return false;
  }

  if (dfs(n, 0)) return { status: 'solvable', move: firstMove };
  return { status: aborted ? 'unknown' : 'stuck' };
}
