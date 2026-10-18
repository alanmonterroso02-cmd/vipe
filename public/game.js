// ============================================================
//  JUEGO VIPE - Cliente (Three.js + WebSocket)  [PC + Móvil]
// ============================================================
import * as THREE from "three";

// ------------------------- Detección de dispositivo -------------------------
const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
const isMobile = isTouch && Math.min(innerWidth, innerHeight) < 1000;

// ------------------------- Ajustes (se guardan en el navegador) -------------------------
const DEFAULT_SETTINGS = {
  sens: isTouch ? 0.0042 : 0.0024, // sensibilidad de cámara (arrastrar / ratón)
  gain: 5.5,                       // velocidad del joystick de apuntado
  autoAim: true,                   // auto apuntado hacia el enemigo
  autoAimStrength: 0.6,            // 0..1
};
let settings = { ...DEFAULT_SETTINGS };
try {
  const saved = JSON.parse(localStorage.getItem("jv_settings") || "null");
  if (saved) settings = { ...settings, ...saved };
} catch { /* sin ajustes guardados */ }

function saveSettings() {
  try { localStorage.setItem("jv_settings", JSON.stringify(settings)); } catch { /* ignore */ }
}

let settingsOpen = false;
let aimLock = false; // el auto apuntado tiene un enemigo fijado
let lastZone = null; // último estado de la zona que mandó el servidor

// ------------------------- Red -------------------------
const WS_URL = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
let ws = null;
let myId = null;
let intentionalLeave = false; // el jugador salió al menú a propósito
let joined = false; // el jugador está dentro de la partida (no en el menú)
let myName = "Jugador";
let myHp = 100;
let myArmor = 0;
let myMedkits = 0;
let myShields = 0;
let myKills = 0;
let aliveCount = 0;
let matchRound = null; // estado de la partida que manda el servidor
const MAX_HP = 100;

// ------------------------- Three.js -------------------------
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: "high-performance" });
renderer.setPixelRatio(isMobile ? Math.min(devicePixelRatio, 1.5) : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7ff);
scene.fog = new THREE.Fog(0x8fc7ff, 140, isMobile ? 340 : 460);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 1000);

scene.add(new THREE.HemisphereLight(0xffffff, 0x3a5a2a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(60, 100, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
const S = 260;
sun.shadow.camera.left = -S;
sun.shadow.camera.right = S;
sun.shadow.camera.top = S;
sun.shadow.camera.bottom = -S;
sun.shadow.camera.far = 500;
scene.add(sun);

// Suelo
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(700, 700),
  new THREE.MeshStandardMaterial({ color: 0x4f8b3e })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ------------------------- Mapa (semilla fija = igual para todos) -------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
const rr = (min, max) => min + rand() * (max - min);

const solids = [];
const worldObjects = []; // objetos contra los que chocan las balas (para puntería)
worldObjects.push(ground); // el suelo también detiene las balas

function addSolid(x, z, w, d) {
  solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
}

function addBox(x, z, w, h, d, color) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.85 })
  );
  m.position.set(x, h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  worldObjects.push(m);
  addSolid(x, z, w, d);
}

function addTree(x, z) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, 3.5, 7),
    new THREE.MeshStandardMaterial({ color: 0x6b4423 })
  );
  trunk.position.set(x, 1.75, z);
  trunk.castShadow = true;
  scene.add(trunk);
  worldObjects.push(trunk);
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(2.4, 5, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f7a34 })
  );
  leaf.position.set(x, 5.2, z);
  leaf.castShadow = true;
  scene.add(leaf);
  worldObjects.push(leaf);
  addSolid(x, z, 1, 1);
}

// ⚠ Estas cantidades y rangos deben coincidir con el servidor (server.js)
for (let i = 0; i < 34; i++) {
  const x = rr(-240, 240), z = rr(-240, 240);
  const w = rr(6, 16), h = rr(4, 12), d = rr(6, 16);
  addBox(x, z, w, h, d, 0x9aa3ad);
}
for (let i = 0; i < 60; i++) {
  const x = rr(-260, 260), z = rr(-260, 260);
  const s = rr(1.4, 2.6);
  addBox(x, z, s, s, s, 0xb5893f);
}
for (let i = 0; i < 110; i++) addTree(rr(-280, 280), rr(-280, 280));

// ------------------------- Zona (el círculo) -------------------------
const zoneWall = new THREE.Mesh(
  new THREE.CylinderGeometry(1, 1, 70, 96, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x33ccff, transparent: true, opacity: 0.18, side: THREE.DoubleSide })
);
zoneWall.position.y = 35;
scene.add(zoneWall);

// ------------------------- Loot -------------------------
const lootMeshes = new Map(); // id -> grupo 3D
const LOOT_STYLE = {
  medkit: { color: 0x2ecc71, emoji: "🩹", label: "Botiquín" },
  shield: { color: 0x3498db, emoji: "🛡️", label: "Chaleco" },
  weapon: { color: 0xffc93c, emoji: "🔫", label: "Arma" },
};

function makeEmojiSprite(emoji) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  ctx.font = "92px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.3, 1.3, 1);
  return sp;
}

function addLootMesh(item) {
  if (lootMeshes.has(item.id)) return;
  const style = LOOT_STYLE[item.kind] || LOOT_STYLE.medkit;
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshStandardMaterial({ color: style.color, emissive: style.color, emissiveIntensity: 0.45, roughness: 0.5 })
  );
  box.position.y = 0.55;
  box.castShadow = true;
  g.add(box);
  const sp = makeEmojiSprite(style.emoji);
  sp.position.y = 1.75;
  g.add(sp);
  g.position.set(item.x, 0, item.z);
  g.userData = { box, kind: item.kind, weapon: item.weapon, phase: Math.random() * 6.28 };
  scene.add(g);
  lootMeshes.set(item.id, g);
}

function removeLootMesh(id) {
  const g = lootMeshes.get(id);
  if (!g) return;
  scene.remove(g);
  lootMeshes.delete(id);
}

// ------------------------- Jugadores -------------------------
function makeLabel(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 34px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, 128, 44);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(3, 0.75, 1);
  return sprite;
}

// Medidas del gatito (en unidades del mundo)
const CAT_HIP_Y = 0.62;      // altura de la cadera de pie (2 patas)
const CAT_RUN_HIP_Y = 0.72;  // altura de la cadera a 4 patas
const CAT_RUN_PITCH = -1.35; // cuánto se tumba el cuerpo al correr a 4 patas
const CAT_ARM_LEN = 0.54;    // del hombro a la pata delantera
const CAT_LEG_LEN = 0.47;    // de la cadera a la pata trasera
const CAT_ARM_PIVOT = { y: 0.43, z: -0.26 }; // hombro, relativo a la cadera
const CAT_LEG_PIVOT = { y: -0.16, z: 0.02 }; // cadera, relativo a la cadera

