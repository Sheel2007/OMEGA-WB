// The phone's scanner: a full-screen camera view that reads barcodes and QR codes.
//
// Live video needs a secure page (HTTPS, or localhost). A phone reaching the Pi over
// plain http:// on the home Wi-Fi can't have it, so there the scanner takes a photo
// instead: the system camera opens, and the photo is read once it's taken. Where the
// browser can read codes itself (BarcodeDetector, on Android), that does the work;
// otherwise the board's own decoders in scan/ do.
import { el, haptic, icons } from '../../ui.js';
import { decodeImage } from './scan/index.js';
import { svg } from './views.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'];
// How often a camera frame is read. Plenty for a hand-held phone, and it leaves the
// phone time to keep the preview smooth.
const SCAN_EVERY_MS = 180;
// Frames are shrunk to this width before the board's own decoders read them.
const FRAME_WIDTH = 960;
// Photos are bigger; this keeps a small barcode's bars wide enough to read.
const PHOTO_WIDTH = 1600;
// After a code is dealt with it's usually still in front of the camera. It isn't
// read again until it has been out of view this long, so one tin isn't added twice.
const SAME_CODE_MS = 2000;
const RECENT_CODES = 4;

let detectorPromise = null;

// The browser's own reader, if it has one that knows product codes. Asked once.
function nativeDetector() {
  detectorPromise ??= (async () => {
    try {
      if (!('BarcodeDetector' in globalThis)) return null;
      const supported = await globalThis.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new globalThis.BarcodeDetector({ formats }) : null;
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

const canScanLive = () => Boolean(globalThis.isSecureContext && navigator.mediaDevices?.getUserMedia);

function drawScaled(source, width, height, maxWidth, canvas) {
  const scale = Math.min(1, maxWidth / width);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// onCode(text, format) is called once per code; call resume() to look for the next.
export function createScanner({ onCode, onClose, onType }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const canvas = document.createElement('canvas');
  let stream = null;
  let timer = null;
  let paused = false;
  let closed = false;
  let torchOn = false;
  // The last few codes found, each ignored while it stays in view: text -> until.
  const recent = new Map();

  const video = el('video', { class: 'grocery-scanner__video', playsinline: true, muted: true, autoplay: true });
  video.muted = true;
  const status = el('p', { class: 'grocery-scanner__status', role: 'status', text: 'Starting the camera…' });
  const photoInput = el('input', { class: 'grocery-scanner__file', type: 'file', accept: 'image/*', capture: 'environment', tabindex: '-1' });
  const torchButton = el('button', {
    class: 'grocery-scanner__round',
    type: 'button',
    'aria-label': 'Flashlight',
    'aria-pressed': 'false',
    html: svg.torch,
    onclick: toggleTorch,
  });
  torchButton.hidden = true;
  const photoButton = el('button', { class: 'grocery-scanner__button', type: 'button', onclick: () => photoInput.click() }, el('span', { class: 'grocery-scanner__icon', html: svg.camera }), 'Take a Photo');
  const typeButton = el('button', { class: 'grocery-scanner__button', type: 'button', onclick: () => onType?.() }, el('span', { class: 'grocery-scanner__icon', html: svg.keyboard }), 'Type It');
  const frame = el('div', { class: 'grocery-scanner__frame', 'aria-hidden': 'true' });

  const node = el(
    'div',
    { class: 'grocery-scanner', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scan a barcode' },
    video,
    frame,
    el(
      'div',
      { class: 'grocery-scanner__top' },
      el('button', { class: 'grocery-scanner__round', type: 'button', 'aria-label': 'Close the scanner', html: icons.close, onclick: () => onClose?.() }),
      el('p', { class: 'grocery-scanner__title', text: 'Scan' }),
      torchButton,
    ),
    el('div', { class: 'grocery-scanner__bar' }, status, el('div', { class: 'grocery-scanner__actions' }, photoButton, typeButton)),
    photoInput,
  );

  function setStatus(text) {
    status.textContent = text;
  }

  function schedule() {
    clearTimeout(timer);
    if (!closed && !paused && stream && !document.hidden) timer = setTimeout(scanFrame, SCAN_EVERY_MS);
  }

  // A code from the camera, unless it's the one just dealt with and still in view.
  function seen(text, format) {
    const now = Date.now();
    if (now < (recent.get(text) ?? 0)) {
      recent.set(text, now + SAME_CODE_MS);
      return false;
    }
    found(text, format);
    return true;
  }

  function found(text, format) {
    recent.delete(text);
    recent.set(text, Date.now() + SAME_CODE_MS);
    if (recent.size > RECENT_CODES) recent.delete(recent.keys().next().value);
    paused = true;
    clearTimeout(timer);
    haptic();
    node.classList.add('grocery-scanner--found');
    onCode(text, format);
  }

  async function scanFrame() {
    if (closed || paused || video.readyState < 2 || !video.videoWidth) return schedule();
    try {
      const detector = await nativeDetector();
      if (detector) {
        const [hit] = await detector.detect(video);
        if (hit?.rawValue && !paused && !closed && seen(hit.rawValue, hit.format)) return;
      } else {
        const image = drawScaled(video, video.videoWidth, video.videoHeight, FRAME_WIDTH, canvas);
        const hit = decodeImage(image, { agree: 2 });
        if (hit && !paused && !closed && seen(hit.text, hit.format)) return;
      }
    } catch {
      // A frame that couldn't be read is just skipped.
    }
    schedule();
  }

  async function startCamera() {
    if (!canScanLive()) {
      node.classList.add('grocery-scanner--photo');
      setStatus('Take a photo of the barcode or QR code. (Live scanning needs the board on HTTPS.)');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      node.classList.add('grocery-scanner--photo');
      setStatus('The camera isn’t available. Take a photo of the barcode instead.');
      return;
    }
    if (closed) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    video.srcObject = stream;
    video.play().catch(() => {});
    const [track] = stream.getVideoTracks();
    torchButton.hidden = !track?.getCapabilities?.().torch;
    setStatus('Point at a barcode or QR code');
    schedule();
  }

  function toggleTorch() {
    const [track] = stream?.getVideoTracks() ?? [];
    if (!track) return;
    torchOn = !torchOn;
    track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => (torchOn = false));
    torchButton.setAttribute('aria-pressed', String(torchOn));
  }

  async function readPhoto(file) {
    if (!file) return;
    paused = true;
    setStatus('Reading the photo…');
    try {
      const bitmap = await createImageBitmap(file);
      const detector = await nativeDetector();
      let hit = null;
      if (detector) {
        const [native] = await detector.detect(bitmap);
        if (native?.rawValue) hit = { text: native.rawValue, format: native.format };
      }
      // A still photo only has one chance, so one line reading the barcode is enough.
      for (const width of [PHOTO_WIDTH, FRAME_WIDTH]) {
        if (hit) break;
        hit = decodeImage(drawScaled(bitmap, bitmap.width, bitmap.height, width, canvas), { agree: 1 });
      }
      bitmap.close?.();
      if (closed) return;
      if (hit) {
        found(hit.text, hit.format);
        return;
      }
      setStatus('No barcode in that photo. Get closer, keep it flat and in focus, and try again.');
    } catch {
      setStatus('That photo couldn’t be read. Try again.');
    }
    paused = false;
    schedule();
  }

  photoInput.addEventListener('change', () => {
    const [file] = photoInput.files;
    photoInput.value = '';
    readPhoto(file);
  }, { signal });
  // The system quietly stops a camera the phone isn't showing; look again on return.
  document.addEventListener('visibilitychange', () => (document.hidden ? clearTimeout(timer) : schedule()), { signal });
  // While a code is being dealt with, Escape belongs to the sheet over the scanner.
  addEventListener('keydown', (event) => event.key === 'Escape' && !paused && onClose?.(), { signal });

  startCamera();

  return {
    node,
    // Back to looking, after the code that was found has been dealt with.
    resume(message = 'Point at a barcode or QR code') {
      if (closed) return;
      paused = false;
      for (const text of recent.keys()) recent.set(text, Date.now() + SAME_CODE_MS);
      node.classList.remove('grocery-scanner--found');
      setStatus(node.classList.contains('grocery-scanner--photo') ? 'Take a photo of the next one.' : message);
      schedule();
    },
    destroy() {
      closed = true;
      clearTimeout(timer);
      lifetime.abort();
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
      node.remove();
    },
  };
}
