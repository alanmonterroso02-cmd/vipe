# JUEGO VIPE

Battle royale **3D multijugador** (prototipo) hecho con **Three.js** y **WebSockets**.
Corre en el navegador y funciona en red local para jugar con amigos.

Los personajes son **gatitos** 🐱: cada jugador tiene su propio color, orejas, bigotes
y una cola que se menea. Tú eres el gatito **naranja**.

Y tienen una manía muy gatuna: **andan erguidos en 2 patas**, pero en cuanto
**corren** se tumban y salen **a 4 patas** a toda velocidad. 🐾

## ▶️ Cómo ejecutar el juego (lo más fácil)

En el **Escritorio** tienes un acceso directo: **`Juego Vipe`**.

1. **Doble clic en "Juego Vipe"**.
2. Se abre una ventana negra (el servidor) y **el navegador se abre solo**.
3. ¡A jugar! **No cierres la ventana negra** mientras juegas.

Para **parar** el juego: cierra la ventana negra (o pulsa `Ctrl + C`).

> La primera vez tarda un poco más porque instala lo necesario.
> Si te falta Node.js, el propio acceso directo te avisa y te da el enlace.

### Alternativa manual (terminal)

1. Abre una terminal en esta carpeta.
2. Inicia el servidor:

   ```powershell
   npm start
   ```

3. Abre en el navegador: <http://localhost:3000>

Para jugar con amigos en la misma red (WiFi), pásales tu IP local:

```
http://TU-IP-LOCAL:3000
```

**El propio servidor te dice la dirección del móvil al arrancar** (línea
"En el movil: http://192.168.X.X:3000"). También puedes verlo con `ipconfig`
(busca "Dirección IPv4", algo como `192.168.1.XX`).
Si no conecta, permite el puerto **3000** en el Firewall de Windows.

## 🔁 Que arranque solo al encender el PC (opcional)

Si quieres que el juego se inicie automáticamente al encender la computadora:

1. Pulsa `Win + R`, escribe `shell:startup` y pulsa Enter.
2. Se abre la carpeta de **Inicio** de Windows.
3. Copia ahí el acceso directo **`Juego Vipe`** (o arrástralo).

Desde entonces, cada vez que enciendas el PC se iniciará el servidor y el
navegador. Si te cansas, borra el acceso directo de esa carpeta.

## 📱 En el teléfono

Funciona en cualquier móvil (Android / iPhone) con navegador moderno:

1. El teléfono debe estar en la **misma WiFi** que la PC.
2. Abre en el navegador del teléfono: `http://TU-IP-LOCAL:3000`
3. Pulsa **Jugar** (entra en pantalla completa automáticamente).

**Controles táctiles**

| Control | Acción |
| --- | --- |
| Joystick (abajo-izquierda) | Moverse. **Empújalo a tope hacia delante = correr** |
| **Joystick de apuntado** (abajo-derecha) | Girar la cámara con precisión **y disparar** a la vez |
| Deslizar el dedo en pantalla | Girar rápido (giros amplios) |
| Botón **🔫** | Cambiar de arma |
| Botón **🎯** | Apuntar con la mira (se queda puesta hasta que la toques otra vez) |
| Botón **⟳** | Recargar |
| Botones **🩹 / 🛡️** (abajo-centro) | Usar botiquín / chaleco |
| Botón **⤒** | Saltar |
| Botón **»** | Correr fijo (se queda activado) |

El joystick de apuntado es como el de Free Fire: cuanto **menos** lo inclinas,
**más fino** es el giro (perfecto para ajustar la mira a distancia); si lo
empujas a tope, gira rápido. Mientras lo mantienes pulsado, disparas.

Consejo: en iPhone, usa **Compartir → Añadir a pantalla de inicio** para que
se abra como una app sin barras del navegador.

## Controles (PC)

