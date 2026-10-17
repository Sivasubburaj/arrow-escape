/* Arrow Escape — synthesized sound effects (no audio files needed). */
'use strict';

const Sound = (() => {
  let ctx = null, master = null, enabled = true;

  function ready() {
    if (!enabled) return false;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.3;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function tone(freq, { dur = 0.15, type = 'sine', vol = 0.5, delay = 0, to = 0 } = {}) {
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Each escape in a combo climbs one step up a pentatonic scale from C5.
  const PENTA = [0, 2, 4, 7, 9];
  const note = step => 523.25 * Math.pow(2, (Math.floor(step / 5) * 12 + PENTA[step % 5]) / 12);

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },
    unlock() { ready(); },
    exit(combo) {
      if (!ready()) return;
      const f = note(Math.min(combo, 12));
      tone(f, { dur: 0.25, type: 'triangle', vol: 0.5 });
      tone(f * 2, { dur: 0.12, vol: 0.12, delay: 0.015 });
    },
    slide() {
      if (!ready()) return;
      tone(320, { dur: 0.1, vol: 0.35, to: 240 });
    },
    bonk() {
      if (!ready()) return;
      tone(150, { dur: 0.14, type: 'square', vol: 0.12, to: 80 });
      tone(95, { dur: 0.2, vol: 0.45, to: 55 });
    },
    undo() {
      if (!ready()) return;
      tone(620, { dur: 0.12, vol: 0.25, to: 380 });
    },
    hint() {
      if (!ready()) return;
      tone(880, { dur: 0.3, vol: 0.18 });
      tone(1320, { dur: 0.35, vol: 0.12, delay: 0.08 });
    },
    click() {
      if (!ready()) return;
      tone(720, { dur: 0.05, vol: 0.15 });
    },
    win() {
      if (!ready()) return;
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        tone(f, { dur: 0.35, type: 'triangle', vol: 0.4, delay: i * 0.085 });
      });
      tone(1567.98, { dur: 0.7, vol: 0.18, delay: 0.45 });
    },
  };
})();
