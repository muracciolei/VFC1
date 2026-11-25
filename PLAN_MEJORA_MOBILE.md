# VFC 1 — Plan de mejora integral (mobile-first)

> **v2 · Auditoría: 2026-11-24**
> Reemplaza el plan v1. La v1 diagnosticaba que faltaban recarga, claxon, apuntar,
> voltear el coche, checkpoints, LOD y preset automático. **Todo eso ya está en el
> código.** El cuello de botella se movió: ahora es rendimiento de tráfico, sensación
> de conducción, continuidad de sesión y contenido concentrado en pocas ciudades.
>
> Base auditada: `src/` completo (35 módulos), `index.html`, `styles.css`, build de
> producción y mediciones previas del 24/11. No se modificó ningún archivo de juego.

---

## 0. Resumen para decidir en dos minutos

VFC 1 ya es un sandbox que **se puede jugar con dos pulgares**: joystick, acción
contextual, salto, sprint, apuntar, disparar, recargar, gas, freno, drift, claxon,
reset de vehículo, pausa, mapa, arma y cámara. También tiene apuntado asistido en
touch, checkpoints con reintento, LOD de ciudad por cuadrante y preset móvil
automático en el primer arranque.

Lo que hoy impide que se sienta como un juego comercial en un Android medio:

1. **El tráfico cuesta hasta ~80 draw calls** (4 meshes por vehículo) y las ruedas
   están fusionadas y quietas: los coches patinan y el frame se encarece.
2. **La sesión no sobrevive a una misión.** Al guardar con una misión activa, al
   reanudar vuelve al paso 0 (`MissionSystem.load` degrada `active` a `available`).
3. **El layout táctil no se adapta.** Solo se puede cambiar de lado el joystick y
   escalar todo; a escala 0.75 los botones de 54 px quedan en 40,5 px, por debajo
   del mínimo táctil de 48 px.
4. **Faltan las capas que hacen legible una persecución**: zona de búsqueda,
   bloqueos, helicóptero, escondites y indicador de daño.
5. **El contenido está en 5 de las 10 ciudades.** Hay 6 misiones; Napoli, Venezia,
   Bologna, Genova y Bari no tienen ninguna. El POI de carrera de Stelvio solo
   muestra un toast y `collectibles` se guarda pero no se usa.
6. **No hay PWA real**: hay manifest e icono, pero ningún service worker, así que
   no hay offline ni instalación confiable.

**Orden recomendado:** Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4.
Si solo hay tiempo para una cosa, que sea la **Fase 0**. Un juego que se traba a
30 FPS y pierde la misión al cambiar de app no se arregla agregando misiones.

---

## 1. North Star y métricas

Una sesión típica de **10 a 15 minutos** en un Android de gama media debe ser:

1. Abrir la app y estar jugando en menos de 10 segundos.
2. Robar un coche, conducir por una ciudad viva y perder a la policía.
3. Completar un trabajo corto, ganar dinero y ver una mejora concreta.
4. Salir en cualquier momento y volver exactamente donde estaba, incluso en medio
   de una misión.

**Métrica de éxito:** un jugador nuevo completa la primera misión y una actividad
secundaria usando solo el touch, sin abrir ajustes, sin trabarse y sin bajar de
30 FPS sostenidos.

### Presupuestos

| Métrica | Gama media (objetivo) | Gama alta |
|---|---|---|
| FPS | 30 estables (p95 frame < 33 ms) | 45–60 |
| Draw calls en escena típica | < 80 | < 140 |
| Triángulos visibles | < 500 K | < 1 M |
| Boot a jugable (4G) | < 10 s | < 6 s |
| Memoria | < 250 MB | < 400 MB |
| Crecimiento de memoria en 30 min | < 15 % | < 15 % |
| Peso inicial gzip | < 2,5 MB | < 2,5 MB |
| Latencia de input percibida | < 100 ms | < 80 ms |
| Tiempo de reanudación desde segundo plano | < 1 s | < 1 s |

> Los presupuestos de draw calls y triángulos son objetivos de diseño, no una
> medición actual. La única medición existente es la del 24/11 (ver §7.2) y se hizo
> en Chrome headless con SwiftShader: sirve para comparar geometría, **no** para FPS.

---

## 2. Estado actual verificado

### 2.1 Lo que ya está y no hay que rehacer

- **Controles touch completos y cableados**: `HUD.bindTouch` conecta joystick,
  acción, salto, sprint, ataque, mira, recarga, gas, freno, handbrake, claxon,
  reset, pausa, mapa, arma y cámara al `InputSystem`.
- **Apuntado asistido táctil**: cono de 8° y ~35 m en `CombatSystem.applyAimAssist`,
  activo solo cuando `tryPlayerShoot` recibe `isTouch`.
- **Botón MIRA separado**: `player.aiming` se activa con `aim` o `attack`; el botón
  de fuego dispara y el de mira sostiene el apuntado.
