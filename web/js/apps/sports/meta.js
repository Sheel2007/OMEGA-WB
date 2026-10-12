export const id = 'sports';
export const name = 'Sports';
export const description = 'Arsenal, Tottenham, Maryland and the Champions League';
// No widget: Sports is the page before page 1 (page.js), with a strip under the
// clock on game days (game-day.js). The app itself has every match and table.
export const iconBackground = 'var(--icon-sports)';
// A football: our own drawing. White patches, black pentagons cut off at the
// ball's white rim, and a little shade low on the right for roundness.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs><clipPath id="sports-icon-ball"><circle cx="32" cy="32" r="22"/></clipPath></defs>
  <g clip-path="url(#sports-icon-ball)">
    <rect width="64" height="64" fill="#d3d8e3"/>
    <circle cx="30.5" cy="30" r="22" fill="#fff"/>
    <path d="M32 23.40L40.18 29.34L37.05 38.96L26.95 38.96L23.82 29.34Z" fill="#1d2230" stroke="#1d2230" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M32 23.40L32 17.40M40.18 29.34L45.89 27.49M37.05 38.96L40.58 43.81M26.95 38.96L23.42 43.81M23.82 29.34L18.11 27.49" stroke="#1d2230" stroke-width="2" stroke-linecap="round"/>
    <path d="M32 17.40L24.01 11.60L27.06 2.20L36.94 2.20L39.99 11.60ZM45.89 27.49L48.94 18.10L58.81 18.10L61.86 27.49L53.87 33.29ZM40.58 43.81L50.46 43.81L53.51 53.20L45.52 59.01L37.53 53.20ZM23.42 43.81L26.47 53.20L18.48 59.01L10.49 53.20L13.54 43.81ZM18.11 27.49L10.13 33.29L2.14 27.49L5.19 18.10L15.06 18.10Z" fill="#1d2230" stroke="#1d2230" stroke-width="1.2" stroke-linejoin="round"/>
  </g>
  <circle cx="32" cy="32" r="22.4" fill="none" stroke="#fff" stroke-width="2.2"/>
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
