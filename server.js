'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const SHARED = require('./public/shared.js');
const { WORLD, TICK_RATE, KILL_TARGET, MAX_PLAYERS, TEAMS, VEHICLES, VEHICLE_ORDER, OBSTACLES, BOOST, MODES } = SHARED;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, 'public')));
const PORT = process.env.PORT || 3000;

const DT = 1 / TICK_RATE;
const rooms = new Map();
let nextId = 1;
const uid = () => nextId++;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// ---------------------------------------------------------------------------
function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = ''; for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]; } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = makeRoomCode();
  const room = {
    code, state: 'lobby', hostId: null, mode: '1v1',
    players: new Map(),
    bullets: [], pickups: [],
    score: { red: 0, blue: 0 },
    pickupTimer: 0,
    winner: null
  };
  rooms.set(code, room);
  return room;
}

function smallerTeam(room) {
  let r = 0, b = 0;
  for (const p of room.players.values()) { if (p.team === 'red') r++; else b++; }
  return r <= b ? 'red' : 'blue';
}

function makePlayer(socketId, name, team) {
  return {
    id: socketId, name: (name || 'Player').slice(0, 16) || 'Player',
    vehId: 'striker', team, ready: false,
    x: 0, y: 0, heading: 0, speed: 0,
    hp: 0, maxHp: 0, alive: false, kills: 0, deaths: 0,
    input: { throttle: 0, steer: 0, aim: 0, shooting: false, boost: false },
    prevBoost: false,
    fireTimer: 0, boostTime: 0, boostCd: 0, respawnTimer: 0,
    weapon: 'gun', weaponTime: 0
  };
}

// ---------------------------------------------------------------------------
function lobbyPayload(room) {
  return {
    code: room.code, state: room.state, hostId: room.hostId, mode: room.mode,
    killTarget: KILL_TARGET,
    players: [...room.players.values()].filter(p => !p.isBot).map(p => ({ id: p.id, name: p.name, vehId: p.vehId, team: p.team, ready: p.ready }))
  };
}

let botSeq = 0;
function makeBot(team) {
  const vehId = VEHICLE_ORDER[Math.floor(Math.random() * VEHICLE_ORDER.length)];
  const bot = makePlayer('bot#' + (++botSeq), 'CPU ' + botSeq, team);
  bot.vehId = vehId; bot.isBot = true; bot.ready = true;
  bot._lx = 0; bot._ly = 0; bot._stuck = 0;
  return bot;
}
function humanCount(room) { let n = 0; for (const p of room.players.values()) if (!p.isBot) n++; return n; }
function teamCount(room, team) { let n = 0; for (const p of room.players.values()) if (p.team === team) n++; return n; }
function removeBots(room) { for (const [id, p] of room.players) if (p.isBot) room.players.delete(id); }
const emitLobby = (room) => io.to(room.code).emit('lobby', lobbyPayload(room));

function spawnPos(room, team) {
  const base = TEAMS[team].spawn;
  return { x: base.x + (Math.random() * 80 - 40), y: base.y + (Math.random() * 160 - 80) };
}

function respawnCar(room, p) {
  const v = VEHICLES[p.vehId] || VEHICLES.striker;
  const s = spawnPos(room, p.team);
  p.x = s.x; p.y = s.y;
  p.heading = p.team === 'red' ? 0 : Math.PI;
  p.speed = 0; p.maxHp = v.hp; p.hp = v.hp; p.alive = true;
  p.fireTimer = 0; p.boostTime = 0; p.respawnTimer = 0;
  p.weapon = 'gun'; p.weaponTime = 0;
}

function fillBots(room) {
  removeBots(room);
  const mode = MODES[room.mode] || MODES['1v1'];
  let target;
  if (mode.size > 0) target = mode.size;
  else target = Math.max(1, teamCount(room, 'red'), teamCount(room, 'blue')); // 'cpu' sizes to humans
  for (const t of ['red', 'blue']) {
    while (teamCount(room, t) < target && room.players.size < MAX_PLAYERS) {
      const bot = makeBot(t); room.players.set(bot.id, bot);
    }
  }
  // guarantee both teams have at least one combatant
  for (const t of ['red', 'blue']) {
    if (teamCount(room, t) === 0 && room.players.size < MAX_PLAYERS) { const bot = makeBot(t); room.players.set(bot.id, bot); }
  }
}

