/**
 * Waypoint beacon, A* route line and arrival detection.
 */

import * as THREE from 'three';
import { dist2D } from '../core/math';
import { World } from '../world/world';
import { Waypoint } from '../ui/hud';

const ARRIVE_RADIUS = 9;
const REROUTE_DISTANCE = 220;

export class NavigationSystem {
  waypoint: Waypoint | null = null;

  private readonly world: World;
  private readonly marker: THREE.Group;
  private readonly ring: THREE.Mesh;
  private readonly routeLine: THREE.Line;
  private routeFrom = { x: Number.NaN, z: Number.NaN };
  private originX = 0;
  private originZ = 0;

  constructor(scene: THREE.Scene, world: World) {
    this.world = world;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 24, 14, 1, true).translate(0, 12, 0),
      new THREE.MeshBasicMaterial({
        color: 0x6fe3d4,
        transparent: true,
        opacity: 0.15,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.6, 26),
      new THREE.MeshBasicMaterial({
        color: 0x6fe3d4,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.1;

    this.marker = new THREE.Group();
    this.marker.add(beam, this.ring);
    this.marker.visible = false;
    scene.add(this.marker);

    this.routeLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x6fe3d4,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      }),
    );
    this.routeLine.frustumCulled = false;
    this.routeLine.visible = false;
    scene.add(this.routeLine);
  }

  set(waypoint: Waypoint | null): void {
    this.waypoint = waypoint;
    if (!waypoint) {
      this.marker.visible = false;
      this.routeLine.visible = false;
      this.routeFrom = { x: Number.NaN, z: Number.NaN };
      return;
    }
    this.marker.position.set(
      waypoint.x,
      this.world.groundHeight(waypoint.x, waypoint.z) + 0.05,
      waypoint.z,
    );
    this.marker.visible = true;
    this.rebuildRoute();
  }

  /** Animate the beacon and report when the player reaches the destination. */
  update(dt: number, x: number, z: number): boolean {
    this.originX = x;
    this.originZ = z;
    const waypoint = this.waypoint;
    if (!waypoint) return false;

    if (dist2D(x, z, waypoint.x, waypoint.z) < ARRIVE_RADIUS) {
      this.set(null);
      return true;
    }

    this.ring.rotation.z += dt * 0.9;
    if (dist2D(x, z, this.routeFrom.x, this.routeFrom.z) > REROUTE_DISTANCE) {
      this.rebuildRoute();
    }
    return false;
  }

  private rebuildRoute(): void {
    const waypoint = this.waypoint;
    if (!waypoint) return;
    const x = this.originX;
    const z = this.originZ;
    const path = this.world.roads.findPath(x, z, waypoint.x, waypoint.z);
    this.routeFrom = { x, z };
    if (!path || path.length < 2) {
      this.routeLine.visible = false;
      return;
    }

    const points: THREE.Vector3[] = [];
    const step = Math.max(1, Math.floor(path.length / 700));
    for (let i = 0; i < path.length; i += step) {
      const p = path[i];
      points.push(new THREE.Vector3(p.x, this.world.groundHeight(p.x, p.z) + 1.5, p.z));
    }
    if (points.length < 2) {
      this.routeLine.visible = false;
      return;
    }
    this.routeLine.geometry.dispose();
    this.routeLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.routeLine.visible = true;
  }
}
