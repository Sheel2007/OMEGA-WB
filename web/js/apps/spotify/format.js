// Words and times for the Spotify widget. Pure, so it's tested in node.

// Where the playhead is at `nowMs` (ms since the epoch): the server says where it
// was at `track.at`, and a playing song has moved on since.
export function progressAt(track, nowMs) {
  if (!track) return 0;
  const moved = track.playing ? Math.max(0, nowMs - track.at) : 0;
  const progress = track.progress_ms + moved;
  return track.duration_ms ? Math.min(progress, track.duration_ms) : progress;
}

// 3:07, or 1:02:45 for an episode over an hour.
export function clockTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

// The line under the widget's name.
export function statusLabel({ configured, linked, track, error }) {
  if (!configured) return 'Not set up';
  if (!linked) return 'Not connected';
  if (error && !track) return 'Offline';
  if (!track) return 'Nothing playing';
  return track.playing ? 'Now playing' : 'Paused';
}

// What a screen reader hears for the whole widget.
export function describe(state) {
  const { track } = state;
  if (!track) return `Spotify: ${statusLabel(state)}`;
  const by = track.artist ? ` by ${track.artist}` : '';
  return `Spotify, ${track.playing ? 'playing' : 'paused'}: ${track.title}${by}`;
}
