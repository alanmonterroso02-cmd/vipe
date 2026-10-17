// ============================================================
//  JUEGO VIPE - Servidor de Battle Royale (prototipo)
//  Node.js + WebSockets. Sirve el cliente y autoriza el estado.
// ============================================================
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ---------- Servidor de archivos estáticos ----------
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  const file = path.join(PUBLIC, url);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("No encontrado");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

// ============================================================
//  MAPA REPLICADO
//  ⚠ Debe coincidir EXACTAMENTE con la generación de public/game.js
//    (misma semilla y mismo orden de llamadas al azar).
// ============================================================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mapRand = mulberry32(1337);
const mr = (min, max) => min + mapRand() * (max - min);

const solids = [];
function addSolid(x, z, w, d) {
  solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}
// Edificios
for (let i = 0; i < 34; i++) {
  const x = mr(-240, 240), z = mr(-240, 240);
  const w = mr(6, 16), h = mr(4, 12), d = mr(6, 16);
  addSolid(x, z, w, d);
}
// Cajas
for (let i = 0; i < 60; i++) {
  const x = mr(-260, 260), z = mr(-260, 260);
  const s = mr(1.4, 2.6);
  addSolid(x, z, s, s);
}
// Árboles
for (let i = 0; i < 110; i++) {
  const x = mr(-280, 280), z = mr(-280, 280);
  addSolid(x, z, 1, 1);
}

function insideSolid(x, z, margin) {
  for (const b of solids) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true;
  }
  return false;
}

// ============================================================
//  Zona segura: empieza grande y se encoge por fases
// ============================================================
const ZONE_START = 300;
// Cada fase: espera "wait" segundos y luego se cierra hasta el radio "to"
// durante "shrink" segundos. La ÚLTIMA lleva el radio a 0:
// la zona se cierra POR COMPLETO y ya no hay ningún sitio seguro.
const ZONE_PHASES = [
  { to: 200, wait: 22, shrink: 26 },
  { to: 130, wait: 18, shrink: 22 },
  { to: 80,  wait: 15, shrink: 20 },
  { to: 45,  wait: 13, shrink: 18 },
  { to: 20,  wait: 11, shrink: 15 },
  { to: 0,   wait: 6,  shrink: 14 },
];
const zone = {
  x: 0, z: 0, r: ZONE_START, phase: 0, t: 0,
  from: ZONE_START, to: ZONE_START, shrinking: false,
  next: ZONE_PHASES[0].wait, closing: false, final: false,
};
const ARENA = 330;
const MAP_R = 350;
const MAX_HP = 100;
const MAX_ARMOR = 100;

// ============================================================
//  PARTIDA: límite de tiempo, zona que cierra del todo y 1 ganador
// ============================================================
const MATCH_TIME = 210;   // segundos máximos que dura una partida
const RESET_DELAY = 12;   // segundos entre el final y la siguiente partida
const round = {
  num: 1,      // número de partida
  t: 0,        // segundos transcurridos
  peak: 0,     // máximo de jugadores vivos que hubo
  over: false, // ¿la partida ha terminado?
  winner: null,
  endAt: 0,    // cuándo empieza la siguiente (timestamp)
};

function resetZone() {
  zone.r = ZONE_START;
  zone.phase = 0;
  zone.t = 0;
  zone.shrinking = false;
  zone.from = ZONE_START;
  zone.to = ZONE_START;
  zone.next = ZONE_PHASES[0].wait;
  zone.closing = false;
  zone.final = false;
}

// ============================================================
//  Loot: objetos tirados por el mapa para recoger
//  kinds: "medkit" (+40 vida) · "shield" (+50 escudo) · "weapon" (arma + cargador lleno)
// ============================================================
const loot = new Map(); // id -> {id, kind, weapon, x, z}
let nextLootId = 1;

function freeSpot(rng, maxR) {
  for (let t = 0; t < 60; t++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * maxR;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!insideSolid(x, z, 1.8)) return { x, z };
  }
  return null;
}