| Tecla | Acción |
| --- | --- |
| W A S D | Moverse |
| Ratón | Mirar |
| Clic izquierdo | Disparar |
| Clic derecho | Apuntar con la mira (zoom) |
| 1 · 2 · 3 | Elegir arma (o rueda del ratón) |
| R | Recargar |
| F | Usar botiquín |
| G | Usar chaleco (escudo) |
| Espacio | Saltar |
| Shift | Correr |
| O | Ajustes |
| ESC | Salir / pausa |

## Reglas (battle royale)

- **Cada jugador aparece en un sitio distinto del mapa**, siempre **lejos de
  los demás** (mínimo ~95 unidades): nada de salir pegado a un rival.
- **Empiezas SIN ARMA**: corre a buscar una **caja 🔫** para poder disparar.
- Empiezas con **100 de vida** y **0 de escudo**.
- El mapa es **grande** y hay una **zona segura** que empieza muy amplia
  (radio **300**) y se **encoge por fases** cada vez más rápido.
- **La zona se cierra por completo** (radio **0**): al final no hay ningún
  sitio seguro y todo el mundo recibe daño. Así la partida siempre acaba.
- Fuera de la zona pierdes vida cada vez más rápido: corre al centro.
- **Gana el último jugador en pie.** 🏆
- ⏱ **Cada partida dura como máximo 3:30** (210 s). Si aún queda más de uno
  cuando se agota el tiempo, la zona ya está cerrada y el daño decide.
- **Si te eliminan NO reapareces**: quedas fuera hasta la siguiente partida
  (aparecerá el ganador y una cuenta atrás).

### Fases de la zona

| Fase | Espera | Tiempo de cierre | Radio final |
| --- | --- | --- | --- |
| 1 | 22 s | 26 s | 200 |
| 2 | 18 s | 22 s | 130 |
| 3 | 15 s | 20 s | 80 |
| 4 | 13 s | 18 s | 45 |
| 5 | 11 s | 15 s | 20 |
| 6 | 6 s | 14 s | **0 (cerrada del todo)** |

En la barra superior verás la **cuenta atrás de la partida** (`⏱ 2:14`),
el aviso de la zona (`cierra en Xs`), los **vivos** y tus **bajas**.

### 🏆 Fin de partida

Cuando solo queda **1 jugador vivo** (o se acaba el tiempo), aparece en pantalla:

- **🏆 ¡GANADOR!** con su nombre y sus bajas.
- **"Nueva partida en X s"** (12 segundos).
- Al empezar la siguiente partida **todos reviven**, el **loot vuelve a
  aparecer** y la **zona se reinicia** (radio 300).

## 🎁 Loot (objetos en el suelo)

Repartidos por el mapa hay **64 objetos**. Se recogen **automáticamente al pasar
por encima** (verás el objeto girando y flotando).

| Objeto | Cantidad | Efecto | Cómo se usa |
| --- | --- | --- | --- |
| 🔫 **Caja de arma** | ~22 | Te da esa arma con el **cargador lleno** | Automático al recogerla |
| 🩹 **Botiquín** | ~21 | +40 de vida | Tecla **F** o botón **🩹** |
| 🛡️ **Chaleco** | ~21 | +50 de escudo | Tecla **G** o botón **🛡️** |

- **Empiezas la partida SIN ARMA** (vas con las manos vacías): lo primero que
  tienes que hacer es **buscar una caja 🔫** para poder disparar.
- Se guardan en tu **inventario** (verás el número en cada botón).
- El **escudo** absorbe el daño **antes** que la vida: es como un "chaleco".
- Máximo de vida 100 y de escudo 100.

## Armas

Hay **3 armas** repartidas por el mapa en cajas 🔫. Cuando recoges una
**la guardas** y puedes cambiar entre las que tengas con **1 / 2 / 3**, la
**rueda del ratón** o el botón **🔫** en el móvil. Se recargan con **R** o el
botón **⟳**.

> Si no tienes ninguna arma, el HUD pone **"Sin arma · busca 🔫"** y no
> puedes disparar. El **auto apuntado** tampoco se activa hasta que lleves una.

