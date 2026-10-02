// The wallpaper is the sky outside: colours follow the real sun, and the
// widgets switch to their dark look once it sets. Light and Dark hold the sky
// still; Blocks follows the sun too, with its own flat, banded colours, a
// square sun and moon, and a day/night card palette.
import { mixHex } from './color.js';
import { seededRandom } from './random.js';

const RAD = Math.PI / 180;
// Below this solar elevation (degrees) the board uses its dark theme. Chosen so
// the clock keeps at least 3:1 contrast through sunset (see sky.test.js).
const DARK_BELOW = 2.75;
const REPAINT_MS = 60 * 1000;

export const THEME_MODES = ['auto', 'light', 'dark', 'blocks'];

// Where the sun "sits" for the themes that don't follow the real one.
const FIXED_SUN = {
  light: { elevation: 45, hourAngle: 28, noonElevation: 60 },
  dark: { elevation: -18, hourAngle: 150, noonElevation: 60 },
};

// Themes whose sky follows the real sun (and so repaints once a minute).
const FOLLOWS_SUN = new Set(['auto', 'blocks']);

// Blocks: the sky is five flat bands from `top` down to `low` (the horizon).
const BLOCK_BANDS = 5;
const BLOCKS_KEYFRAMES = [
  { at: -18, top: '#0a0e2a', low: '#1f2557', stars: 1 },
  { at: -9, top: '#141a4a', low: '#3b2f6b', stars: 0.8 },
  { at: -4, top: '#26357f', low: '#b85a6e', stars: 0.25 },
  { at: 0, top: '#3555b0', low: '#f0884f', stars: 0 },
  { at: 5, top: '#3c63c4', low: '#f3b27a', stars: 0 },
  { at: 12, top: '#3d6ad0', low: '#8fb7f5', stars: 0 },
  { at: 90, top: '#3f70d8', low: '#9cc2f7', stars: 0 },
];
// Phases of the day for the Blocks scenery (which character visits).
const NIGHT_BELOW = -6;
const DAY_FROM = 8;
// The sun glow fades out here and the night glow takes over.
const NIGHT_GLOW_BELOW = -7;

const KEYFRAMES = [
  { at: -18, top: '#050918', mid: '#0c1230', low: '#1a1b3f', glow: '#8b9cff', glowA: 0.13, stars: 1 },
  { at: -10, top: '#0a1230', mid: '#1b2156', low: '#3a2c62', glow: '#9a8cff', glowA: 0.1, stars: 0.85 },
  { at: -7, top: '#111b45', mid: '#33306e', low: '#71416f', glow: '#ff9a6b', glowA: 0, stars: 0.55 },
  { at: -4, top: '#1b2a63', mid: '#5a4886', low: '#c2717c', glow: '#ff9a6b', glowA: 0.32, stars: 0.2 },
  { at: 0, top: '#2d4a8c', mid: '#9a6c9c', low: '#f4956a', glow: '#ffb071', glowA: 0.55, stars: 0 },
  { at: 4, top: '#4f7bc0', mid: '#c49ab4', low: '#ffc893', glow: '#ffd29a', glowA: 0.6, stars: 0 },
  { at: 12, top: '#6a9fe0', mid: '#b5cdea', low: '#f6ddbf', glow: '#fff1d6', glowA: 0.55, stars: 0 },
  { at: 30, top: '#7db1ea', mid: '#bfdaf3', low: '#eef0ea', glow: '#ffffff', glowA: 0.5, stars: 0 },
  { at: 90, top: '#78aee9', mid: '#c3ddf5', low: '#f3f4ef', glow: '#ffffff', glowA: 0.5, stars: 0 },
];

