/**
 * Procedural humanoid used for the player, police officers and mission cast.
 *
 * The silhouette is built from tapered cylinders and spheres instead of plain
 * boxes: shoulders, waist, knees, elbows, face and clothing read much better
 * at a distance while keeping the part count low enough for mobile GPUs.
 */

import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface CharacterLook {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  shoes: string;
  hat?: string;
  vest?: string;
  backpack?: string;
}

const materialCache = new Map<string, THREE.MeshLambertMaterial>();
const geometryCache = new Map<string, THREE.BufferGeometry>();

function mat(color: string): THREE.MeshLambertMaterial {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    materialCache.set(color, m);
  }
  return m;
}

/** Cached geometry factory: identical parts are shared across all characters. */
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g;
}

function taper(
  top: number,
  bottom: number,
  height: number,
  segments = 8,
): THREE.BufferGeometry {
  const key = `t${top}_${bottom}_${height}_${segments}`;
  return geo(key, () => new THREE.CylinderGeometry(top, bottom, height, segments, 1));
}

function ball(radius: number, w = 10, h = 8): THREE.BufferGeometry {
  return geo(`s${radius}_${w}_${h}`, () => new THREE.SphereGeometry(radius, w, h));
}

function slab(w: number, h: number, d: number): THREE.BufferGeometry {
  return geo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function hairCap(radius: number): THREE.BufferGeometry {
  return geo(`hair${radius}`, () =>
    new THREE.SphereGeometry(radius, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.56),
  );
}

function placed(
  source: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = source.clone();
  g.translate(x, y, z);
  return g;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!result) throw new Error('Character geometry merge failed');
  return result;
}

function mesh(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
  const m = new THREE.Mesh(geometry, mat(color));
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

interface Joint {
  group: THREE.Group;
  lower: THREE.Group;
}

function makeLeg(look: CharacterLook, side: -1 | 1): Joint {
  const group = new THREE.Group();
  group.position.set(side * 0.115, 0.9, 0);

  const upper = mesh(taper(0.097, 0.078, 0.44, 8), look.pants);
  upper.position.y = -0.22;

  const knee = new THREE.Group();
  knee.position.y = -0.44;
  const lower = mesh(taper(0.078, 0.058, 0.42, 8), look.pants);
  lower.position.y = -0.21;
  const shoe = mesh(merged([slab(0.12, 0.1, 0.25)]), look.shoes);
  shoe.position.set(0, -0.43, 0.055);
  knee.add(lower, shoe);

  group.add(upper, knee);
  return { group, lower: knee };
}

function makeArm(look: CharacterLook, side: -1 | 1): Joint {
  const group = new THREE.Group();
  group.position.set(side * 0.275, 1.45, 0);

  const upper = mesh(taper(0.079, 0.062, 0.32, 8), look.shirt);
  upper.position.y = -0.16;
  const shoulder = mesh(ball(0.085, 8, 6), look.shirt);

  const elbow = new THREE.Group();
  elbow.position.y = -0.32;
  const forearm = mesh(taper(0.062, 0.05, 0.29, 8), look.shirt);
  forearm.position.y = -0.145;
  const hand = mesh(ball(0.065, 8, 6), look.skin);
  hand.position.y = -0.31;
  elbow.add(forearm, hand);

  group.add(shoulder, upper, elbow);
  return { group, lower: elbow };
}

export type CharacterWeapon = 'pistol' | 'smg' | 'shotgun';

/** Low-poly firearm held in the right hand, merged to one or two meshes. */
function weaponModel(id: CharacterWeapon): THREE.Group {
  const group = new THREE.Group();
  const add = (parts: THREE.BufferGeometry[], color: string): void => {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) return;
    const m = new THREE.Mesh(geometry, mat(color));
    m.castShadow = true;
    group.add(m);
  };

  if (id === 'pistol') {
    add(
      [
        placed(slab(0.058, 0.13, 0.075), 0, 0, -0.005),
        placed(slab(0.052, 0.21, 0.055), 0, -0.1, 0.035),
        placed(slab(0.024, 0.05, 0.024), 0, -0.22, 0.035),
      ],
      '#2f3235',
    );
  } else if (id === 'smg') {
    add(
      [
        placed(slab(0.072, 0.36, 0.085), 0, -0.14, 0.02),
        placed(slab(0.045, 0.18, 0.05), 0, -0.02, -0.095),
        placed(slab(0.038, 0.26, 0.038), 0, -0.33, 0.03),
        placed(slab(0.02, 0.09, 0.05), 0, -0.02, 0.13),
      ],
      '#2b2d30',
    );
  } else {
    add(
      [
        placed(slab(0.048, 0.62, 0.048), 0, -0.3, 0.03),
        placed(slab(0.05, 0.16, 0.05), 0, -0.05, 0),
      ],
      '#3a3d41',
    );
    const stock = [
      placed(slab(0.075, 0.26, 0.09), 0, -0.22, -0.005),
      placed(slab(0.07, 0.2, 0.09), 0, 0.07, -0.02),
    ];
    const wood = mergeGeometries(stock, false);
    for (const part of stock) part.dispose();
    if (wood) {
      const m = new THREE.Mesh(wood, mat('#6b4a2e'));
      m.castShadow = true;
      group.add(m);
    }
  }

  group.position.set(0, -0.34, 0.045);
  return group;
}

