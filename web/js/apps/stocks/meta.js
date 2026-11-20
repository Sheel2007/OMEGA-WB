export const id = 'stocks';
export const name = 'Stocks';
export const description = 'The AI Index: the biggest AI companies as one fund';
// The size it starts at, and every size it can be resized to in edit mode
// (mini, small, medium, large; see SIZES in widget-layout.js). Mini is the
// one-column strip beside the clock, and it's the only size this widget comes in:
// it was made to fill that strip, so edit mode gives it no corner to stretch.
export const widgetSize = 'mini';
export const widgetSizes = ['mini'];
export const iconBackground = 'var(--icon-stocks)';
// A line climbing over a row of bars to a dot: our own drawing.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <rect x="11" y="44" width="8" height="10" rx="2" fill="#fff" fill-opacity=".7"/>
  <rect x="23" y="38" width="8" height="16" rx="2" fill="#fff" fill-opacity=".7"/>
  <rect x="35" y="42" width="8" height="12" rx="2" fill="#fff" fill-opacity=".7"/>
  <rect x="47" y="30" width="8" height="24" rx="2" fill="#fff" fill-opacity=".7"/>
  <path d="M11 33l12-9 10 6 16-16" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="50" cy="13" r="5.5" fill="#fff"/>
</svg>`;