- **Recarga manual contextual**: el botón se oculta con cargador lleno o al conducir.
- **Claxon funcional**: `audio:honk`, pánico de peatones y vibración corta.
- **Reset de vehículo**: `Vehicle.resetUpright`, con cooldown de mensaje y shake.
- **Checkpoints y reintento**: `MissionSystem.retryLastFailure` y la pantalla
  `RIPROVA DAL CHECKPOINT`.
- **LOD de ciudad real**: `World.desiredSectorDetail` hornea cuadrantes lejanos con
  `detail=1`; en calidad baja el umbral baja de 560 a 330.
- **Calidad baja coherente**: sin sombras, `resolutionScale = 0.7`, decoración de
  balcón/aires/jardineras omitida en `CityBuilder.lowDetail`.
- **Preset móvil automático**: `main.ts` lo aplica en el primer arranque con puntero
  grueso y sin settings guardados; `?mobile=1` lo fuerza.
- **Resolución adaptativa**: `RenderSystem.updateAdaptive` baja a 0.62 y sube a 1.2,
  pero **solo con calidad `auto`**.
- **Tráfico y peatones**: 12 vehículos de tráfico + 8 aparcados, peatones
  instanciados con pánico y atropello.
- **Policía**: niveles 0–5, línea de visión, búsqueda con decaimiento, unidades a pie
  y patrullas, radio con subtítulos.
- **Misiones**: 6 misiones encadenadas, temporizadores, objetivos de robo,
  destrucción, supervivencia y escape.
- **Navegación**: ruta A* dibujada en el mundo con línea y baliza; waypoint en
  minimapa y mapa grande.
- **Economía**: garage, armería, hospital, emporio, distribuidor, aeropuerto,
  ferry a Sicilia, coches comprados y armas.
- **Guardado**: localStorage, autosave cada 60 s, `pagehide` y `visibilitychange`.
- **Audio procedural**: motor, sirena, lluvia, música ambiental, disparo, explosión,
  choque y claxon. Sin archivos externos.
- **UI**: menú, pausa, misiones, garage, ajustes, controles, diálogo, WASTED,
  pantalla de misión fallida, mapa grande, HUD y minimapa.
- **Accesibilidad básica**: lado del joystick, escala, sensibilidad, invertir Y,
  vibración, subtítulos, ayudas y overlay de métricas.

### 2.2 Lo que falta o está a medias

| Sistema | Estado actual | Brecha principal | Prioridad |
|---|---|---|---|
| Tráfico | 4 meshes por vehículo (body, glass, wheels, lights) | Hasta ~80 draws con 20 vehículos; sin LOD de vehículo | **P0** |
| Ruedas | Geometría fusionada y estática | No giran ni giran al volante; el coche parece flotar | **P0** |
| Luces | Mesh emisivo fijo | Sin freno, marcha atrás ni faros nocturnos | **P0** |
| Sesión | Autosave de posición y dinero | Misión activa vuelve al paso 0; no se guarda `stepIndex` | **P0** |
| Layout táctil | Lado, escala y sensibilidad | Sin reposicionar botones; escala mínima rompe el mínimo de 48 px | **P0** |
| Onboarding | Diálogo de 3 líneas al empezar | Sin tutorial interactivo ni pistas contextuales | **P0** |
| Cámara | Follow, presets, shake, FOV por velocidad | Falta look-ahead, distancia por velocidad y recuperación de vuelco guiada | **P0/P1** |
| Combate | Hitscan, 3 armas, asistencia, hit marker | Sin cobertura, melee, granadas, pickups ni daño direccional | **P1** |
| Policía | Niveles, LOS, búsqueda, patrullas | Sin zona visible, bloqueos, helicóptero, escondites ni soborno | **P1** |
| Tráfico urbano | Sigue links y velocidad | Sin semáforos, ceda el paso, adelantamientos ni reacción a sirenas | **P1** |
| Audio | Motor de 2 osciladores, sirena, ambiente | Sin radio, música dinámica de persecución, derrape ni frenos | **P1** |
| UI | HUD completo, mapa, minimapa | Sin ETA/distancia, ruta en minimapa, teléfono ni diario | **P1** |
| PWA | Manifest + icono | Sin service worker, offline ni prompt de instalación | **P1** |
| Interiores | POIs que abren menús | Sin escenas interiores; todo ocurre en la calle | **P1** |
| Contenido | 6 misiones en 5 ciudades | 5 ciudades sin misión; sin actividades secundarias | **P1** |
| Economía | Compras y servicios | Sin propiedades, mejoras de vehículo ni cosméticos | **P1** |
| Guardado | 1 slot local | Sin slots, export/import ni migración probada | **P1** |
| Accesibilidad | Básica | Sin tamaño de texto, daltonismo, reduced motion ni remapeo | **P1** |
| QA | Pruebas manuales | Sin smoke automatizado ni benchmark reproducible | **P1** |
| Legal | Nombres reales (`Vespa`, `Panda`) | Riesgo de marca si se publica | **P2** |

### 2.3 Correcciones al plan v1

