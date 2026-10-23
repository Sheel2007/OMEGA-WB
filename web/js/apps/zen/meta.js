export const id = 'zen';
export const name = 'Zen';
export const description = 'Clear the widgets away and sit with the Blocks world: moods, a visitor, breathing and soft sounds';
// No widget. It opens without the Home bar or the panel behind apps (app-host.js),
// so the moving world stays, and its own controls take it home.
export const immersive = true;
export const iconBackground = 'var(--icon-zen)';
// A square sun over a blocky green hill: our own drawing.
export const iconGlyph = `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="29" y="6" width="6" height="6" fill="#ffd23f"/>
  <rect x="11" y="22" width="6" height="5" fill="#ffd23f"/>
  <rect x="47" y="22" width="6" height="5" fill="#ffd23f"/>
  <rect x="21" y="15" width="22" height="22" fill="#e89a00"/>
  <rect x="24" y="18" width="16" height="16" fill="#ffe066"/>
  <rect x="24" y="18" width="6" height="6" fill="#fff6c4"/>
  <path d="M4 44h12v-4h10v-4h12v4h10v4h12v6H4z" fill="#5fa83a"/>
  <path d="M4 50h56v8H4z" fill="#8a5a2b"/>
  <path d="M8 46h4v2H8zM30 40h4v2h-4zM50 46h4v2h-4z" fill="#7cc24c"/>
</svg>`;
