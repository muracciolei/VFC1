/**
 * Sky, lighting, day/night cycle and weather.
 */

import * as THREE from 'three';
import { clamp01, damp, lerp, smoothstep } from '../core/math';
import { events } from '../core/events';
import { GameSettings } from '../core/settings';
import { MaterialLibrary } from './materials';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'fog' | 'storm';

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'SERENO',
  cloudy: 'NUVOLOSO',
  rain: 'PIOGGIA',
  fog: 'NEBBIA',
  storm: 'TEMPORALE',
};

interface WeatherState {
  cloud: number;
  rain: number;
  fog: number;
  sun: number;
}

const WEATHER_STATES: Record<WeatherKind, WeatherState> = {
  clear: { cloud: 0.12, rain: 0, fog: 0.00026, sun: 1 },
  cloudy: { cloud: 0.62, rain: 0, fog: 0.00038, sun: 0.66 },
  rain: { cloud: 0.88, rain: 0.7, fog: 0.00062, sun: 0.42 },
  fog: { cloud: 0.5, rain: 0, fog: 0.0015, sun: 0.5 },
  storm: { cloud: 1, rain: 1, fog: 0.0009, sun: 0.3 },
};

const DAY_TOP = new THREE.Color('#2f6fb2');
const DAY_HORIZON = new THREE.Color('#b9d2e2');
const DAY_BOTTOM = new THREE.Color('#93a7aa');
const NIGHT_TOP = new THREE.Color('#03060f');
const NIGHT_HORIZON = new THREE.Color('#0b1526');
const NIGHT_BOTTOM = new THREE.Color('#05080d');
const DUSK_TOP = new THREE.Color('#263c60');
const DUSK_HORIZON = new THREE.Color('#ff9a5c');
const DUSK_BOTTOM = new THREE.Color('#7b5a48');

export class Environment {
  readonly sky: THREE.Mesh;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly rain: THREE.LineSegments;
  private skyMat: THREE.ShaderMaterial;
  private rainMat!: THREE.ShaderMaterial;
  private mats: MaterialLibrary;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private settings: GameSettings;

  timeOfDay = 8.5;
  weather: WeatherKind = 'clear';
  private weatherTarget: WeatherState = { ...WEATHER_STATES.clear };
  private weatherCurrent: WeatherState = { ...WEATHER_STATES.clear };
  private weatherTimer = 140;
  private lightningTimer = 8;
  private flash = 0;
  private sunDir = new THREE.Vector3(0.5, 0.7, 0.3);
  private nightFactor = 0;
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    mats: MaterialLibrary,
    settings: GameSettings,
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.mats = mats;
    this.settings = settings;

