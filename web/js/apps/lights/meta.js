export const id = 'lights';
export const name = 'Lights';
export const description = 'Turn the lights on and off, or on a schedule';
// The size it starts at, and every size it can be resized to in edit mode
// (small, medium, large; see SIZES in widget-layout.js). It must look right in each.
export const widgetSize = 'medium';
export const widgetSizes = ['small', 'medium', 'large'];
export const iconBackground = 'var(--icon-lights)';
export const iconGlyph = `<svg viewBox="0 0 64 64" aria-hidden="true">
  <path d="M32 10a16 16 0 0 0-9.3 29c1.5 1.1 2.3 2.8 2.3 4.6V45h14v-1.4c0-1.8.8-3.5 2.3-4.6A16 16 0 0 0 32 10z" fill="#ffd54a"/>
  <path d="M26 50.5h12M28.5 56h7" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>
</svg>`;
