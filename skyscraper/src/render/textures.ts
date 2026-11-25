// Procedural canvas textures: one facade + roof per tile type, plus a window glow mask for night.

import * as THREE from 'three';
import { hash32, mulberry32, type Rand } from '../game/rng.ts';
import type { FacadeStyle, TileDef } from '../game/types.ts';

export interface TileTextures {
  side: THREE.Texture;
  glow: THREE.Texture | null;
  top: THREE.Texture;
}

const SW = 64;
const SH = 48;

function ctx2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function css(c: number, f = 1): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

type Painter = (g: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, color: number, rand: Rand) => boolean;

/** Draw a window: dark glass on the facade, and (maybe) lit on the glow mask. Returns true if lit. */
function win(g: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: Rand, glass = '#1d2533', litChance = 0.75, frame?: string) {
  if (frame) {
    g.fillStyle = frame;
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
  }
  g.fillStyle = glass;
  g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(x, y, Math.max(1, w / 3), h);
  if (rand() < litChance) {
    const warm = rand();
    glow.fillStyle = warm < 0.7 ? '#ffd890' : warm < 0.9 ? '#fff2d0' : '#a8d8ff';
    glow.fillRect(x, y, w, h);
  }
}

const PAINT: Record<FacadeStyle, Painter> = {
  shack(g, glow, c, rand) {
    for (let x = 0; x < SW; x += 4) {
      g.fillStyle = css(c, 0.85 + rand() * 0.25);
      g.fillRect(x, 0, 2, SH);
    }
    g.fillStyle = 'rgba(80,40,20,0.35)';
    for (let i = 0; i < 4; i++) g.fillRect(Math.floor(rand() * SW), 6, 2, 10 + rand() * 20);
    win(g, glow, 10, 16, 12, 12, rand, '#241a14', 0.9, css(c, 0.6));
    g.fillStyle = css(c, 0.5);
    g.fillRect(38, 20, 14, 28);
    return true;
  },
  brick(g, glow, c, rand) {
    for (let y = 0; y < SH; y += 6) {
      for (let x = (y / 6) % 2 ? -6 : 0; x < SW; x += 12) {
        g.fillStyle = css(c, 0.85 + rand() * 0.3);
        g.fillRect(x + 1, y + 1, 10, 4);
      }
    }
    for (const x of [9, 37]) {
      win(g, glow, x, 12, 16, 20, rand, '#1e1c22', 0.75, '#d8cdbb');
      g.fillStyle = '#d8cdbb';
      g.fillRect(x - 2, 33, 20, 2);
    }
    return true;
  },
  windows(g, glow, c, rand) {
    g.fillStyle = css(c, 0.9);
    g.fillRect(0, 40, SW, 3);
    for (const x of [6, 26, 46]) win(g, glow, x, 12, 12, 22, rand, '#22303e', 0.8, css(c, 0.7));
    return true;
  },
  luxury(g, glow, c, rand) {
    const grd = g.createLinearGradient(0, 0, 0, SH);
    grd.addColorStop(0, '#9fc4dc');
    grd.addColorStop(1, '#2c4058');
    g.fillStyle = grd;
    g.fillRect(0, 4, SW, SH - 8);
    g.fillStyle = css(c, 1.0);
    g.fillRect(0, 0, SW, 4);
    g.fillRect(0, SH - 4, SW, 4);
    g.fillStyle = '#d8b860';
    for (let x = 0; x <= SW; x += 16) g.fillRect(x - 1, 4, 2, SH - 8);
    for (let x = 0; x < SW; x += 16) {
      if (rand() < 0.7) {
        glow.fillStyle = rand() < 0.5 ? '#ffe0a0' : '#fff4dc';
        glow.fillRect(x + 1, 4, 14, SH - 8);
      }
    }
    return true;
  },
  industrial(g, glow, c, rand) {
    for (let x = 0; x < SW; x += 6) {
      g.fillStyle = css(c, 0.8);
      g.fillRect(x, 0, 1, SH);
    }
    for (let x = 4; x < SW; x += 12) win(g, glow, x, 6, 8, 6, rand, '#2a2420', 0.9);
    g.fillStyle = css(c, 0.45);
    g.fillRect(22, 24, 20, 24);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 6; i++) g.fillRect(22, 26 + i * 4, 20, 1);
    glow.fillStyle = '#ff9a40';
    glow.fillRect(24, 44, 16, 4);
    return true;
  },
  utility(g, glow, c, rand) {
    g.fillStyle = css(c, 0.75);
    g.fillRect(0, 14, SW, 3);
    g.fillRect(0, 32, SW, 3);
    g.fillStyle = css(c, 1.15);
    g.fillRect(0, 15, SW, 1);
    g.fillRect(0, 33, SW, 1);
    g.fillStyle = css(c, 0.6);
    for (let i = 0; i < 5; i++) g.fillRect(40, 20 + i * 2, 16, 1);
    g.fillStyle = css(c, 0.85);
    g.fillRect(Math.floor(rand() * 20) + 4, 0, 2, SH);
    glow.fillStyle = '#80c0ff';
    glow.fillRect(8, 22, 3, 3);
    return true;
  },
  glass(g, glow, c) {
    g.fillStyle = css(c, 1.1);
    g.fillRect(0, 0, SW, SH);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < SW; x += 16) g.fillRect(x + 2, 2, 5, SH - 4);
    g.fillStyle = css(c, 0.6);
    for (let x = 0; x <= SW; x += 16) g.fillRect(x - 1, 0, 2, SH);
    g.fillRect(0, 0, SW, 2);
    g.fillRect(0, SH - 2, SW, 2);
    glow.fillStyle = '#b8f0ff';
    glow.fillRect(0, SH - 6, SW, 2);
    return true;
  },
  soil(g, _glow, c, rand) {
    const bands = [0.75, 0.9, 0.65, 0.8, 0.7];
    let y = 6;
    for (const f of bands) {
      g.fillStyle = css(c, f);
      g.fillRect(0, y, SW, 9);
      y += 9;
    }
    g.fillStyle = '#5a8a3a';
    g.fillRect(0, 0, SW, 6);
    g.fillStyle = 'rgba(30,20,10,0.5)';
    for (let i = 0; i < 40; i++) g.fillRect(rand() * SW, 6 + rand() * (SH - 6), 2, 1);
    return false;
  },
  shop(g, glow, c, rand) {
    for (let x = 0; x < SW; x += 8) {
      g.fillStyle = x % 16 ? '#f4efe4' : css(c, 1.0);
      g.fillRect(x, 6, 8, 8);
    }
    g.fillStyle = css(c, 0.55);
    g.fillRect(0, 0, SW, 6);
    win(g, glow, 4, 18, 56, 24, rand, '#2a2a30', 1, css(c, 0.5));
    g.fillStyle = 'rgba(255,220,150,0.5)';
    for (let i = 0; i < 6; i++) g.fillRect(8 + i * 9, 30, 5, 10);
    return true;
  },
  capsule(g, glow, c, rand) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 4; x++) {
        const px = 2 + x * 16;
        const py = 2 + y * 16;
        g.fillStyle = css(c, 0.85 + rand() * 0.3);
        g.fillRect(px, py, 13, 13);
        g.fillStyle = '#1a2028';
        g.beginPath();
        g.arc(px + 6.5, py + 6.5, 4, 0, Math.PI * 2);
        g.fill();
        if (rand() < 0.7) {
          glow.fillStyle = rand() < 0.5 ? '#ffd0a0' : '#c0e0ff';
          glow.beginPath();
          glow.arc(px + 6.5, py + 6.5, 4, 0, Math.PI * 2);
          glow.fill();
        }
      }
    }
    return true;
  },
  stone(g, glow, c, rand) {
    for (let y = 0; y < SH; y += 8) {
      for (let x = (y / 8) % 2 ? -8 : 0; x < SW; x += 16) {
        g.fillStyle = css(c, 0.8 + rand() * 0.35);
        g.fillRect(x + 1, y + 1, 14, 6);
      }
    }
    g.fillStyle = '#1c1c22';
    g.fillRect(26, 18, 12, 18);
    g.beginPath();
    g.arc(32, 18, 6, Math.PI, 0);
    g.fill();
    if (rand() < 0.8) {
      glow.fillStyle = '#ffcf80';
      glow.fillRect(26, 18, 12, 18);
      glow.beginPath();
      glow.arc(32, 18, 6, Math.PI, 0);
      glow.fill();
    }
    return true;
  },
};