function generateLoot() {
  const rng = mulberry32(90210);
  let weaponSlot = 0;
  for (let i = 0; i < 64; i++) {
    // Un tercio de armas (todos empiezan desarmados), un tercio de
    // botiquines y un tercio de chalecos.
    const kind = i % 3 === 0 ? "weapon" : i % 3 === 1 ? "medkit" : "shield";
    const spot = freeSpot(rng, 275);
    if (!spot) continue;
    const id = String(nextLootId++);
    loot.set(id, {
      id,
      kind,
      weapon: kind === "weapon" ? weaponSlot++ % 3 : null,
      x: +spot.x.toFixed(2),
      z: +spot.z.toFixed(2),
    });
  }
}
generateLoot();

// ============================================================
//  Jugadores
// ============================================================
const players = new Map();
let nextId = 1;

// Busca un sitio libre y lo MÁS LEJOS posible de los demás jugadores,
// para que nadie aparezca pegado a otro.
function randomSpawn(exceptId) {
  let best = null, bestD = -1;
  for (let t = 0; t < 90; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * (ZONE_START - 30);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (insideSolid(x, z, 1.5)) continue;

    let nearest = Infinity;
    for (const p of players.values()) {
      if (p.id === exceptId) continue;
      const dd = Math.hypot(p.x - x, p.z - z);
      if (dd < nearest) nearest = dd;
    }
    if (nearest >= 95) return { x, z };   // bien separado: nos vale
    if (nearest > bestD) { bestD = nearest; best = { x, z }; }
  }
  return best || { x: Math.random() * 120 - 60, z: Math.random() * 120 - 60 };
}

function makePlayer(id, name) {
  const s = randomSpawn(id);
  return {
    id,
    name: (name || "Jugador").slice(0, 12),
    x: s.x, y: 0, z: s.z, ry: 0,
    hp: MAX_HP,
    armor: 0,
    medkits: 0,
    shields: 0,
    alive: true,
    kills: 0,
  };
}

// ---------- Cambio de partida ----------
// Resumen de la partida para el HUD del cliente
function roundInfo() {
  return {
    num: round.num,
    over: round.over,
    timeLeft: Math.max(0, Math.ceil(MATCH_TIME - round.t)),
    winner: round.winner,
    nextIn: round.over ? Math.max(0, Math.ceil((round.endAt - Date.now()) / 1000)) : 0,
  };
}

function endRound() {
  round.over = true;
  round.endAt = Date.now() + RESET_DELAY * 1000;

  // Gana el único que siga vivo. Si no queda nadie (todos muertos a la vez),
  // gana quien tenga más bajas.
  let winner = null;
  for (const p of players.values()) if (p.alive) { winner = p; break; }
  if (!winner) {
    for (const p of players.values()) if (!winner || p.kills > winner.kills) winner = p;
  }

  round.winner = winner
    ? { id: winner.id, name: winner.name, kills: winner.kills }
    : null;
  broadcast({ t: "roundOver", winner: round.winner, nextIn: RESET_DELAY, num: round.num });
}

function resetRound() {
  // Todos vuelven a nacer, con vida y escudo limpios, y el loot reaparece
  for (const p of players.values()) {
    const s = randomSpawn(p.id);
    p.x = s.x; p.y = 0; p.z = s.z; p.ry = 0;
    p.hp = MAX_HP;
    p.armor = 0;
    p.medkits = 0;
    p.shields = 0;
    p.alive = true;
    p.kills = 0;
  }
  loot.clear();
  generateLoot();
  resetZone();

  round.num++;
  round.t = 0;
  round.peak = 0;
  round.over = false;
  round.winner = null;
  round.endAt = 0;

  broadcast({ t: "roundStart", num: round.num, zone, loot: [...loot.values()] });
}

