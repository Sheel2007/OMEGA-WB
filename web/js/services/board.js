// The board itself: its address for phones, and leaving kiosk mode.
import { getJson, postJson } from './http.js';

export async function fetchInfo() {
  try {
    return await getJson('/api/info');
  } catch {
    return null;
  }
}

export async function fetchQrSvg() {
  try {
    const response = await fetch('/api/qr.svg', { cache: 'no-store' });
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