| El plan v1 decía | Lo que hay hoy |
|---|---|
| “No hay botón de recarga” | `#btn-reload` existe, se muestra según estado y recarga con el cargador parcial. |
| “No hay claxon” | `#btn-horn`, `audio:honk` y reacción de peatones implementados. |
| “No se puede apuntar sin disparar” | `#btn-aim` sostiene `aiming`; `attack` dispara. |
| “No hay forma de desatascar el coche” | `#btn-reset` + `resetUpright`. |
| “El preset móvil no es automático” | Se aplica en el primer arranque touch sin settings guardados. |
| “La calidad baja no reduce geometría” | `lowDetail()` omite decoración y el LOD de sector usa umbral 330. |
| “Fallar una misión reinicia todo” | Hay checkpoints y `RIPROVA DAL CHECKPOINT`. |
| “No hay ruta GPS dibujada” | `NavigationSystem` dibuja una ruta A* en el mundo. |
| “El tráfico cuesta ~80 draws” | **Sigue siendo cierto** y es la prioridad técnica n.º 1. |
| “Las ruedas no giran” | **Sigue siendo cierto.** |
| “Falta pausa real al ocultar” | Se guarda al ocultar, pero el juego sigue simulando; falta pausar de verdad. |

---

## 3. Diagnóstico: las 12 fricciones móviles que más duelen

Ordenadas por impacto en la experiencia, no por facilidad.

1. **Tráfico caro en draw calls.** Cada vehículo son 4 meshes. Con 12 de tráfico,
   8 aparcados y patrullas, el costo llega a ~80 draws si están en cámara. En el
   spawn medido el total era 99, así que el tráfico es una fracción grande del frame.
   *Dirección:* fusionar body+glass con vertex colors, dejar luces aparte y ruedas
   instanciadas; después evaluar instancing por tipo para el tráfico.

2. **Ruedas quietas y coche sin luces reactivas.** Es el detalle que más rompe la
   ilusión de conducción: el coche se desplaza como un bloque. *Dirección:* ruedas
   con giro por velocidad, giro de las delanteras, freno/marcha atrás y faros de noche.

3. **La misión se pierde al reanudar.** `MissionSystem.load` convierte `active` en
   `available` y no restaura `stepIndex`, `timeLeft` ni el vehículo objetivo. En
   móvil, cambiar de app es normal; perder 8 minutos de misión es inaceptable.
   *Dirección:* persistir el estado activo completo y reanudarlo en el checkpoint.

4. **El layout táctil no se adapta al pulgar.** Solo hay lado del joystick y una
   escala global. A 0.75, los botones pequeños quedan en 40,5 px. *Dirección:* editor
   de posiciones, presets compacto/estándar, mínimo real de 48 px y modo una mano.

5. **No hay onboarding.** El jugador recibe tres líneas de diálogo y queda suelto en
   una ciudad. *Dirección:* tutorial de 5 pasos integrado en la primera misión,
   saltable y recordable desde ajustes.

6. **Apuntar es asistido pero no configurable ni legible.** No hay nivel de
   asistencia, indicador de dirección del daño ni feedback de impacto enemigo.
   *Dirección:* asistencia off/baja/alta, arco de daño, vignette de vida baja y
   melee contextual.

7. **La persecución no se lee.** La policía persigue, pero no hay zona de búsqueda,
   última posición conocida, bloqueos, helicóptero ni escondites. *Dirección:*
   escalado 1→5 con recursos distintos y una UI de búsqueda clara.

8. **El minimapa no muestra la ruta.** `NavigationSystem` dibuja la línea en el
   mundo, pero `HUD.updateMinimap` solo pinta el waypoint. No hay distancia ni ETA.
   *Dirección:* ruta simplificada en minimapa, flecha de próximo giro y metros.

9. **PWA incompleta.** Sin service worker no hay offline ni instalación confiable;
   el manifest solo declara la intención. *Dirección:* SW con cache runtime,
   actualización versionada y aviso de instalación en Android.

10. **Contenido desbalanceado.** 6 misiones en Milano (2), Torino, Roma, Firenze y
    Palermo; Napoli, Venezia, Bologna, Genova y Bari no tienen ninguna. El POI
    `stelvio` de tipo `race` solo muestra un toast. `collectibles` se persiste pero
    nunca se llena. *Dirección:* 12–15 misiones en 3 actos, actividades por ciudad y
    coleccionables reales.

11. **El mundo se recorre pero no se habita.** Sin interiores, propiedades, mejoras
    ni eventos. Los POIs son menús. *Dirección:* interiores modulares y una capa de
    progresión con ingresos pasivos y mejoras visibles.

12. **No hay laboratorio de rendimiento ni QA repetible.** La última medición fue
    headless con SwiftShader; los FPS no son representativos. *Dirección:* modo
    `?bench=1`, ruta fija, p50/p95, memoria y prueba en dispositivo real.

---

## 4. Principios de diseño mobile-first