// Cada personaje es un GATO montado en grupos ("huesos") para poder animarlo:
//   rig  -> tronco + cabeza + patas delanteras + cola + arma (se inclina al correr)
//   legs -> las 2 patas traseras
// Delante es -z y su derecha es +x (lo mismo que usa el arma).
function makeAvatar(color) {
  const g = new THREE.Group();
  const furColor = new THREE.Color(color);
  const fur = new THREE.MeshStandardMaterial({ color: furColor, roughness: 0.85 });
  const lightFur = new THREE.MeshStandardMaterial({
    color: furColor.clone().lerp(new THREE.Color(0xffffff), 0.55),
    roughness: 0.85,
  });
  const pink = new THREE.MeshStandardMaterial({ color: 0xff9db3, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x241f1c, roughness: 0.6 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });

  // Grupo del cuerpo: todo lo que se tumba al ir a 4 patas
  const rig = new THREE.Group();
  rig.position.y = CAT_HIP_Y;
  g.add(rig);

  // --- tronco ---
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.40, 0.55, 8, 16), fur);
  body.position.y = 0.10;
  body.castShadow = true;
  body.userData.isBody = true;
  rig.add(body);

  // barriga clara
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.30, 14, 12), lightFur);
  belly.position.set(0, 0, -0.16);
  belly.scale.set(1, 1.15, 0.6);
  rig.add(belly);

  // --- cabeza (grupo propio: al correr se endereza sola) ---
  const head = new THREE.Group();
  head.position.y = 0.84;
  rig.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16), fur);
  skull.castShadow = true;
  head.add(skull);

  // morro claro + naricita rosa
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.20, 14, 12), lightFur);
  muzzle.position.set(0, -0.10, -0.32);
  muzzle.scale.set(1, 0.8, 0.75);
  head.add(muzzle);

  const catNose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), pink);
  catNose.position.set(0, -0.04, -0.47);
  head.add(catNose);

  // ojos con pupila
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 10), eyeWhite);
    eye.position.set(s * 0.17, 0.09, -0.33);
    head.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), dark);
    pupil.position.set(s * 0.175, 0.085, -0.41);
    head.add(pupil);
  }

  // orejas (conos) con interior rosa
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.34, 4), fur);
    ear.position.set(s * 0.23, 0.36, 0);
    ear.rotation.y = Math.PI / 4;
    ear.rotation.z = s * -0.20;
    ear.castShadow = true;
    head.add(ear);

    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.20, 4), pink);
    inner.position.set(s * 0.235, 0.34, -0.06);
    inner.rotation.y = Math.PI / 4;
    inner.rotation.z = s * -0.20;
    head.add(inner);
  }

  // bigotes
  for (const s of [-1, 1]) {
    for (const [dy, rz] of [[0.045, 0.10], [0, 0], [-0.045, -0.10]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.012), lightFur);
      w.position.set(s * 0.30, -0.08 + dy, -0.34);
      w.rotation.z = s * rz;
      head.add(w);
    }
  }

  // --- patas TRASERAS (grupo propio para poder moverlas) ---
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(s * 0.19, CAT_LEG_PIVOT.y, CAT_LEG_PIVOT.z);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.22, 5, 10), fur);
    thigh.position.y = -0.22;
    thigh.castShadow = true;
    leg.add(thigh);

    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), lightFur);
    foot.position.set(0, -0.37, -0.05);
    foot.scale.set(1, 0.65, 1.3);
    leg.add(foot);

    rig.add(leg);
    legs.push(leg);
  }

  // --- patas DELANTERAS: de pie sujetan el arma, al correr van al suelo ---
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.34, CAT_ARM_PIVOT.y, CAT_ARM_PIVOT.z);
    arm.rotation.x = -1.35;
    const limb = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 5, 10), fur);
    limb.position.y = -0.21;
    limb.castShadow = true;
    arm.add(limb);

    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), lightFur);
    paw.position.set(0, -0.44, -0.02);
    paw.scale.set(1, 0.8, 1.2);
    arm.add(paw);

    rig.add(arm);
    arms.push(arm);
  }

  // --- arma, delante y a la derecha ---
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.8), dark);
  gun.position.set(0.28, 0.36, -0.50);
  gun.castShadow = true;
  rig.add(gun);

  // --- cola articulada (se menea desde el bucle de dibujo) ---
  // El primer tramo la abre hacia un lado: así se ve bien desde detrás.
  const tail = new THREE.Group();
  tail.position.set(0, -0.08, 0.28);
  let parent = tail;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.y = i === 0 ? 0 : 0.18;
    seg.rotation.x = 0.20;                   // cada tramo curva hacia atrás
    seg.rotation.z = i === 0 ? 0.60 : -0.04; // el primero la abre al lado
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.06, 0.18, 8),
      i > 4 ? lightFur : fur
    );
    m.position.y = 0.09;
    m.castShadow = true;
    seg.add(m);
    parent.add(seg);
    parent = seg;
  }
  rig.add(tail);

  g.userData.body = body;
  g.userData.tail = tail;
  g.userData.rig = rig;
  g.userData.head = head;
  g.userData.arms = arms;
  g.userData.legs = legs;
  g.userData.gun = gun;
  g.userData.cat = { quad: 0, phase: 0 }; // estado de la animacion
  return g;
}

// ------------------- Animación del gato -------------------
// Con "speed" (u/s) decide la postura:
//   parado / andando  -> de pie, en 2 patas, con pasitos alternos
//   corriendo         -> se tumba y corre a 4 patas (galope)
// El cambio entre posturas se mezcla poco a poco (no da un salto).
function animateCat(g, speed, dt) {
  const u = g.userData;
  if (!u || !u.rig || !u.cat) return;
  const st = u.cat;

  // ¿a 4 patas? solo cuando de verdad corre
  const wantQuad = speed > 7.7 ? 1 : 0;
  st.quad += (wantQuad - st.quad) * Math.min(1, dt * 7);
  const q = st.quad;

  // el ciclo de las patas corre más rápido cuanto más rápido vas
  st.phase += dt * (speed > 0.4 ? Math.min(speed, 14) * 1.5 : 1.8);
  const p = st.phase;

  const walk = Math.min(1, speed / 6.5);                        // 0 parado · 1 andando
  const run = Math.min(1, Math.max(0, (speed - 6.5) / 3.6));     // 0 andando · 1 corriendo
  const th = CAT_RUN_PITCH * q;
  const cosT = Math.cos(th), sinT = Math.sin(th);

  // tronco: se tumba y baja al correr, con un rebote al dar las zancadas
  const hipY = CAT_HIP_Y + (CAT_RUN_HIP_Y - CAT_HIP_Y) * q
    + Math.sin(p * 2) * (0.012 * walk + 0.030 * run);
  u.rig.position.y = hipY;
  u.rig.rotation.x = th;

  // a 4 patas el cuerpo se afina un poco: así se ven mejor las patas
  const slim = 1 - 0.18 * q;
  u.body.scale.set(slim, 1, slim);

  // la cabeza se endereza sola para seguir mirando al frente
  u.head.rotation.x = -th * 0.85;

  for (let i = 0; i < 2; i++) {
    const sgn = i === 0 ? -1 : 1;

    // --- patas delanteras ---
    const arm = u.arms[i];
    const armPivotY = hipY + CAT_ARM_PIVOT.y * cosT - CAT_ARM_PIVOT.z * sinT;
    const armWalk = Math.sin(p) * 0.18 * walk * (1 - run) * sgn; // pasitos alternos
    const armRunSw = Math.sin(p) * 0.60 * run;                   // las 2 a la vez
    // de pie (-1.35: sujeta el arma) -> a 4 patas (recta hasta el suelo)
    arm.rotation.x = -1.35 * (1 - q) + (-th) * q + armWalk + armRunSw;
    const armS = 1 + (armPivotY / CAT_ARM_LEN - 1) * q;
    arm.scale.set(1 + 0.22 * q, armS, 1 + 0.22 * q);

    // --- patas traseras ---
    const leg = u.legs[i];
    const legPivotY = hipY + CAT_LEG_PIVOT.y * cosT - CAT_LEG_PIVOT.z * sinT;
    const legWalk = Math.sin(p + (i === 0 ? 0 : Math.PI)) * 0.50 * walk * (1 - run);
    const legRunSw = Math.sin(p + Math.PI) * 0.60 * run;
    leg.rotation.x = (-th) * q + legWalk + legRunSw;
    const legS = 1 + (legPivotY / CAT_LEG_LEN - 1) * q;
    leg.scale.set(1 + 0.22 * q, legS, 1 + 0.22 * q);
  }

  // el arma se mantiene horizontal y se recoge contra el cuerpo al correr
  u.gun.rotation.x = -th;
  u.gun.position.set(0.28 + 0.10 * q, 0.36 + 0.26 * q, -0.50 + 0.40 * q);

  // la cola se levanta un poco al ir a 4 patas
  u.tail.rotation.x = -0.12 * q;
}

