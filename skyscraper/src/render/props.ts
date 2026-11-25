// Little roof-top models (crops, solar panels, water tanks, chimneys...). Each kind is merged
// into one vertex-coloured geometry so it can be drawn as a single InstancedMesh. Parts that
// should glow at night go into a separate "glow" geometry drawn unlit.
// Coordinates: origin at the centre of the roof of one cell, y up, cell spans -0.5..0.5.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PropKind } from '../game/types.ts';

type G = THREE.BufferGeometry;

function colorize(g: G, color: number): G {
  const c = new THREE.Color(color);
  const n = g.attributes.position!.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0): G {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colorize(g, color);
}

function cyl(rt: number, rb: number, h: number, color: number, x = 0, y = 0, z = 0, seg = 10): G {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return colorize(g, color);
}

function ball(r: number, color: number, x = 0, y = 0, z = 0, detail = 0): G {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.translate(x, y, z);
  return colorize(g, color);
}

function dome(r: number, color: number, y = 0): G {
  const g = new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(0, y, 0);
  return colorize(g, color);
}

function merge(parts: G[]): G {
  // Icosahedra are non-indexed while boxes are indexed; mergeGeometries needs them to agree.
  const m = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  if (!m) throw new Error('prop merge failed');
  return m;
}

export interface PropModel {
  base: G;
  glow: G | null;
  /** Stretch over a rectangular building's whole footprint instead of one copy per cell. */
  stretch?: boolean;
}

function tree(x: number, z: number, s: number, hue: number): G[] {
  return [cyl(0.025 * s, 0.035 * s, 0.16 * s, 0x6b4a2a, x, 0.08 * s, z, 6), ball(0.15 * s, hue, x, 0.24 * s, z, 0)];
}

