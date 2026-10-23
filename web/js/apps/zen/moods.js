// Zen mode's moods: what the Blocks world does while you sit with it. A mood can
// move the sun (sky.js draws it there instead of the real one) and choose what
// falls (fall.js); `undefined` leaves the falling to the real weather. `sound` is
// the ambient sound it goes with, if one is already playing (it never starts one).

// The sun low in the west, just before it sets: a golden sky, the day's visitors.
export const SUNSET = { elevation: 3, hourAngle: 75 };
// Well past dusk: every star out, the land dark, night visitors, and the moon high
// on the left (clear of the breathing sun in the middle).
export const STARRY_NIGHT = { elevation: -28, hourAngle: 145 };

export const MOODS = [
  { id: 'now', label: 'Now', sun: null, fall: undefined, sound: null },
  { id: 'rain', label: 'Rain', sun: null, fall: 'rain', sound: 'rain' },
  { id: 'snow', label: 'Snow', sun: null, fall: 'snow', sound: 'wind' },
  { id: 'sunset', label: 'Sunset', sun: SUNSET, fall: null, sound: 'stream' },
  { id: 'night', label: 'Starry night', sun: STARRY_NIGHT, fall: null, sound: 'campfire' },
];

export function moodById(id) {
  return MOODS.find((mood) => mood.id === id) ?? MOODS[0];
}