const myAvatar = makeAvatar(0xf2913d); // tú: gatito naranja
scene.add(myAvatar);
const myLabel = makeLabel("Tú");
myLabel.position.y = 2.3;
myAvatar.add(myLabel);

// ------------------------- Helicóptero + paracaídas -------------------------
function makeHelicopter() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x7fd4ff, roughness: 0.15, metalness: 0.3 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 4.4), dark);
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 1.5), glass);
  cabin.position.set(0, 0.25, 1.9);
  g.add(cabin);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 3.4), dark);
  tail.position.set(0, 0.45, -3.3);
  g.add(tail);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.9), dark);
  fin.position.set(0, 1.05, -4.7);
  g.add(fin);

  for (const s of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 4.2), dark);
    skid.position.set(s * 0.95, -1.15, 0.2);
    g.add(skid);
  }

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 6), dark);
  mast.position.set(0, 1.2, 0);
  g.add(mast);

  const rotor = new THREE.Group();
  rotor.position.y = 1.5;
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.4), dark);
    blade.rotation.y = (i / 4) * Math.PI * 2;
    rotor.add(blade);
  }
  g.add(rotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.35, 0.75, -4.5);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.28), dark);
    b.rotation.x = (i / 2) * Math.PI;
    tailRotor.add(b);
  }
  g.add(tailRotor);

  g.userData.rotor = rotor;
  g.userData.tailRotor = tailRotor;
  return g;
}

function makeParachute() {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.7, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.75, side: THREE.DoubleSide })
  );
  canopy.position.y = 2.6;
  canopy.scale.set(1, 0.65, 1);
  canopy.castShadow = true;
  g.add(canopy);

  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(dx * 1.1, 2.4, dz * 1.1),
      new THREE.Vector3(0, 1.5, 0),
    ]);
    g.add(new THREE.Line(geo, lineMat));
  }
  return g;
}

const heli = makeHelicopter();
heli.visible = false;
scene.add(heli);
let heliTimer = 0;
const heliDir = new THREE.Vector3(1, 0, 0);

const myChute = makeParachute();
myChute.visible = false;
myAvatar.add(myChute);

const remotePlayers = new Map();

// Menea la cola de todos los gatos (el tuyo y los de los demás)
function wagTails(t) {
  const a = Math.sin(t) * 0.22;
  if (myAvatar.userData.tail) myAvatar.userData.tail.rotation.z = a;
  for (const r of remotePlayers.values()) {
    const tail = r.group.userData.tail;
    if (tail) tail.rotation.z = a;
  }
}

// ------------------------- Estado local -------------------------
const pos = new THREE.Vector3(0, 0, 0);
const vel = new THREE.Vector3(0, 0, 0);
let yaw = 0;
let pitch = -0.25;
let onGround = true;
let playing = false;
let alive = true;
let dropping = false; // ¿estás cayendo en paracaídas desde el helicóptero?

// ------------------------- Armas -------------------------
// cd = tiempo entre disparos · pellets = balas por disparo · spread = dispersión
const WEAPONS = [
  { name: "Rifle",         dmg: 34, cd: 0.13, auto: true,  pellets: 1, spread: 0.010, range: 160, mag: 30, reload: 1.8, color: 0xffe066, assist: 0.022 },
  { name: "Escopeta",      dmg: 13, cd: 0.80, auto: false, pellets: 8, spread: 0.085, range: 45,  mag: 6,  reload: 2.4, color: 0xffa64d, assist: 0.070 },
  { name: "Francotirador", dmg: 85, cd: 1.30, auto: false, pellets: 1, spread: 0.001, range: 320, mag: 5,  reload: 2.9, color: 0x66e0ff, assist: 0.012 },
];
let weaponIndex = -1; // -1 = vas desarmado
const owned = WEAPONS.map(() => false); // armas que llevas encima
const ammo = WEAPONS.map(() => 0);
let reloading = false;
let reloadTimer = 0;
let shootCooldown = 0;
let triggerArmed = false; // armas semiautomáticas: solo disparan al pulsar, no manteniendo

function hasWeapon() { return weaponIndex >= 0 && owned[weaponIndex]; }

// Coge un arma del suelo (caja 🔫)
function takeWeapon(i) {
  if (!WEAPONS[i]) return;
  owned[i] = true;
  ammo[i] = WEAPONS[i].mag;
  weaponIndex = i;
  reloading = false;
  $("reloading")?.classList.add("hidden");
  shootCooldown = 0.3;
  updateWeaponHUD();
  addFeed("Recogiste: " + WEAPONS[i].name);
}

function selectWeapon(i) {
  if (!owned[i] || !WEAPONS[i]) return; // no cambias a un arma que no tienes
  if (i === weaponIndex) return;
  weaponIndex = i;
  reloading = false;
  document.getElementById("reloading").classList.add("hidden");
  shootCooldown = 0.25; // pequeño margen al cambiar de arma
  updateWeaponHUD();
}

function nextWeapon() {
  // Salta solo entre las armas que llevas
  for (let k = 1; k <= WEAPONS.length; k++) {
    const i = (weaponIndex + k + WEAPONS.length) % WEAPONS.length;
    if (owned[i]) { selectWeapon(i); return; }
  }
}

function startReload() {
  if (!hasWeapon()) return;
  const w = WEAPONS[weaponIndex];
  if (reloading || ammo[weaponIndex] >= w.mag) return;
  reloading = true;
  reloadTimer = w.reload;
  document.getElementById("reloading").classList.remove("hidden");
}

function updateWeaponHUD() {
  const n = document.getElementById("weaponName");
  const a = document.getElementById("ammo");
  if (!hasWeapon()) {
    if (n) n.textContent = "Sin arma";
    if (a) a.textContent = "busca 🔫";
    return;
  }
  const w = WEAPONS[weaponIndex];
  if (n) n.textContent = w.name;
  if (a) a.textContent = ammo[weaponIndex] + " / " + w.mag;
}

function updateInventoryHUD() {
  const m = document.getElementById("medCount");
  const s = document.getElementById("shieldCount");
  if (m) m.textContent = myMedkits;
  if (s) s.textContent = myShields;
  document.getElementById("btnMed")?.classList.toggle("empty", myMedkits <= 0);
  document.getElementById("btnShield")?.classList.toggle("empty", myShields <= 0);
}