function startGame(room) {
  room.state = 'playing';
  room.bullets = []; room.pickups = [];
  room.score = { red: 0, blue: 0 };
  room.winner = null; room.pickupTimer = 2;
  fillBots(room);
  for (const p of room.players.values()) { p.kills = 0; p.deaths = 0; respawnCar(room, p); }
  io.to(room.code).emit('started');
}

// Computer-controlled driver: hunt nearest enemy, drive + aim + shoot, dodge walls.
function aiThink(room, bot) {
  if (!bot.alive) { bot.input.throttle = 0; bot.input.steer = 0; bot.input.shooting = false; bot.input.boost = false; return; }
  let foe = null, bd = Infinity;
  for (const p of room.players.values()) {
    if (p.team === bot.team || !p.alive) continue;
    const d = (p.x - bot.x) ** 2 + (p.y - bot.y) ** 2;
    if (d < bd) { bd = d; foe = p; }
  }
  if (!foe) { bot.input.throttle = 0; bot.input.steer = 0; bot.input.shooting = false; return; }
  const dx = foe.x - bot.x, dy = foe.y - bot.y, dist = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  bot.input.aim = ang + (Math.random() - 0.5) * 0.14;               // slight inaccuracy (beatable)
  let steer = clamp(angDiff(ang, bot.heading) / 0.7, -1, 1);
  const moved = Math.abs(bot.x - bot._lx) + Math.abs(bot.y - bot._ly);
  bot._stuck = moved < 1.5 ? bot._stuck + 1 : 0; bot._lx = bot.x; bot._ly = bot.y;
  if (bot._stuck > 5) steer = 1;                                    // slide off a wall
  bot.input.steer = steer;
  bot.input.throttle = dist > 70 ? 1 : 0.25;
  bot.input.shooting = dist < 430 && Math.abs(angDiff(ang, bot.heading)) < 0.6;
  bot.input.boost = dist > 300 && bot.boostCd === 0 && Math.random() < 0.04;
}

// ---------------------------------------------------------------------------
function circleRectHit(cx, cy, r, rect) {
  const nx = clamp(cx, rect.x - rect.w / 2, rect.x + rect.w / 2);
  const ny = clamp(cy, rect.y - rect.h / 2, rect.y + rect.h / 2);
  const dx = cx - nx, dy = cy - ny;
  return (dx * dx + dy * dy) < r * r;
}
function pointInRect(px, py, rect) {
  return px > rect.x - rect.w / 2 && px < rect.x + rect.w / 2 && py > rect.y - rect.h / 2 && py < rect.y + rect.h / 2;
}

function spawnPickup(room) {
  const types = ['health', 'rockets', 'nitro'];
  const type = types[Math.floor(Math.random() * types.length)];
  const m = 90;
  for (let tries = 0; tries < 12; tries++) {
    const x = m + Math.random() * (WORLD.w - 2 * m), y = m + Math.random() * (WORLD.h - 2 * m);
    if (!OBSTACLES.some(o => circleRectHit(x, y, 24, o))) { room.pickups.push({ id: uid(), type, x, y }); return; }
  }
}

