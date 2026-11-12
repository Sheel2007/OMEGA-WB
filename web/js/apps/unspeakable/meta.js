export const id = 'unspeakable';
export const name = 'Unspeakable';
export const description = 'Things we don’t talk about';
// The size it starts at, and every size it can be resized to in edit mode
// (small, medium, large; see SIZES in widget-layout.js). It must look right in each.
export const widgetSize = 'small';
export const widgetSizes = ['small', 'medium', 'large'];
export const iconBackground = 'var(--icon-unspeakable)';
// A filed page with its lines struck out.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M15 10h34a3 3 0 0 1 3 3v38a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3z" fill="#fff"/>
  <rect x="19" y="20" width="26" height="6" rx="1" fill="#1b1b22"/>
  <rect x="19" y="31" width="19" height="6" rx="1" fill="#1b1b22"/>
  <rect x="19" y="42" width="23" height="6" rx="1" fill="#1b1b22"/>
</svg>`;