function useItem(item) {
  if (!playing || !alive) return;
  send({ t: "use", item });
}

// ------------------------- Entrada (teclado) -------------------------
const keys = Object.create(null);
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Space") e.preventDefault();
  if (e.repeat) return;
  if (e.code === "Digit1") selectWeapon(0);
  if (e.code === "Digit2") selectWeapon(1);
  if (e.code === "Digit3") selectWeapon(2);
  if (e.code === "KeyR") startReload();
  if (e.code === "KeyO") openSettings(!settingsOpen);
  if (e.code === "KeyF") useItem("medkit");
  if (e.code === "KeyG") useItem("shield");
});
addEventListener("keyup", (e) => { keys[e.code] = false; });
addEventListener("wheel", (e) => {
  if (playing) nextWeapon();
}, { passive: true });

// ------------------------- Entrada (táctil) -------------------------
const stickVec = { x: 0, y: 0 };
let runToggle = false;
let jumpQueued = false;
let wantShoot = false;
// Joystick de apuntado (derecha)
const aimVec = { x: 0, y: 0 };
let aiming = false;
let autoRunStick = false; // empujar el joystick a tope = correr

function bindLook() {
  let lookId = null, lastX = 0, lastY = 0;
  const el = renderer.domElement;

  el.addEventListener("touchstart", (e) => {
    for (const t of e.changedTouches) {
      if (lookId === null) { lookId = t.identifier; lastX = t.clientX; lastY = t.clientY; break; }
    }
    if (playing) e.preventDefault();
  }, { passive: false });

  el.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      const dx = t.clientX - lastX, dy = t.clientY - lastY;
      lastX = t.clientX; lastY = t.clientY;
      yaw -= dx * settings.sens;
      pitch -= dy * settings.sens;
      pitch = Math.max(-1.2, Math.min(0.9, pitch));
    }
    if (playing) e.preventDefault();
  }, { passive: false });

  const endLook = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  };
  el.addEventListener("touchend", endLook);
  el.addEventListener("touchcancel", endLook);
}

function bindStick() {
  const stick = document.getElementById("stick");
  const knob = document.getElementById("knob");
  const R = 52;
  let id = null, cx = 0, cy = 0;

  const set = (t) => {
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stickVec.x = dx / R;
    stickVec.y = dy / R;
  };
  const reset = () => {
    id = null; stickVec.x = 0; stickVec.y = 0;
    knob.style.transform = "translate(0,0)";
  };

  stick.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    id = t.identifier;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    set(t);
  }, { passive: false });

  stick.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) set(t);
    e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) reset();
  };
  stick.addEventListener("touchend", end);
  stick.addEventListener("touchcancel", end);
}

// Joystick de apuntado: al arrastrarlo gira la cámara con precisión y dispara.
// Cuanto menos lo inclinas, más fino es el giro (como en Free Fire).
function bindAimStick() {
  const stick = document.getElementById("aimstick");
  const knob = document.getElementById("aimknob");
  const R = 54;
  let id = null, cx = 0, cy = 0;

  const set = (t) => {
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    aimVec.x = dx / R;
    aimVec.y = dy / R;
  };

  const release = () => {
    id = null;
    aimVec.x = 0;
    aimVec.y = 0;
    aiming = false;
    wantShoot = false;
    stick.classList.remove("firing");
    knob.style.transform = "translate(0,0)";
  };

  stick.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    id = t.identifier;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    aiming = true;
    wantShoot = true;
    triggerArmed = true;
    stick.classList.add("firing");
    set(t);
  }, { passive: false });

  stick.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) set(t);
    e.preventDefault();
  }, { passive: false });

  const end = (e) => {
    for (const t of e.changedTouches) if (t.identifier === id) release();
  };
  stick.addEventListener("touchend", end);
  stick.addEventListener("touchcancel", end);
}

function bindButton(id, onDown, onUp) {
  const el = document.getElementById(id);
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.classList.add("on");
    onDown && onDown();
  });
  const up = () => { el.classList.remove("on"); onUp && onUp(); };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("pointerleave", up);
}

function setTouchVisible(v) {
  document.getElementById("touch").classList.toggle("hidden", !(v && isTouch));
}

// ------------------------- Entrada (ratón, PC) -------------------------
renderer.domElement.addEventListener("click", () => {
  if (!isTouch && playing && alive && !document.pointerLockElement) {
    renderer.domElement.requestPointerLock();
  }
});

addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  yaw -= e.movementX * settings.sens;
  pitch -= e.movementY * settings.sens;
  pitch = Math.max(-1.2, Math.min(0.9, pitch));
});

addEventListener("mousedown", (e) => {
  if (e.button === 0 && !isTouch) { wantShoot = true; triggerArmed = true; }
});
addEventListener("mouseup", (e) => { if (e.button === 0 && !isTouch) wantShoot = false; });

document.addEventListener("pointerlockchange", () => {
  if (isTouch) return;
  const locked = document.pointerLockElement === renderer.domElement;
  if (!locked && playing && alive && !settingsOpen) showMenu(true);
  if (locked) showMenu(false);
});

// ------------------------- UI -------------------------
const $ = (id) => document.getElementById(id);
const hpfill = $("hpfill"), armorfill = $("armorfill"), zoneMsg = $("zoneMsg"), feed = $("feed");

function showMenu(v) {
  $("menu").classList.toggle("hidden", !v);
  if (v) {
    playing = false;
    setTouchVisible(false);
  }
}

function goFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    }
  } catch { /* ignore */ }
}

function startPlaying() {
  myName = ($("nameInput").value || "Jugador").slice(0, 12);
  intentionalLeave = false;
  joined = true;
  connect();
  showMenu(false);
  revive();
  if (isTouch) goFullscreen();
}

$("playBtn").addEventListener("click", startPlaying);

// Al morir puedes volver al menú (no se reaparece hasta la próxima partida)
$("leaveBtn")?.addEventListener("click", () => {
  intentionalLeave = true;
  joined = false;
  if (ws && ws.readyState <= 1) ws.close();
  $("dead").classList.add("hidden");
  $("winner").classList.add("hidden");
  document.exitPointerLock?.();
  showMenu(true);
  playing = false;
  alive = false;
});

// ------------------------- Salto en paracaídas -------------------------
const DROP_ALT = 105;   // altura desde la que saltas (unidades)
const PARA_FALL = 9;    // velocidad de descenso con paracaídas (u/s)
const HELI_SPEED = 46;  // velocidad del helicóptero (u/s)

// ¿Hay algún edificio (sólido) en ese punto?
function isSolidAt(x, z, margin) {
  for (const b of solids) {
    if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return true;
  }
  return false;
}

// Elige un punto libre y dentro de la zona segura para aterrizar
function randomDropSpot() {
  const zr = lastZone && lastZone.r ? lastZone.r : 300;
  const limit = Math.max(40, Math.min(240, zr * 0.8));
  let fallback = { x: 0, z: 0 };
  for (let t = 0; t < 120; t++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * limit;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    fallback = { x, z };
    if (!isSolidAt(x, z, 2.5)) return { x, z };
  }
  return fallback;
}

