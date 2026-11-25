# VFC 1 — Deploy

El juego es 100% frontend (Three.js + TypeScript compilado con Vite). No hay backend,
no hay base de datos: solo se sube la carpeta `dist/`.

Ruta absoluta de la carpeta de deploy:
`C:\Users\Ivan\Documents\GAMES\VFC_1\dist`

## 1) Estado actual

La carpeta de deploy ya está generada y verificada:

```
C:\Users\Ivan\Documents\GAMES\VFC_1\dist
├── index.html
├── manifest.webmanifest
├── icon.svg
└── assets
    ├── index-IQ75lmRF.js      (juego)
    ├── three-Bu1Q2ejE.js      (three.js)
    └── index-BC8KErym.css     (estilos)
```

Para regenerarla en cualquier momento:

```powershell
cd C:\Users\Ivan\Documents\GAMES\VFC_1
npm run build
```

---

## 2) Opción A — Firebase Hosting (la que ya está configurada)

Archivos creados en la raíz del proyecto:

- `firebase.json` → apunta a `dist`, con rewrites SPA y cabeceras de caché.
- `.firebaserc.example` → plantilla para tu project id.

Pasos (solo los tenés que hacer vos, porque pide login interactivo):

```powershell
# 0) si todavía no tenés la CLI
npm i -g firebase-tools

# 1) login con tu cuenta de Google
firebase login

# 2) elegir el proyecto (crealo antes en https://console.firebase.google.com)
cd C:\Users\Ivan\Documents\GAMES\VFC_1
firebase use --add          # elegí tu proyecto cuando lo pregunte
#    (o copiá el id a mano):
#    copy .firebaserc.example .firebaserc  → y editá "TU-PROYECTO-FIREBASE"

# 3) firebase.json ya apunta a dist/ (no hace falta tocar nada)

# 4) deploy
firebase deploy --only hosting
```

Después te da una URL tipo `https://TU-PROYECTO.web.app`.

Para futuras actualizaciones, siempre el mismo ciclo:

```powershell
npm run build
firebase deploy --only hosting
```

> Nota: si el proyecto es nuevo y no tiene Hosting inicializado, `firebase init hosting`
> detecta el `firebase.json` existente y solo pide la carpeta pública → poné `dist`.

---

## 3) Opción B — Cloudflare Pages

No necesita ningún archivo extra. En el dashboard de Cloudflare:

1. Pages → **Create a project** → conectá el repo (o subí la carpeta con Wrangler).
2. Configuración de build:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** 20 o superior
3. Deploy. La SPA está resuelta por `./` en los assets, así que funciona en subcarpeta.

Con Wrangler (CLI):

```powershell
npm i -g wrangler
wrangler login
wrangler pages deploy dist --project-name=vfc-1
```

---

## 4) Opción C — GitHub Pages

`vite.config.ts` ya usa `base: './'`, así que sirve para `https://usuario.github.io/repo/`:

```powershell
git init
git add -A
git commit -m "VFC 1"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/vfc-1.git
git push -u origin main

# rama de deploy
git checkout --orphan gh-pages
git --work-tree=dist add --all
git commit -m "build VFC 1"
git push -u origin gh-pages
```

Y activá **Settings → Pages → Branch: gh-pages / root**.

---

## Checklist pre-deploy

- [x] `npm run build` sin errores (tsc + vite build)
- [x] `dist/index.html` referencia assets con rutas relativas `./assets/...`
- [x] manifest + icono copiados desde `public/`
- [x] Sin dependencias de red (todo procedural, sin archivos de audio ni texturas externas)
- [x] Guardado en `localStorage` (funciona en cualquier host)

## Mejoras visuales (última pasada)

### Avatares
- Personajes reconstruidos con cilindros cónicos y esferas en vez de cajas: hombros, cintura, cuello, orejas, nariz, ojos, cejas, sombrero con visera y mochila.
- Rodillas y codos articulados: caminar con balanceo de piernas/brazos, flexión de rodilla, trote, salto, apuntar y caída al morir.
- Peatones instanciados mejorados (8 draw calls): torso cónico, cabeza esférica, pelo con 6 colores, zapatos y balanceo con subida del cuerpo.

### Arquitectura
- **Bug crítico corregido:** `CityBuilder` se construía antes de `RoadNetwork.build()`, así que las cuadrículas estaban vacías y **no se generaba ningún edificio**. Ahora `prepare()` se llama tras construir las carreteras (16 sectores, ~337K vértices).
- **Bug crítico corregido:** la animación del personaje sobrescribía la posición Y mundial y los avatares quedaban enterrados bajo el terreno. El balanceo vive ahora en un grupo rig interno.
- Spawn movido a un cruce libre (el anterior quedaba pegado a una pared al activarse la colisión de edificios).
- 2 estilos de fachada nuevos (`medieval`, `barocco`) en las casillas libres del atlas; ventanas con desfase aleatorio por edificio.
- Tejados con paleta por ciudad y más vida: depósitos de agua, paneles solares, pérgolas, antenas, parabólicas y chimeneas.
- Tendederos ("panni stesi") en fachadas mediterráneas, palmeras en ciudades costeras.
- Vesuvio propio para Nápoles (antes se generaba un castillo): cono estratificado, cráter, coladas de lava y columna de humo.
- Iluminación ambiental diurna más legible en las calles.

## Pruebas realizadas sobre `dist/` (build de producción)

Verificado en navegador real contra `npm run preview`:

- Arranque: menú en italiano, botones CONTINUA/NUOVA PARTITA/IMPOSTAZIONI/COMANDI, sin errores de consola.
- Nueva partida: mundo generado (20 vehículos, 23 peatones, 25 chunks, 16 sectores de ciudad), HUD con cash/región/reloj/cielo.
- A pie y en vehículo: prompt contextual, entrar/salir, velocímetro, conducción a 55 km/h, 60 FPS.
- POIs (104, todos separados entre sí tras el fix de `snapPois`): casa sicura (guarda + cura), garage, armeria (compra de armas/munición), hospital, emporio (chaleco), distributore, questura (soborno), puerto → **traghete a Sicilia**.
- Misiones: `PRIMO GIRO` completada de punta a punta (3 objetivos) → recompensa €900, estado `done`, siguiente misión disponible.
- Policía: `forceLevel(4)` → 4 estrellas + volante + agente; `clearWanted()` → limpia. Matar/disparar peatones sube el nivel buscado.
- Muerte: pantalla WASTED con coste médico → respawn con cura, cash descontado y wanted a 0.
- Teclado: Escape cierra pausa/mapa/misiones/ajustes; M abre el mapa; waypoint en el mapa; minimap con waypoint y marcador de misión.
- Guardado: manual desde pausa, autosave cada 60 s, CONTINUA restaura la partida.