1. **Dos pulgares, nunca tres acciones a la vez.** Mover, mirar y una acción.
2. **Un botón, muchos verbos.** `ENTRA`, `ROBA`, `HABLA`, `RECOGE`, `PAGA`, `SALTA`.
3. **Apuntar es asistido; disparar es un tap.** El jugador elige el objetivo
   aproximado y el juego perdona el resto.
4. **Conducir con una mano.** Gas/freno a la derecha, volante a la izquierda,
   asistencia de trayectoria y cámara que mira hacia delante.
5. **Misiones de 3–8 minutos.** Checkpoints, reintento en menos de 2 segundos y
   reanudación exacta al volver de segundo plano.
6. **Sesiones cortas.** Guardar sin pensar, reanudar sin menús y sin perder progreso.
7. **30 FPS estables > 60 FPS inestables.** La calidad visual escala; la jugabilidad no.
8. **UI en zonas de pulgar.** Objetivos ≥ 48 px, contraste AA, safe areas y nada
   crítico en el centro de la pantalla.
9. **Feedback inmediato.** Sonido, vibración corta, hit marker, números flotantes y
   minimapa.
10. **Todo se juega sin teclado.** Teclado y gamepad son extras, no requisitos.

---

## 5. Roadmap por fases

### Fase 0 — “Mobile Core” (P0)

**Duración estimada:** 5–7 sesiones.
**Objetivo:** que un jugador nuevo juegue 30 minutos en un Android medio, sin
frustrarse y sin perder progreso.

| # | Trabajo | Detalle | Archivos | Criterio de aceptación |
|---|---|---|---|---|
| 0.1 | Tráfico 2.0 | Fusionar body+glass en un mesh con vertex colors; luces en un mesh emisivo; ruedas en `InstancedMesh` de 4 con giro y dirección. LOD: a >120 m ocultar ruedas y luces traseras. | `entities/vehicle.ts`, `systems/vehicles.ts` | ≤ 3 meshes por vehículo; −25 % draw calls con 20 vehículos; mismo aspecto a 10 m. |
| 0.2 | Ruedas y luces | Giro por velocidad, dirección en las delanteras, luz de freno, marcha atrás y faros nocturnos. | `entities/vehicle.ts`, `effects/drivefx.ts` | A 50 km/h las ruedas giran; al frenar se encienden; de noche iluminan. |
| 0.3 | Sesión persistente | Guardar `stepIndex`, `timeLeft`, `targetVehicle` y estado de misión; reanudar en el checkpoint. Pausar simulación al ocultar y reanudar sin salto de cámara. | `core/save.ts`, `systems/missions.ts`, `core/game.ts` | Matar la pestaña en el paso 2/4 y volver: mismo paso, mismo tiempo y mismas municiones. |
| 0.4 | Layout táctil 2.0 | Editor de posiciones con drag & drop, presets compacto/estándar, modo una mano, mínimo 48 px real y persistencia. | `ui/hud.ts`, `ui/styles.css`, `core/settings.ts`, `index.html` | Ningún target < 48 px a escala mínima; sin solapamientos en 360×640 y 412×915; layout persiste. |
| 0.5 | Onboarding | Tutorial de 5 pasos dentro de la primera misión: mover, mirar, entrar al coche, conducir, disparar. Saltable y repetible. | `ui/menus.ts`, `core/game.ts`, `ui/hud.ts` | Un jugador nuevo completa `PRIMO GIRO` solo con touch y sin ayuda externa. |
| 0.6 | Cámara y conducción móvil | Look-ahead, distancia por velocidad, colisión de cámara, cámara trasera al revertir, zona muerta del joystick y curva de dirección. | `entities/camera.ts`, `entities/vehicle.ts`, `core/game.ts` | 5 minutos de conducción sin náuseas; recuperarse de un vuelco en < 2 s. |
| 0.7 | Combate táctil 2.0 | Asistencia off/baja/alta, recarga automática al vaciar, arco de daño, melee contextual, hit marker más legible. | `systems/combat.ts`, `entities/player.ts`, `ui/hud.ts`, `core/settings.ts` | 80 % de impactos a 20 m con un pulgar; el jugador sabe de dónde le disparan. |
| 0.8 | PWA offline | Service worker con precache del shell, cache-first para assets hasheados, network-first para `index.html`, versión y aviso de actualización. Prompt de instalación Android. | `public/sw.js`, `src/main.ts`, `index.html`, `manifest.webmanifest` | Tras la primera visita, recargar offline funciona; la app se instala en Android. |
| 0.9 | Feedback y audio móvil | Derrape, frenos, pasos, impactos, patrones de háptica por evento, vignette de vida baja y reacción al claxon. | `audio/audio.ts`, `ui/hud.ts`, `styles.css`, `core/game.ts` | Toda acción relevante tiene sonido + feedback visual o háptico. |
| 0.10 | Laboratorio de rendimiento | `?bench=1`: ruta fija de 60 s, registro de p50/p95, draw calls, triángulos y memoria; salida descargable. | `core/game.ts`, `core/renderer.ts`, `ui/metrics.ts` | Dos ejecuciones en el mismo dispositivo dan cifras comparables. |