// El helicóptero pasa por encima del punto de salto y se aleja
function heliFlyOver(x, z) {
  const ang = Math.random() * Math.PI * 2;
  heliDir.set(Math.cos(ang), 0, Math.sin(ang)).normalize();
  heli.position.set(x - heliDir.x * 9, DROP_ALT + 7, z - heliDir.z * 9);
  heli.rotation.y = Math.atan2(heliDir.x, heliDir.z);
  heliTimer = 0;
  heli.visible = true;
}

// Empieza el salto: apareces en el aire y bajas en paracaídas
function startDrop() {
  const s = randomDropSpot();
  pos.set(s.x, DROP_ALT, s.z);
  vel.set(0, 0, 0);
  pitch = -0.55; // mirando hacia el suelo
  onGround = false;
  dropping = true;
  myChute.visible = true;
  wantShoot = false;
  triggerArmed = false;
  aiming = false;
  aimVec.x = 0;
  aimVec.y = 0;
  heliFlyOver(s.x, s.z);
  $("dropHint")?.classList.remove("hidden");
}

// Tocas tierra: vuelves al juego normal
function endDrop() {
  dropping = false;
  pos.y = 0;
  vel.y = 0;
  onGround = true;
  myChute.visible = false;
  $("dropHint")?.classList.add("hidden");
  addFeed("¡Tocaste tierra! Busca un arma 🔫");
}

// Resucitar al jugador: se usa al empezar una partida nueva
function revive() {
  alive = true;
  playing = true;
  myHp = MAX_HP;
  myArmor = 0;
  myMedkits = 0;
  myShields = 0;
  myKills = 0;
  // Empiezas desarmado: hay que encontrar un arma en el mapa
  for (let i = 0; i < WEAPONS.length; i++) { owned[i] = false; ammo[i] = 0; }
  weaponIndex = -1;
  reloading = false;
  reloadTimer = 0;
  shootCooldown = 0;
  triggerArmed = false;
  $("reloading")?.classList.add("hidden");
  updateWeaponHUD();
  updateInventoryHUD();
  $("kills").textContent = "0 bajas";
  $("dead").classList.add("hidden");
  $("winner").classList.add("hidden");
  setTouchVisible(true);
  if (!isTouch) renderer.domElement.requestPointerLock();
  startDrop(); // empiezas cayendo desde un helicóptero
}

$("btnMed")?.addEventListener("click", () => useItem("medkit"));
$("btnShield")?.addEventListener("click", () => useItem("shield"));

// ------------------------- Panel de ajustes -------------------------
function openSettings(open) {
  settingsOpen = open;
  document.getElementById("settings").classList.toggle("hidden", !open);
  if (open) {
    wantShoot = false;
    triggerArmed = false;
    aiming = false;
    aimVec.x = 0;
    aimVec.y = 0;
    const k = document.getElementById("aimknob");
    if (k) k.style.transform = "translate(0,0)";
    document.getElementById("aimstick")?.classList.remove("firing");
    if (!isTouch) document.exitPointerLock?.();
  } else if (playing && alive && !isTouch) {
    renderer.domElement.requestPointerLock();
  }
}

function initSettingsUI() {
  const sensR = document.getElementById("sensRange");
  const gainR = document.getElementById("gainRange");
  const aaR = document.getElementById("aaRange");
  const aaC = document.getElementById("autoAimChk");
  const baseSens = isTouch ? 0.0042 : 0.0024;

  const sync = () => {
    sensR.value = Math.round((settings.sens / baseSens) * 50);
    gainR.value = Math.round(settings.gain * 10);
    aaR.value = Math.round(settings.autoAimStrength * 100);
    aaC.checked = settings.autoAim;
    document.getElementById("sensVal").textContent = Math.round((settings.sens / baseSens) * 100) + "%";
    document.getElementById("gainVal").textContent = settings.gain.toFixed(1);
    document.getElementById("aaVal").textContent = Math.round(settings.autoAimStrength * 100) + "%";
  };

  sensR.addEventListener("input", () => { settings.sens = baseSens * (+sensR.value / 50); saveSettings(); sync(); });
  gainR.addEventListener("input", () => { settings.gain = +gainR.value / 10; saveSettings(); sync(); });
  aaR.addEventListener("input", () => { settings.autoAimStrength = +aaR.value / 100; saveSettings(); sync(); });
  aaC.addEventListener("change", () => { settings.autoAim = aaC.checked; saveSettings(); sync(); });

  document.getElementById("gearBtn").addEventListener("click", () => openSettings(!settingsOpen));
  document.getElementById("closeSettings").addEventListener("click", () => openSettings(false));

  sync();
}

// Mostrar la ayuda correcta
if (isTouch) {
  document.body.classList.add("touch");
  $("helpDesktop")?.classList.add("hidden");
  $("helpMobile")?.classList.remove("hidden");
  bindLook();
  bindStick();
  bindAimStick();
  bindButton("btnJump", () => { jumpQueued = true; }, null);
  bindButton("btnRun", () => {
    runToggle = !runToggle;
    $("btnRun").classList.toggle("on", runToggle);
  }, null);
  bindButton("btnWeapon", () => nextWeapon(), null);
  bindButton("btnReload", () => startReload(), null);
}

