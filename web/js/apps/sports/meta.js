export const id = 'sports';
export const name = 'Sports';
export const description = 'Arsenal, Tottenham, Maryland and the Champions League';
// No widget: Sports is the page before page 1 (page.js), with a strip under the
// clock on game days (game-day.js). The app itself has every match and table.
export const iconBackground = 'var(--icon-sports)';
// A football: our own drawing.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="22" fill="#fff"/>
  <path d="M32 23.5l8.1 5.9-3.1 9.5H27l-3.1-9.5z" fill="#232838"/>
  <path d="M32 23.5V10.5M40.1 29.4l12.3-4M37 38.9l7.6 10.4M27 38.9l-7.6 10.4M23.9 29.4l-12.3-4" stroke="#232838" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M26.5 11.2l5.5 2.3 5.5-2.3M50 20.5l1.6 6.2-3.3 4.6M47.3 45.4l-5.2 3.6-5.6-.4M16.7 45.4l5.2 3.6 5.6-.4M14 20.5l-1.6 6.2 3.3 4.6" fill="none" stroke="#232838" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
// The dot before the page dots that opens the Sports page: a football in the
// dots' own colour (currentColor), its edge patches cut off by the ball's outline.
export const dotGlyph = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <defs><clipPath id="sports-dot-ball"><circle cx="12" cy="12" r="10"/></clipPath></defs>
  <circle cx="12" cy="12" r="10.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M12 7.70L16.09 10.67L14.53 15.48L9.47 15.48L7.91 10.67Z" fill="currentColor"/>
  <path d="M12 7.70L12 4.80M16.09 10.67L18.85 9.78M14.53 15.48L16.23 17.82M9.47 15.48L7.77 17.82M7.91 10.67L5.15 9.78" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path clip-path="url(#sports-dot-ball)" fill="currentColor" d="M12 5L8.20 2.24L9.65 -2.24L14.35 -2.24L15.80 2.24ZM18.66 9.84L20.11 5.36L24.81 5.36L26.27 9.84L22.46 12.60ZM16.11 17.66L20.82 17.66L22.27 22.14L18.47 24.90L14.66 22.14ZM7.89 17.66L9.34 22.14L5.53 24.90L1.73 22.14L3.18 17.66ZM5.34 9.84L1.54 12.60L-2.27 9.84L-0.81 5.36L3.89 5.36Z"/>
</svg>`;
