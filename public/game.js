(function () {
  'use strict';
  const { WORLD, VEHICLES, VEHICLE_ORDER, TEAMS, OBSTACLES, MODES } = window.SHARED;
  const SPRITES = window.SPRITES;
  const socket = io();

  const $ = (id) => document.getElementById(id);
  const screens = { menu: $('menu'), lobby: $('lobby'), game: $('game'), gameover: $('gameover') };
  const show = (name) => { for (const k in screens) screens[k].classList.toggle('active', k === name); };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let youId = null, myVeh = 'striker', myTeam = 'red', lobby = null;

  // ---------------- AUDIO ----------------
  const ensureAudio = () => { try { AUDIO.init(); } catch (e) {} };
  window.addEventListener('pointerdown', ensureAudio);
  window.addEventListener('keydown', ensureAudio);
  const muteBtn = $('muteBtn');
  const refreshMute = () => { muteBtn.textContent = AUDIO.isMuted() ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { ensureAudio(); AUDIO.toggleMute(); refreshMute(); };
  refreshMute();

  // ---------------- PARTICLES ----------------
  const particles = [];
  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 24; i++) { const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 220; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.45, max: 0.95, size: 2 + Math.random() * 3, color: Math.random() < 0.45 ? color : (Math.random() < 0.6 ? '#ffd23f' : '#ff7a1a'), drag: 0.9 }); }
    particles.push({ x, y, vx: 0, vy: 0, life: 0.22, max: 0.22, size: 34, color: '#ffe9a8', flash: true, drag: 1 });
    for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2, sp = 10 + Math.random() * 40; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + Math.random() * 0.4, max: 1, size: 4 + Math.random() * 4, color: 'rgba(60,60,70,0.7)', drag: 0.92 }); }
  }
  function spawnSpark(x, y, color, n) { n = n || 7; for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 100; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.2 + Math.random() * 0.25, max: 0.45, size: 1.5 + Math.random() * 1.5, color, drag: 0.9 }); } }
  function spawnFlash(x, y, ang, color) { for (let i = 0; i < 4; i++) { const a = ang + (Math.random() - 0.5) * 0.5, sp = 120 + Math.random() * 140; particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.1, max: 0.1, size: 2 + Math.random() * 2, color: color || '#fff', drag: 0.85 }); } }
  function updateParticles(dt) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= p.drag; p.vy *= p.drag; } }
  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1); ctx.globalAlpha = a * (p.flash ? 0.7 : 1); ctx.fillStyle = p.color;
      if (p.flash) { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - a) + 4, 0, 7); ctx.fill(); }
      else { ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    ctx.globalAlpha = 1;
  }

  // event detection from raw (non-interpolated) snapshots
  let prevRaw = null, lastShotAt = 0;
  function detectEvents(s) {
    if (prevRaw) {
      const prev = new Map(prevRaw.players.map(p => [p.id, p]));
      for (const p of s.players) {
        const pp = prev.get(p.id); if (!pp) continue;
        if (pp.alive && !p.alive) { spawnExplosion(pp.x, pp.y, TEAMS[p.team].color); AUDIO.sfx.explosion(); }
        if (p.id === youId && !pp.boost && p.boost) AUDIO.sfx.boost();
      }
      const cur = new Set(s.pickups.map(pk => pk.id));
      for (const pk of prevRaw.pickups) if (!cur.has(pk.id)) { spawnSpark(pk.x, pk.y, '#7cff6b', 9); AUDIO.sfx.pickup(); }
    }
    prevRaw = s;
  }
  function maybeShoot(me, aim) {
    const v = VEHICLES[me.veh] || VEHICLES.striker;
    const cd = me.rockets ? 0.45 : v.fireCooldown;
    const t = performance.now();
    if (t - lastShotAt >= cd * 1000) {
      lastShotAt = t;
      if (me.rockets) AUDIO.sfx.shoot(); else if (v.spread) AUDIO.sfx.shotgun(); else AUDIO.sfx.shoot();
      spawnFlash(me.x + Math.cos(aim) * (v.radius + 6), me.y + Math.sin(aim) * (v.radius + 6), aim, '#fff');
    }
  }

  // ---------------- MENU ----------------
  const nameInput = $('nameInput');
  nameInput.value = localStorage.getItem('nc_name') || '';
  const getName = () => { const n = nameInput.value.trim(); localStorage.setItem('nc_name', n); return n || 'Driver'; };
  const menuError = (m) => $('menuError').textContent = m || '';

  // ---- connection status (so Create/Join never fail silently) ----
  const connStatus = $('connStatus');
  function setConn(state) {
    if (state === 'connecting') { connStatus.textContent = 'Connecting to server…'; connStatus.style.color = 'var(--warn)'; }
    else if (state === 'connected') { connStatus.textContent = 'Connected ✓'; connStatus.style.color = 'var(--good)'; setTimeout(() => { if (socket.connected && connStatus.textContent === 'Connected ✓') connStatus.textContent = ''; }, 1500); }
    else if (state === 'lost') { connStatus.textContent = 'Connection lost — reconnecting…'; connStatus.style.color = 'var(--warn)'; }
    else if (state === 'error') { connStatus.textContent = 'Can’t reach the server — free hosting may be waking up (~30s). Retrying…'; connStatus.style.color = 'var(--warn)'; }
  }
  setConn('connecting');
  socket.on('connect', () => setConn('connected'));
  socket.io.on('reconnect_attempt', () => setConn('connecting'));
  socket.on('connect_error', () => setConn('error'));

  $('createBtn').onclick = () => {
    ensureAudio(); AUDIO.sfx.ui(); menuError('');
    if (!socket.connected) menuError('Still connecting to the server — one moment…');
    socket.timeout(12000).emit('createRoom', { name: getName() }, (err, res) => {
      if (err) return menuError('Server didn’t respond — it may be waking up (free hosting sleeps when idle). Wait ~30s and try again.');
      if (!res || !res.ok) return menuError(res && res.error || 'Could not create room');
      youId = res.youId;
    });
  };
  $('joinBtn').onclick = doJoin;
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
  function doJoin() {
    ensureAudio(); AUDIO.sfx.ui(); menuError('');
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 4) return menuError('Enter the 4-character room code');
    if (!socket.connected) menuError('Still connecting to the server — one moment…');
    socket.timeout(12000).emit('joinRoom', { name: getName(), code }, (err, res) => {
      if (err) return menuError('Server didn’t respond — it may be waking up (free hosting). Wait ~30s and try Join again.');
      if (!res || !res.ok) return menuError((res && res.error === 'Room not found')
        ? 'Room not found — check the code, and make sure you both opened the same link (the onrender.com URL).'
        : (res && res.error) || 'Could not join');
      youId = res.youId;
    });
  }

  // ---------------- LOBBY ----------------
  function statBar(label, val, max) { return `<div class="statrow"><span class="lbl">${label}</span><div class="bar"><i style="width:${Math.round(val / max * 100)}%"></i></div></div>`; }
  function buildVehPicker() {
    const wrap = $('vehPicker'); wrap.innerHTML = '';
    const vals = VEHICLE_ORDER.map(id => VEHICLES[id]);
    const mSpd = Math.max(...vals.map(v => v.maxSpeed)), mHp = Math.max(...vals.map(v => v.hp)), mDmg = Math.max(...vals.map(v => v.damage * (1 / v.fireCooldown)));
    for (const id of VEHICLE_ORDER) {
      const v = VEHICLES[id];
      const card = document.createElement('div');
      card.className = 'veh-card' + (id === myVeh ? ' selected' : '');
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 40;
      const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
      const spr = SPRITES.cars[myTeam][id];
      const sc = Math.min(64 / spr.width, 40 / spr.height);
      cx.drawImage(spr, (64 - spr.width * sc) / 2, (40 - spr.height * sc) / 2, spr.width * sc, spr.height * sc);
      card.appendChild(cv);
      const info = document.createElement('div');
      info.innerHTML = `<div class="vname">${v.emoji} ${v.name}</div><div class="vblurb">${v.blurb}</div>` +
        `<div class="statbars">${statBar('SPD', v.maxSpeed, mSpd)}${statBar('HP', v.hp, mHp)}${statBar('DPS', v.damage / v.fireCooldown, mDmg)}</div>`;
      card.appendChild(info);
      card.onclick = () => { myVeh = id; socket.emit('selectVehicle', { vehId: id }); buildVehPicker(); };
      wrap.appendChild(card);
    }
  }
  document.querySelectorAll('.team-btn').forEach(b => b.onclick = () => { myTeam = b.dataset.team; socket.emit('selectTeam', { team: myTeam }); });
  document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => { if (!lobby || lobby.hostId !== youId) return; AUDIO.sfx.ui(); socket.emit('selectMode', { mode: b.dataset.mode }); });
  const MODE_HINTS = { '1v1': '1 per team — an empty slot is filled by a CPU bot.', '2v2': '2 per team — empty slots filled by CPU bots.', 'cpu': 'You (and any friends) vs a team of CPU bots.' };

  function renderLobby() {
    if (!lobby) return;
    $('roomCode').textContent = lobby.code;
    $('killTarget').textContent = lobby.killTarget;
    const isHostMode = lobby.hostId === youId;
    document.querySelectorAll('.mode-btn').forEach(b => { b.classList.toggle('sel', b.dataset.mode === lobby.mode); b.disabled = !isHostMode; });
    $('modeHint').textContent = (MODE_HINTS[lobby.mode] || '') + (isHostMode ? '' : '  (host picks the mode)');
    document.querySelectorAll('.team-btn').forEach(b => b.classList.toggle('sel', b.dataset.team === myTeam));
    for (const team of ['red', 'blue']) {
      const ul = $(team + 'List'); ul.innerHTML = '';
      lobby.players.filter(p => p.team === team).forEach(p => {
        const v = VEHICLES[p.vehId] || VEHICLES.striker;
        const li = document.createElement('li');
        li.innerHTML = `<span class="pname">${escapeHtml(p.name)}${p.id === youId ? ' (you)' : ''}</span>` +
          (p.id === lobby.hostId ? '<span class="host-tag">HOST</span>' : '') +
          `<span class="pveh">${v.emoji}</span><span class="pready">${p.ready ? '✅' : '⬜'}</span>`;
        ul.appendChild(li);
      });
    }
    const me = lobby.players.find(p => p.id === youId);
    if (me) { myVeh = me.vehId; myTeam = me.team; }
    const isHost = lobby.hostId === youId;
    $('readyBtn').textContent = me && me.ready ? 'Unready' : 'Ready';
    $('readyBtn').classList.toggle('primary', !(me && me.ready));
    const allReady = lobby.players.length > 0 && lobby.players.every(p => p.ready);
    $('startBtn').style.display = isHost ? '' : 'none';
    $('startBtn').disabled = !allReady;
    $('lobbyHint').textContent = isHost ? (allReady ? 'All ready — start the battle!' : 'Waiting for everyone to ready up…') : 'Only the host can start.';
  }
  $('readyBtn').onclick = () => { AUDIO.sfx.ui(); socket.emit('toggleReady'); };
  $('startBtn').onclick = () => { AUDIO.sfx.ui(); socket.emit('startGame'); };
  $('leaveBtn').onclick = () => location.reload();
  $('copyBtn').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(lobby.code); $('copyBtn').textContent = 'Copied!'; setTimeout(() => $('copyBtn').textContent = 'Copy', 1200); };

  // ---------------- SOCKET ----------------
  socket.on('lobby', (data) => {
    lobby = data;
    const me = data.players.find(p => p.id === youId);
    if (me) { myVeh = me.vehId; myTeam = me.team; }
    if (data.state === 'lobby') { buildVehPicker(); renderLobby(); show('lobby'); AUDIO.startMusic(); }
  });
  socket.on('started', () => { startGameLoop(); show('game'); });
  socket.on('state', (s) => pushSnapshot(s));
  socket.on('gameover', (data) => {
    stopGameLoop();
    AUDIO.sfx.win();
    const t = $('winnerTitle'); t.textContent = (data.winner === 'red' ? 'RED' : 'BLUE') + ' TEAM WINS';
    t.className = 'over ' + data.winner;
    $('overSummary').textContent = `Final score — Red ${data.score.red} : ${data.score.blue} Blue`;
    const ul = $('overStats'); ul.innerHTML = '';
    data.players.sort((a, b) => b.kills - a.kills).forEach(p => {
      const v = VEHICLES[p.vehId] || VEHICLES.striker;
      const li = document.createElement('li');
      li.innerHTML = `<span class="dot" style="background:${TEAMS[p.team].color}"></span><span class="pname">${escapeHtml(p.name)} ${v.emoji}</span><span class="kd">${p.kills} K / ${p.deaths} D</span>`;
      ul.appendChild(li);
    });
    const isHost = lobby && lobby.hostId === youId;
    $('lobbyBtn').style.display = isHost ? '' : 'none';
    $('overWait').textContent = isHost ? '' : 'Waiting for the host…';
    show('gameover');
  });
  $('lobbyBtn').onclick = () => socket.emit('returnToLobby');
  socket.on('disconnect', () => { stopGameLoop(); setConn('lost'); show('menu'); });

  // ---------------- INPUT ----------------
  const canvas = $('canvas'); const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
  const keys = {}; const mouse = { x: WORLD.w / 2, y: WORLD.h / 2, down: false };
  window.addEventListener('keydown', (e) => { keys[e.code] = true; if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && screens.game.classList.contains('active')) e.preventDefault(); });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  function canvasToWorld(cx, cy) { const r = canvas.getBoundingClientRect(); return { x: (cx - r.left) / r.width * WORLD.w, y: (cy - r.top) / r.height * WORLD.h }; }
  canvas.addEventListener('mousemove', (e) => { const w = canvasToWorld(e.clientX, e.clientY); mouse.x = w.x; mouse.y = w.y; });
  canvas.addEventListener('mousedown', () => { mouse.down = true; });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // touch
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const STICK_R = 70;
  const touch = { move: { active: false, id: null, bx: 0, by: 0, x: 0, y: 0 }, aim: { active: false, id: null, bx: 0, by: 0, x: 0, y: 0 }, boostDown: false, boostPid: null, boostBtn: { x: WORLD.w - 120, y: WORLD.h - 110, r: 52 } };
  const stickVec = (s) => { let dx = s.x - s.bx, dy = s.y - s.by; const len = Math.hypot(dx, dy); if (len > 0) { dx /= len; dy /= len; } return { dx, dy, len, mag: Math.min(len, STICK_R) / STICK_R }; };
  if (isTouch) {
    document.body.classList.add('touch');
    canvas.style.cursor = 'none';
    const fsBtn = $('fsBtn');
    if (fsBtn) fsBtn.addEventListener('click', () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && !document.webkitFullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
      else (document.exitFullscreen || document.webkitExitFullscreen || (() => {})).call(document);
    });
    const onDown = (e) => {
      if (e.pointerType === 'mouse' || !screens.game.classList.contains('active')) return; e.preventDefault();
      const w = canvasToWorld(e.clientX, e.clientY); const b = touch.boostBtn;
      if (Math.hypot(w.x - b.x, w.y - b.y) < b.r) { touch.boostDown = true; touch.boostPid = e.pointerId; return; }
      const s = w.x < WORLD.w / 2 ? touch.move : touch.aim;
      s.active = true; s.id = e.pointerId; s.bx = s.x = w.x; s.by = s.y = w.y;
    };
    const onMove = (e) => {
      if (e.pointerType === 'mouse') return; const w = canvasToWorld(e.clientX, e.clientY);
      if (touch.move.active && touch.move.id === e.pointerId) { touch.move.x = w.x; touch.move.y = w.y; e.preventDefault(); }
      else if (touch.aim.active && touch.aim.id === e.pointerId) { touch.aim.x = w.x; touch.aim.y = w.y; e.preventDefault(); }
    };
    const onUp = (e) => {
      if (e.pointerType === 'mouse') return;
      if (touch.boostPid === e.pointerId) { touch.boostDown = false; touch.boostPid = null; }
      if (touch.move.id === e.pointerId) { touch.move.active = false; touch.move.id = null; }
      if (touch.aim.id === e.pointerId) { touch.aim.active = false; touch.aim.id = null; }
    };
    canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  }

  let inputTimer = null;
  const startInput = () => { if (!inputTimer) inputTimer = setInterval(sendInput, 1000 / 30); };
  const stopInput = () => { clearInterval(inputTimer); inputTimer = null; };
  function sendInput() {
    const me = currentMe();
    let throttle = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    let steer = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    let shooting = mouse.down || !!keys['Enter'];
    let boost = !!keys['Space'] || touch.boostDown;
    let aim = 0, aimSet = false;
    if (touch.move.active) {
      const v = stickVec(touch.move);
      if (v.mag > 0.12) { throttle = v.mag; if (me) steer = clamp(angDiff(Math.atan2(v.dy, v.dx), me.heading) / 0.7, -1, 1); }
    }
    if (touch.aim.active) { const v = stickVec(touch.aim); aim = Math.atan2(v.dy, v.dx); aimSet = true; if (v.len > 14) shooting = true; }
    if (!aimSet && me) aim = Math.atan2(mouse.y - me.y, mouse.x - me.x);
    if (shooting && me && me.alive) maybeShoot(me, aim);
    socket.emit('input', { throttle, steer, aim, shooting, boost });
  }

  // ---------------- SNAPSHOTS / INTERP ----------------
  const INTERP_DELAY = 90; let snaps = [], latest = null;
  const pushSnapshot = (s) => { latest = s; detectEvents(s); snaps.push({ t: performance.now(), s }); if (snaps.length > 30) snaps.shift(); };
  const currentMe = () => latest ? latest.players.find(p => p.id === youId) : null;
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpAng = (a, b, t) => a + angDiff(b, a) * t;
  function sampleState() {
    if (!snaps.length) return null;
    const rt = performance.now() - INTERP_DELAY;
    let o = snaps[0], n = snaps[snaps.length - 1];
    for (let i = 0; i < snaps.length - 1; i++) if (snaps[i].t <= rt && snaps[i + 1].t >= rt) { o = snaps[i]; n = snaps[i + 1]; break; }
    const span = n.t - o.t || 1, al = clamp((rt - o.t) / span, 0, 1);
    return interp(o.s, n.s, al);
  }
  function interp(a, b, al) {
    const map = (arr) => { const m = new Map(); for (const e of arr) m.set(e.id, e); return m; };
    const out = { score: b.score, killTarget: b.killTarget, pickups: b.pickups };
    const pa = map(a.players);
    out.players = b.players.map(pb => { const p0 = pa.get(pb.id); return p0 ? { ...pb, x: lerp(p0.x, pb.x, al), y: lerp(p0.y, pb.y, al), heading: lerpAng(p0.heading, pb.heading, al), aim: lerpAng(p0.aim, pb.aim, al) } : pb; });
    const ba = map(a.bullets);
    out.bullets = b.bullets.map(bb => { const b0 = ba.get(bb.id); return b0 ? { ...bb, x: lerp(b0.x, bb.x, al), y: lerp(b0.y, bb.y, al) } : bb; });
    return out;
  }

  // ---------------- RENDER ----------------
  let raf = null, lastT = performance.now();
  function startGameLoop() { snaps = []; latest = null; prevRaw = null; particles.length = 0; lastT = performance.now(); document.body.classList.add('ingame'); startInput(); if (!raf) raf = requestAnimationFrame(render); }
  function stopGameLoop() { document.body.classList.remove('ingame'); stopInput(); if (raf) cancelAnimationFrame(raf); raf = null; }

  let bgCanvas = null;
  function mulberry32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function buildBackground() {
    const c = document.createElement('canvas'); c.width = WORLD.w; c.height = WORLD.h; const x = c.getContext('2d');
    x.fillStyle = '#10131c'; x.fillRect(0, 0, WORLD.w, WORLD.h);
    // asphalt tint + grid
    x.strokeStyle = 'rgba(120,140,200,0.06)'; x.lineWidth = 1; x.beginPath();
    for (let gx = 0; gx <= WORLD.w; gx += 64) { x.moveTo(gx, 0); x.lineTo(gx, WORLD.h); }
    for (let gy = 0; gy <= WORLD.h; gy += 64) { x.moveTo(0, gy); x.lineTo(WORLD.w, gy); }
    x.stroke();
    // team-colored base zones
    const g1 = x.createLinearGradient(0, 0, 260, 0); g1.addColorStop(0, 'rgba(255,93,108,0.10)'); g1.addColorStop(1, 'rgba(255,93,108,0)'); x.fillStyle = g1; x.fillRect(0, 0, 260, WORLD.h);
    const g2 = x.createLinearGradient(WORLD.w, 0, WORLD.w - 260, 0); g2.addColorStop(0, 'rgba(54,209,255,0.10)'); g2.addColorStop(1, 'rgba(54,209,255,0)'); x.fillStyle = g2; x.fillRect(WORLD.w - 260, 0, 260, WORLD.h);
    // scattered specks
    const rnd = mulberry32(99); for (let i = 0; i < 90; i++) { x.fillStyle = 'rgba(150,170,220,0.05)'; x.fillRect(rnd() * WORLD.w, rnd() * WORLD.h, 2, 2); }
    return c;
  }
  function drawObstacles() {
    for (const o of OBSTACLES) {
      ctx.fillStyle = '#2a2f44'; ctx.fillRect(o.x - o.w / 2 - 2, o.y - o.h / 2 - 2, o.w + 4, o.h + 4);
      ctx.fillStyle = '#3c425e'; ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(o.x - o.w / 2, o.y - o.h / 2, o.w, 3);
      // hazard stripes
      ctx.fillStyle = 'rgba(255,210,63,0.5)';
      for (let s = -o.w / 2; s < o.w / 2; s += 12) ctx.fillRect(o.x + s, o.y + o.h / 2 - 3, 6, 3);
    }
  }
  function drawBackground() { if (!bgCanvas) bgCanvas = buildBackground(); ctx.drawImage(bgCanvas, 0, 0); ctx.strokeStyle = 'rgba(120,140,200,0.25)'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, WORLD.w - 4, WORLD.h - 4); }

  function hpBar(x, y, w, frac, color) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 1, y - 1, w + 2, 5); ctx.fillStyle = '#3a0d1a'; ctx.fillRect(x, y, w, 3); ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, frac), 3); }

  function render() {
    raf = requestAnimationFrame(render);
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    updateParticles(dt);
    const st = sampleState(); drawBackground();
    if (!st) { drawParticles(); return; }

    drawObstacles();

    // pickups
    for (const pk of st.pickups) {
      const spr = SPRITES[pk.type] || SPRITES.health;
      const bob = Math.sin(now / 350 + pk.id) * 2;
      ctx.drawImage(spr, Math.round(pk.x - 11), Math.round(pk.y - 11 + bob));
    }

    // bullets
    for (const b of st.bullets) {
      const col = b.t === 0 ? '#ff8a93' : '#8ad9ff';
      ctx.fillStyle = b.r ? '#ffd23f' : col; ctx.beginPath(); ctx.arc(b.x, b.y, b.r ? 5 : 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = b.r ? 'rgba(255,210,63,.3)' : 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r ? 8 : 6, 0, 7); ctx.fill();
    }

    // cars
    for (const p of st.players) {
      const v = VEHICLES[p.veh] || VEHICLES.striker;
      const spr = SPRITES.cars[p.team][p.veh] || SPRITES.cars[p.team].striker;
      if (!p.alive) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Segoe UI'; ctx.textAlign = 'center';
        ctx.fillText(p.respawnIn > 0 ? 'Respawn ' + p.respawnIn : '💥', p.x, p.y);
        continue;
      }
      // boost flame trail (emit particles behind the car)
      if (p.boost) {
        const fx = p.x - Math.cos(p.heading) * (v.radius + 2), fy = p.y - Math.sin(p.heading) * (v.radius + 2);
        particles.push({ x: fx, y: fy, vx: -Math.cos(p.heading) * 70 + (Math.random() - 0.5) * 50, vy: -Math.sin(p.heading) * 70 + (Math.random() - 0.5) * 50, life: 0.32, max: 0.32, size: 3 + Math.random() * 3, color: Math.random() < 0.5 ? '#ffb43c' : '#ff6a00', drag: 0.9 });
      }
      // drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + 3, v.radius, v.radius * 0.7, 0, 0, 7); ctx.fill();
      // body
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.heading);
      ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
      ctx.restore();
      // turret barrel toward aim
      ctx.strokeStyle = p.rockets ? '#ffd23f' : '#e7ecff'; ctx.lineWidth = p.veh === 'tank' ? 5 : 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.aim) * (v.radius + 8), p.y + Math.sin(p.aim) * (v.radius + 8)); ctx.stroke();
      // name + hp
      ctx.fillStyle = p.id === youId ? '#fff' : TEAMS[p.team].color; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(p.name + (p.id === youId ? '' : ''), p.x, p.y - v.radius - 12);
      hpBar(p.x - 16, p.y - v.radius - 9, 32, p.hp / p.maxHp, TEAMS[p.team].color);
      if (p.id === youId) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, v.radius + 4, 0, 7); ctx.stroke(); }
    }

    drawParticles();
    if (isTouch) drawTouch(st);
    $('redScore').textContent = st.score.red; $('blueScore').textContent = st.score.blue;
  }

  function drawStick(s, color) {
    if (!s.active) return;
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.bx, s.by, STICK_R, 0, 7); ctx.stroke();
    let dx = s.x - s.bx, dy = s.y - s.by; const len = Math.hypot(dx, dy), m = Math.min(len, STICK_R); if (len > 0) { dx = dx / len * m; dy = dy / len * m; }
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(s.bx + dx, s.by + dy, 26, 0, 7); ctx.fill();
  }
  function drawTouch(st) {
    const me = st.players.find(p => p.id === youId);
    drawStick(touch.move, 'rgba(124,255,107,0.5)');
    drawStick(touch.aim, 'rgba(255,93,143,0.6)');
    const b = touch.boostBtn, ready = me ? me.boostReady : true;
    ctx.fillStyle = ready ? 'rgba(255,210,63,0.22)' : 'rgba(140,140,160,0.15)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
    ctx.strokeStyle = ready ? '#ffd23f' : '#6a6f88'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 14px Segoe UI'; ctx.fillText('BOOST', b.x, b.y + 5);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.font = 'bold 14px Segoe UI';
    if (!touch.move.active) ctx.fillText('◄ DRIVE', WORLD.w * 0.25, WORLD.h - 36);
    if (!touch.aim.active) ctx.fillText('AIM / FIRE ►', WORLD.w * 0.70, WORLD.h - 36);
  }

  show('menu');
})();