// ------------------------- Red -------------------------
function connect() {
  if (ws && ws.readyState <= 1) {
    send({ t: "join", name: myName });
    return;
  }
  ws = new WebSocket(WS_URL);
  ws.onopen = () => send({ t: "join", name: myName });
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = () => {
    if (!intentionalLeave) addFeed("Conexión perdida con el servidor");
    intentionalLeave = false;
    playing = false;
    setTouchVisible(false);
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function onMessage(msg) {
  switch (msg.t) {
    case "welcome":
      myId = msg.id;
      myLabel.visible = false;
      for (const it of msg.loot || []) addLootMesh(it);
      updateRound(msg.round);
      break;

    case "lootTaken":
      removeLootMesh(msg.id);
      break;

    case "giveloot":
      if (msg.kind === "weapon") takeWeapon(msg.weapon);
      break;

    case "used":
      addFeed(msg.item === "medkit" ? "Usaste un botiquín (+40 vida)" : "Usaste un chaleco (+50 escudo)");
      break;

    case "state":
      aliveCount = msg.alive;
      $("alive").textContent = aliveCount + " vivos";
      updateRound(msg.round);
      updateZone(msg.zone);
      for (const p of msg.players) {
        if (p.id === myId) {
          myHp = p.hp;
          myArmor = p.armor;
          myMedkits = p.medkits;
          myShields = p.shields;
          myKills = p.kills;
          $("kills").textContent = myKills + " bajas";
          updateInventoryHUD();
          if (!p.alive && alive) onDeath(null);
          continue;
        }
        upsertRemote(p);
      }
      for (const [id, r] of remotePlayers) {
        if (!msg.players.find((p) => p.id === id)) {
          scene.remove(r.group);
          remotePlayers.delete(id);
        }
      }
      break;

    case "kill":
      addFeed(`${msg.killer} eliminó a ${msg.victim}`);
      if (msg.victimId === myId && alive) onDeath(msg.killer);
      break;

    case "roundOver": {
      if (!joined) break;
      const w = msg.winner;
      $("winnerName").textContent = w
        ? `${w.name} · ${w.kills} ${w.kills === 1 ? "baja" : "bajas"}`
        : "Nadie sobrevivió";
      $("winnerNext").textContent = "Nueva partida en " + msg.nextIn + " s";
      $("winner").classList.remove("hidden");
      addFeed(w ? `🏆 ¡Ganó ${w.name}!` : "🏆 Fin de la partida");
      break;
    }

    case "roundStart": {
      // Loot nuevo en el mapa
      for (const lid of [...lootMeshes.keys()]) removeLootMesh(lid);
      for (const it of msg.loot || []) addLootMesh(it);
      updateZone(msg.zone);
      if (!joined) break; // está en el menú: no le metemos en la partida
      revive();
      addFeed("¡Empieza la partida #" + msg.num + "!");
      break;
    }
  }
}

// Barra superior: cuenta atrás de la partida y ganador
function updateRound(r) {
  if (!r) return;
  matchRound = r;
  const t = Math.max(0, Math.floor(r.timeLeft || 0));
  const txt = Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
  const el = $("matchTime");
  if (el) {
    el.textContent = "⏱ " + txt;
    el.style.color = t <= 30 ? "#ff6b6b" : "";
  }

  if (r.over && joined) {
    const w = r.winner;
    $("winnerName").textContent = w
      ? `${w.name} · ${w.kills} ${w.kills === 1 ? "baja" : "bajas"}`
      : "Nadie sobrevivió";
    $("winnerNext").textContent = "Nueva partida en " + r.nextIn + " s";
    $("winner").classList.remove("hidden");
  } else {
    $("winner").classList.add("hidden");
    if (joined && !alive) {
      const d = $("deadWait");
      if (d) d.textContent = "Estás fuera. La partida termina en " + txt + ".";
    }
  }
}

function upsertRemote(p) {
  let r = remotePlayers.get(p.id);
  if (!r) {
    const color = new THREE.Color().setHSL((parseInt(p.id) * 0.137) % 1, 0.65, 0.55);
    const group = makeAvatar(color.getHex());
    scene.add(group);
    const label = makeLabel(p.name);
    label.position.y = 2.3;
    group.add(label);
    const chute = makeParachute();
    chute.visible = false;
    group.add(chute);
    group.userData.id = p.id;
    r = { group, label, chute, name: p.name, target: { x: p.x, y: p.y, z: p.z, ry: p.ry }, hp: p.hp };
    remotePlayers.set(p.id, r);
  }
  r.target = { x: p.x, y: p.y, z: p.z, ry: p.ry };
  r.hp = p.hp;
  r.name = p.name; // el nombre puede cambiar si el jugador lo edita al entrar
  r.group.visible = p.alive;
}

function updateZone(z) {
  lastZone = z;
  zoneWall.position.x = z.x;
  zoneWall.position.z = z.z;
  zoneWall.scale.set(z.r, 1, z.r);
}

function addFeed(text) {
  const d = document.createElement("div");
  d.textContent = text;
  feed.appendChild(d);
  setTimeout(() => d.remove(), 6000);
}

function onDeath(killer) {
  alive = false;
  playing = false;
  wantShoot = false;
  triggerArmed = false;
  aiming = false;
  aimVec.x = 0;
  aimVec.y = 0;
  dropping = false;
  myChute.visible = false;
  $("dropHint")?.classList.add("hidden");
  document.exitPointerLock?.();
  setTouchVisible(false);
  $("deadBy").textContent = killer ? `Te eliminó ${killer}` : "Te quedaste fuera de la zona";
  const d = $("deadWait");
  if (d) d.textContent = "Estás fuera. Vuelves en la próxima partida…";
  $("dead").classList.remove("hidden");
  $("menu").classList.add("hidden");
}

// ------------------------- Disparo -------------------------
// El truco de los juegos en 3ª persona: las balas NO salen de la cámara,
// sino del arma, apuntando al punto que hay justo bajo la mira.
const raycaster = new THREE.Raycaster();
const tracers = [];
const CENTER = new THREE.Vector2(0, 0);
const crosshairEl = document.getElementById("crosshair");

// Punto del arma: hombro derecho del jugador
function muzzlePoint() {
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  return new THREE.Vector3(pos.x, pos.y + 1.5, pos.z).addScaledVector(right, 0.5);
}

function firstEnemy(hits) {
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.id) o = o.parent;
    if (o && o.userData.id) return { id: o.userData.id, point: h.point.clone() };
  }
  return null;
}

function markHit() {
  crosshairEl.classList.add("hit");
  setTimeout(() => crosshairEl.classList.remove("hit"), 90);
}

function addTracer(a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  scene.add(line);
  tracers.push({ line, t: 0 });
}

function shoot() {
  if (!hasWeapon()) return;
  const w = WEAPONS[weaponIndex];
  const enemyRoots = [];
  for (const r of remotePlayers.values()) if (r.group.visible) enemyRoots.push(r.group);

  // 1) ¿Qué hay bajo la mira? (rayo desde la cámara)
  raycaster.setFromCamera(CENTER, camera);
  raycaster.far = 400;
  const wallA = raycaster.intersectObjects(worldObjects, false)[0] || null;
  const enemyA = raycaster.intersectObjects(enemyRoots, true)[0] || null;

  let aimPoint;
  if (enemyA && (!wallA || enemyA.distance <= wallA.distance)) aimPoint = enemyA.point.clone();
  else if (wallA) aimPoint = wallA.point.clone();
  else aimPoint = camera.position.clone().addScaledVector(raycaster.ray.direction, 200);

  // 2) Las balas salen del arma hacia ese punto (con dispersión según el arma)
  const origin = muzzlePoint();
  const baseDir = aimPoint.clone().sub(origin).normalize();
  const damage = new Map(); // id -> daño total que le llega a ese enemigo
  const assistAng = w.assist * (isTouch ? 2.5 : 1) * (aiming ? 1.5 : 1);

  for (let p = 0; p < w.pellets; p++) {
    const dir = baseDir.clone();
    if (w.spread > 0) {
      dir.add(new THREE.Vector3(
        (Math.random() - 0.5) * w.spread,
        (Math.random() - 0.5) * w.spread,
        (Math.random() - 0.5) * w.spread
      ));
      dir.normalize();
    }

    raycaster.set(origin, dir);
    raycaster.far = w.range;
    const wallB = raycaster.intersectObjects(worldObjects, false)[0] || null;
    const enemyB = raycaster.intersectObjects(enemyRoots, true);

    let target = null;
    if (enemyB.length && (!wallB || enemyB[0].distance < wallB[0].distance)) target = firstEnemy(enemyB);

    // 3) Ayuda de puntería suave (más generosa en móvil)
    if (!target && assistAng > 0) {
      let best = null, bestAng = assistAng;
      for (const [id, r] of remotePlayers) {
        if (!r.group.visible) continue;
        const c = new THREE.Vector3(r.group.position.x, r.group.position.y + 1.0, r.group.position.z);
        const to = c.clone().sub(origin);
        const dist = to.length();
        if (dist > w.range || dist < 0.5) continue;
        if (wallB && dist > wallB.distance + 0.5) continue; // hay pared en medio
        const ang = to.normalize().angleTo(dir);
        if (ang < bestAng) { bestAng = ang; best = { id, point: c }; }
      }
      if (best) target = best;
    }

    if (target) {
      damage.set(target.id, (damage.get(target.id) || 0) + w.dmg);
      addTracer(origin, target.point, w.color);
    } else {
      const end = wallB ? wallB.point.clone() : origin.clone().addScaledVector(dir, w.range);
      addTracer(origin, end, w.color);
    }
  }

  // 4) Un solo mensaje de daño por enemigo
  for (const [id, dmg] of damage) send({ t: "hit", target: id, dmg });
  if (damage.size) markHit();
}