**Definition of Done de la fase:** primera misión completada solo con touch; 30 FPS
estables en el dispositivo de referencia; 0 errores de consola en 30 minutos;
guardado/reanudación verificado en medio de una misión; offline tras la primera carga.

---

### Fase 1 — “Core Feel” (P0/P1)

**Duración estimada:** 7–9 sesiones.
**Objetivo:** que conducir, disparar, moverse y ser perseguido se sientan bien.

| # | Trabajo | Detalle | Archivos |
|---|---|---|---|
| 1.1 | Vehículos 2.0 | Suspensión visual (roll/pitch), daño por clase, humo y cristales, frenos/faros, intermitentes, matrícula, óxido y colores. Ómnibus, furgones y motos con handling propio. | `entities/vehicle.ts`, `systems/vehicles.ts`, `effects/drivefx.ts` |
| 1.2 | Combate 2.0 | Cobertura automática cerca de esquina, melee, granadas, pickups de munición/armadura, headshots, reacción al impacto, rueda de armas. | `systems/combat.ts`, `entities/player.ts`, `ui/hud.ts` |
| 1.3 | Policía 2.0 | Zona de búsqueda visible, última posición conocida, bloqueos con pinchos a 3+, helicóptero a 4–5, escondites (garaje/interior), soborno en questura, música de persecución. | `systems/police.ts`, `systems/missions.ts`, `audio/audio.ts`, `ui/hud.ts` |
| 1.4 | Tráfico y peatones 2.0 | Semáforos y prioridad de paso, adelantamientos, claxon, atascos, peatones que esperan y cruzan, reacciones a disparos y sirenas, densidad por distrito/hora. | `systems/vehicles.ts`, `systems/pedestrians.ts`, `world/roadnetwork.ts` |
| 1.5 | Audio 2.0 | Radio con 3 emisoras originales, motor multicapa por RPM, neumáticos, frenos, impactos, pasos, recarga, ambientes por ciudad, ducking y unlock iOS. | `audio/audio.ts`, `core/game.ts`, `effects/drivefx.ts` |
| 1.6 | UI/UX 2.0 | Distancia/ETA, próximo giro, ruta en minimapa, teléfono (mapa, misiones, radio, guardar), diario, filtros de mapa, indicador de daño direccional. | `ui/hud.ts`, `ui/bigmap.ts`, `ui/menus.ts`, `systems/navigation.ts` |
| 1.7 | Interiores | Escenas modulares para casa segura, garaje, armería, emporio y questura. Transición con fade, sin pantalla de carga. | `core/game.ts`, `world/city.ts`, `ui/menus.ts` |
| 1.8 | Accesibilidad | Tamaño de texto, daltonismo, reduced motion, hold/toggle para sprint y mira, intensidad de háptica, remapeo y modo una mano. | `core/settings.ts`, `ui/menus.ts`, `ui/styles.css` |

**Definition of Done:** persecución de 5 estrellas memorable y escapable; combate
resoluble con un pulgar; 30 FPS con toda la funcionalidad; interiores sin cargas.

---

### Fase 2 — “Contenido y progresión” (P1)

**Duración estimada:** 9–11 sesiones.
**Objetivo:** 10–12 horas de contenido y una razón para seguir jugando.

| # | Trabajo | Detalle |
|---|---|---|
| 2.1 | Historia en 3 actos | 12–15 misiones con personajes recurrentes y set pieces en las 10 ciudades. Acto 1 Milano/Torino, acto 2 Roma/Firenze/Napoli, acto 3 Palermo/Venezia/Bologna/Genova/Bari. |
| 2.2 | Actividades secundarias | Taxi, reparto, carreras (convertir `stelvio` en contrarreloj real), stunt jumps, 100 cartoline usando `collectibles`, apuestas, trabajos de grúa. |
| 2.3 | Economía 2.0 | 3 propiedades con ingresos pasivos, mejoras de motor/frenos/blindaje/nitro, mejoras de armas, ropa, barbería y concesionario. |
| 2.4 | Progresión | Notoriedad, desbloqueos por misión, logros, estadísticas, retos diarios y recompensas por ciudad. |
| 2.5 | Mundo 2.0 | Más landmarks, distritos con identidad, mercados, plazas, calles peatonales, aparcamientos subterráneos y aeropuertos. |
| 2.6 | Eventos dinámicos | Robos, accidentes, persecuciones improvisadas, carreras callejeras, festivales y clima severo. |
| 2.7 | Guardado 2.0 | 3 slots, export/import por código, migración de versión y resumen de partida. Nube solo si se acepta backend. |
| 2.8 | Localización | UI en italiano como identidad; agregar inglés y español sin duplicar lógica. |

**Definition of Done:** 10–12 h de historia + actividades; 3 formas distintas de ganar
dinero; progresión visible cada 30 minutos; 100 % de misiones completables en móvil.

---

### Fase 3 — “Vida y salto visual” (P2)

**Duración estimada:** 5–7 sesiones.
**Objetivo:** que cada ciudad y cada hora se vean distintas sin romper los 30 FPS.

