// The board itself: its address for phones, and leaving kiosk mode.
import { getJson, postJson } from './http.js';

export async function fetchInfo() {
  try {
    return await getJson('/api/info');
  } catch {
    return null;
  }
}

// The QR code a phone scans: this board (optionally straight into one app), or one
// of the places the server knows about, such as Google Calendar's new-event page.
export async function fetchQrSvg({ app, target } = {}) {
  try {
    const query = target ? `?target=${encodeURIComponent(target)}` : app ? `?app=${encodeURIComponent(app)}` : '';
    const response = await fetch(`/api/qr.svg${query}`, { cache: 'no-store' });
    const svg = response.ok ? await response.text() : '';
    return svg.startsWith('<svg') ? svg : null;
  } catch {
    return null;
  }
}

export async function isServerUp() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}

// Resolves to true if the kiosk browser is closing, false if this screen isn't the kiosk.
export async function exitKiosk() {
  const result = await postJson('/api/kiosk/exit', {});
  return Boolean(result?.closing);
}
