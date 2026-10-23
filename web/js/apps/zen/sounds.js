// Zen mode's ambient sounds, played with Web Audio from the recipes in
// sounds-plan.js. Nothing is made until someone picks a sound (browsers only let
// a tap start audio), every timer and node is let go when a sound stops, and
// close() ends it all when Zen does.
import { FADE_S, fillNoise, NOISE_SECONDS, nextCrackle, SOUNDS, VOLUMES } from './sounds-plan.js';

// A crackle: a few hundredths of a second of bright noise.
const CRACKLE_SECONDS = 0.05;

export function createSoundscape({ random = Math.random } = {}) {
  let ctx = null;
  let playing = null;
  let volume = 'quiet';
  const buffers = new Map();
  const timers = new Set();

  function later(fn, ms) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function audio() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Each colour of noise is made once and looped (both ears different, so it's wide).
  function noise(kind, seconds = NOISE_SECONDS) {
    const key = `${kind} ${seconds}`;
    if (!buffers.has(key)) {
      const buffer = ctx.createBuffer(2, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) fillNoise(kind, buffer.getChannelData(channel), random);
      buffers.set(key, buffer);
    }
    return buffers.get(key);
  }

  function crackle(sound, crackles) {
    if (sound.stopped) return;
    const next = nextCrackle(random, crackles);
    sound.crackleTimer = later(() => {
      if (sound.stopped) return;
      const source = ctx.createBufferSource();
      source.buffer = noise('white', CRACKLE_SECONDS);
      const bright = ctx.createBiquadFilter();
      bright.type = 'highpass';
      bright.frequency.value = 1800;
      const pop = ctx.createGain();
      const now = ctx.currentTime;
      pop.gain.setValueAtTime(next.level, now);
      pop.gain.exponentialRampToValueAtTime(0.001, now + next.lengthMs / 1000);
      source.connect(bright).connect(pop).connect(sound.out);
      source.onended = () => {
        source.disconnect();
        bright.disconnect();
        pop.disconnect();
      };
      source.start(now, random() * (CRACKLE_SECONDS / 2));
      source.stop(now + next.lengthMs / 1000 + 0.01);
      crackle(sound, crackles);
    }, next.inMs);
  }

  function start(name) {
    const plan = SOUNDS[name];
    const ac = audio();
    const out = ac.createGain();
    out.gain.value = 0;
    out.connect(ac.destination);
    const source = ac.createBufferSource();
    source.buffer = noise(plan.noise);
    source.loop = true;
    const filters = plan.filters.map(({ type, frequency, Q }) => {
      const filter = ac.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = Q;
      return filter;
    });
    const level = ac.createGain();
    level.gain.value = plan.level;
    [source, ...filters, level].reduce((from, to) => from.connect(to));
    level.connect(out);
    const nodes = [source, ...filters, level];
    if (plan.drift) {
      const wave = ac.createOscillator();
      wave.frequency.value = plan.drift.rateHz;
      const depth = ac.createGain();
      depth.gain.value = plan.drift.depthHz;
      wave.connect(depth).connect(filters[plan.drift.filter].frequency);
      wave.start();
      nodes.push(wave, depth);
    }
    source.start();
    out.gain.setTargetAtTime(VOLUMES[volume], ac.currentTime, FADE_S / 3);
    const sound = { name, out, nodes, stopped: false, crackleTimer: null };
    if (plan.crackles) crackle(sound, plan.crackles);
    return sound;
  }

  function release(sound) {
    for (const node of sound.nodes) {
      try {
        node.stop?.();
      } catch {
        // Already stopped.
      }
      node.disconnect();
    }
    sound.out.disconnect();
  }

  function stop(sound, { fade = true } = {}) {
    sound.stopped = true;
    clearTimeout(sound.crackleTimer);
    timers.delete(sound.crackleTimer);
    if (!fade || !ctx) {
      release(sound);
      return;
    }
    sound.out.gain.setTargetAtTime(0, ctx.currentTime, FADE_S / 3);
    later(() => release(sound), FADE_S * 1000 + 200);
  }

  return {
    get playing() {
      return playing?.name ?? null;
    },
    get volume() {
      return volume;
    },
    // A sound's name from SOUNDS, or null for quiet. Call it from a tap.
    play(name) {
      const next = Object.hasOwn(SOUNDS, name ?? '') ? name : null;
      if (next === (playing?.name ?? null)) return;
      if (playing) stop(playing);
      playing = next ? start(next) : null;
    },
    setVolume(next) {
      if (!Object.hasOwn(VOLUMES, next)) return;
      volume = next;
      if (playing && ctx) playing.out.gain.setTargetAtTime(VOLUMES[volume], ctx.currentTime, 0.3);
    },
    close() {
      if (playing) stop(playing, { fade: false });
      playing = null;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      buffers.clear();
      ctx?.close();
      ctx = null;
    },
    // For checking it's let everything go.
    get state() {
      return ctx?.state ?? 'closed';
    },
  };
}
