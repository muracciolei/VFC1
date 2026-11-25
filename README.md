# VFC 1 — Una Fuga Italiana

Sandbox de crimen open world ambientado en una Mini Italia comprimida. Hecho con Three.js, TypeScript y Vite. Todo el arte y el audio son procedurales; no hay backend ni assets de terceros.

## Jugar

- **GitHub Pages:** https://muracciolei.github.io/VFC1/
- **Local:** `npm install` y `npm run dev`
- **Producción:** `npm run build` genera `dist/`

El juego está pensado para móvil en horizontal. En escritorio se juega con teclado y ratón; en teléfono aparecen los controles táctiles.

## Controles

| Acción | Teclado | Táctil |
|---|---|---|
| Mover | WASD / flechas | Joystick izquierdo |
| Mirar | Ratón (pointer lock) | Arrastrar en pantalla |
| Entrar / interactuar | E | Botón contextual |
| Saltar | Espacio | SALTA |
| Correr | Shift | CORRI |
| Apuntar | Botón derecho | MIRA |
| Disparar | Clic izquierdo | SPARA |
| Recargar | R | RICA |
| Cambiar arma | Q | Botón del arma |
| Cámara | C | CAM |
| Mapa | M / Tab | MAP |
| Pausa | Esc / P | II |
| Claxon | H | CLACSON |
| Raddrizzar vehículo | X | RESET |

## Deploy en GitHub Pages

El workflow `.github/workflows/deploy.yml` compila y publica `dist/` en cada push a `main`.

Si es la primera publicación, en GitHub ve a **Settings → Pages → Build and deployment → Source** y elige **GitHub Actions**. Después ejecuta el workflow desde **Actions → Deploy VFC 1 to GitHub Pages → Run workflow** o haz un push a `main`.

Vite usa `base: './'`, así que la build funciona tanto en la raíz de un dominio como en un subdirectorio de proyecto (`/VFC1/`).

## Scripts

```bash
npm run dev        # servidor local
npm run typecheck  # TypeScript sin emitir
npm run build      # typecheck + build de producción
npm run preview    # previsualizar dist/
```

## Estado

La hoja de ruta mobile-first y la auditoría técnica están en [`PLAN_MEJORA_MOBILE.md`](./PLAN_MEJORA_MOBILE.md).
