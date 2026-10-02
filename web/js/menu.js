// The top-right menu: theme, adding and removing widgets, and (on the kiosk)
// leaving full screen.
import { appIcon, el, icons } from './ui.js';

const THEMES = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'retro', label: 'Retro' },
];
// How long "Tap again to exit" waits for the second tap.
const EXIT_CONFIRM_MS = 4000;

export function createBoardMenu({ settings, apps, kiosk, onExit }) {
  let open = false;
  let whileOpen = null;
  let confirmTimer = null;

  const toggle = el('button', {
    class: 'board-menu__toggle',
    type: 'button',
    'aria-label': 'Menu',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    'aria-controls': 'board-menu-panel',
    html: icons.menu,
    onclick: () => (open ? close() : show()),
  });
  const scrim = el('div', { class: 'board-menu__scrim', onpointerdown: (event) => (event.preventDefault(), close()) });
  scrim.hidden = true;

  // Main view

  const themeButtons = THEMES.map((theme) =>
    el(
      'button',
      {
        class: 'theme-picker__option',
        type: 'button',
        role: 'radio',
        dataset: { mode: theme.id },
        onclick: () => settings.setTheme(theme.id),
      },
      el('span', { class: `theme-picker__swatch theme-picker__swatch--${theme.id}`, 'aria-hidden': 'true' }),
      el('span', { class: 'theme-picker__label', text: theme.label }),
    ),
  );
  const exitLabel = el('span', { class: 'board-menu__item-label', text: 'Exit to desktop' });
  const exitButton = kiosk
    ? el(
        'button',
        { class: 'board-menu__item board-menu__item--danger', type: 'button', onclick: exit },
        el('span', { class: 'board-menu__item-icon', html: icons.exit }),
        exitLabel,
      )
    : null;
  const mainView = el(
    'section',
    { class: 'board-menu__view' },
    el('h2', { class: 'board-menu__heading', id: 'board-menu-theme', text: 'Theme' }),
    el('div', { class: 'theme-picker', role: 'radiogroup', 'aria-labelledby': 'board-menu-theme' }, themeButtons),
    el(
      'button',
      { class: 'board-menu__item', type: 'button', onclick: () => showView('widgets') },
      el('span', { class: 'board-menu__item-icon', html: icons.widgets }),
      el('span', { class: 'board-menu__item-label', text: 'Add widget' }),
      el('span', { class: 'board-menu__item-chevron', html: icons.chevronRight }),
    ),
    exitButton,
  );

  // Widgets view

  const pickerRows = apps.map((app) => {
    const button = el('button', {
      class: 'widget-picker__button',
      type: 'button',
      onclick: () => (settings.getWidgets().includes(app.id) ? settings.removeWidget(app.id) : settings.addWidget(app.id)),
    });
    const row = el(
      'li',
      { class: 'widget-picker__row' },
      appIcon(app, 'widget-picker__icon'),
      el(
        'div',
        { class: 'widget-picker__text' },
        el('p', { class: 'widget-picker__name', text: app.name }),
        el('p', { class: 'widget-picker__description', text: app.description }),
      ),
      button,
    );
    return { app, row, button };
  });
  const widgetsView = el(
    'section',
    { class: 'board-menu__view' },
    el(
      'header',
      { class: 'board-menu__subhead' },
      el('button', {
        class: 'board-menu__back',
        type: 'button',
        html: `${icons.chevronLeft}<span>Back</span>`,
        onclick: () => showView('main'),
      }),
      el('h2', { class: 'board-menu__heading board-menu__heading--inline', text: 'Widgets' }),
    ),
    el('ul', { class: 'widget-picker' }, pickerRows.map((p) => p.row)),
  );
  widgetsView.hidden = true;

  const panel = el(
    'div',
    { class: 'board-menu__panel', id: 'board-menu-panel', role: 'dialog', 'aria-label': 'Board settings', tabindex: '-1' },
    mainView,
    widgetsView,
  );
  panel.hidden = true;

  const node = el('div', { class: 'board-menu' }, scrim, toggle, panel);

  function renderSettings({ theme, widgets }) {
    themeButtons.forEach((button) => button.setAttribute('aria-checked', String(button.dataset.mode === theme)));
    pickerRows.forEach(({ app, button }) => {
      const added = widgets.includes(app.id);
      button.textContent = added ? 'Remove' : 'Add';
      button.classList.toggle('widget-picker__button--remove', added);
      button.setAttribute('aria-label', `${added ? 'Remove' : 'Add'} the ${app.name} widget`);
    });
  }

  function showView(view) {
    mainView.hidden = view !== 'main';
    widgetsView.hidden = view !== 'widgets';
    resetExit();
  }

  function resetExit() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    if (!exitButton) return;
    exitButton.classList.remove('board-menu__item--confirm');
    exitLabel.textContent = 'Exit to desktop';
  }

  // Two taps, so a stray touch can't close the board.
  function exit() {
    if (!confirmTimer) {
      exitButton.classList.add('board-menu__item--confirm');
      exitLabel.textContent = 'Tap again to exit';
      confirmTimer = setTimeout(resetExit, EXIT_CONFIRM_MS);
      return;
    }
    resetExit();
    close();
    onExit();
  }

  function show() {
    if (open) return;
    open = true;
    showView('main');
    panel.hidden = false;
    scrim.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    node.classList.add('board-menu--open');
    panel.focus({ preventScroll: true });
    whileOpen = new AbortController();
    addEventListener('keydown', (event) => event.key === 'Escape' && close(), { signal: whileOpen.signal });
  }

  function close() {
    if (!open) return;
    open = false;
    resetExit();
    whileOpen.abort();
    panel.hidden = true;
    scrim.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    node.classList.remove('board-menu--open');
  }

  const unsubscribe = settings.subscribe(renderSettings);
  renderSettings(settings.get());

  return {
    node,
    close,
    destroy() {
      close();
      unsubscribe();
      node.remove();
    },
  };
}
