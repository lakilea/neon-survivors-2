// Procedural pixel-art car sprites + pickups. Cars face +x (right); rotated to heading in game.js.
(function () {
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; return c; }
  function rect(x, rx, ry, w, h, color) { x.fillStyle = color; x.fillRect(Math.round(rx), Math.round(ry), Math.round(w), Math.round(h)); }
  function disc(x, cx, cy, r, color) { x.fillStyle = color; for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) x.fillRect(cx + xx, cy + yy, 1, 1); }

  const PAL = {
    red: { body: '#ff5d6c', dark: '#8c2230', light: '#ffd0d6', glass: '#2a1014' },
    blue: { body: '#36d1ff', dark: '#1b6f8c', light: '#d0f4ff', glass: '#0c2630' }
  };

  function carRacer(p) {
    const L = 30, W = 18, c = mk(L + 6, W + 6), x = c.getContext('2d'); const ox = 3, oy = 3;
    rect(x, ox + 1, oy + 5, 6, 3, '#0c0c12'); rect(x, ox + 22, oy + 5, 6, 3, '#0c0c12'); // left wheels (top)
    rect(x, ox + 1, oy + W - 8, 6, 3, '#0c0c12'); rect(x, ox + 22, oy + W - 8, 6, 3, '#0c0c12'); // right wheels
    rect(x, ox + 2, oy + 4, 22, W - 8, p.dark);            // hull base
    rect(x, ox + 3, oy + 5, 20, W - 10, p.body);           // body
    // pointed nose
    rect(x, ox + 24, oy + 6, 3, W - 12, p.body); rect(x, ox + 26, oy + 7, 2, W - 14, p.dark);
    rect(x, ox + 6, oy + 6, 8, W - 12, p.glass);           // cockpit
    rect(x, ox + 4, oy + 5, 18, 1, p.light);               // top highlight
    return c;
  }
  function carStriker(p) {
    const L = 28, W = 18, c = mk(L + 6, W + 6), x = c.getContext('2d'); const ox = 3, oy = 3;
    rect(x, ox + 2, oy + 3, 5, 3, '#0c0c12'); rect(x, ox + 19, oy + 3, 5, 3, '#0c0c12');
    rect(x, ox + 2, oy + W - 6, 5, 3, '#0c0c12'); rect(x, ox + 19, oy + W - 6, 5, 3, '#0c0c12');
    rect(x, ox + 1, oy + 4, 24, W - 8, p.dark);
    rect(x, ox + 2, oy + 5, 22, W - 10, p.body);
    rect(x, ox + 23, oy + 6, 3, W - 12, p.dark);           // nose
    rect(x, ox + 6, oy + 6, 9, W - 12, p.glass);           // canopy
    rect(x, ox + 3, oy + 5, 20, 1, p.light);
    rect(x, ox + 16, oy + 7, 4, W - 14, p.light);          // accent
    return c;
  }
  function carTank(p) {
    const L = 32, W = 24, c = mk(L + 6, W + 6), x = c.getContext('2d'); const ox = 3, oy = 3;
    rect(x, ox, oy + 1, L, 5, '#0c0c12'); rect(x, ox, oy + W - 6, L, 5, '#0c0c12'); // treads
    for (let i = 0; i < L; i += 4) { rect(x, ox + i, oy + 1, 1, 5, '#23232c'); rect(x, ox + i, oy + W - 6, 1, 5, '#23232c'); }
    rect(x, ox + 2, oy + 5, L - 4, W - 10, p.dark);        // hull
    rect(x, ox + 3, oy + 6, L - 6, W - 12, p.body);
    rect(x, ox + 3, oy + 6, L - 6, 1, p.light);
    disc(x, ox + L / 2, oy + W / 2, 6, p.dark);            // turret base
    disc(x, ox + L / 2, oy + W / 2, 5, p.body);
    disc(x, ox + L / 2, oy + W / 2, 2, p.glass);
    return c;
  }
  function carBruiser(p) {
    const L = 30, W = 20, c = mk(L + 6, W + 6), x = c.getContext('2d'); const ox = 3, oy = 3;
    rect(x, ox + 2, oy + 2, 6, 3, '#0c0c12'); rect(x, ox + 20, oy + 2, 6, 3, '#0c0c12');       // fat wheels
    rect(x, ox + 2, oy + W - 5, 6, 3, '#0c0c12'); rect(x, ox + 20, oy + W - 5, 6, 3, '#0c0c12');
    rect(x, ox + 1, oy + 4, 26, W - 8, p.dark);          // hull
    rect(x, ox + 2, oy + 5, 23, W - 10, p.body);
    rect(x, ox + 2, oy + 5, 23, 1, p.light);             // top highlight
    rect(x, ox + 6, oy + 7, 8, W - 14, p.glass);         // cabin
    rect(x, ox + 24, oy + 5, 5, 4, '#1a1a22');           // twin scattergun barrels
    rect(x, ox + 24, oy + W - 9, 5, 4, '#1a1a22');
    rect(x, ox + 16, oy + 6, 3, W - 12, p.light);        // accent
    return c;
  }
  const BUILDERS = { racer: carRacer, striker: carStriker, tank: carTank, bruiser: carBruiser };

  function health() {
    const c = mk(22, 22), x = c.getContext('2d'), m = 11;
    rect(x, m - 9, m - 9, 18, 18, '#0c3b1a'); rect(x, m - 8, m - 8, 16, 16, '#1f8c45'); rect(x, m - 8, m - 8, 16, 3, '#3fd271');
    rect(x, m - 2, m - 6, 4, 12, '#eafff0'); rect(x, m - 6, m - 2, 12, 4, '#eafff0');
    return c;
  }
  function rockets() {
    const c = mk(22, 22), x = c.getContext('2d'), m = 11;
    rect(x, m - 9, m - 9, 18, 18, '#3a1a0c'); rect(x, m - 8, m - 8, 16, 16, '#a8531f'); rect(x, m - 8, m - 8, 16, 3, '#ff9a4d');
    rect(x, m - 5, m - 2, 10, 4, '#ffe9c2'); rect(x, m + 4, m - 1, 3, 2, '#ffd23f'); // missile body+tip
    rect(x, m - 6, m - 3, 2, 6, '#7a3a14');
    return c;
  }
  function nitro() {
    const c = mk(22, 22), x = c.getContext('2d'), m = 11;
    rect(x, m - 9, m - 9, 18, 18, '#0c2340'); rect(x, m - 8, m - 8, 16, 16, '#1b4a8c'); rect(x, m - 8, m - 8, 16, 3, '#36d1ff');
    rect(x, m - 1, m - 7, 3, 5, '#ffe066'); rect(x, m - 3, m - 2, 5, 2, '#ffe066'); rect(x, m - 1, m, 3, 6, '#ffe066');
    return c;
  }

  // build sprites: cars[team][veh]
  const cars = { red: {}, blue: {} };
  for (const team of ['red', 'blue']) for (const veh of ['racer', 'striker', 'tank', 'bruiser']) cars[team][veh] = BUILDERS[veh](PAL[team]);

  window.SPRITES = { cars, PAL, health: health(), rockets: rockets(), nitro: nitro() };
})();