function paintTop(g: CanvasRenderingContext2D, d: TileDef, rand: Rand) {
  const c = d.look.top ?? d.look.color;
  const S = 64;
  g.fillStyle = css(c);
  g.fillRect(0, 0, S, S);
  const style = d.look.style;
  if (d.look.prop === 'crops') {
    for (let y = 4; y < S; y += 10) {
      g.fillStyle = '#5a3c20';
      g.fillRect(0, y + 6, S, 4);
      g.fillStyle = css(c, 0.9 + rand() * 0.25);
      g.fillRect(0, y, S, 6);
    }
    return;
  }
  if (style === 'soil') {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = css(c, 0.75 + rand() * 0.5);
      g.fillRect(rand() * S, rand() * S, 3, 3);
    }
    return;
  }
  if (style === 'glass') {
    g.fillStyle = 'rgba(255,255,255,0.3)';
    for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 2, 2, 12, 60);
    g.fillStyle = css(c, 0.6);
    for (let i = 0; i <= 4; i++) {
      g.fillRect(i * 16 - 1, 0, 2, S);
      g.fillRect(0, i * 16 - 1, S, 2);
    }
    return;
  }
  if (style === 'luxury') {
    for (let y = 0; y < S; y += 6) {
      g.fillStyle = css(c, 0.9 + rand() * 0.2);
      g.fillRect(0, y, S, 5);
    }
  }
  // Parapet and roof clutter.
  g.strokeStyle = css(c, 0.7);
  g.lineWidth = 4;
  g.strokeRect(2, 2, S - 4, S - 4);
  if (style !== 'luxury') {
    g.fillStyle = css(c, 0.82);
    for (let i = 0; i < 3; i++) g.fillRect(10 + rand() * 36, 10 + rand() * 36, 6 + rand() * 6, 6 + rand() * 6);
  }
}