// ============================================================
//  WebSocket
// ============================================================
const wss = new WebSocketServer({ server });

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function applyDamage(target, dmg) {
  if (!target.alive) return;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, dmg);
    target.armor -= absorbed;
    dmg -= absorbed;
  }
  target.hp -= dmg;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    return true;
  }
  return false;
}

wss.on("connection", (ws) => {
  const id = String(nextId++);
  const player = makePlayer(id, "Jugador");
  players.set(id, player);

  send(ws, {
    t: "welcome",
    id,
    arena: ARENA,
    mapR: MAP_R,
    maxHp: MAX_HP,
    zone,
    loot: [...loot.values()],
    round: roundInfo(),
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const p = players.get(id);
    if (!p) return;

    switch (msg.t) {
      case "join":
        p.name = String(msg.name || "Jugador").slice(0, 12);
        break;

      case "state":
        if (typeof msg.x === "number") p.x = msg.x;
        if (typeof msg.y === "number") p.y = msg.y;
        if (typeof msg.z === "number") p.z = msg.z;
        if (typeof msg.ry === "number") p.ry = msg.ry;
        break;

      case "hit": {
        if (!p.alive) break;
        const target = players.get(String(msg.target));
        if (!target || !target.alive || target.id === p.id) break;
        const dmg = Math.max(1, Math.min(100, Number(msg.dmg) || 10));
        const died = applyDamage(target, dmg);
        if (died) {
          p.kills++;
          broadcast({ t: "kill", killer: p.name, victim: target.name, killerId: p.id, victimId: target.id });
        }
        break;
      }

      case "pickup": {
        if (!p.alive) break;
        const item = loot.get(String(msg.id));
        if (!item) break;
        // validar que está cerca
        if (Math.hypot(item.x - p.x, item.z - p.z) > 5) break;
        loot.delete(item.id);
        if (item.kind === "medkit") p.medkits++;
        else if (item.kind === "shield") p.shields++;
        broadcast({ t: "lootTaken", id: item.id, by: p.id });
        if (item.kind === "weapon") {
          send(ws, { t: "giveloot", kind: "weapon", weapon: item.weapon });
        }
        break;
      }

      case "use": {
        if (!p.alive) break;
        if (msg.item === "medkit") {
          if (p.medkits > 0 && p.hp < MAX_HP) {
            p.medkits--;
            p.hp = Math.min(MAX_HP, p.hp + 40);
            send(ws, { t: "used", item: "medkit" });
          }
        } else if (msg.item === "shield") {
          if (p.shields > 0 && p.armor < MAX_ARMOR) {
            p.shields--;
            p.armor = Math.min(MAX_ARMOR, p.armor + 50);
            send(ws, { t: "used", item: "shield" });
          }
        }
        break;
      }

      case "respawn": {
        // Battle royale: si mueres NO vuelves hasta la próxima partida
        if (!round.over) break;
        const s = randomSpawn();
        p.x = s.x; p.z = s.z; p.y = 0;
        p.hp = MAX_HP;
        p.armor = 0;
        p.alive = true;
        break;
      }
    }
  });

  ws.on("close", () => {
    players.delete(id);
    broadcast({ t: "left", id });
  });
});

// ============================================================
//  Bucle del juego
// ============================================================
let lastTick = Date.now();
let worldFresh = true; // ¿el mundo está listo para empezar una partida nueva?

