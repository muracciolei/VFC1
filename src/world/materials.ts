/** Shared material library. Keeps draw calls low by reusing materials everywhere. */

import * as THREE from 'three';
import { FacadeStyle, TextureLibrary } from './textures';

export class MaterialLibrary {
  readonly facade: THREE.MeshLambertMaterial;
  readonly roof: THREE.MeshLambertMaterial;
  readonly shopfront: THREE.MeshLambertMaterial;
  readonly asphalt: THREE.MeshLambertMaterial;
  readonly sidewalk: THREE.MeshLambertMaterial;
  readonly terrain: THREE.MeshLambertMaterial;
  readonly markings: THREE.MeshBasicMaterial;
  readonly markingsYellow: THREE.MeshBasicMaterial;

  readonly props: THREE.MeshLambertMaterial;
  readonly propsDark: THREE.MeshLambertMaterial;
  readonly leaves: THREE.MeshLambertMaterial;
  readonly trunk: THREE.MeshLambertMaterial;
  readonly concrete: THREE.MeshLambertMaterial;
  readonly metal: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshStandardMaterial;
  readonly water: THREE.ShaderMaterial;

  readonly carBody: THREE.MeshStandardMaterial;
  readonly carGlass: THREE.MeshStandardMaterial;
  readonly tire: THREE.MeshLambertMaterial;
  readonly carLight: THREE.MeshBasicMaterial;
  readonly carTail: THREE.MeshBasicMaterial;
  readonly carAmber: THREE.MeshBasicMaterial;
  readonly policeBlue: THREE.MeshBasicMaterial;
  readonly policeRed: THREE.MeshBasicMaterial;
  readonly black: THREE.MeshLambertMaterial;
  readonly white: THREE.MeshLambertMaterial;

  readonly interiorWall: THREE.MeshLambertMaterial;
  readonly interiorFloor: THREE.MeshLambertMaterial;
  readonly marker: THREE.MeshBasicMaterial;
  readonly glow: THREE.MeshBasicMaterial;
  readonly lightPool: THREE.MeshBasicMaterial;

  constructor(tex: TextureLibrary) {
    this.facade = new THREE.MeshLambertMaterial({
      map: tex.facadeAtlas,
      emissiveMap: tex.facadeEmissiveAtlas,
      emissive: new THREE.Color('#ffb45e'),
      emissiveIntensity: 0,
      vertexColors: true,
    });

    this.roof = new THREE.MeshLambertMaterial({ map: tex.roof, vertexColors: true });
    this.shopfront = new THREE.MeshLambertMaterial({ map: tex.shopfront, vertexColors: true });
    this.asphalt = new THREE.MeshLambertMaterial({ map: tex.asphalt, color: '#8b8b8b' });
    this.sidewalk = new THREE.MeshLambertMaterial({ map: tex.sidewalk, color: '#b8b2a6' });
    this.terrain = new THREE.MeshLambertMaterial({
      map: tex.grass,
      vertexColors: true,
      color: '#ffffff',
    });
    this.markings = new THREE.MeshBasicMaterial({
      color: '#d8d4c8',
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.markingsYellow = new THREE.MeshBasicMaterial({
      color: '#d6b05a',
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.props = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.propsDark = new THREE.MeshLambertMaterial({ color: '#2b2d2f' });
    this.leaves = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.trunk = new THREE.MeshLambertMaterial({ color: '#5a4530' });
    this.concrete = new THREE.MeshLambertMaterial({ map: tex.concrete, color: '#b0aca3' });
    this.metal = new THREE.MeshStandardMaterial({ color: '#8c9296', metalness: 0.65, roughness: 0.42 });
    this.glass = new THREE.MeshStandardMaterial({
      color: '#3a4f59',
      metalness: 0.55,
      roughness: 0.16,
      transparent: true,
      opacity: 0.72,
    });

    this.carBody = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.45,
      roughness: 0.34,
    });
    this.carGlass = new THREE.MeshStandardMaterial({
      color: '#1d2a30',
      metalness: 0.6,
      roughness: 0.12,
      transparent: true,
      opacity: 0.82,
    });
    this.tire = new THREE.MeshLambertMaterial({ color: '#181a1b' });
    this.carLight = new THREE.MeshBasicMaterial({ color: '#fff4cf' });
    this.carTail = new THREE.MeshBasicMaterial({ color: '#c92f22' });
    this.carAmber = new THREE.MeshBasicMaterial({ color: '#e08a22' });
    this.policeBlue = new THREE.MeshBasicMaterial({ color: '#2e6dff' });
    this.policeRed = new THREE.MeshBasicMaterial({ color: '#ff2e2e' });
    this.black = new THREE.MeshLambertMaterial({ color: '#1a1c1e' });
    this.white = new THREE.MeshLambertMaterial({ color: '#e8e4da' });

    this.interiorWall = new THREE.MeshLambertMaterial({ color: '#b9ae9c' });
    this.interiorFloor = new THREE.MeshLambertMaterial({ color: '#6b5a45' });
    this.marker = new THREE.MeshBasicMaterial({ color: '#e8b25a', transparent: true, opacity: 0.85 });
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.lightPool = new THREE.MeshBasicMaterial({
      map: tex.lightPool,
      color: '#ffc478',
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });

    this.water = createWaterMaterial();
  }

  setNight(amount: number): void {
    this.facade.emissiveIntensity = amount * 0.85;
  }
}

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.7, 0.3) },
      uSunColor: { value: new THREE.Color('#ffe0b0') },
      uSkyColor: { value: new THREE.Color('#7fa6b8') },
      uDeepColor: { value: new THREE.Color('#123c46') },
      uShallowColor: { value: new THREE.Color('#2d7079') },
      uFogColor: { value: new THREE.Color('#b9c6c8') },
      uFogDensity: { value: 0.0005 },
      uNight: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormalW;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyColor;
      uniform vec3 uDeepColor;
      uniform vec3 uShallowColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uNight;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }

      void main() {
        vec2 p = vWorld.xz;
        float t = uTime;
        vec2 w1 = vec2(noise(p * 0.06 + t * 0.05), noise(p * 0.06 - t * 0.04));
        vec2 w2 = vec2(noise(p * 0.19 - t * 0.11), noise(p * 0.17 + t * 0.09));
        vec3 n = normalize(vec3((w1.x - 0.5) * 0.5 + (w2.x - 0.5) * 0.18, 1.0, (w1.y - 0.5) * 0.5 + (w2.y - 0.5) * 0.18));

        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), 3.0);

        vec3 sun = normalize(uSunDir);
        vec3 h = normalize(sun + viewDir);
        float spec = pow(max(dot(n, h), 0.0), 220.0) * 1.6;

        float depth = clamp(noise(p * 0.03 + 3.0) * 0.7 + 0.2, 0.0, 1.0);
        vec3 col = mix(uShallowColor, uDeepColor, depth);
        col = mix(col, uSkyColor, fres * 0.75);
        col += uSunColor * spec * (1.0 - uNight * 0.7);

        // subtle foam lines near the shore
        float foam = smoothstep(0.72, 0.95, noise(p * 0.35 + t * 0.15)) * 0.08;
        col += foam;

        float dist = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
        gl_FragColor = vec4(col, 0.9);
      }
    `,
  });
}
