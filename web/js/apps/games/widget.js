// Games: the home-screen widget. One row per game, showing where it's up to.
import { appIcon, el } from '../../ui.js';
import * as meta from './meta.js';
import { RULES } from './rules/index.js';
import { summary } from './status.js';

export function createWidget({ services, openApp }) {
  const store = services.games;
  const status = el('p', { class: 'widget-head__meta' });
  const rows = Object.entries(RULES).map(([kind, rules]) => {
    const state = el('span', { class: 'games-widget__state' });
    const button = el(
      'button',
      { class: `games-widget__game games-widget__game--${kind}`, type: 'button', onclick: () => openApp(meta.id, { origin: node, intent: kind }) },
      el('span', { class: 'games-widget__art', 'aria-hidden': 'true' }),
      el('span', { class: 'games-widget__name', text: rules.NAME }),
      state,
    );
    return { kind, rules, button, state };
  });
  const node = el(
    'article',
    { class: 'games-widget', 'aria-label': meta.name },
    el('a', {
      class: 'widget__link',
      href: `#/app/${meta.id}`,
      'aria-label': `Open ${meta.name}`,
      onclick: (event) => {
        event.preventDefault();
        openApp(meta.id, { origin: node });
      },
    }),
    el(
      'header',
      { class: 'widget-head' },
      appIcon(meta, 'widget-head__icon'),
      el('div', { class: 'widget-head__heading' }, el('h2', { class: 'widget-head__title', text: meta.name }), status),
    ),
    el('div', { class: 'games-widget__list' }, rows.map((r) => r.button)),
  );

  function render() {
    const last = store.getLast();
    rows.forEach(({ kind, rules, button, state }) => {
      const { playing, text } = summary(kind, store.get(kind));
      state.textContent = text;
      button.classList.toggle('games-widget__game--playing', playing);
      button.setAttribute('aria-label', `${rules.NAME}: ${text}`);
    });
    const lastSummary = last && RULES[last] ? summary(last, store.get(last)) : null;
    status.textContent = lastSummary?.playing ? `${RULES[last].NAME} · ${lastSummary.text}` : 'Pick a game';
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { node, destroy: unsubscribe };
}
