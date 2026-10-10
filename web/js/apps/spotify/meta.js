export const id = 'spotify';
export const name = 'Spotify';
export const description = "What's playing on the board's Spotify account";
// The size it starts at, and every size it can be resized to in edit mode
// (mini, small, medium, large; see SIZES in widget-layout.js). It must look right
// in each. Mini is the one-column strip beside the clock: just the cover and the song.
export const widgetSize = 'mini';
export const widgetSizes = ['mini', 'small', 'medium', 'large'];
export const iconBackground = 'var(--icon-spotify)';
// A music note over a few level bars: our own drawing, not Spotify's logo.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M27 14l20-5v29" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M27 14v28" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="21" cy="44" rx="7.5" ry="6" fill="#fff"/>
  <ellipse cx="41" cy="40" rx="7.5" ry="6" fill="#fff"/>
  <rect x="12" y="54" width="8" height="4" rx="2" fill="#fff" fill-opacity=".7"/>
  <rect x="24" y="54" width="16" height="4" rx="2" fill="#fff" fill-opacity=".7"/>
  <rect x="44" y="54" width="8" height="4" rx="2" fill="#fff" fill-opacity=".7"/>
</svg>`;
