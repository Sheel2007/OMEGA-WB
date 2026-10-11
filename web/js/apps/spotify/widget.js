// Spotify: the song playing on the board's account, its cover made into a CD,
// with the song's name under it. Display only; the board never controls playback. No header at
// any size: just the cover and the song.
//
// Mini (one column by two rows) is the cover, the song and who it's by; bigger
// sizes add the album and a playhead. The server pushes a new reading only when the
// song, the pause state or the position jumps, so the playhead is moved along here
// by one 1s timer that runs only while a song is playing.
import { el, toast } from '../../ui.js';
import { clockTime, describe, progressAt } from './format.js';
import * as meta from './meta.js';

const TICK_MS = 1000;
// Only these sizes show the playhead; the timer skips its writes otherwise.
const PLAYHEAD_SIZES = new Set(['medium', 'large']);
const NOTE = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M27 16l20-5v27" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 16v27" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><ellipse cx="21" cy="45" rx="7" ry="5.6" fill="currentColor"/><ellipse cx="41" cy="40" rx="7" ry="5.6" fill="currentColor"/></svg>`;

export function createWidget({ services }) {
  const { spotify } = services;
  const art = el('img', { class: 'spotify-widget__art', alt: '', decoding: 'async', draggable: 'false' });
  art.hidden = true;
  // The cover printed on the disc, with the CD's hub and shine laid over it.
  const disc = el('div', { class: 'spotify-widget__disc' }, el('span', { class: 'spotify-widget__placeholder', html: NOTE }), art);
  const cover = el('div', { class: 'spotify-widget__cover' }, disc, el('span', { class: 'spotify-widget__shine', 'aria-hidden': 'true' }));
  const title = el('p', { class: 'spotify-widget__title' });
  const artist = el('p', { class: 'spotify-widget__artist' });
  const album = el('p', { class: 'spotify-widget__album' });
  const hint = el('p', { class: 'spotify-widget__hint' });
  const fill = el('span', { class: 'spotify-widget__fill' });
  const elapsed = el('span', { class: 'spotify-widget__time' });
  const total = el('span', { class: 'spotify-widget__time' });
  const playhead = el(
    'div',
    { class: 'spotify-widget__playhead', 'aria-hidden': 'true' },
    el('span', { class: 'spotify-widget__bar' }, fill),
    el('span', { class: 'spotify-widget__times' }, elapsed, total),
  );
  const connect = el('button', { class: 'spotify-widget__connect', type: 'button', text: 'Connect', onclick: link });
  const node = el(
    'article',
    { class: 'spotify-widget', 'aria-label': meta.name },
    el(
      'div',
      { class: 'spotify-widget__body' },
      el('div', { class: 'spotify-widget__cover-slot' }, cover),
      el('div', { class: 'spotify-widget__text', 'aria-live': 'polite' }, title, artist, album, hint, playhead, connect),
    ),
  );

  let track = null;
  let shownArt = null;
  let timer = null;
  let logged = null;

  art.addEventListener('load', () => (art.hidden = false));
  art.addEventListener('error', () => (art.hidden = true));

  function setArt(id) {
    if (id === shownArt) return;
    shownArt = id;
    art.hidden = true;
    if (id) art.src = `/api/spotify/art?id=${encodeURIComponent(id)}`;
    else art.removeAttribute('src');
  }

  function drawPlayhead() {
    const at = progressAt(track, Date.now());
    const share = track?.duration_ms ? at / track.duration_ms : 0;
    fill.style.transform = `scaleX(${share.toFixed(4)})`;
    elapsed.textContent = clockTime(at);
    total.textContent = track?.duration_ms ? clockTime(track.duration_ms) : '';
  }

  function tick() {
    timer = null;
    if (!track?.playing) return;
    if (PLAYHEAD_SIZES.has(node.dataset.size)) drawPlayhead();
    timer = setTimeout(tick, TICK_MS);
  }

  function render(state) {
    track = state.track;
    if (state.error && state.error !== logged) console.warn(`Spotify: ${state.error}`);
    logged = state.error;
    node.setAttribute('aria-label', describe(state));
    node.classList.toggle('spotify-widget--paused', Boolean(track && !track.playing));
    node.classList.toggle('spotify-widget--idle', !track);
    connect.hidden = !state.configured || state.linked;

    if (track) {
      title.textContent = track.title;
      artist.textContent = track.artist ?? '';
      album.textContent = track.album ?? '';
      hint.textContent = '';
    } else if (!state.configured) {
      title.textContent = 'Not set up';
      artist.textContent = album.textContent = '';
      hint.textContent = 'Add a Spotify client ID to config.json.';
    } else if (!state.linked) {
      title.textContent = 'Spotify';
      artist.textContent = album.textContent = '';
      hint.textContent = "Connect an account to see what's playing.";
    } else {
      title.textContent = 'Nothing playing';
      artist.textContent = state.account ?? '';
      album.textContent = '';
      hint.textContent = '';
    }
    artist.hidden = !artist.textContent;
    album.hidden = !album.textContent;
    hint.hidden = !hint.textContent;
    playhead.hidden = !track;
    setArt(track?.art ?? null);

    clearTimeout(timer);
    timer = null;
    if (track) drawPlayhead();
    if (track?.playing) timer = setTimeout(tick, TICK_MS);
  }

  async function link() {
    connect.disabled = true;
    try {
      const started = await spotify.link(location.href);
      // Spotify sends the browser back to this server once the account says yes.
      location.href = started.url;
    } catch (err) {
      toast(err.message);
      connect.disabled = false;
    }
  }

  const unsubscribe = spotify.subscribe(render);
  return {
    node,
    destroy() {
      unsubscribe();
      clearTimeout(timer);
      timer = null;
    },
  };
}
