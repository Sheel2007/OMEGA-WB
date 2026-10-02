// Weather icons. Colours come from --wx-* tokens so they hold up in every theme.

const sun = (cx, cy, r) => {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [x1, y1] = [cx + Math.cos(a) * (r + 3.5), cy + Math.sin(a) * (r + 3.5)];
    const [x2, y2] = [cx + Math.cos(a) * (r + 7), cy + Math.sin(a) * (r + 7)];
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join('');
  return `<path d="${rays}" stroke="var(--wx-sun)" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--wx-sun)"/>`;
};
const moon = (cx, cy, r) =>
  `<path d="M${cx + r * 0.35} ${cy - r}a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55}A${r * 0.85} ${r * 0.85} 0 0 1 ${cx + r * 0.35} ${cy - r}z" fill="var(--wx-moon)"/>`;
const cloud = (dy = 0, fill = 'var(--wx-cloud)') =>
  `<path d="M17 ${44 + dy}h28a10 10 0 0 0 1.4-19.9A14 14 0 0 0 19.3 ${21 + dy}a11.5 11.5 0 0 0-2.3 ${23}z" fill="${fill}" stroke="var(--wx-cloud-edge)" stroke-width="2.2" stroke-linejoin="round"/>`;
const drops = (count, color) =>
  Array.from({ length: count }, (_, i) => `<path d="M${22 + i * 9} 50l-3 7" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/>`).join('');
const flakes = Array.from({ length: 3 }, (_, i) => `<circle cx="${22 + i * 9}" cy="${53 + (i % 2) * 4}" r="2.6" fill="var(--wx-snow)"/>`).join('');

const ICONS = {
  sun: sun(32, 32, 12),
  moon: moon(30, 32, 15),
  'partly-day': sun(24, 22, 9) + cloud(6),
  'partly-night': moon(24, 22, 11) + cloud(6),
  cloud: cloud(),
  fog: cloud(-6) + '<path d="M14 50h36M18 57h28" stroke="var(--wx-cloud-edge)" stroke-width="3" stroke-linecap="round"/>',
  drizzle: cloud(-4) + drops(3, 'var(--wx-rain)'),
  rain: cloud(-4) + drops(4, 'var(--wx-rain)'),
  snow: cloud(-4) + flakes,
  storm: cloud(-4) + '<path d="M34 46l-6 9h6l-4 8 10-12h-6l4-5z" fill="var(--wx-bolt)" stroke="var(--wx-cloud-edge)" stroke-width="1.5" stroke-linejoin="round"/>',
};

export function weatherIcon(name) {
  return `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true">${ICONS[name] ?? ICONS.cloud}</svg>`;
}