function build(kind: PropKind): PropModel {
  switch (kind) {
    case 'crops': {
      const parts: G[] = [];
      for (let i = 0; i < 4; i++) {
        parts.push(box(0.82, 0.07, 0.1, i % 2 ? 0x7fbf4a : 0x5fa83a, 0, 0.035, -0.3 + i * 0.2));
        for (let j = 0; j < 4; j++) parts.push(ball(0.05, 0x9fd860, -0.3 + j * 0.2, 0.1, -0.3 + i * 0.2));
      }
      return { base: merge(parts), glow: null };
    }
    case 'solar': {
      const parts: G[] = [];
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] as const) {
        parts.push(box(0.36, 0.025, 0.34, 0x1d3a6a, x, 0.14, z, -0.45));
        parts.push(box(0.03, 0.12, 0.03, 0x8a8a8a, x, 0.06, z + 0.08));
      }
      return { base: merge(parts), glow: null };
    }
    case 'funnel': {
      const cone = new THREE.ConeGeometry(0.32, 0.22, 14, 1, true);
      cone.rotateX(Math.PI);
      cone.translate(0, 0.42, 0);
      return {
        base: merge([cyl(0.2, 0.2, 0.28, 0x55748c, 0, 0.14, 0, 14), colorize(cone, 0x8fb0c8), box(0.5, 0.04, 0.04, 0x55748c, 0, 0.3, 0)]),
        glow: null,
      };
    }
    case 'trees': {
      return {
        base: merge([...tree(-0.22, -0.18, 1.2, 0x3f8f3a), ...tree(0.2, -0.05, 1.5, 0x4fa84a), ...tree(-0.1, 0.24, 1.0, 0x2f7f3a), box(0.9, 0.02, 0.9, 0x5f9a4a, 0, 0.01, 0)]),
        glow: null,
      };
    }
    case 'chimney':
      return {
        base: merge([box(0.18, 0.7, 0.18, 0x3a302c, 0.2, 0.35, -0.15), box(0.24, 0.05, 0.24, 0x5a4a44, 0.2, 0.7, -0.15), box(0.3, 0.18, 0.3, 0x4a403a, -0.15, 0.09, 0.15)]),
        glow: merge([box(0.14, 0.02, 0.14, 0xff8030, 0.2, 0.73, -0.15)]),
      };
    case 'chimneys':
      return {
        base: merge([box(0.22, 1.0, 0.22, 0x332a26, 0, 0.5, 0), box(0.28, 0.06, 0.28, 0x55453e, 0, 1.0, 0), box(0.7, 0.12, 0.5, 0x40342e, 0, 0.06, 0.15)]),
        glow: merge([box(0.18, 0.02, 0.18, 0xff6a20, 0, 1.03, 0), box(0.5, 0.05, 0.02, 0xff8a40, 0, 0.08, 0.41)]),
      };
    case 'tank': {
      const legs: G[] = [];
      for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]] as const) legs.push(box(0.04, 0.36, 0.04, 0x3a3028, x, 0.18, z));
      const roof = new THREE.ConeGeometry(0.29, 0.18, 14);
      roof.translate(0, 0.8, 0);
      return { base: merge([...legs, cyl(0.26, 0.26, 0.36, 0x9a6b44, 0, 0.54, 0, 14), colorize(roof, 0x5a4030), cyl(0.27, 0.27, 0.03, 0x3a3028, 0, 0.45, 0, 14)]), glow: null };
    }
    case 'dome':
      return { base: merge([cyl(0.34, 0.34, 0.04, 0xb8a878, 0, 0.02, 0, 16)]), glow: merge([dome(0.3, 0xfff0b0, 0.03)]) };
    case 'cone': {
      const c = new THREE.ConeGeometry(0.3, 1.9, 4);
      c.rotateY(Math.PI / 4);
      c.translate(0, 0.95, 0);
      return { base: merge([colorize(c, 0xe8c15a), box(0.5, 0.08, 0.5, 0xc8a040, 0, 0.04, 0)]), glow: merge([ball(0.07, 0xfff0c0, 0, 1.95, 0, 1)]) };
    }
    case 'pavilion': {
      const canopy = new THREE.ConeGeometry(0.2, 0.08, 10);
      canopy.translate(-0.28, 0.34, 0.25);
      return {
        base: merge([
          box(0.5, 0.28, 0.4, 0xa8d8e8, 0.12, 0.14, -0.05),
          box(0.62, 0.04, 0.52, 0xf4f0e8, 0.12, 0.3, -0.05),
          cyl(0.012, 0.012, 0.3, 0xdddddd, -0.28, 0.15, 0.25, 6),
          colorize(canopy, 0xf0a0a0),
          box(0.3, 0.02, 0.16, 0x40c0d0, -0.18, 0.01, -0.28),
        ]),
        glow: merge([box(0.46, 0.2, 0.02, 0xffe8b0, 0.12, 0.14, 0.16)]),
      };
    }
    case 'lamp':
      return { base: merge([cyl(0.025, 0.04, 0.3, 0x707070, 0, 0.15, 0, 8), cyl(0.18, 0.18, 0.03, 0x505050, 0, 0.015, 0, 10)]), glow: merge([ball(0.12, 0xd890ff, 0, 0.36, 0, 1)]) };
    case 'wellhead':
      return {
        base: merge([
          cyl(0.24, 0.24, 0.18, 0x8a8478, 0, 0.09, 0, 14),
          cyl(0.18, 0.18, 0.02, 0x2f5f88, 0, 0.17, 0, 14),
          box(0.04, 0.4, 0.04, 0x6b4a2a, -0.22, 0.2, 0),
          box(0.04, 0.4, 0.04, 0x6b4a2a, 0.22, 0.2, 0),
          box(0.52, 0.04, 0.04, 0x6b4a2a, 0, 0.4, 0),
          box(0.6, 0.03, 0.3, 0x8a5a3a, 0, 0.46, 0, 0.25),
        ]),
        glow: null,
      };
    case 'pool':
      return {
        base: merge([box(0.9, 0.05, 0.9, 0xf2efe6, 0, 0.025, 0), box(0.12, 0.05, 0.25, 0xffffff, -0.36, 0.06, 0.3)]),
        glow: merge([box(0.66, 0.055, 0.56, 0x48d8e0, 0.06, 0.03, -0.08)]),
        stretch: true,
      };
    case 'deck': {
      const parts: G[] = [box(0.9, 0.03, 0.9, 0xd8d0c0, 0, 0.015, 0)];
      parts.push(box(0.9, 0.22, 0.02, 0xa8e0f8, 0, 0.13, 0.44), box(0.9, 0.22, 0.02, 0xa8e0f8, 0, 0.13, -0.44));
      parts.push(box(0.02, 0.22, 0.9, 0xa8e0f8, 0.44, 0.13, 0), box(0.02, 0.22, 0.9, 0xa8e0f8, -0.44, 0.13, 0));
      parts.push(cyl(0.015, 0.015, 0.22, 0x404040, 0.1, 0.11, 0.1, 6), box(0.16, 0.05, 0.05, 0x303030, 0.1, 0.24, 0.1));
      return { base: merge(parts), glow: null };
    }
    case 'awning': {
      const parts: G[] = [];
      for (const [x, c] of [[-0.22, 0xe05a3a], [0.22, 0x3a8ae0]] as const) {
        parts.push(box(0.36, 0.03, 0.36, c, x, 0.3, 0, 0.15));
        for (const dx of [-0.15, 0.15]) parts.push(box(0.025, 0.3, 0.025, 0xdddddd, x + dx, 0.15, 0.12));
        parts.push(box(0.3, 0.1, 0.18, 0xc8a070, x, 0.05, -0.05));
      }
      return { base: merge(parts), glow: merge([box(0.2, 0.02, 0.1, 0xffd890, -0.22, 0.11, -0.05), box(0.2, 0.02, 0.1, 0xffd890, 0.22, 0.11, -0.05)]) };
    }
    case 'machine':
      return {
        base: merge([box(0.5, 0.28, 0.42, 0x8a9098, 0.05, 0.14, 0), cyl(0.07, 0.07, 0.12, 0x60666e, 0.15, 0.34, 0.05, 8), box(0.3, 0.02, 0.2, 0x50565e, -0.1, 0.29, 0)]),
        glow: merge([box(0.06, 0.06, 0.02, 0x40ff90, -0.12, 0.2, 0.215)]),
      };
    case 'vent':
      return {
        base: merge([box(0.24, 0.2, 0.24, 0x7a6a5a, -0.22, 0.1, -0.2), box(0.2, 0.14, 0.2, 0x6a5a4a, 0.2, 0.07, 0.22), box(0.5, 0.06, 0.16, 0x9fc0d0, 0.05, 0.03, -0.05)]),
        glow: null,
      };
    case 'cross':
      return {
        base: merge([cyl(0.4, 0.4, 0.02, 0x8a9a98, 0, 0.01, 0, 20), box(0.08, 0.025, 0.36, 0x30b080, 0, 0.022, 0), box(0.36, 0.025, 0.08, 0x30b080, 0, 0.022, 0)]),
        glow: null,
      };
    case 'pit':
      return {
        base: merge([box(0.84, 0.03, 0.84, 0x2e2a1a, 0, 0.015, 0), box(0.84, 0.035, 0.03, 0x6a6a60, 0, 0.02, -0.2), box(0.84, 0.035, 0.03, 0x6a6a60, 0, 0.02, 0.2), box(0.84, 0.035, 0.03, 0x6a6a60, 0, 0.02, 0)]),
        glow: null,
        stretch: true,
      };
    case 'tanks':
      return {
        base: merge([
          cyl(0.17, 0.17, 0.3, 0x7a8a4a, -0.18, 0.15, -0.1, 12),
          dome(0.17, 0x8a9a5a, 0.3).translate(-0.18, 0, -0.1),
          cyl(0.14, 0.14, 0.24, 0x6a7a3e, 0.2, 0.12, 0.15, 12),
          dome(0.14, 0x7a8a4a, 0.24).translate(0.2, 0, 0.15),
          box(0.45, 0.04, 0.04, 0x505848, 0.01, 0.2, 0.02, 0, 0.7),
        ]),
        glow: merge([ball(0.035, 0x90ff60, 0.2, 0.42, 0.15, 0)]),
      };
    case 'bore': {
      const parts: G[] = [];
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const leg = new THREE.BoxGeometry(0.04, 1.0, 0.04);
        leg.rotateX(z * 0.3);
        leg.rotateZ(-x * 0.3);
        leg.translate(x * 0.15, 0.48, z * 0.15);
        parts.push(colorize(leg, 0x6a5a50));
      }
      parts.push(box(0.12, 0.06, 0.12, 0x504038, 0, 0.98, 0), cyl(0.3, 0.34, 0.08, 0x3a2a2a, 0, 0.04, 0, 12));
      return { base: merge(parts), glow: merge([cyl(0.1, 0.12, 0.5, 0xff5a20, 0, 0.3, 0, 10)]) };
    }
  }
}

const models = new Map<PropKind, PropModel>();

export function propModel(kind: PropKind): PropModel {
  let m = models.get(kind);
  if (!m) {
    m = build(kind);
    models.set(kind, m);
  }
  return m;
}