function fire(room, p) {
  const v = VEHICLES[p.vehId] || VEHICLES.striker;
  const rockets = p.weaponTime > 0;
  const muzzle = v.radius + 6;
  const bx = p.x + Math.cos(p.input.aim) * muzzle;
  const by = p.y + Math.sin(p.input.aim) * muzzle;
  if (rockets) {
    room.bullets.push({ id: uid(), x: bx, y: by, vx: Math.cos(p.input.aim) * 460, vy: Math.sin(p.input.aim) * 460, damage: 46, radius: 6, team: p.team, owner: p.id, life: 1.6, rocket: true });
    p.fireTimer = 0.45;
  } else if (v.spread) {
    for (let i = 0; i < v.spread; i++) {
      const t = v.spread > 1 ? (i / (v.spread - 1) - 0.5) : 0;
      const a = p.input.aim + t * v.spreadArc + (Math.random() - 0.5) * 0.03;
      room.bullets.push({ id: uid(), x: bx, y: by, vx: Math.cos(a) * v.bulletSpeed, vy: Math.sin(a) * v.bulletSpeed, damage: v.damage, radius: 3.5, team: p.team, owner: p.id, life: 0.9, rocket: false });
    }
    p.fireTimer = v.fireCooldown;
  } else {
    const a = p.input.aim + (Math.random() - 0.5) * 0.04;
    room.bullets.push({ id: uid(), x: bx, y: by, vx: Math.cos(a) * v.bulletSpeed, vy: Math.sin(a) * v.bulletSpeed, damage: v.damage, radius: 3.5, team: p.team, owner: p.id, life: 1.3, rocket: false });
    p.fireTimer = v.fireCooldown;
  }
}

function killCar(room, victim, killerId) {
  victim.alive = false; victim.deaths++; victim.respawnTimer = 3;
  const killer = killerId && room.players.get(killerId);
  if (killer && killer !== victim && killer.team !== victim.team) {
    killer.kills++;
    room.score[killer.team]++;
    if (room.score[killer.team] >= KILL_TARGET && !room.winner) {
      room.winner = killer.team;
    }
  }
}

function damageCar(room, p, dmg, srcId) {
  if (!p.alive) return;
  p.hp -= dmg;
  if (p.hp <= 0) { p.hp = 0; killCar(room, p, srcId); }
}