| # | Trabajo | Detalle |
|---|---|---|
| 3.1 | Iluminación | Sombras por hora, luz volumétrica falsa, reflejos en charcos, faros reales, luces de ciudad y neón. |
| 3.2 | Materiales y partículas | PBR ligero, normal maps procedurales, asfalto mojado, lluvia, nieve, polvo, chispas, fuego, hojas y aves. |
| 3.3 | Postproceso móvil | Bloom barato, vignette y color grading por ciudad/hora; motion blur desactivado; AA según calidad. |
| 3.4 | Animación | Recarga, cobertura, entrada/salida de coche, muerte, conversación y peatones con móvil/paraguas. |
| 3.5 | Más variedad | Civiles por ciudad, uniformes policiales, ambulancias, bomberos, autobuses, tranvías, motos y barcos. |
| 3.6 | Mezcla de audio | Reverb por espacio, SFX únicos, prioridad de voces y sirena. |

**Definition of Done:** cada ciudad tiene identidad visual reconocible; 30 FPS en
calidad media; sin popping evidente.

---

### Fase 4 — “Lanzamiento” (P2)

**Duración estimada:** 4–5 sesiones.

- QA matrix en 4 tamaños de pantalla, Chrome Android, Safari iOS, tablet y desktop.
- Smoke automatizado con Playwright: boot → nueva partida → mover → entrar al coche
  → conducir → mapa → guardar → recargar → continuar.
- Laboratorio de rendimiento: FPS, frame time p95, memoria, batería y térmica en
  sesiones de 30–60 min.
- Legal y originalidad: renombrar `Vespa` y `Panda` si se publica; auditar marcas y
  assets; créditos y privacidad.
- Assets de tienda: iconos, splash, capturas, tráiler corto y descripción.
- Deploy verificado de `dist/` (Firebase Hosting, Cloudflare Pages o GitHub Pages).
- Documentación: controles, FAQ y changelog.

**Definition of Done:** deploy verificado, 0 errores críticos en 60 min, PWA
instalable y jugable offline tras la primera carga.

---

## 6. Sprint 0 — arranque inmediato (3–4 sesiones)

Orden exacto, de mayor a menor impacto. No abrir frentes nuevos hasta cerrar estos.

1. **Medir antes de tocar**: agregar `?bench=1` y correr la ruta fija en el Android
   de referencia. Guardar p50/p95, draws, triángulos y memoria como línea base.
2. **Tráfico 2.0**: fusionar body+glass, luces aparte, ruedas instanciadas. Medir de
   nuevo con la misma ruta.
3. **Ruedas y luces**: giro por velocidad, dirección delantera, freno y faros.
4. **Sesión persistente**: guardar y reanudar misión activa desde el checkpoint.
5. **Pausa real al ocultar**: detener simulación y audio, reanudar sin salto.
6. **Layout táctil**: editor de posiciones + mínimo 48 px + modo una mano.
7. **Onboarding**: 5 pasos dentro de `PRIMO GIRO`, saltables.
8. **Combate táctil**: niveles de asistencia + arco de daño + auto-recarga.
9. **PWA offline**: service worker, versión y aviso de actualización.
10. **Cierre**: primera misión solo con touch, 30 FPS estables, offline y
    reanudación en misión verificados en dispositivo real.

**Criterio de cierre del sprint:** un jugador que nunca vio el juego completa
`PRIMO GIRO` en menos de 8 minutos, sale de la app en el paso 2, vuelve y sigue
donde estaba. Sin teclado. Sin errores de consola.

---

## 7. Rendimiento

### 7.1 Presupuesto por escena

| Escena | Draw calls | Triángulos | Notas |
|---|---|---|---|
| Ciudad densa, jugador a pie | < 80 | < 500 K | Calidad baja, sombras off |
| Ciudad densa, conduciendo | < 90 | < 550 K | Incluye tráfico visible |
| Persecución 5 estrellas | < 110 | < 650 K | Helicóptero opcional |
| Carretera rural / montaña | < 50 | < 300 K | Menos chunks activos |
| Menú / mapa | < 10 | < 50 K | El mundo no se simula |

### 7.2 Protocolo de medición

- **Dispositivo real**, no emulador: Pixel 6a / Moto G Power / Galaxy A54.
- Chrome remote debugging por USB (`chrome://inspect`), Performance panel.
- Ruta fija de 60 s: spawn → 200 m en coche → giro → frenada → 100 m a pie.
- Tres ejecuciones; reportar p50, p95 y peor frame.
- `renderer.info.render.calls/triangles` en el pico de la ruta.
- `performance.memory` al inicio y a los 30 min.
- **No usar SwiftShader para FPS**: la medición del 24/11 sirve para comparar
  geometría (alta 564 K tri vs baja 477 K; frame 99 calls/463 K vs 98/413 K), no
  para afirmar que el juego corre a 30 FPS.

### 7.3 Palanca de optimización, por impacto