export class CharacterModel {
  /** World-space root: Game/Player position this every frame. */
  readonly group = new THREE.Group();
  /** Local rig: animation moves this, never the world-space root. */
  private rig = new THREE.Group();
  private legL: Joint;
  private legR: Joint;
  private armL: Joint;
  private armR: Joint;
  private head = new THREE.Group();
  private phase = 0;
  private walkAmp = 0;
  private deadTime = 0;
  private bob = 0;
  private sprintAmp = 0;
  private landAmp = 0;
  private idleTime = 0;
  private readonly weapons = new Map<CharacterWeapon, THREE.Group>();
  private activeWeapon: CharacterWeapon | null = null;
  readonly height = 1.8;

  constructor(look: CharacterLook) {
    this.legL = makeLeg(look, -1);
    this.legR = makeLeg(look, 1);
    this.armL = makeArm(look, -1);
    this.armR = makeArm(look, 1);

    for (const id of ['pistol', 'smg', 'shotgun'] as CharacterWeapon[]) {
      const weapon = weaponModel(id);
      weapon.visible = false;
      this.weapons.set(id, weapon);
      this.armR.lower.add(weapon);
    }

    // Torso, waist and belt: a tapered outline reads as shoulders + chest.
    const torso = mesh(taper(0.245, 0.19, 0.58, 10), look.shirt);
    torso.position.y = 1.2;
    const hips = mesh(taper(0.19, 0.205, 0.22, 10), look.pants);
    hips.position.y = 0.88;
    const belt = mesh(taper(0.2, 0.2, 0.055, 10), '#202124');
    belt.position.y = 0.98;

    // Neck and face.
    const neck = mesh(taper(0.072, 0.078, 0.13, 8), look.skin);
    neck.position.y = 1.55;
    this.head.position.y = 1.58;
    const skull = mesh(ball(0.135, 12, 10), look.skin);
    skull.scale.set(1, 1.12, 0.94);
    skull.position.y = 0.135;
    const hair = mesh(hairCap(0.142), look.hair);
    hair.position.y = 0.15;
    hair.scale.set(1.02, 1.05, 0.98);

    const eyes = mesh(
      merged([
        placed(ball(0.018, 8, 6), -0.055, 0.155, 0.119),
        placed(ball(0.018, 8, 6), 0.055, 0.155, 0.119),
      ]),
      '#1a1715',
    );
    const brows = mesh(
      merged([
        placed(slab(0.055, 0.012, 0.02), -0.055, 0.19, 0.12),
        placed(slab(0.055, 0.012, 0.02), 0.055, 0.19, 0.12),
      ]),
      look.hair,
    );
    // Nose + ears + mouth, all skin/dark in a couple of merged meshes.
    const features = mesh(
      merged([
        placed(taper(0.026, 0.012, 0.075, 6), 0, 0.115, 0.135),
        placed(ball(0.035, 8, 6), -0.135, 0.125, 0),
        placed(ball(0.035, 8, 6), 0.135, 0.125, 0),
      ]),
      look.skin,
    );
    const mouth = mesh(placed(slab(0.07, 0.008, 0.01), 0, 0.073, 0.126), '#5b3730');
    this.head.add(skull, hair, eyes, brows, features, mouth);

    this.group.add(this.rig);
    this.rig.add(
      hips,
      belt,
      torso,
      neck,
      this.head,
      this.legL.group,
      this.legR.group,
      this.armL.group,
      this.armR.group,
    );

    if (look.vest) {
      const vest = mesh(taper(0.255, 0.2, 0.44, 10), look.vest);
      vest.position.y = 1.24;
      this.rig.add(vest);
    }
    if (look.hat) {
      const cap = mesh(
        merged([
          placed(taper(0.142, 0.15, 0.12, 12), 0, 0.235, 0),
          placed(new THREE.CylinderGeometry(0.154, 0.154, 0.03, 12), 0, 0.18, 0),
          // short peaked brim, not a full wide disc
          placed(slab(0.25, 0.022, 0.15), 0, 0.166, 0.13),
        ]),
        look.hat,
      );
      this.head.add(cap);
    }
    if (look.backpack) {
      const pack = mesh(
        merged([
          placed(slab(0.31, 0.4, 0.16), 0, 1.23, -0.22),
          placed(slab(0.33, 0.11, 0.18), 0, 1.42, -0.23),
          placed(slab(0.045, 0.42, 0.04), -0.17, 1.24, -0.13),
          placed(slab(0.045, 0.42, 0.04), 0.17, 1.24, -0.13),
        ]),
        look.backpack,
      );
      this.rig.add(pack);
    }

    this.group.traverse((o) => {
      o.frustumCulled = true;
    });
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /** Hand gun for the player and police; pass null to carry nothing. */
  setWeapon(id: CharacterWeapon | null): void {
    if (id === this.activeWeapon) return;
    this.activeWeapon = id;
    for (const [key, weapon] of this.weapons) weapon.visible = key === id;
  }

  /** Animate walking / aiming / jumping with articulated knees and elbows. */
  update(
    dt: number,
    speed: number,
    aiming: boolean,
    airborne: boolean,
    dead = false,
    aimPitch = 0,
    sprint = false,
    land = 0,
  ): void {
    this.sprintAmp = damp(this.sprintAmp, sprint && !aiming && !airborne ? 1 : 0, 6, dt);
    this.landAmp = damp(this.landAmp, clamp(land, 0, 1), 20, dt);

    if (dead) {
      this.deadTime += dt;
      this.rig.rotation.x = damp(this.rig.rotation.x, 0, 6, dt);
      this.rig.rotation.z = damp(this.rig.rotation.z, -Math.PI / 2, 6, dt);
      this.rig.position.y = damp(this.rig.position.y, 0.2, 6, dt);
      this.legL.group.rotation.x = damp(this.legL.group.rotation.x, 0.24, 5, dt);
      this.legR.group.rotation.x = damp(this.legR.group.rotation.x, -0.14, 5, dt);
      this.armL.group.rotation.x = damp(this.armL.group.rotation.x, -0.45, 5, dt);
      this.armR.group.rotation.x = damp(this.armR.group.rotation.x, 0.35, 5, dt);
      return;
    }

    this.rig.rotation.z = damp(this.rig.rotation.z, 0, 10, dt);
    this.rig.position.y = damp(this.rig.position.y, 0, 10, dt);

    const targetAmp = clamp(speed / 5.5, 0, 1) * 0.82;
    this.walkAmp = damp(this.walkAmp, targetAmp, 8, dt);
    this.phase += speed * 1.9 * dt;
    const swing = Math.sin(this.phase) * this.walkAmp;
    const kneeBend = Math.max(0, Math.sin(this.phase - 0.7)) * this.walkAmp;

    if (airborne) {
      this.legL.group.rotation.x = damp(this.legL.group.rotation.x, -0.6, 8, dt);
      this.legR.group.rotation.x = damp(this.legR.group.rotation.x, 0.42, 8, dt);
      this.legL.lower.rotation.x = damp(this.legL.lower.rotation.x, 0.55, 8, dt);
      this.legR.lower.rotation.x = damp(this.legR.lower.rotation.x, 0.18, 8, dt);
      this.armL.group.rotation.x = damp(this.armL.group.rotation.x, -0.8, 8, dt);
      this.armR.group.rotation.x = damp(this.armR.group.rotation.x, -0.8, 8, dt);
      this.armL.lower.rotation.x = damp(this.armL.lower.rotation.x, 0.4, 8, dt);
      this.armR.lower.rotation.x = damp(this.armR.lower.rotation.x, 0.4, 8, dt);
    } else if (aiming) {
      const aim = -1.35 + aimPitch * 0.95;
      this.legL.group.rotation.x = damp(this.legL.group.rotation.x, swing * 0.35, 10, dt);
      this.legR.group.rotation.x = damp(this.legR.group.rotation.x, -swing * 0.35, 10, dt);
      this.legL.lower.rotation.x = damp(this.legL.lower.rotation.x, 0.12, 8, dt);
      this.legR.lower.rotation.x = damp(this.legR.lower.rotation.x, 0.12, 8, dt);
      this.armR.group.rotation.x = damp(this.armR.group.rotation.x, aim, 14, dt);
      this.armR.group.rotation.z = damp(this.armR.group.rotation.z, 0.06, 14, dt);
      this.armR.lower.rotation.x = damp(this.armR.lower.rotation.x, -0.22, 14, dt);
      this.armL.group.rotation.x = damp(
        this.armL.group.rotation.x,
        -1.05 + aimPitch * 0.7,
        14,
        dt,
      );
      this.armL.group.rotation.z = damp(this.armL.group.rotation.z, -0.42, 14, dt);
      this.armL.lower.rotation.x = damp(this.armL.lower.rotation.x, -0.55, 14, dt);
    } else {
      this.legL.group.rotation.x = damp(this.legL.group.rotation.x, swing, 16, dt);
      this.legR.group.rotation.x = damp(this.legR.group.rotation.x, -swing, 16, dt);
      this.legL.lower.rotation.x = damp(
        this.legL.lower.rotation.x,
        kneeBend * 0.85 + this.landAmp * 0.55,
        16,
        dt,
      );
      this.legR.lower.rotation.x = damp(
        this.legR.lower.rotation.x,
        Math.max(0, -Math.sin(this.phase - 0.7)) * this.walkAmp * 0.85 +
          this.landAmp * 0.55,
        16,
        dt,
      );
      this.armL.group.rotation.x = damp(this.armL.group.rotation.x, -swing * 0.8, 14, dt);
      this.armR.group.rotation.x = damp(this.armR.group.rotation.x, swing * 0.8, 14, dt);
      this.armL.group.rotation.z = damp(this.armL.group.rotation.z, -0.08, 10, dt);
      this.armR.group.rotation.z = damp(this.armR.group.rotation.z, 0.08, 10, dt);
      this.armL.lower.rotation.x = damp(
        this.armL.lower.rotation.x,
        0.18 + Math.max(0, -swing) * 0.5 + this.sprintAmp * 0.45,
        12,
        dt,
      );
      this.armR.lower.rotation.x = damp(
        this.armR.lower.rotation.x,
        0.18 + Math.max(0, swing) * 0.5 + this.sprintAmp * 0.45,
        12,
        dt,
      );
    }

    // Subtle body motion: bob, hip sway, sprint lean, landing crouch and idle breathing.
    this.bob = Math.abs(Math.sin(this.phase * 2)) * this.walkAmp * 0.022;
    const idle = speed < 0.25 && !airborne;
    if (idle) this.idleTime += dt;
    const breathe = idle ? Math.sin(this.idleTime * 1.7) * 0.007 : 0;
    this.rig.position.y = damp(
      this.rig.position.y,
      this.bob + breathe - this.landAmp * 0.14,
      14,
      dt,
    );
    this.rig.rotation.x = damp(
      this.rig.rotation.x,
      this.sprintAmp * 0.16 + this.landAmp * 0.1,
      10,
      dt,
    );
    this.rig.rotation.z = damp(this.rig.rotation.z, swing * 0.025, 10, dt);
    this.head.rotation.x = damp(
      this.head.rotation.x,
      -swing * 0.05 - this.rig.rotation.x * 0.55,
      8,
      dt,
    );
    this.head.rotation.y = damp(
      this.head.rotation.y,
      idle && !aiming ? Math.sin(this.idleTime * 0.5) * 0.16 : 0,
      3,
      dt,
    );
    this.head.rotation.z = damp(this.head.rotation.z, -swing * 0.045, 8, dt);
  }

  /** Geometries are cached across characters, so nothing per-instance is owned. */
  dispose(): void {
    this.group.clear();
  }
}

export const PLAYER_LOOK: CharacterLook = {
  skin: '#c99a72',
  shirt: '#b6503a',
  pants: '#333945',
  hair: '#2a211c',
  shoes: '#1a1c1e',
  hat: '#3a3228',
  backpack: '#8a6b3f',
};

export const COP_LOOK: CharacterLook = {
  skin: '#c99a72',
  shirt: '#22345a',
  pants: '#1c2536',
  hair: '#241d18',
  shoes: '#141619',
  vest: '#16233d',
  hat: '#1a2a49',
};