function updateRoom(room) {
  if (room.state !== 'playing') return;
  const players = [...room.players.values()];

  // pickups spawn over time (cap a few on the field)
  room.pickupTimer -= DT;
  if (room.pickupTimer <= 0) { room.pickupTimer = 6; if (room.pickups.length < 5) spawnPickup(room); }

  // --- cars ---
  for (const p of players) {
    if (p.isBot) aiThink(room, p);
    p.fireTimer = Math.max(0, p.fireTimer - DT);
    p.boostCd = Math.max(0, p.boostCd - DT);
    p.boostTime = Math.max(0, p.boostTime - DT);
    p.weaponTime = Math.max(0, p.weaponTime - DT);

    if (!p.alive) {
      if (p.respawnTimer > 0) { p.respawnTimer = Math.max(0, p.respawnTimer - DT); if (p.respawnTimer === 0) respawnCar(room, p); }
      continue;
    }

    const v = VEHICLES[p.vehId] || VEHICLES.striker;
    const throttle = clamp(p.input.throttle || 0, -1, 1);
    const steer = clamp(p.input.steer || 0, -1, 1);

    // boost (edge trigger)
    if (p.input.boost && !p.prevBoost && p.boostCd === 0) { p.boostTime = BOOST.time; p.boostCd = BOOST.cooldown; }
    p.prevBoost = p.input.boost;
    const boosting = p.boostTime > 0;

    // longitudinal speed
    p.speed += throttle * v.accel * DT;
    p.speed *= 0.985; // drag
    const maxF = v.maxSpeed * (boosting ? BOOST.mult : 1);
    const maxR = v.maxSpeed * 0.45;
    p.speed = clamp(p.speed, -maxR, maxF);
    if (Math.abs(p.speed) < 3 && throttle === 0) p.speed = 0;

    // steering scales with speed and reverses when going backwards
    const steerFactor = (0.35 + 0.65 * Math.min(1, Math.abs(p.speed) / v.maxSpeed)) * (p.speed < 0 ? -1 : 1);
    p.heading += steer * v.turn * DT * steerFactor;

    // integrate
    let nx = p.x + Math.cos(p.heading) * p.speed * DT;
    let ny = p.y + Math.sin(p.heading) * p.speed * DT;

    // world bounds
    nx = clamp(nx, v.radius, WORLD.w - v.radius);
    ny = clamp(ny, v.radius, WORLD.h - v.radius);

    // obstacle collision — block movement and bleed speed
    for (const o of OBSTACLES) {
      if (circleRectHit(nx, ny, v.radius, o)) {
        if (!circleRectHit(nx, p.y, v.radius, o)) ny = p.y;
        else if (!circleRectHit(p.x, ny, v.radius, o)) nx = p.x;
        else { nx = p.x; ny = p.y; }
        p.speed *= 0.4;
      }
    }
    p.x = nx; p.y = ny;

    // fire
    if (p.input.shooting && p.fireTimer === 0) fire(room, p);

    // pickups
    for (let i = room.pickups.length - 1; i >= 0; i--) {
      const pk = room.pickups[i];
      if (Math.hypot(pk.x - p.x, pk.y - p.y) < v.radius + 14) {
        if (pk.type === 'health') p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5);
        else if (pk.type === 'rockets') p.weaponTime = 9;
        else if (pk.type === 'nitro') { p.boostCd = 0; p.boostTime = BOOST.time; }
        room.pickups.splice(i, 1);
      }
    }
  }

  // --- car vs car push apart ---
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      if (!a.alive || !b.alive) continue;
      const va = VEHICLES[a.vehId], vb = VEHICLES[b.vehId];
      const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.001;
      const min = va.radius + vb.radius;
      if (d < min) {
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
        a.speed *= 0.7; b.speed *= 0.7;
      }
    }
  }

  // --- bullets ---
  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const bu = room.bullets[i];
    bu.x += bu.vx * DT; bu.y += bu.vy * DT; bu.life -= DT;
    let dead = bu.life <= 0 || bu.x < 0 || bu.x > WORLD.w || bu.y < 0 || bu.y > WORLD.h;
    if (!dead && OBSTACLES.some(o => pointInRect(bu.x, bu.y, o))) dead = true;
    if (!dead) {
      for (const p of players) {
        if (!p.alive || p.team === bu.team) continue;
        const v = VEHICLES[p.vehId];
        if (Math.hypot(p.x - bu.x, p.y - bu.y) < v.radius + bu.radius) {
          damageCar(room, p, bu.damage, bu.owner);
          if (bu.rocket) {
            // splash to nearby enemies
            for (const q of players) {
              if (q !== p && q.alive && q.team !== bu.team && Math.hypot(q.x - bu.x, q.y - bu.y) < 60) damageCar(room, q, bu.damage * 0.5, bu.owner);
            }
          }
          dead = true; break;
        }
      }
    }
    if (dead) room.bullets.splice(i, 1);
  }

  // --- win ---
  if (room.winner) {
    room.state = 'gameover';
    io.to(room.code).emit('gameover', {
      winner: room.winner, score: room.score,
      players: players.map(p => ({ name: p.name, team: p.team, vehId: p.vehId, kills: p.kills, deaths: p.deaths }))
    });
  }
}

function statePayload(room) {
  return {
    score: room.score, killTarget: KILL_TARGET,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, veh: p.vehId, team: p.team,
      x: Math.round(p.x), y: Math.round(p.y),
      heading: +p.heading.toFixed(2), aim: +p.input.aim.toFixed(2),
      hp: Math.round(p.hp), maxHp: p.maxHp, alive: p.alive,
      kills: p.kills, respawnIn: p.alive ? 0 : Math.ceil(p.respawnTimer),
      boost: p.boostTime > 0, boostReady: p.boostCd === 0, rockets: p.weaponTime > 0, bot: p.isBot ? 1 : 0
    })),
    bullets: room.bullets.map(b => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), t: b.team === 'red' ? 0 : 1, r: b.rocket ? 1 : 0 })),
    pickups: room.pickups.map(pk => ({ id: pk.id, type: pk.type, x: pk.x, y: pk.y }))
  };
}

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state === 'playing') { updateRoom(room); if (room.state === 'playing') io.to(room.code).emit('state', statePayload(room)); }
  }
}, 1000 / TICK_RATE);

// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data.roomCode = null;
  const room = () => socket.data.roomCode ? rooms.get(socket.data.roomCode) : null;

  function leaveRoom() {
    const r = room(); if (!r) return;
    r.players.delete(socket.id); socket.leave(r.code); socket.data.roomCode = null;
    const humans = [...r.players.values()].filter(p => !p.isBot);
    if (humans.length === 0) { rooms.delete(r.code); return; } // no humans left → drop room (and its bots)
    if (r.hostId === socket.id || !r.players.has(r.hostId)) r.hostId = humans[0].id;
    emitLobby(r);
  }

  socket.on('createRoom', ({ name }, cb) => {
    leaveRoom();
    const r = createRoom();
    const p = makePlayer(socket.id, String(name || ''), 'red');
    r.players.set(socket.id, p); r.hostId = socket.id;
    socket.data.roomCode = r.code; socket.join(r.code);
    cb && cb({ ok: true, code: r.code, youId: socket.id });
    emitLobby(r);
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    code = String(code || '').toUpperCase().trim();
    const r = rooms.get(code);
    if (!r) return cb && cb({ ok: false, error: 'Room not found' });
    if (r.state !== 'lobby') return cb && cb({ ok: false, error: 'Game already in progress' });
    if (r.players.size >= MAX_PLAYERS) return cb && cb({ ok: false, error: 'Room is full' });
    leaveRoom();
    const p = makePlayer(socket.id, String(name || ''), smallerTeam(r));
    r.players.set(socket.id, p);
    socket.data.roomCode = r.code; socket.join(r.code);
    cb && cb({ ok: true, code: r.code, youId: socket.id });
    emitLobby(r);
  });

  socket.on('selectVehicle', ({ vehId }) => {
    const r = room(); if (!r || r.state !== 'lobby') return;
    const p = r.players.get(socket.id); if (!p || !VEHICLES[vehId]) return;
    p.vehId = vehId; emitLobby(r);
  });

  socket.on('selectTeam', ({ team }) => {
    const r = room(); if (!r || r.state !== 'lobby') return;
    const p = r.players.get(socket.id); if (!p || !TEAMS[team]) return;
    p.team = team; emitLobby(r);
  });

  socket.on('selectMode', ({ mode }) => {
    const r = room(); if (!r || r.state !== 'lobby' || r.hostId !== socket.id) return;
    if (!MODES[mode]) return;
    r.mode = mode; emitLobby(r);
  });

  socket.on('toggleReady', () => {
    const r = room(); if (!r || r.state !== 'lobby') return;
    const p = r.players.get(socket.id); if (!p) return;
    p.ready = !p.ready; emitLobby(r);
  });

  socket.on('startGame', () => {
    const r = room(); if (!r || r.state !== 'lobby' || r.hostId !== socket.id) return;
    const players = [...r.players.values()];
    if (players.length === 0 || !players.every(p => p.ready)) return;
    startGame(r);
  });

  socket.on('input', (inp) => {
    const r = room(); if (!r || r.state !== 'playing') return;
    const p = r.players.get(socket.id); if (!p) return;
    p.input.throttle = (typeof inp.throttle === 'number' && isFinite(inp.throttle)) ? clamp(inp.throttle, -1, 1) : 0;
    p.input.steer = (typeof inp.steer === 'number' && isFinite(inp.steer)) ? clamp(inp.steer, -1, 1) : 0;
    if (typeof inp.aim === 'number' && isFinite(inp.aim)) p.input.aim = inp.aim;
    p.input.shooting = !!inp.shooting;
    p.input.boost = !!inp.boost;
  });

  socket.on('returnToLobby', () => {
    const r = room(); if (!r || r.hostId !== socket.id) return;
    r.state = 'lobby'; r.bullets = []; r.pickups = [];
    removeBots(r);
    for (const p of r.players.values()) p.ready = false;
    emitLobby(r);
  });

  socket.on('disconnect', leaveRoom);
});

server.listen(PORT, () => console.log(`\n  Neon Survivors 2 running:  http://localhost:${PORT}\n`));
