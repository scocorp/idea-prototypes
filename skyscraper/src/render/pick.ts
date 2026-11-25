// Exact picking against the voxel grid (Amanatides & Woo DDA), independent of mesh details.

import type * as THREE from 'three';

export interface Hit {
  /** Cell hit; z = -1 means the ground plane below level 0. */
  x: number;
  y: number;
  z: number;
  /** Outward normal of the face that was hit, in grid axes (z = up). */
  nx: number;
  ny: number;
  nz: number;
  ground: boolean;
}

export function pickVoxel(
  ray: THREE.Ray,
  n: number,
  levels: number,
  levelH: number,
  solid: (x: number, y: number, z: number) => boolean,
): Hit | null {
  // World → grid: gx = X + n/2, gy = Z + n/2, gz = Y / levelH.
  const o = [ray.origin.x + n / 2, ray.origin.z + n / 2, ray.origin.y / levelH];
  const d = [ray.direction.x, ray.direction.z, ray.direction.y / levelH];
  const lo = [0, 0, 0];
  const hi = [n, n, levels];
  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterAxis = 2;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-12) {
      if (o[a]! < lo[a]! || o[a]! > hi[a]!) return null;
      continue;
    }
    let t0 = (lo[a]! - o[a]!) / d[a]!;
    let t1 = (hi[a]! - o[a]!) / d[a]!;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tEnter) {
      tEnter = t0;
      enterAxis = a;
    }
    tExit = Math.min(tExit, t1);
  }
  if (tEnter > tExit || tExit < 0) return null;
  const t = Math.max(0, tEnter) + 1e-6;
  const p = [o[0]! + d[0]! * t, o[1]! + d[1]! * t, o[2]! + d[2]! * t];
  const v = p.map((c, a) => Math.min(hi[a]! - 1, Math.max(0, Math.floor(c))));
  const step = d.map((c) => (c > 0 ? 1 : -1));
  const tDelta = d.map((c) => (Math.abs(c) < 1e-12 ? Infinity : Math.abs(1 / c)));
  const tMax = d.map((c, a) => {
    if (Math.abs(c) < 1e-12) return Infinity;
    const next = c > 0 ? v[a]! + 1 : v[a]!;
    return t + (next - p[a]!) / c;
  });
  const normal = [0, 0, 0];
  normal[enterAxis] = -step[enterAxis]!;
  for (let guard = 0; guard < 4 * (n + n + levels); guard++) {
    if (solid(v[0]!, v[1]!, v[2]!)) {
      return { x: v[0]!, y: v[1]!, z: v[2]!, nx: normal[0]!, ny: normal[1]!, nz: normal[2]!, ground: false };
    }
    let a = 0;
    if (tMax[1]! < tMax[a]!) a = 1;
    if (tMax[2]! < tMax[a]!) a = 2;
    if (a === 2 && step[2] === -1 && v[2] === 0) {
      // Leaving through the ground: report the ground under this cell.
      return { x: v[0]!, y: v[1]!, z: -1, nx: 0, ny: 0, nz: 1, ground: true };
    }
    v[a] = v[a]! + step[a]!;
    tMax[a] = tMax[a]! + tDelta[a]!;
    normal[0] = 0;
    normal[1] = 0;
    normal[2] = 0;
    normal[a] = -step[a]!;
    if (v[a]! < 0 || v[a]! >= hi[a]!) return null;
  }
  return null;
}