const cache = new Map<string, TileTextures>();

export function tileTextures(d: TileDef): TileTextures {
  const hit = cache.get(d.id);
  if (hit) return hit;
  const rand = mulberry32(hash32(d.id.length, d.look.color));
  const [sc, sg] = ctx2d(SW, SH);
  const [gc, gg] = ctx2d(SW, SH);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, SW, SH);
  sg.fillStyle = css(d.look.color);
  sg.fillRect(0, 0, SW, SH);
  const glows = PAINT[d.look.style](sg, gg, d.look.color, rand);
  // Slab edge at the bottom of each level reads as a floor line.
  sg.fillStyle = 'rgba(0,0,0,0.22)';
  sg.fillRect(0, SH - 2, SW, 2);
  const [tc, tg] = ctx2d(64, 64);
  paintTop(tg, d, rand);
  const t: TileTextures = { side: tex(sc), glow: glows ? tex(gc) : null, top: tex(tc) };
  cache.set(d.id, t);
  return t;
}

/** Facade texture for the neighbouring towers (window grid, lit at night). */
export function neighborTextures(seed: number): { side: THREE.Texture; glow: THREE.Texture } {
  const rand = mulberry32(seed);
  const W = 64;
  const H = 128;
  const [sc, sg] = ctx2d(W, H);
  const [gc, gg] = ctx2d(W, H);
  sg.fillStyle = '#ffffff';
  sg.fillRect(0, 0, W, H);
  gg.fillStyle = '#000';
  gg.fillRect(0, 0, W, H);
  for (let y = 2; y < H; y += 8) {
    for (let x = 2; x < W; x += 8) {
      sg.fillStyle = 'rgba(40,52,72,0.32)';
      sg.fillRect(x, y, 5, 5);
      if (rand() < 0.45) {
        gg.fillStyle = rand() < 0.8 ? '#ffd890' : '#a8d8ff';
        gg.fillRect(x, y, 5, 5);
      }
    }
  }
  const side = tex(sc);
  const glow = tex(gc);
  for (const t of [side, glow]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return { side, glow };
}

/** Soft round puff for clouds and smoke. */
export function puffTexture(): THREE.Texture {
  const [c, g] = ctx2d(64, 64);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return tex(c);
}

/** Ground texture for the plot: paving with faint tile lines. */
export function groundTexture(n: number): THREE.Texture {
  const P = 32;
  const [c, g] = ctx2d(n * P, n * P);
  g.fillStyle = '#5d6b5a';
  g.fillRect(0, 0, n * P, n * P);
  const rand = mulberry32(n * 977);
  for (let i = 0; i < n * n * 6; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
    g.fillRect(rand() * n * P, rand() * n * P, 3, 3);
  }
  g.strokeStyle = 'rgba(20,30,20,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * P, 0);
    g.lineTo(i * P, n * P);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * P);
    g.lineTo(n * P, i * P);
    g.stroke();
  }
  return tex(c);
}