    const skyGeo = new THREE.SphereGeometry(6800, 28, 18);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: DAY_TOP.clone() },
        uHorizon: { value: DAY_HORIZON.clone() },
        uBottom: { value: DAY_BOTTOM.clone() },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.2) },
        uSunColor: { value: new THREE.Color('#fff1d8') },
        uNight: { value: 0 },
        uCloud: { value: 0.15 },
        uCloudColor: { value: new THREE.Color('#f2f0ea') },
        uTime: { value: 0 },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 world = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uCloudColor;
        uniform float uNight;
        uniform float uCloud;
        uniform float uTime;
        uniform float uFlash;
        varying vec3 vDir;

        float hash21(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float s = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            s += vnoise(p) * a;
            p *= 2.03;
            a *= 0.5;
          }
          return s;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -1.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.62));
          col = mix(uBottom, col, smoothstep(-0.18, 0.04, h));

          // sun / moon disc + glow
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * pow(sd, 1400.0) * 7.0;
          col += uSunColor * pow(sd, 14.0) * 0.22;

          // clouds
          vec2 cp = d.xz / max(d.y, 0.07) * 0.55;
          float n = fbm(cp * 0.75 + vec2(uTime * 0.0035, uTime * 0.0015));
          float n2 = fbm(cp * 1.9 - vec2(uTime * 0.006, 0.0));
          float cover = smoothstep(0.52 - uCloud * 0.22, 0.8 - uCloud * 0.16, n * 0.7 + n2 * 0.3);
          cover *= smoothstep(0.0, 0.22, d.y) * uCloud;
          vec3 cloudCol = mix(uCloudColor, uSunColor, 0.15) * (1.0 - uNight * 0.72);
          col = mix(col, cloudCol, cover * 0.82);

          // stars
          vec2 sp = vec2(atan(d.z, d.x) * 1.7, asin(clamp(d.y, -1.0, 1.0)) * 1.7);
          vec2 grid = floor(sp * 62.0);
          float sh = hash21(grid);
          float star = smoothstep(0.994, 1.0, sh) * smoothstep(0.02, 0.24, d.y);
          star *= 0.55 + 0.45 * sin(uTime * 2.2 + sh * 90.0);
          col += vec3(0.9, 0.94, 1.0) * star * uNight * (1.0 - cover * 0.9) * 1.4;

          col += vec3(0.72, 0.82, 1.0) * uFlash * 0.35;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(skyGeo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.4);
    this.sun.castShadow = settings.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.camera.left = -95;
    this.sun.shadow.camera.right = 95;
    this.sun.shadow.camera.top = 95;
    this.sun.shadow.camera.bottom = -95;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(DAY_TOP, 0x4a4436, 0.85);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(DAY_HORIZON.getHex(), 0.00026);

    this.rain = this.createRain();
    scene.add(this.rain);

    this.applyWeather(true);
    this.updateLighting(0);
  }

  private createRain(): THREE.LineSegments {
    const COUNT = 900;
    const positions = new Float32Array(COUNT * 2 * 3);
    const offsets = new Float32Array(COUNT * 2);
    const tips = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * 90;
      const z = (Math.random() - 0.5) * 90;
      const oy = Math.random() * 46;
      const speedVar = 0.8 + Math.random() * 0.5;
      for (let v = 0; v < 2; v++) {
        const idx = (i * 2 + v) * 3;
        positions[idx] = x;
        positions[idx + 1] = 0;
        positions[idx + 2] = z;
        offsets[i * 2 + v] = oy;
        tips[i * 2 + v] = v;
        void speedVar;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('aTip', new THREE.BufferAttribute(tips, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);

    this.rainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uOpacity: { value: 0 },
        uHeight: { value: 46 },
      },
      vertexShader: /* glsl */ `
        attribute float aOffset;
        attribute float aTip;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uHeight;
        varying float vTip;
        void main() {
          float y = mod(aOffset - uTime * 26.0, uHeight);
          vec3 p = vec3(
            uCenter.x + position.x,
            uCenter.y + y - uHeight * 0.42 + aTip * 0.85,
            uCenter.z + position.z
          );
          vTip = aTip;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vTip;
        void main() {
          gl_FragColor = vec4(0.72, 0.8, 0.88, uOpacity * (0.28 + vTip * 0.3));
        }
      `,
    });
    const mesh = new THREE.LineSegments(geo, this.rainMat);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 3;
    return mesh;
  }

  setTime(hours: number): void {
    this.timeOfDay = ((hours % 24) + 24) % 24;
    this.updateLighting(0);
  }

  setWeather(kind: WeatherKind, immediate = false): void {
    if (this.weather === kind && !immediate) return;
    this.weather = kind;
    this.weatherTarget = { ...WEATHER_STATES[kind] };
    if (immediate) {
      this.weatherCurrent = { ...this.weatherTarget };
      this.applyWeather(true);
    }
    events.emit('world:weather', { kind });
  }

  private chooseWeather(): void {
    const roll = Math.random();
    let kind: WeatherKind = 'clear';
    if (roll < 0.46) kind = 'clear';
    else if (roll < 0.68) kind = 'cloudy';
    else if (roll < 0.84) kind = 'rain';
    else if (roll < 0.93) kind = 'fog';
    else kind = 'storm';
    this.setWeather(kind);
    this.weatherTimer = 110 + Math.random() * 160;
  }

  private applyWeather(immediate: boolean): void {
    const t = this.weatherTarget;
    const c = this.weatherCurrent;
    if (immediate) {
      c.cloud = t.cloud;
      c.rain = t.rain;
      c.fog = t.fog;
      c.sun = t.sun;
    }
    this.rain.visible = c.rain > 0.02;
    this.rainMat.uniforms.uOpacity.value = c.rain;
  }

  private updateLighting(dt: number): void {
    const hours = this.timeOfDay;
    const a = ((hours - 6) / 12) * Math.PI;
    const sunHeight = Math.sin(a);
    const sx = Math.cos(a);
    const sy = sunHeight;
    const sz = 0.32;
    const len = Math.hypot(sx, sy, sz) || 1;
    this.sunDir.set(sx / len, sy / len, sz / len);

    const day = smoothstep(-0.12, 0.16, sunHeight);
    this.nightFactor = 1 - day;
    const golden = clamp01(1 - Math.abs(sunHeight - 0.06) / 0.24) * day;

    const c = this.weatherCurrent;
    const top = NIGHT_TOP.clone().lerp(DAY_TOP, day);
    const horizon = NIGHT_HORIZON.clone().lerp(DAY_HORIZON, day);
    const bottom = NIGHT_BOTTOM.clone().lerp(DAY_BOTTOM, day);
    top.lerp(DUSK_TOP, golden * 0.6);
    horizon.lerp(DUSK_HORIZON, golden * 0.75);
    bottom.lerp(DUSK_BOTTOM, golden * 0.4);

    // overcast desaturation
    const grey = new THREE.Color('#7c848c').lerp(new THREE.Color('#20262c'), this.nightFactor);
    top.lerp(grey, c.cloud * 0.55);
    horizon.lerp(grey, c.cloud * 0.62);
    bottom.lerp(grey, c.cloud * 0.5);

    const sunColor = new THREE.Color('#ffb066').lerp(new THREE.Color('#fff4e2'), clamp01((sunHeight - 0.02) / 0.4));
    const moonColor = new THREE.Color('#8fb4e8');

    const isNight = sunHeight < -0.02;
    const lightDir = isNight
      ? new THREE.Vector3(-this.sunDir.x, Math.max(0.25, -this.sunDir.y), -this.sunDir.z).normalize()
      : this.sunDir;
    const lightColor = isNight ? moonColor : sunColor;
    const lightIntensity = isNight
      ? 0.34 * (1 - c.cloud * 0.55)
      : 2.6 * day * (1 - c.cloud * 0.55);

    this.sun.color.copy(lightColor);
    this.sun.intensity = lightIntensity + this.flash * 1.8;
    this.sun.castShadow = this.settings.shadows && !isNight;
    this.hemi.color.copy(top);
    this.hemi.groundColor.set('#8f8474');
    this.hemi.intensity = lerp(0.16, 1.5, day) * (1 - c.cloud * 0.28) + this.flash * 0.5;

    this.skyMat.uniforms.uTop.value.copy(top);
    this.skyMat.uniforms.uHorizon.value.copy(horizon);
    this.skyMat.uniforms.uBottom.value.copy(bottom);
    this.skyMat.uniforms.uSunDir.value.copy(isNight ? lightDir : this.sunDir);
    this.skyMat.uniforms.uSunColor.value.copy(lightColor);
    this.skyMat.uniforms.uNight.value = this.nightFactor;
    this.skyMat.uniforms.uCloud.value = c.cloud;
    this.skyMat.uniforms.uFlash.value = this.flash;
    this.skyMat.uniforms.uCloudColor.value
      .copy(new THREE.Color('#f4f1ea'))
      .lerp(new THREE.Color('#7d838c'), c.cloud * 0.35)
      .multiplyScalar(lerp(1, 0.25, this.nightFactor));

    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(horizon).multiplyScalar(lerp(1, 0.35, this.nightFactor));
    fog.density = c.fog;

    this.renderer.toneMappingExposure = lerp(1.28, 1.22, day) + this.flash * 0.15;

    // material night response
    this.mats.setNight(this.nightFactor);
    this.mats.lightPool.opacity = this.nightFactor * 0.62;

    const u = this.mats.water.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.copy(sunColor).multiplyScalar(lerp(0.1, 1, day));
    u.uSkyColor.value.copy(horizon);
    u.uFogColor.value.copy(fog.color);
    u.uFogDensity.value = fog.density;
    u.uNight.value = this.nightFactor;

    void dt;
  }

  /** Advance the clock and weather; camera/player position used for sky and rain. */
  update(dt: number, cameraPos: THREE.Vector3, playerPos: THREE.Vector3): void {
    this.elapsed += dt;
    this.timeOfDay += (dt * 0.6) / 60; // 0.6 game minutes per real second
    if (this.timeOfDay >= 24) this.timeOfDay -= 24;

    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) this.chooseWeather();

    const target = this.weatherTarget;
    const c = this.weatherCurrent;
    const k = 1 - Math.exp(-0.25 * dt);
    c.cloud = lerp(c.cloud, target.cloud, k);
    c.rain = lerp(c.rain, target.rain, k);
    c.fog = lerp(c.fog, target.fog, k);
    c.sun = lerp(c.sun, target.sun, k);
    this.rain.visible = c.rain > 0.02;
    this.rainMat.uniforms.uOpacity.value = c.rain;
    this.rainMat.uniforms.uTime.value = this.elapsed;
    this.rainMat.uniforms.uCenter.value.set(playerPos.x, playerPos.y + 4, playerPos.z);

    if (this.weather === 'storm') {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.flash = 1;
        this.lightningTimer = 4 + Math.random() * 9;
        events.emit('audio:explosion', { x: cameraPos.x, z: cameraPos.z });
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.2);

    this.updateLighting(dt);

    this.sky.position.copy(cameraPos);
    this.skyMat.uniforms.uTime.value = this.elapsed;

    // shadow camera follows the player
    const targetPos = playerPos;
    this.sun.target.position.set(targetPos.x, targetPos.y, targetPos.z);
    this.sun.position.set(
      targetPos.x + this.sunDir.x * 160,
      targetPos.y + Math.max(30, this.sunDir.y * 160),
      targetPos.z + this.sunDir.z * 160,
    );
    this.sun.target.updateMatrixWorld();

    if (this.settings.shadows) {
      const size = this.settings.quality === 'high' ? 2048 : 1024;
      if (this.sun.shadow.mapSize.x !== size) {
        this.sun.shadow.mapSize.set(size, size);
        if (this.sun.shadow.map) {
          this.sun.shadow.map.dispose();
          this.sun.shadow.map = null;
        }
      }
    }
  }

  get isNight(): boolean {
    return this.nightFactor > 0.55;
  }

  get timeLabel(): string {
    const h = Math.floor(this.timeOfDay) % 24;
    const m = Math.floor((this.timeOfDay % 1) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  get weatherLabel(): string {
    return WEATHER_LABEL[this.weather];
  }

  setShadows(enabled: boolean): void {
    this.settings.shadows = enabled;
    this.sun.castShadow = enabled;
    this.renderer.shadowMap.enabled = enabled;
    this.scene.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh && m.material) {
        const mat = m.material as THREE.Material;
        mat.needsUpdate = true;
      }
    });
  }

  /** Approximate sun elevation, for UI. */
  get sunElevation(): number {
    return this.sunDir.y;
  }
}