| Arma | Daño | Cadencia | Cargador | Alcance | Notas |
| --- | --- | --- | --- | --- | --- |
| 🔫 **Rifle** | 34 | Rápida (automático) | 30 | Medio-largo | Todo terreno, mantén pulsado |
| 💥 **Escopeta** | 13 × 8 perdigones | Lenta | 6 | Corto | Devastadora de cerca |
| 🎯 **Francotirador** | 85 | Muy lenta | 5 | Muy largo | Casi mata de un tiro |

La munición es **infinita** (solo cuentas las balas del cargador); al vaciarlo
se recarga automáticamente. Al empezar una **partida nueva vuelves a estar
desarmado** y hay que volver a buscar armas.

### 🔭 Miras y apuntar con zoom

Cada arma tiene **su propia mira**: el **francotirador** una **telescópica**, el
**rifle** un **punto rojo** y la **escopeta** solo el punto del cañón (sin óptica).
Además puedes **apuntar con zoom (ADS)**:

- **PC:** mantén pulsado el **clic derecho**.
- **Móvil:** toca el botón **🎯** (se queda puesta hasta que lo quites).

Mientras apuntas, la cámara **se acerca al hombro** y hace **zoom** (con el
francotirador mucho más: aparece su **visor** con la cruz), el arma es **más
precisa** (la dispersión se reduce) y **te mueves más despacio**. Los demás
jugadores ven **qué arma llevas** en la mano.

## 🗺️ Minimapa (radar)

Arriba a la **izquierda** (en todos los dispositivos) hay un **radar** que
muestra un radio de **170 unidades** a tu alrededor:

- **Flecha blanca** en el centro: tú. Gira según hacia dónde miras.
- **Puntos rojos**: los otros jugadores. Se hacen **más grandes y con borde
  blanco** cuando están a menos de 60 unidades (los "cercanos").
- **Nombre**: debajo de cada punto rojo verás **el nombre de ese jugador**,
  para saber quién es quién de un vistazo.
- **Aro azul**: el borde de la zona segura.
- **Fondo rojizo + flecha azul**: aparece cuando estás **fuera de la zona**,
  y la flecha señala hacia el centro para que sepas hacia dónde correr.
- **N**: el norte (arriba = norte).

## ⚙ Ajustes (esquina superior derecha)

Pulsa el **icono de engranaje** (siempre visible, arriba a la derecha) para abrir
el panel. En PC también se abre con la tecla **O** (pulsa **ESC** antes si estás
jugando). Los ajustes se **guardan** en el navegador.

| Ajuste | Qué hace |
| --- | --- |
| **Sensibilidad de cámara** | Cuánto gira la vista al arrastrar el dedo / mover el ratón |
| **Velocidad del joystick de apuntado** | Cuánto gira la cámara con el joystick derecho |
| **Auto apuntado** (on/off) | Activa o desactiva la ayuda de apuntado |
| **Fuerza del auto apuntado** | Cuán fuerte y amplio es el enganche al enemigo |

**Auto apuntado:** mientras disparas o usas el joystick de apuntado, la mira se
**imanta suavemente** hacia el enemigo más cercano a la cruz, sin llegar a
secuestrar el control. Cuando tiene a alguien fijado, la **mira se pone dorada**.
Bájalo o apágalo si lo prefieres más "puro".

## Estructura

```
juego_vipe/
├── package.json
├── server.js          # Servidor: archivos + estado autorizado del juego
└── public/
    ├── index.html     # Interfaz y menú
    ├── style.css      # HUD y menús
    └── game.js        # Motor 3D, controles, disparos y red
```

## Ideas para continuar

- Más loot: granadas, munición limitada, cascos, acoplar/quitar miras.
- Escudos y botiquines con animación de uso y tiempo de curación.
- Modelos 3D reales (exportados) en vez de cápsulas.
- Zona con forma y tiempos configurables, escudos.
- Salas/lobbies y modo espectador.
- Desplegar en internet (Render, Railway, Fly.io) para jugar con cualquiera.

> Es un **prototipo**. El servidor confía en la posición que reporta cada cliente,
> así que no está pensado para partidas competitivas con desconocidos.