const norm360 = (deg) => ((deg % 360) + 360) % 360;
const norm180 = (deg) => norm360(deg + 180) - 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function solarPosition(date, latitude, longitude) {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0
  const g = norm360(357.529 + 0.98560028 * d) * RAD;
  const q = norm360(280.459 + 0.98564736 * d);
  const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const tilt = (23.439 - 0.00000036 * d) * RAD;
  const rightAscension = Math.atan2(Math.cos(tilt) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const declination = Math.asin(Math.sin(tilt) * Math.sin(lambda));
  const siderealTime = norm360(280.46061837 + 360.98564736629 * d);
  const hourAngle = norm180(siderealTime + longitude - rightAscension);
  const lat = latitude * RAD;
  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle * RAD),
  ) / RAD;
  const noonElevation = 90 - Math.abs(latitude - declination / RAD);
  return { elevation, hourAngle, noonElevation };
}

function between(frames, elevation) {
  const e = clamp(elevation, frames[0].at, frames[frames.length - 1].at);
  let i = 0;
  while (i < frames.length - 2 && e > frames[i + 1].at) i++;
  const a = frames[i];
  const b = frames[i + 1];
  return { a, b, t: (e - a.at) / (b.at - a.at) };
}

function blocksSky(elevation) {
  const { a, b, t } = between(BLOCKS_KEYFRAMES, elevation);
  const top = mixHex(a.top, b.top, t);
  const low = mixHex(a.low, b.low, t);
  return {
    top,
    mid: mixHex(top, low, 0.5),
    low,
    glow: '#ffffff',
    glowAlpha: 0,
    stars: a.stars + (b.stars - a.stars) * t,
    theme: 'blocks',
    night: elevation < DARK_BELOW,
  };
}

export function blocksBands(sky) {
  return Array.from({ length: BLOCK_BANDS }, (_, i) => mixHex(sky.top, sky.low, i / (BLOCK_BANDS - 1)));
}

export function skyAt(elevation) {
  const { a, b, t } = between(KEYFRAMES, elevation);
  return {
    top: mixHex(a.top, b.top, t),
    mid: mixHex(a.mid, b.mid, t),
    low: mixHex(a.low, b.low, t),
    glow: mixHex(a.glow, b.glow, t),
    glowAlpha: a.glowA + (b.glowA - a.glowA) * t,
    stars: a.stars + (b.stars - a.stars) * t,
    theme: elevation < DARK_BELOW ? 'dark' : 'light',
  };
}

export function skyFor(mode, elevation) {
  if (mode === 'blocks') return blocksSky(elevation);
  if (FIXED_SUN[mode]) return skyAt(FIXED_SUN[mode].elevation);
  return skyAt(elevation);
}

// getTimezoneOffset() is minutes *behind* UTC, and the sun moves 15° per hour.
export function longitudeFromOffset(standardOffsetMinutes) {
  return -standardOffsetMinutes / 4 || 0;
}

export function guessLocation(now = new Date()) {
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  const southern = jan < jul; // clocks go forward in January only down south
  const latitude = jan === jul ? 30 : southern ? -35 : 40;
  return { latitude, longitude: longitudeFromOffset(Math.max(jan, jul)) };
}

export function parseTimeOverride(value, base = new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const at = new Date(base);
  at.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return at;
}

function glowPosition({ elevation, hourAngle, noonElevation }) {
  if (elevation < NIGHT_GLOW_BELOW) {
    // A soft, cool glow that drifts across the night sky.
    return { x: 50 + clamp(norm180(hourAngle + 180) / 110, -1, 1) * 38, y: 24 };
  }
  const peak = Math.max(noonElevation, 12);
  return {
    x: 50 + clamp(hourAngle / 110, -1, 1) * 42,
    y: 90 - clamp(elevation / peak, -0.3, 1) * 72,
  };
}

