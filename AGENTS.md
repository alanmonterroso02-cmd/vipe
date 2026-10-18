# AGENTS.md — JUEGO VIPE

Battle royale 3D **multijugador** (prototipo) en el navegador: **Three.js** (3D) +
**Node.js + WebSockets** (`ws`). Un solo proceso sirve los archivos y el estado del juego.
Corre en red local (PC + móviles en la misma WiFi). No es un repo git.

## Comandos

- `npm install` — única dependencia: `ws`. **No** instala Three.js: el cliente lo carga
  desde un CDN (unpkg) vía `<script type="importmap">`.
- `npm start` ( = `node server.js` ) — arranca el servidor en `PORT` (por defecto **3000**).
- Jugar: `http://localhost:3000`. En el móvil (misma WiFi): `http://IP-LOCAL:3000`.
  El servidor imprime la IP local al arrancar.
- `iniciar-juego.bat` — arranca el servidor y abre el navegador (pensado para doble clic).

No hay build, lint ni framework de tests. Verificación manual:

- Servidor (CommonJS): `node --check server.js`
- Cliente (ESM, usa `import`): `node --check` **falla** sobre `.js`; copia a `.mjs` y
  comprueba ahí (p. ej. `Copy-Item public\game.js $env:TEMP\g.mjs; node --check $env:TEMP\g.mjs`).
- Multijugador: script corto con `ws` que conecta, envía `{t:"join",name}` y espera `state`.

## Arquitectura

- **`server.js`**: HTTP estático de `public/` + WebSocket en el **mismo puerto**. Bucle de
  red a ~20 Hz (`setTimeout(tick, 50)`). Zona que se encoge por fases (`ZONE_PHASES`,
  radio inicial `ZONE_START = 300`). Loot generado en el servidor.
- **`public/game.js`**: cliente ESM (Three.js). Cámara 3ª persona, interpolación de jugadores
  remotos, HUD, minimapa, inventario, armas, **salto en paracaídas**.
- **Salto en paracaídas (intro)**: al empezar partida o renacer, `revive()` llama a
  `startDrop()` (todo en `public/game.js`, **sin cambios en el servidor**). Coloca al jugador
  a `DROP_ALT = 105` en un punto libre (`isSolidAt`) dentro de la zona (`randomDropSpot`), lo
  baja a `PARA_FALL = 9` u/s y muestra un helicóptero (`makeHelicopter`) y un paracaídas
  (`makeParachute`). Mientras `dropping` está activo **no** disparas, no recoges loot y no
  chocas con edificios; puedes deslizarte (velocidad 13). La posición (incluida `y`) se sigue
  reportando al servidor, así que los demás ven caer a cada jugador (con paracaídas si `y > 3`).
- **Mapa replicado (importante)**: el escenario se genera con un PRNG `mulberry32` de
  **semilla fija** y el **mismo orden exacto de llamadas** en `server.js` y en
  `public/game.js` (semilla del mapa `1337`, semilla del loot `90210`). Si cambias la
  generación en un lado, cópiala **idéntica** en el otro o las colisiones y las mallas
  dejarán de coincidir. Hay un comentario explícito en `server.js`.
- **Servidor poco autoritativo**: confía en la posición (`x/y/z/ry`) que reporta cada
  cliente. El cliente hace el *raycast* y envía `{t:"hit", target, dmg}`; el servidor aplica
  el daño. Bien para LAN con amigos, **no** para partidas competitivas con desconocidos.

## Protocolo de mensajes

- Cliente → servidor: `join`, `state`, `hit`, `pickup`, `use`, `respawn`
- Servidor → cliente: `welcome`, `state`, `kill`, `lootTaken`, `giveloot`, `used`, `left`
  (y, del feature final: `roundOver` / `roundStart`)

## Convenciones y trampas

- **Todo el texto/UI está en español.** Mantén ese idioma.
- **PC vs móvil**: se detecta táctil (`isTouch` / `isMobile`). PC usa pointer lock + WASD;
  móvil usa dos joysticks (movimiento izq., apuntado/disparo der.) y añade la clase
  `body.touch`. Pointer lock es solo de escritorio.
- **Puntería en 3ª persona**: las balas **no** salen de la cámara. Se calcula el punto bajo la
  mira y se dispara desde el arma (dos raycasts + auto-apuntado). No lo simplifiques a disparar
  desde la cámara; es un arreglo deliberado.
- Three.js viene por CDN: **sin internet el cliente no arranca** (y `node_modules` solo tiene `ws`).
- Editar `public/*` **no** requiere reiniciar el servidor (se leen en cada request);
  editar `server.js` **sí**.
- El `.bat` debe tener finales de línea **CRLF** (con LF los bloques `if (...)` fallan).
- Sonda rápida del servidor: `Invoke-WebRequest -UseBasicParsing http://localhost:3000/`.
- El servidor escucha en todas las interfaces; para LAN abre el puerto 3000 en el Firewall
  (`New-NetFirewallRule -DisplayName "Juego Vipe" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow`).

## Estado

- **Implementado**: límite de tiempo de partida, cierre total de la zona y un único ganador
  (`MATCH_TIME`, `RESET_DELAY`, `round` con `num`/`winner`/`endAt`, y los mensajes
  `roundOver` / `roundStart`). Durante la partida **no** hay respawn: al morir esperas a la
  siguiente. El servidor también envía `timeLeft` y `winner` en `state`.
- **Implementado**: salto en paracaídas desde el helicóptero al empezar/renacer (ver arriba).
- **Implementado**: **miras por arma** (francotirador telescópica, rifle de punto rojo, escopeta
  sin óptica) y **apuntar con zoom** (ADS) con clic derecho en PC o botón **🎯** en móvil: la
  cámara se acerca al hombro, baja el FOV (el francotirador muestra su visor), reduce la
  dispersión y la velocidad de movimiento. El cliente manda su arma en `state` (`w`) y el
  servidor la reenvía para que los demás vean el arma en la mano de cada jugador.
- Probado con Node 24 / npm 11 en Windows.