function tick() {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;

  // --- ¿Cuántos siguen vivos? ---
  let aliveCount = 0;
  for (const p of players.values()) if (p.alive) aliveCount++;

  if (players.size === 0) {
    // Nadie conectado: dejamos el mundo listo para la próxima partida
    if (!worldFresh) {
      loot.clear();
      generateLoot();
      resetZone();
      round.t = 0;
      round.peak = 0;
      round.over = false;
      round.winner = null;
      round.endAt = 0;
      worldFresh = true;
    }
  } else if (!round.over) {
    worldFresh = false;
    // --- Tiempo de la partida ---
    round.t += dt;
    if (aliveCount > round.peak) round.peak = aliveCount;

    // --- Encogimiento de la zona por fases ---
    zone.t += dt;
    const ph = ZONE_PHASES[zone.phase];
    if (ph) {
      if (!zone.shrinking && zone.t >= ph.wait) {
        zone.shrinking = true;
        zone.t = 0;
        zone.from = zone.r;
        zone.to = ph.to;
      } else if (zone.shrinking) {
        const k = Math.min(1, zone.t / ph.shrink);
        zone.r = zone.from + (zone.to - zone.from) * k;
        if (k >= 1) {
          zone.shrinking = false;
          zone.t = 0;
          zone.phase++;
          zone.r = ph.to;
        }
      }
    }
    zone.final = zone.r <= 0.5;

    // --- Daño fuera de la zona (con la zona cerrada del todo hiere a TODOS,
    //     incluso a quien esté justo en el centro) ---
    const zoneDps = zone.final ? 30 : 3 + zone.phase * 1.6;
    for (const p of players.values()) {
      if (!p.alive) continue;
      const d = Math.hypot(p.x - zone.x, p.z - zone.z);
      if (zone.final || d > zone.r) {
        const died = applyDamage(p, zoneDps * dt);
        if (died) broadcast({ t: "kill", killer: "La Zona", victim: p.name, killerId: null, victimId: p.id });
      }
    }

    // --- ¿Se acaba la partida? ---
    let aliveNow = 0;
    for (const p of players.values()) if (p.alive) aliveNow++;
    aliveCount = aliveNow;

    // Solo queda 1 (o ninguno) y había una pelea real → hay ganador
    if (round.peak >= 2 && aliveNow <= 1) endRound();
    // Se acabó el tiempo → la zona ya está cerrada, se decide por daño
    else if (round.t >= MATCH_TIME) endRound();
  } else if (now >= round.endAt) {
    // Tiempo de espera terminado: empieza una partida nueva
    resetRound();
  }

  // Info para el HUD: ¿se está cerrando? ¿cuánto falta?
  const phNow = ZONE_PHASES[zone.phase];
  zone.closing = zone.shrinking;
  if (!phNow) zone.next = null;
  else zone.next = Math.max(0, (zone.shrinking ? phNow.shrink : phNow.wait) - zone.t);

  // --- Estado ---
  const list = [];
  for (const p of players.values()) {
    list.push({
      id: p.id,
      name: p.name,
      x: +p.x.toFixed(2),
      y: +p.y.toFixed(2),
      z: +p.z.toFixed(2),
      ry: +p.ry.toFixed(2),
      hp: Math.round(p.hp),
      armor: Math.round(p.armor),
      medkits: p.medkits,
      shields: p.shields,
      alive: p.alive,
      kills: p.kills,
    });
  }
  broadcast({
    t: "state",
    players: list,
    alive: aliveCount,
    zone,
    lootLeft: loot.size,
    round: roundInfo(),
  });

  setTimeout(tick, 50); // ~20 ticks por segundo
}
tick();

server.listen(PORT, () => {
  // Direcciones IPv4 de tu red local (para el móvil)
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) ips.push(ni.address);
    }
  }

  console.log("");
  console.log("  ============================================");
  console.log("   JUEGO VIPE - servidor en marcha");
  console.log("  ============================================");
  console.log("");
  console.log(`   En este PC:   http://localhost:${PORT}`);
  if (ips.length) {
    for (const ip of ips) {
      console.log(`   En el movil:  http://${ip}:${PORT}`);
    }
  } else {
    console.log("   (No se detecto red local. El movil podria no conectar.)");
  }
  console.log("");
  console.log(`   Objetos de loot en el mapa: ${loot.size}`);
  console.log("");
  console.log("   Deja esta ventana ABIERTA mientras juegas.");
  console.log("   Para parar el servidor: cierra esta ventana o pulsa Ctrl+C.");
  console.log("");
});