| Acción | Ahorro estimado | Riesgo | Fase |
|---|---|---|---|
| Fusionar body+glass+lights | Hasta −20 draws con 20 vehículos | Medio | 0 |
| Ruedas instanciadas | 0 draws extra; elimina 4 meshes por coche | Bajo | 0 |
| Instancing de tráfico por tipo | Hasta −56 draws | Alto | 1 |
| Sombras off en baja | −27 draws medidos | Ya aplicado | — |
| Resolución 0.7 en baja | −51 % píxeles medido | Ya aplicado | — |
| LOD de sector 330 m en baja | −15,5 % triángulos medido | Ya aplicado | — |
| Resolución adaptativa también en baja | 5–10 % frame time | Bajo | 1 |
| LOD de vehículo >120 m | −30 % triángulos de tráfico | Bajo | 0 |
| Cap de peatones a 26 | Estable | Ya aplicado | — |
| Presupuesto de construcción 1 chunk/frame | Elimina hitches | Ya aplicado, verificar | — |

> Los ahorros son **estimaciones de diseño**; solo los marcados “medido” tienen
> número real. Toda optimización se valida con la ruta fija antes de darla por hecha.

### 7.4 Riesgos técnicos de rendimiento

- **Overdraw** por humo, lluvia y cristales transparentes: limitar sprites y ordenar.
- **Sombras** son el gasto más caro en móvil: mantenerlas off en baja y una sola
  luz con sombra en media.
- **Memoria**: `unloadChunk` libera geometría, pero materiales y texturas deben ser
  compartidos; auditar fugas al cruzar 10 chunks.
- **Pérdida de contexto WebGL**: escuchar `webglcontextlost`, pausar y reconstruir
  recursos al `restored`.
- **Compilación de shaders**: el primer frame de una ciudad nueva produce hitch;
  precompilar con `renderer.compile` antes de mostrar.

---

## 8. Especificación de UX táctil

### Zonas

```
┌─────────────────────────────────────────────┐
│ HUD superior: dinero, vida, estrellas, reloj │  ← no interactivo
│                                             │
│              zona de cámara                 │  ← arrastrar para mirar
│              (mitad derecha)                │
│                                             │
│  joystick            acción   salto         │
│  (izquierda)         mira     recarga       │  ← pulgares
│                      ataque                 │
└─────────────────────────────────────────────┘
```

### Matriz de controles por estado

| Estado | Izquierda | Derecha | Contextual |
|---|---|---|---|
| A pie | Joystick | Arrastrar cámara | `ENTRA`, `LAVORO`, `SALVA`, `CURA` |
| Combate | Joystick | MIRA + SPARA + RICA | Melee si hay enemigo a < 2 m |
| Vehículo | Joystick/volante | Gas, freno, drift | `ESCI`, `CLACSON`, `RESET` |
| Pasajero | — | Cámara | `ESCI` |
| Menú | — | — | Botones ≥ 48 px, cierre con X |

### Reglas

- **Tamaño mínimo 48 × 48 CSS px** en cualquier escala. Si la escala baja de 0.89,
  los botones pequeños deben crecer en proporción inversa o separarse del escalado.
- **Separación mínima 8 px** entre targets.
- **Safe areas** en los cuatro bordes (`env(safe-area-inset-*)`), ya implementadas.
- **Landscape primario**; portrait muestra el aviso actual. No bloquear el juego en
  portrait si el usuario insiste: ofrecer “continuar así”.
- **Modo una mano**: joystick y acciones en el mismo lado, cámara en el opuesto;
  presets guardables.
- **Háptica**: 16 ms claxon, 30 ms disparo, 35 ms impacto, 45 ms aterrizaje, 60–70 ms
  daño/choque. Intensidad configurable.
- **Legibilidad**: texto de HUD ≥ 12 px efectivos, contraste AA, fondo semitransparente
  detrás de texto sobre cielo claro.
- **Sin botones muertos**: cada botón visible hace algo en ese estado.

---

## 9. Contenido por ciudad

| Ciudad | Misión actual | Rol hoy | Propuesta |
|---|---|---|---|
| Milano | `PRIMO GIRO`, `CONSEGNA SPECIALE` | Hub inicial, garage y armería | Tutorial + acto 1, mercado y moda |
| Torino | `SIRENE` | Persecución | Acto 1 policial, fábrica y muelles |
| Roma | `DEMOLIZIONE` | Destrucción | Acto 2, monumentos y tráfico denso |
| Firenze | `GRAN PREMIO DI FIRENZE` | Carrera | Acto 2, contrarreloj por colinas |
| Palermo | `ULTIMA FUGA` | Final | Acto 3, mercado y puerto |
| Napoli | — | Solo mundo | Acto 2, contrabando, Vesuvio y callejones |
| Venezia | — | Solo mundo | Acto 3, persecución en lancha (requiere navegación acuática) |
| Bologna | — | Solo mundo | Acto 3, pórticos y persecución a pie |
| Genova | — | Solo mundo | Acto 3, puerto, túneles y grúas |
| Bari | — | Solo mundo | Acto 3, entrega costera y aduana |

