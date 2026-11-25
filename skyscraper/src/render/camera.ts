// Fixed-pitch orthographic camera that yaws in 90° steps with a short eased animation.

import * as THREE from 'three';

export const PITCH = (30 * Math.PI) / 180;
/** World height of one level. Tiles are 1×1 in plan. */
export const LEVEL_H = 0.75;
export const ROTATE_SECONDS = 0.5;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3(0, 3, 0);
  yaw = Math.PI / 4;
  private yawFrom = this.yaw;
  private yawTo = this.yaw;
  private rotT = 1;
  zoom = 1;
  zoomTo = 1;
  private zoomAnchor = new THREE.Vector2();
  /** World units visible vertically at zoom 1. */
  viewHeight = 24;
  private w = 1;
  private h = 1;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2000);
    this.apply();
  }

  resize(w: number, h: number) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.apply();
  }

  rotate(dir: 1 | -1) {
    this.yawFrom = this.yaw;
    this.yawTo += (dir * Math.PI) / 2;
    this.rotT = 0;
  }

  get rotating(): boolean {
    return this.rotT < 1;
  }

  /** 0..3: which diagonal the camera is settling on (used for the compass and labels). */
  get quadrant(): number {
    return (((Math.round((this.yawTo - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4);
  }

  get halfH(): number {
    return this.viewHeight / 2 / this.zoom;
  }

  get halfW(): number {
    return (this.halfH * this.w) / this.h;
  }

  /** World units per screen pixel. */
  get unitsPerPx(): number {
    return (this.halfH * 2) / this.h;
  }

  setZoom(z: number, anchorNdc?: { x: number; y: number }) {
    this.zoomTo = THREE.MathUtils.clamp(z, 0.25, 5);
    if (anchorNdc) this.zoomAnchor.set(anchorNdc.x, anchorNdc.y);
    else this.zoomAnchor.set(0, 0);
  }

  update(dt: number) {
    if (this.rotT < 1) {
      this.rotT = Math.min(1, this.rotT + dt / ROTATE_SECONDS);
      this.yaw = this.yawFrom + (this.yawTo - this.yawFrom) * ease(this.rotT);
    }
    if (Math.abs(this.zoomTo - this.zoom) > 1e-4) {
      const hw0 = this.halfW;
      const hh0 = this.halfH;
      this.zoom += (this.zoomTo - this.zoom) * (1 - Math.exp(-dt * 14));
      // Keep the point under the cursor fixed while zooming.
      this.target
        .addScaledVector(this.right, this.zoomAnchor.x * (hw0 - this.halfW))
        .addScaledVector(this.up, this.zoomAnchor.y * (hh0 - this.halfH));
    }
    this.apply();
  }

  private apply() {
    const cam = this.camera;
    cam.left = -this.halfW;
    cam.right = this.halfW;
    cam.top = this.halfH;
    cam.bottom = -this.halfH;
    this.back.set(Math.sin(this.yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(this.yaw) * Math.cos(PITCH));
    cam.position.copy(this.target).addScaledVector(this.back, 500);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.right.setFromMatrixColumn(cam.matrixWorld, 0);
    this.up.setFromMatrixColumn(cam.matrixWorld, 1);
  }

  /** Grab-and-drag pan in screen pixels. Keeps the rotation pivot near the plot's centre axis. */
  pan(dxPx: number, dyPx: number, limit: number) {
    const k = this.unitsPerPx;
    this.target.addScaledVector(this.right, -dxPx * k).addScaledVector(this.up, dyPx * k);
    this.recentre(limit);
  }

  /** Slide the target along the view axis (no visible change) to sit closest to the centre axis. */
  recentre(limit: number) {
    const dh = new THREE.Vector2(this.back.x, this.back.z);
    const h0 = new THREE.Vector2(this.target.x, this.target.z);
    const t = -h0.dot(dh) / Math.max(1e-6, dh.lengthSq());
    this.target.addScaledVector(this.back, t);
    this.target.x = THREE.MathUtils.clamp(this.target.x, -limit, limit);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -limit, limit);
    this.target.y = THREE.MathUtils.clamp(this.target.y, -20, 60);
  }

  /** Ray through a point in normalised device coordinates. */
  ray(ndcX: number, ndcY: number): THREE.Ray {
    const origin = this.target
      .clone()
      .addScaledVector(this.right, ndcX * this.halfW)
      .addScaledVector(this.up, ndcY * this.halfH)
      .addScaledVector(this.back, 600);
    return new THREE.Ray(origin, this.back.clone().negate());
  }

  /** Project a world point to CSS pixels. */
  toScreen(p: THREE.Vector3, out = new THREE.Vector2()): THREE.Vector2 {
    const v = p.clone().project(this.camera);
    return out.set(((v.x + 1) / 2) * this.w, ((1 - v.y) / 2) * this.h);
  }

  get viewDirFlat(): THREE.Vector2 {
    return new THREE.Vector2(-this.back.x, -this.back.z).normalize();
  }
}
