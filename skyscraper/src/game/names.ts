import { pick, type Rand } from './rng.ts';

const A = [
  'Aurelian', 'Meridian', 'Halcyon', 'Cinder', 'Saint Agnes', 'Gullwing', 'Copperline', 'Old Mercy', 'Zenith',
  'Hollowmere', 'Lantern', 'Basalt', 'Vesper', 'Marrow', 'Juniper', 'Kestrel', 'Obsidian', 'Saffron', 'Tidewater',
  'Ironbark', 'Low Kessel', 'Carrow', 'Brightwater', 'Pellucid', 'Umber', 'Northgate', 'Seraph', 'Quayside',
];
const B = ['Spire', 'Arcology', 'Stack', 'Heights', 'Needle', 'Citadel', 'Tower', 'Block', 'Terraces', 'Pinnacle', 'Column', 'Rise'];

export function towerName(rand: Rand): string {
  return `${pick(rand, A)} ${pick(rand, B)}`;
}

export function uniqueTowerName(rand: Rand, used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const s = towerName(rand);
    const first = s.split(' ').slice(0, -1).join(' ');
    if (![...used].some((u) => u.startsWith(first))) {
      used.add(s);
      return s;
    }
  }
  const s = towerName(rand);
  used.add(s);
  return s;
}

export function plural(name: string, k: number): string {
  if (k === 1) return name;
  if (name.endsWith('Works')) return name;
  if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies';
  return name + 's';
}
