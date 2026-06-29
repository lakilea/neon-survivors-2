// Procedural chiptune music + SFX via Web Audio API. No asset files. Robust no-op if unsupported.
(function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) { window.AUDIO = { init() {}, startMusic() {}, stopMusic() {}, toggleMute() { return false; }, isMuted() { return false; }, sfx: new Proxy({}, { get: () => () => {} }) }; return; }

  let ctx = null, master = null, musicGain = null, sfxGain = null, muted = (localStorage.getItem('ns2_muted') === '1'), schedTimer = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.7; sfxGain.connect(master);
    } catch (e) { ctx = null; }
  }
  const now = () => ctx.currentTime;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function tone(freq, t, dur, type, peak, target) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(target || sfxGain);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(t, dur, peak, type, freq, q, target) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 1200; f.Q.value = q || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(target || sfxGain);
    src.start(t); src.stop(t + dur + 0.03);
    return { f };
  }

  // ---- looping chiptune (A-minor neon vibe): Am - F - C - G ----
  const BPM = 112, stepDur = 60 / BPM / 4;
  const bassRoots = [45, 41, 48, 43];
  const chordTones = [[69, 72, 76], [65, 69, 72], [72, 76, 79], [67, 71, 74]];
  let step = 0, nextTime = 0;
  function scheduleStep(s, t) {
    const bar = Math.floor(s / 16) % 4, w = s % 16;
    if (w % 4 === 0) tone(mtof(bassRoots[bar] - 12), t, stepDur * 3.6, 'triangle', 0.16, musicGain);
    if (w % 2 === 0) { const ct = chordTones[bar], oct = w >= 8 ? 12 : 0; tone(mtof(ct[(w / 2) % ct.length] + oct), t, stepDur * 1.6, 'square', 0.05, musicGain); }
    if (w % 2 === 1) noise(t, 0.03, 0.035, 'highpass', 6500, 1, musicGain);
    if (w === 0) chordTones[bar].forEach(n => tone(mtof(n - 12), t, stepDur * 15, 'sawtooth', 0.016, musicGain));
  }
  function scheduler() { if (!ctx) return; while (nextTime < ctx.currentTime + 0.12) { scheduleStep(step, nextTime); step = (step + 1) % 64; nextTime += stepDur; } }
  function startMusic() { init(); if (!ctx || schedTimer) return; step = 0; nextTime = ctx.currentTime + 0.1; schedTimer = setInterval(scheduler, 25); }
  function stopMusic() { if (schedTimer) { clearInterval(schedTimer); schedTimer = null; } }

  function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.9; localStorage.setItem('ns2_muted', muted ? '1' : '0'); return muted; }
  function isMuted() { return muted; }

  const sfx = {
    shoot() { if (!ctx) return; const t = now(); tone(680, t, 0.08, 'square', 0.09); tone(430, t + 0.005, 0.06, 'square', 0.05); },
    shotgun() { if (!ctx) return; const t = now(); noise(t, 0.16, 0.2, 'lowpass', 1800, 1); tone(150, t, 0.12, 'square', 0.07); },
    explosion() { if (!ctx) return; const t = now(); noise(t, 0.45, 0.32, 'lowpass', 900, 1); const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4); g.gain.setValueAtTime(0.28, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45); o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + 0.48); },
    pickup() { if (!ctx) return; const t = now(); tone(660, t, 0.1, 'square', 0.11); tone(990, t + 0.08, 0.12, 'square', 0.11); },
    boost() { if (!ctx) return; const t = now(); const n = noise(t, 0.3, 0.11, 'bandpass', 500, 1.2); n.f.frequency.setValueAtTime(400, t); n.f.frequency.exponentialRampToValueAtTime(2600, t + 0.28); },
    hit() { if (!ctx) return; const t = now(); tone(300, t, 0.05, 'square', 0.045); },
    win() { if (!ctx) return; const t = now();[0, 4, 7, 12].forEach((s, i) => tone(mtof(72 + s), t + i * 0.12, 0.25, 'square', 0.12)); },
    ui() { if (!ctx) return; const t = now(); tone(520, t, 0.05, 'square', 0.06); }
  };

  window.AUDIO = { init, startMusic, stopMusic, toggleMute, isMuted, sfx };
})();