// ------------------------- Auto apuntado -------------------------
function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Atrae suavemente la mira hacia el enemigo más cercano a la cruz.
function applyAutoAim(dt) {
  const s = settings.autoAimStrength;
  if (s <= 0) return;

  const head = new THREE.Vector3(pos.x, pos.y + 1.55, pos.z);
  const camDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  const maxAng = 0.08 + 0.24 * s; // cono de captura

  let best = null, bestAng = maxAng;
  for (const r of remotePlayers.values()) {
    if (!r.group.visible) continue;
    const c = new THREE.Vector3(r.group.position.x, r.group.position.y + 1.05, r.group.position.z);
    const to = c.clone().sub(head);
    const dist = to.length();
    if (dist > 180 || dist < 0.6) continue;
    const ang = to.normalize().angleTo(camDir);
    if (ang < bestAng) { bestAng = ang; best = c; }
  }
  if (!best) return;

  const to = best.clone().sub(head);
  const wantYaw = Math.atan2(-to.x, -to.z);
  const wantPitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
  const k = Math.min(1, (2 + 12 * s) * dt); // suavidad del enganche
  yaw += shortestAngle(yaw, wantYaw) * k;
  pitch += (wantPitch - pitch) * k;
  pitch = Math.max(-1.2, Math.min(0.9, pitch));
  aimLock = true;
}

// ------------------------- Minimapa (radar) -------------------------
const mmCanvas = document.getElementById("minimap");
const mmCtx = mmCanvas ? mmCanvas.getContext("2d") : null;
const MM_RANGE = 170; // unidades del mundo visibles del centro al borde
const MM_NAME_FS = isTouch ? 17 : 12; // px del nombre en el radar (el canvas mide 200 y se ve más pequeño)
let mmTimer = 0;

