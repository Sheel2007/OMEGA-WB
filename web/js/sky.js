// The wallpaper is the sky outside: colours follow the real sun, and the
// widgets switch to their dark look once it sets.

const RAD = Math.PI / 180;
// Below this solar elevation (degrees) the board uses its dark theme.
const DARK_BELOW = 2;
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

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return '#' + ((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0');
}

export function skyAt(elevation) {
  const e = clamp(elevation, KEYFRAMES[0].at, KEYFRAMES[KEYFRAMES.length - 1].at);
  let i = 0;
  while (i < KEYFRAMES.length - 2 && e > KEYFRAMES[i + 1].at) i++;
  const a = KEYFRAMES[i];
  const b = KEYFRAMES[i + 1];
  const t = (e - a.at) / (b.at - a.at);
  return {
    top: mix(a.top, b.top, t),
    mid: mix(a.mid, b.mid, t),
    low: mix(a.low, b.low, t),
    glow: mix(a.glow, b.glow, t),
    glowAlpha: a.glowA + (b.glowA - a.glowA) * t,
    stars: a.stars + (b.stars - a.stars) * t,
    theme: elevation < DARK_BELOW ? 'dark' : 'light',
  };
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

function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

export function startSky({ root = document.documentElement, starsEl, getLocation, getTime = () => new Date() }) {
  if (starsEl) starsEl.style.boxShadow = starField();

  function paint() {
    const { latitude, longitude } = getLocation();
    const sun = solarPosition(getTime(), latitude, longitude);
    const sky = skyAt(sun.elevation);
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
    if (root.dataset.theme !== sky.theme) {
      root.dataset.theme = sky.theme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sky.top);
    }
  }

  paint();
  const timer = setInterval(paint, 60 * 1000);
  document.addEventListener('visibilitychange', () => document.hidden || paint());
  return { repaint: paint, stop: () => clearInterval(timer) };
}
