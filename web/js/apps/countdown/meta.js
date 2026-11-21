export const id = 'countdown';
export const name = 'Countdown';
export const description = 'The days we’re waiting for';
// The size it starts at, and every size it can be resized to in edit mode
// (small, medium, large; see SIZES in widget-layout.js). It must look right in each.
export const widgetSize = 'small';
export const widgetSizes = ['small', 'medium', 'large'];
export const iconBackground = 'var(--icon-countdown)';
// An hourglass, sand running down.
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <rect x="16" y="9" width="32" height="6" rx="2" fill="#17240a"/>
  <rect x="16" y="49" width="32" height="6" rx="2" fill="#17240a"/>
  <path d="M20 15h24c0 9-7 13-9.5 17C37 36 44 40 44 49H20c0-9 7-13 9.5-17C27 28 20 24 20 15z" fill="#fff"/>
  <path d="M25 19h14c-1 4-4 6-7 8-3-2-6-4-7-8zM24.5 46c1.5-5 4.5-7 7.5-8.5 3 1.5 6 3.5 7.5 8.5z" fill="#17240a"/>
</svg>`;