function drawMinimap() {
  if (!mmCtx) return;
  const W = mmCanvas.width, H = mmCanvas.height;
  const cx = W / 2, cy = H / 2;
  const R = W / 2 - 6;
  const scale = R / MM_RANGE;
  const ctx = mmCtx;

  const zx = zoneWall.position.x, zz = zoneWall.position.z, zr = zoneWall.scale.x;
  const distZone = Math.hypot(pos.x - zx, pos.z - zz);

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  // fondo
  ctx.fillStyle = "rgba(12,20,30,.72)";
  ctx.fillRect(0, 0, W, H);

  // si estás fuera de la zona, tinte rojo de aviso
  if (distZone > zr) {
    ctx.fillStyle = "rgba(255,60,40,.20)";
    ctx.fillRect(0, 0, W, H);
  }

  // borde de la zona segura
  ctx.beginPath();
  ctx.arc(cx + (zx - pos.x) * scale, cy + (zz - pos.z) * scale, zr * scale, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(80,200,255,.95)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // jugadores cercanos (puntos rojos)
  for (const r of remotePlayers.values()) {
    if (!r.group.visible) continue;
    const dx = (r.group.position.x - pos.x) * scale;
    const dz = (r.group.position.z - pos.z) * scale;
    if (Math.hypot(dx, dz) > R - 3) continue;
    const near = Math.hypot(r.group.position.x - pos.x, r.group.position.z - pos.z) < 60;
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dz, near ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = near ? "#ff3b30" : "rgba(255,138,128,.85)";
    ctx.fill();
    if (near) { ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.5; ctx.stroke(); }

    // nombre del jugador, debajo de su punto
    if (r.name) {
      const ty = cy + dz + (near ? 5.5 : 3.5) + 3;
      ctx.font = `bold ${MM_NAME_FS}px Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(0,0,0,.85)";
      ctx.strokeText(r.name, cx + dx, ty);
      ctx.fillStyle = "#fff";
      ctx.fillText(r.name, cx + dx, ty);
    }
  }

  // tú (flecha blanca que gira con la cámara)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6.5, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6.5, 7);
  ctx.closePath();
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  ctx.restore(); // fin del recorte circular

  // aro exterior
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,.3)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // norte
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.font = "bold 13px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, 16);

  // flecha hacia el centro de la zona si estás fuera
  if (distZone > zr) {
    const ang = Math.atan2(zz - pos.z, zx - pos.x);
    ctx.save();
    ctx.translate(cx + Math.cos(ang) * (R - 12), cy + Math.sin(ang) * (R - 12));
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = "#4fd0ff";
    ctx.fill();
    ctx.restore();
  }
}

// ------------------------- Colisiones -------------------------
const RADIUS = 0.55;
function collide(p) {
  for (const b of solids) {
    const minX = b.minX - RADIUS, maxX = b.maxX + RADIUS;
    const minZ = b.minZ - RADIUS, maxZ = b.maxZ + RADIUS;
    if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
      const dl = p.x - minX, dr = maxX - p.x, dt = p.z - minZ, db = maxZ - p.z;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) p.x = minX;
      else if (m === dr) p.x = maxX;
      else if (m === dt) p.z = minZ;
      else p.z = maxZ;
    }
  }
  const LIM = 330;
  p.x = Math.max(-LIM, Math.min(LIM, p.x));
  p.z = Math.max(-LIM, Math.min(LIM, p.z));
}

// ------------------------- Bucle principal -------------------------
const clock = new THREE.Clock();
let netAccum = 0;
let pickupTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  aimLock = false;

  if (playing && alive && !settingsOpen) {
    // --- Apuntado con el joystick derecho ---
    if (aiming) {
      const DZ = 0.14;   // zona muerta: cerca del centro el giro es muy fino
      const ax = Math.abs(aimVec.x) > DZ ? aimVec.x - Math.sign(aimVec.x) * DZ : 0;
      const ay = Math.abs(aimVec.y) > DZ ? aimVec.y - Math.sign(aimVec.y) * DZ : 0;
      const A = settings.gain; // ganancia de giro (rad/s a máxima inclinación)
      yaw -= ax * Math.abs(ax) * A * dt;
      pitch -= ay * Math.abs(ay) * A * dt;
      pitch = Math.max(-1.2, Math.min(0.9, pitch));
    }

    // --- Auto apuntado hacia el enemigo ---
    if (settings.autoAim && hasWeapon() && !dropping && (aiming || wantShoot)) applyAutoAim(dt);

    // Entradas combinadas (teclado + joystick)
    let fwd = 0, str = 0;
    if (keys["KeyW"]) fwd += 1;
    if (keys["KeyS"]) fwd -= 1;
    if (keys["KeyD"]) str += 1;
    if (keys["KeyA"]) str -= 1;
    fwd += -stickVec.y;
    str += stickVec.x;

    const len = Math.hypot(fwd, str);
    if (len > 1) { fwd /= len; str /= len; }

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    // Empujar el joystick a tope hacia delante = correr (con histéresis)
    const stickFwd = -stickVec.y;
    if (stickFwd > 0.75) autoRunStick = true;
    else if (stickFwd < 0.6) autoRunStick = false;

    const running = keys["ShiftLeft"] || keys["ShiftRight"] || runToggle || autoRunStick;
    const speed = dropping ? 13 : running ? 10 : 6.5;
    const dir = new THREE.Vector3()
      .addScaledVector(forward, fwd)
      .addScaledVector(right, str);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(speed * Math.min(1, len));

    vel.x = dir.x;
    vel.z = dir.z;

    if (dropping) {
      // Paracaídas: desciendes a velocidad constante mientras te deslizas
      vel.y = -PARA_FALL;
      jumpQueued = false;
    } else {
      if ((keys["Space"] || jumpQueued) && onGround) { vel.y = 7.5; onGround = false; }
      jumpQueued = false;
      vel.y -= 22 * dt;
    }

    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    pos.y += vel.y * dt;

    if (pos.y <= 0) {
      if (dropping) endDrop();
      else { pos.y = 0; vel.y = 0; onGround = true; }
    }

    // En el aire no chocas con los edificios; al tocar tierra sí
    if (!dropping) collide(pos);

    // --- Recarga ---
    if (reloading && hasWeapon()) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        reloading = false;
        ammo[weaponIndex] = WEAPONS[weaponIndex].mag;
        $("reloading").classList.add("hidden");
        updateWeaponHUD();
      }
    }

    // --- Disparo (solo si llevas un arma y ya has aterrizado) ---
    shootCooldown -= dt;
    if (hasWeapon() && !dropping) {
      const wp = WEAPONS[weaponIndex];
      const wantsFire = wp.auto ? wantShoot : (triggerArmed && wantShoot);
      if (wantsFire && !reloading && shootCooldown <= 0) {
        if (ammo[weaponIndex] > 0) {
          shoot();
          ammo[weaponIndex]--;
          shootCooldown = wp.cd;
          triggerArmed = false;
          updateWeaponHUD();
          if (ammo[weaponIndex] === 0) startReload();
        } else {
          startReload();
        }
      }
    }
    if (!wantShoot) triggerArmed = false;

    // --- Recoger loot del suelo al pasar cerca ---
    pickupTimer -= dt;
    if (pickupTimer <= 0 && !dropping) {
      pickupTimer = 0.25;
      let nearest = null, nd = 2.6;
      for (const [lid, g] of lootMeshes) {
        const d = Math.hypot(g.position.x - pos.x, g.position.z - pos.z);
        if (d < nd) { nd = d; nearest = lid; }
      }
      if (nearest) send({ t: "pickup", id: nearest });
    }

    netAccum += dt;
    if (netAccum > 0.066) {
      netAccum = 0;
      send({ t: "state", x: pos.x, y: pos.y, z: pos.z, ry: yaw });
    }
  }

  // --- Loot: girar y flotar ---
  const tsec = performance.now() / 1000;
  for (const g of lootMeshes.values()) {
    g.userData.box.rotation.y += dt * 1.6;
    g.position.y = Math.sin(tsec * 2 + g.userData.phase) * 0.12;
  }

  // --- Helicóptero: pasa volando y se aleja ---
  if (heli.visible) {
    heliTimer += dt;
    heli.position.addScaledVector(heliDir, HELI_SPEED * dt);
    heli.position.y = DROP_ALT + 7 + Math.sin(heliTimer * 2) * 0.6;
    heli.userData.rotor.rotation.y += dt * 26;
    heli.userData.tailRotor.rotation.x += dt * 40;
    if (heliTimer > 7) heli.visible = false;
  }

  myAvatar.position.copy(pos);
  myAvatar.rotation.y = yaw;
  myAvatar.visible = alive;

  // Animación del gato: anda en 2 patas y corre a 4 patas
  const mySpeed = (playing && alive && !settingsOpen && !dropping)
    ? Math.hypot(vel.x, vel.z)
    : 0;
  animateCat(myAvatar, mySpeed, dt);

  // Aviso de paracaídas con la altura restante
  if (dropping) {
    const dh = $("dropHint");
    if (dh) dh.textContent = "🪂 Paracaídas · altura " + Math.max(0, Math.round(pos.y)) + " m";
  }
  crosshairEl.style.display = dropping ? "none" : "";

  for (const r of remotePlayers.values()) {
    const px = r.group.position.x, pz = r.group.position.z;
    r.group.position.lerp(new THREE.Vector3(r.target.x, r.target.y, r.target.z), 0.22);
    r.group.rotation.y = r.target.ry;
    if (r.chute) r.chute.visible = r.target.y > 3;

    // velocidad real del jugador (la posición va suavizada, así no tiembla)
    const sp = Math.min(20,
      Math.hypot(r.group.position.x - px, r.group.position.z - pz) / Math.max(dt, 0.001));
    animateCat(r.group, r.target.y > 3 ? 0 : sp, dt);
  }

  wagTails(performance.now() * 0.004);

  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].t += dt;
    if (tracers[i].t > 0.06) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }

  // Cámara en 3ª persona, al hombro (el personaje no tapa la mira)
  const camDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
  const camRight = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const focus = new THREE.Vector3(pos.x, pos.y + 1.55, pos.z).addScaledVector(camRight, 0.8);
  camera.position.copy(focus).addScaledVector(camDir, dropping ? -9 : -6.2);
  if (camera.position.y < 0.7) camera.position.y = 0.7;
  camera.lookAt(focus.x + camDir.x, focus.y + camDir.y, focus.z + camDir.z);

  // HUD
  const pct = Math.max(0, (myHp / MAX_HP) * 100);
  hpfill.style.width = pct + "%";
  hpfill.style.background = pct > 50
    ? "linear-gradient(90deg,#29d17a,#7ef29b)"
    : pct > 25 ? "linear-gradient(90deg,#e0b13a,#f5d76e)" : "linear-gradient(90deg,#c0392b,#e74c3c)";

  armorfill.style.width = Math.max(0, (myArmor / 100) * 100) + "%";

  // Minimapa (unas 8 veces por segundo)
  mmTimer -= dt;
  if (mmTimer <= 0) { mmTimer = 0.12; drawMinimap(); }

  const d = Math.hypot(pos.x - zoneWall.position.x, pos.z - zoneWall.position.z);
  const outside = d > zoneWall.scale.x;
  zoneMsg.style.opacity = outside ? 1 : 0;
  zoneMsg.textContent = outside ? "⚠ ESTÁS FUERA DE LA ZONA — corre al centro" : "";

  // Aviso de la zona con cuenta atrás
  if (lastZone) {
    const zi = $("zoneInfo");
    const r = Math.round(lastZone.r);
    if (outside) {
      zi.textContent = "⚠ Fuera de la zona · r=" + r;
    } else if (lastZone.closing) {
      zi.textContent = "Zona cerrándose · r=" + r;
    } else if (lastZone.next != null) {
      zi.textContent = "Zona r=" + r + " · cierra en " + Math.ceil(lastZone.next) + "s";
    } else {
      zi.textContent = "Zona final · r=" + r;
    }
    // El muro se ve más intenso mientras se cierra
    zoneWall.material.opacity = lastZone.closing ? 0.34 : 0.18;
  }

  // La mira se pone dorada cuando el auto apuntado engancha a un enemigo
  crosshairEl.classList.toggle("lock", aimLock);

  renderer.render(scene, camera);
}
animate();

// ------------------------- Redimensionado -------------------------
function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener("resize", onResize);
addEventListener("orientationchange", () => setTimeout(onResize, 300));

connect();
updateWeaponHUD();
updateInventoryHUD();
initSettingsUI();
