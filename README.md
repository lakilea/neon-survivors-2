# 🚗 Neon Survivors 2

Online **team vehicular combat** in the browser — Red vs Blue. Drive a pixel-art car with an
independent turret, shoot the other team, and respawn when you're wrecked. First team to the
kill target wins. Now with **chiptune music + sound effects** and lots of **explosive detail**.

## Play
- **Drive:** `W` accelerate · `S` brake/reverse · `A`/`D` steer
- **Aim & shoot:** mouse (hold to fire) — your turret aims separately from where you're driving
- **Boost:** `Space` (short nitro burst, then cools down)
- **Mute:** 🔊 button (top-right)
- **Mobile:** left thumb drives (point where to go), right thumb aims & fires, BOOST button bottom-right. Best in landscape.

Grab pickups on the open arena: 💚 health · 🚀 rockets (temporary heavy weapon) · ⚡ nitro (instant boost).

### Vehicle classes (pick in the lobby)
| | Class | Profile |
|---|---|---|
| 🏎️ | **Racer** | Fast, fragile, rapid fire |
| 🛡️ | **Tank** | Slow, heavily armored, big cannon |
| ⚔️ | **Striker** | Balanced all-rounder |
| 💥 | **Bruiser** | Mid-weight brawler with a 4-pellet **scattergun** |

## Detail / juice
- Procedural **chiptune soundtrack** (Web Audio, no files) + SFX: shooting, shotgun, explosions, pickups, boost, victory
- **Explosions**, smoke, muzzle flashes, boost flame trails, pickup sparkles, car drop-shadows

## Run it
```
npm install      # first time only
npm start
```
Then open **http://localhost:3000** (or double-click `start-game.bat`). To test solo, open two
browser tabs — create a room in one, join with the code in the other, both Ready, then Start.

## Tech
- **Client:** HTML5 Canvas + vanilla JS, procedural pixel-art cars & audio (no asset files), client-side interpolation
- **Server:** Node.js + Socket.IO, authoritative 30 Hz simulation (arcade car physics, obstacles, scoring)
- **Files:** `server.js`, `public/` (`index.html`, `style.css`, `sprites.js`, `audio.js`, `game.js`, `shared.js`)