// Where the square sun and moon sit, as fractions of the sky (0,0 is top-left).
// Same arc as the glow; the moon is on the opposite side of the sky.
export function celestial({ elevation, hourAngle, noonElevation = 60 }) {
  const peak = Math.max(noonElevation, 12);
  const place = (angle, height) => ({
    x: 0.5 + clamp(angle / 110, -1, 1) * 0.42,
    y: 0.9 - clamp(height / peak, -0.3, 1) * 0.72,
  });
  return {
    sun: { ...place(hourAngle, elevation), visible: elevation > -3 },
    moon: { ...place(norm180(hourAngle + 180), -elevation), visible: elevation < 4 },
  };
}

export function dayPhase({ elevation, hourAngle }) {
  if (elevation < NIGHT_BELOW) return 'night';
  if (elevation >= DAY_FROM) return 'day';
  return hourAngle < 0 ? 'dawn' : 'dusk';
}

function starField(count = 120) {
  const random = seededRandom(20261001);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const x = (random() * 100).toFixed(2);
    const y = (Math.pow(random(), 1.4) * 70).toFixed(2);
    const spread = random() < 0.12 ? 0.6 : random() < 0.5 ? 0 : -0.4;
    const alpha = (0.35 + random() * 0.6).toFixed(2);
    stars.push(`${x}vw ${y}vh 0 ${spread}px rgb(255 255 255 / ${alpha})`);
  }
  return stars.join(',');
}

// onPaint(sun) is called after every repaint (the Blocks scenery uses it).
export function startSky({ root = document.documentElement, starsEl, getLocation, getTime = () => new Date(), mode = 'auto', onPaint }) {
  if (starsEl) starsEl.style.boxShadow = starField();
  const lifetime = new AbortController();
  let timer = null;

  function paint() {
    const { latitude, longitude } = getLocation();
    const sun = FIXED_SUN[mode] ?? solarPosition(getTime(), latitude, longitude);
    const sky = skyFor(mode, sun.elevation);
    const glow = glowPosition(sun);
    const style = root.style;
    style.setProperty('--sky-top', sky.top);
    style.setProperty('--sky-mid', sky.mid);
    style.setProperty('--sky-low', sky.low);
    style.setProperty('--glow', sky.glow);
    style.setProperty('--glow-alpha', sky.glowAlpha.toFixed(3));
    style.setProperty('--glow-x', `${glow.x.toFixed(1)}%`);
    style.setProperty('--glow-y', `${glow.y.toFixed(1)}%`);
    style.setProperty('--stars', sky.stars.toFixed(2));
    if (sky.theme === 'blocks') {
      blocksBands(sky).forEach((band, i) => style.setProperty(`--band-${i + 1}`, band));
      const { sun: sunAt, moon } = celestial(sun);
      style.setProperty('--sun-x', `${(sunAt.x * 100).toFixed(1)}%`);
      style.setProperty('--sun-y', `${(sunAt.y * 100).toFixed(1)}%`);
      style.setProperty('--sun-shown', sunAt.visible ? '1' : '0');
      style.setProperty('--moon-x', `${(moon.x * 100).toFixed(1)}%`);
      style.setProperty('--moon-y', `${(moon.y * 100).toFixed(1)}%`);
      style.setProperty('--moon-shown', moon.visible ? '1' : '0');
      root.dataset.night = String(sky.night);
    } else {
      delete root.dataset.night;
    }
    if (root.dataset.theme !== sky.theme) {
      root.dataset.theme = sky.theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sky.top);
    }
    onPaint?.(sun);
  }

  // Only skies that follow the real sun need repainting.
  function schedule() {
    clearInterval(timer);
    timer = FOLLOWS_SUN.has(mode) ? setInterval(paint, REPAINT_MS) : null;
  }

  paint();
  schedule();
  document.addEventListener('visibilitychange', () => document.hidden || paint(), { signal: lifetime.signal });

  return {
    repaint: paint,
    setMode(next) {
      mode = THEME_MODES.includes(next) ? next : 'auto';
      paint();
      schedule();
    },
    stop() {
      clearInterval(timer);
      lifetime.abort();
    },
  };
}
