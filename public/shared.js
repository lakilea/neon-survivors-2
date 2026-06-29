// Shared constants for Neon Clash — works in Node (require) and browser (window.SHARED).
(function (root, factory) {
  const data = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.SHARED = data;
})(typeof self !== 'undefined' ? self : this, function () {
  const WORLD = { w: 1280, h: 720 };
  const TICK_RATE = 30;
  const KILL_TARGET = 20;        // first team to this many kills wins
  const MAX_PLAYERS = 8;

  // Match modes. teamSize = humans+bots target per team ('cpu' sizes to the human count).
  const MODES = {
    '1v1': { id: '1v1', label: '1 v 1', size: 1 },
    '2v2': { id: '2v2', label: '2 v 2', size: 2 },
    'cpu': { id: 'cpu', label: 'vs CPU', size: 0 }
  };
  const MODE_ORDER = ['1v1', '2v2', 'cpu'];

  const TEAMS = {
    red: { id: 'red', name: 'Red', color: '#ff5d6c', spawn: { x: 170, y: 360 } },
    blue: { id: 'blue', name: 'Blue', color: '#36d1ff', spawn: { x: 1110, y: 360 } }
  };

  // Vehicle classes — distinct stats. speed px/s, accel px/s^2, turn rad/s, fireCooldown s.
  const VEHICLES = {
    racer: {
      id: 'racer', name: 'Racer', emoji: '🏎️',
      maxSpeed: 290, accel: 420, turn: 3.3, hp: 70,
      damage: 8, fireCooldown: 0.12, bulletSpeed: 640,
      w: 26, h: 14, radius: 13,
      blurb: 'Blazing fast, lightly armored.'
    },
    tank: {
      id: 'tank', name: 'Tank', emoji: '🛡️',
      maxSpeed: 180, accel: 250, turn: 1.9, hp: 170,
      damage: 26, fireCooldown: 0.5, bulletSpeed: 520,
      w: 32, h: 22, radius: 17,
      blurb: 'Heavy armor, hard-hitting cannon.'
    },
    striker: {
      id: 'striker', name: 'Striker', emoji: '⚔️',
      maxSpeed: 235, accel: 340, turn: 2.6, hp: 110,
      damage: 14, fireCooldown: 0.22, bulletSpeed: 570,
      w: 28, h: 17, radius: 15,
      blurb: 'Balanced all-round fighter.'
    },
    bruiser: {
      id: 'bruiser', name: 'Bruiser', emoji: '💥',
      maxSpeed: 205, accel: 300, turn: 2.2, hp: 135,
      damage: 7, fireCooldown: 0.46, bulletSpeed: 540,
      spread: 4, spreadArc: 0.42,        // fires 4 pellets in a shotgun arc
      w: 30, h: 20, radius: 16,
      blurb: 'Mid-weight brawler with a scattergun.'
    }
  };
  const VEHICLE_ORDER = ['racer', 'tank', 'striker', 'bruiser'];

  // Static cover obstacles (axis-aligned rectangles), symmetric layout.
  const OBSTACLES = [
    { x: 610, y: 320, w: 60, h: 80 },     // center block
    { x: 360, y: 130, w: 110, h: 26 },
    { x: 810, y: 130, w: 110, h: 26 },
    { x: 360, y: 564, w: 110, h: 26 },
    { x: 810, y: 564, w: 110, h: 26 },
    { x: 230, y: 300, w: 26, h: 120 },
    { x: 1024, y: 300, w: 26, h: 120 }
  ];

  const BOOST = { mult: 1.7, time: 1.4, cooldown: 5 };

  return { WORLD, TICK_RATE, KILL_TARGET, MAX_PLAYERS, TEAMS, VEHICLES, VEHICLE_ORDER, OBSTACLES, BOOST, MODES, MODE_ORDER };
});
