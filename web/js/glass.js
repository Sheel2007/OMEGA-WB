// The Apple theme's glass without backdrop-filter. Each card shows a copy of the
// wallpaper made ahead of time (apple-wallpaper.js); this lines that copy up with
// the part of the wallpaper behind the card by setting --glass-x and --glass-y on it.
//
// Offsets come from offsetLeft/offsetTop, which ignore transforms, so a page sliding
// in or the home screen zooming out under an app doesn't need anything redone: a
// widget's place on its page is the place it's shown at once that page is current.
// Measuring is only needed when the layout itself changes (refresh()) or the
// screen is resized (watched here).
const GLASS = '.home-page > .widget, .home__drag-layer > .widget, .dock, .page-dots';

export function createGlass({ board, home, isActive }) {
  // Where `node` sits inside .home, which fills the board.
  function offsetInHome(node) {
    let x = 0;
    let y = 0;
    for (let at = node; at && at !== home; at = at.offsetParent) {
      x += at.offsetLeft;
      y += at.offsetTop;
    }
    // Pages sit side by side in the track; every one is shown where the first is.
    const page = node.parentElement?.classList.contains('home-page') ? node.parentElement : null;
    if (page) x -= page.offsetLeft;
    return { x, y };
  }

  function refresh() {
    if (!isActive()) return;
    // The wallpaper fills the window and the board is centred in it.
    const origin = board.getBoundingClientRect();
    home.querySelectorAll(GLASS).forEach((node) => {
      const { x, y } = offsetInHome(node);
      node.style.setProperty('--glass-x', `${Math.round(origin.left + x)}px`);
      node.style.setProperty('--glass-y', `${Math.round(origin.top + y)}px`);
    });
  }

  const resizes = new ResizeObserver(() => refresh());
  resizes.observe(document.documentElement);

  return {
    refresh,
    destroy() {
      resizes.disconnect();
    },
  };
}
