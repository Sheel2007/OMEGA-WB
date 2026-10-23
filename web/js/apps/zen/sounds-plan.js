// Zen mode's ambient sounds, as recipes: no recordings, just noise shaped by
// filters, made in the browser (sounds.js plays them). Pure, so the numbers can be
// checked without a speaker.
//
// noise: the colour of noise (white is hiss, pink is softer, brown is a rumble).
// filters: in order, BiquadFilter settings. level: how loud it is in the mix.
// drift: a slow wave moving one filter's frequency (wind gusting, water moving).
// crackles: short bright pops at random (a campfire).

export const SOUNDS = {
  rain: {
    label: 'Rain',
    noise: 'pink',
    filters: [
      { type: 'highpass', frequency: 500, Q: 0.7 },
      { type: 'lowpass', frequency: 6500, Q: 0.7 },
    ],
    level: 0.55,
    drift: { filter: 1, rateHz: 0.11, depthHz: 900 },
  },
  wind: {
    label: 'Wind',
    noise: 'brown',
    filters: [{ type: 'lowpass', frequency: 420, Q: 1.4 }],
    level: 0.95,
    drift: { filter: 0, rateHz: 0.07, depthHz: 260 },
  },
  stream: {
    label: 'Stream',
    noise: 'pink',
    filters: [{ type: 'bandpass', frequency: 1100, Q: 0.8 }],
    level: 0.6,
    drift: { filter: 0, rateHz: 0.31, depthHz: 380 },
  },
  campfire: {
    label: 'Campfire',
    noise: 'brown',
    filters: [{ type: 'lowpass', frequency: 260, Q: 0.7 }],
    level: 0.75,
    crackles: { everyMs: [120, 1100], level: [0.06, 0.3], lengthMs: [8, 35] },
  },
};

// The two volumes (the whole mix), kept low: it's background.
export const VOLUMES = { quiet: 0.18, normal: 0.4 };
// Seconds a sound takes to fade in or out.
export const FADE_S = 2;
// Seconds of noise in each looping buffer (long enough that the loop isn't heard).
export const NOISE_SECONDS = 4;

const between = (random, [lo, hi]) => lo + random() * (hi - lo);

export function nextCrackle(random, crackles) {
  return {
    inMs: Math.round(between(random, crackles.everyMs)),
    level: between(random, crackles.level),
    lengthMs: between(random, crackles.lengthMs),
  };
}

// Fills `samples` with noise of a colour, kept between -1 and 1.
export function fillNoise(kind, samples, random = Math.random) {
  if (kind === 'pink') {
    // Paul Kellet's filter: white noise through a few leaky averages.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      samples[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else if (kind === 'brown') {
    // White noise, summed and leaking back towards zero so it never wanders off.
    let last = 0;
    for (let i = 0; i < samples.length; i++) {
      last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
      samples[i] = last * 3.5;
    }
  } else {
    for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i]));
  return samples;
}
