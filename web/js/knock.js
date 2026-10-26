// A secret knock: so many taps on the same spot, close enough together. Pure, so
// it's tested in node. Used by the jukebox, which has no button to find.
export const KNOCK_TAPS = 5;
export const KNOCK_WITHIN_MS = 3000;

// The taps still worth counting at `now`: the most recent `keep` inside the window.
export function recentTaps(times, now, withinMs = KNOCK_WITHIN_MS, keep = KNOCK_TAPS) {
  const inside = times.filter((at) => now - at < withinMs);
  return keep > 0 ? inside.slice(-keep) : [];
}

// Adds a tap and says whether that completed the knock. Returns the taps to keep,
// empty once the knock lands so the next one starts from nothing.
export function knock(times, now, { taps = KNOCK_TAPS, withinMs = KNOCK_WITHIN_MS } = {}) {
  // Room for the tap being added, so a longer knock isn't cut short.
  const kept = [...recentTaps(times, now, withinMs, taps - 1), now];
  const opened = kept.length >= taps && now - kept[0] < withinMs;
  return { taps: opened ? [] : kept, opened };
}
