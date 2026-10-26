// The board's end of the jukebox: an invisible YouTube player.
//
// Built only on the board's own screen, so a phone or a laptop that happens to
// have the page open never joins in and gives the game away. Nothing is loaded
// from YouTube until a song is actually asked for, and nothing is ever shown:
// the player is one pixel, off-screen and out of the accessibility tree.
const API_URL = 'https://www.youtube.com/iframe_api';
// How long to let a song get going before deciding the browser blocked it.
const START_GRACE_MS = 4000;
// What YouTube's onError codes mean, in words the phone can show.
const ERRORS = {
  2: 'That video id is wrong.',
  5: 'The player couldn’t play that one.',
  100: 'That video is gone or private.',
  101: 'The owner doesn’t allow this video off YouTube.',
  150: 'The owner doesn’t allow this video off YouTube.',
};

let apiReady = null;

// Loads YouTube's player script once, the first time a song is asked for.
function youtubeApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (globalThis.YT?.Player) return resolve(globalThis.YT);
    const earlier = globalThis.onYouTubeIframeAPIReady;
    globalThis.onYouTubeIframeAPIReady = () => {
      earlier?.();
      resolve(globalThis.YT);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Couldn’t reach YouTube.'));
    document.head.append(script);
  });
  return apiReady;
}

export function createJukebox({ jukebox }) {
  const frame = document.createElement('div');
  // Out of sight and out of the accessibility tree, but still laid out, because a
  // player with no box at all is treated as hidden and won't play.
  frame.className = 'jukebox-player';
  frame.setAttribute('aria-hidden', 'true');
  document.body.append(frame);

  let player = null;
  let building = null;
  let playing = null;
  let graceTimer = null;
  let stopped = false;

  const say = (what, detail) => jukebox.report(what, detail);

  function clearGrace() {
    clearTimeout(graceTimer);
    graceTimer = null;
  }

  // Chromium won't start sound on its own unless the kiosk launcher allows it
  // (pi/kiosk.sh passes --autoplay-policy=no-user-gesture-required). If a song
  // hasn't started by now, say so rather than leaving the phone guessing.
  function watchForBlocked() {
    clearGrace();
    graceTimer = setTimeout(() => {
      graceTimer = null;
      const state = player?.getPlayerState?.();
      // -1 unstarted, 5 cued: it loaded and then just sat there.
      if (state === -1 || state === 5) say('blocked', 'The board’s browser blocked the sound.');
    }, START_GRACE_MS);
  }

  async function build(track, volume) {
    const YT = await youtubeApi();
    if (stopped) return null;
    return new Promise((resolve) => {
      player = new YT.Player(frame, {
        width: 1,
        height: 1,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          rel: 0,
          fs: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            player.setVolume(volume);
            player.unMute();
            resolve(player);
          },
          onStateChange: ({ data }) => {
            if (data === YT.PlayerState.PLAYING) {
              clearGrace();
              say('playing');
            } else if (data === YT.PlayerState.ENDED) {
              clearGrace();
              playing = null;
              say('idle');
            }
          },
          onError: ({ data }) => {
            clearGrace();
            playing = null;
            say('error', ERRORS[data] ?? 'YouTube wouldn’t play that.');
          },
        },
      });
    });
  }

  async function apply(state) {
    if (stopped) return;
    const track = state.track;
    if (!track) {
      clearGrace();
      playing = null;
      player?.stopVideo?.();
      return;
    }
    // The same song asked for again means "start it over".
    const again = playing && playing.video === track.video && playing.asked === track.asked;
    if (again) {
      player?.setVolume?.(state.volume);
      return;
    }
    playing = track;
    try {
      building = building ?? build(track, state.volume);
      const ready = await building;
      if (stopped || !ready || playing !== track) return;
      ready.setVolume(state.volume);
      ready.unMute();
      ready.loadVideoById({ videoId: track.video, startSeconds: track.start || 0 });
      watchForBlocked();
    } catch (err) {
      building = null;
      playing = null;
      say('error', err.message);
    }
  }

  let lastVolume = null;
  const unsubscribe = jukebox.subscribe((state) => {
    if (player && state.volume !== lastVolume) player.setVolume?.(state.volume);
    lastVolume = state.volume;
    apply(state);
  });

  return {
    destroy() {
      stopped = true;
      clearGrace();
      unsubscribe();
      player?.destroy?.();
      player = null;
      frame.remove();
    },
  };
}