**Actividades reutilizables:** el POI `stelvio` ya existe como `race`; convertirlo en
contrarreloj es la actividad de menor costo y mayor impacto. `collectibles` ya está
en `SaveData`; las 100 cartoline solo necesitan spawn, recogida y contador.

---

## 10. QA y métricas

### Dispositivos de referencia

- **Gama media:** Moto G Power, Pixel 6a, Samsung A54.
- **Gama alta:** Pixel 8, iPhone 13+.
- **Pequeño:** iPhone SE (4,7").
- **Tablet:** iPad 10".

### Matriz mínima

| Prueba | Criterio |
|---|---|
| Boot en frío (4G) | < 10 s al menú; < 12 s a jugar |
| Nueva partida | Sin errores; ciudad visible; 20+ vehículos y 20+ peatones |
| Primera misión | Completable solo con touch, con checkpoints |
| Reanudación en misión | Mismo paso, tiempo y municiones tras matar la pestaña |
| Conducción 10 min | Sin vuelcos irrecuperables; ruedas giran; cámara estable |
| Persecución 5 estrellas | Escapable en < 3 min; sin caídas de FPS |
| Guardado/reanudación | Dinero, armas, vehículo y misión intactos |
| 30 min de sesión | Memoria < +15 %; sin errores; p95 < 33 ms |
| Orientación | Portrait muestra aviso; landscape no recorta HUD |
| Safe areas | Nada tapado por notch ni barra de gestos |
| Accesibilidad | Texto legible, contraste AA, targets ≥ 48 px |
| PWA | Instalable; abre offline tras la primera visita |

### Automatización

- Playwright con emulación de Pixel 6a e iPhone SE para humo funcional.
- `?bench=1` para rendimiento; no confundir emulación con dispositivo real.
- Captura de `renderer.info` y `performance.memory` en cada corrida.
- Test de regresión visual por ciudad/hora cuando exista Fase 3.

---

## 11. Riesgos y no objetivos

### Riesgos

- **Scope creep:** 15 misiones + interiores + mundo 2.0 es mucho. Congelar fases y no
  abrir frentes hasta cerrar la anterior.
- **Rendimiento:** cada adorno nuevo cuesta vértices. Medir en dispositivo real antes
  de cada fase; presupuesto automático.
- **Audio iOS:** el contexto requiere gesto; el unlock ya existe en `newGame`, pero
  debe cubrir “CONTINUA” y el primer tap en menú.
- **Guardado:** versionar y migrar; nunca borrar progreso sin confirmación.
- **Legal:** renombrar marcas reales si se publica; todo el arte debe ser original.
- **Firebase:** el deploy requiere login interactivo del usuario; el asistente no
  puede hacerlo.

### No objetivos (por ahora)

- Multijugador en línea.
- Backend obligatorio o cuentas.
- Assets con licencia de terceros.
- Realismo gráfico tipo GTA VI.
- Doblaje de voz profesional.
- 60 FPS garantizados en gama baja.
- Navegación acuática completa (barcos) antes de Fase 3.

---

## 12. Decisiones abiertas (con default recomendado)

1. **Plataforma:** ¿Android primero o Android + iOS? → **Android primero**, iOS como
   smoke test en Fase 4.
2. **Duración de sesión:** ¿5–10 min o 20–30? → **10–15 min**, con guardado en
   cualquier momento.
3. **Nube:** ¿guardado solo local o sync? → **local primero**; nube solo si hay
   backend y cuentas.
4. **Marcas:** ¿renombrar `Vespa`/`Panda`? → **sí, antes de publicar**.
5. **Alcance de historia:** ¿12 misiones pulidas en 10 ciudades o 15 en 5? →
   **12 pulidas en todas las ciudades**.
6. **Portrait:** ¿bloquear o permitir? → **landscape recomendado**, portrait con
   aviso y opción de continuar.

---

## 13. Definición de terminado global

VFC 1 está listo para publicar cuando:

- [ ] Un jugador nuevo completa la primera misión y una actividad solo con touch.
- [ ] 30 FPS estables (p95 < 33 ms) en el dispositivo de referencia, 30 minutos.
- [ ] Cero errores de consola y cero fugas de memoria > 15 % en 30 minutos.
- [ ] Guardar, salir, volver y reanudar funciona en cualquier punto, incluida misión.
- [ ] La app se instala y abre offline tras la primera visita.
- [ ] Todos los targets táctiles son ≥ 48 px y respetan safe areas.
- [ ] Las 10 ciudades tienen al menos una razón de gameplay para visitarlas.
- [ ] No hay marcas reales ni assets de terceros sin licencia.
- [ ] `npm run typecheck` y `npm run build` pasan; `dist/` está verificado.
- [ ] El deploy está publicado y la URL final fue probada en un teléfono real.

---

> **Siguiente paso concreto:** Sprint 0, punto 1. Agregar `?bench=1`, medir la ruta
> fija en un Android real y recién después tocar el tráfico. Sin línea base, cualquier
> “mejora” de rendimiento es una opinión.
