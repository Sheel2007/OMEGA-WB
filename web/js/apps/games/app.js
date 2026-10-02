// Games: pick a game, then play it full screen.
import { el } from '../../ui.js';
import { RULES } from './rules/index.js';
import { summary } from './status.js';
import { createGameScreen } from './views/game-screen.js';

const BLURBS = {
  'four-in-a-row': 'Drop discs in turn. Four in a line wins.',
  reversi: 'Trap the other colour to flip it. Most discs wins.',
  'dots-and-boxes': 'Draw lines in turn. Close a box to keep it.',
};

export function mount(root, { services }) {
  const store = services.games;
  let screen = null;

  const cards = el('div', { class: 'games-app__cards' });
  const picker = el('div', { class: 'games-app__picker' }, el('h1', { class: 'games-app__title', text: 'Games' }), cards);
  const view = el('div', { class: 'games-app' }, picker);
  root.append(view);

  function renderCards() {
    cards.replaceChildren(
      ...Object.entries(RULES).map(([kind, rules]) => {
        const { playing, text } = summary(kind, store.get(kind));
        return el(
          'button',
          { class: `game-card game-card--${kind}`, type: 'button', onclick: () => open(kind) },
          el('span', { class: 'game-card__art', 'aria-hidden': 'true' }),
          el('span', { class: 'game-card__name', text: rules.NAME }),
          el('span', { class: 'game-card__blurb', text: BLURBS[kind] }),
          el('span', { class: `game-card__status${playing ? ' game-card__status--playing' : ''}`, text: playing ? `Continue · ${text}` : 'Play' }),
        );
      }),
    );
  }

  function open(kind) {
    screen?.destroy();
    screen = createGameScreen({ rules: RULES[kind], store, onBack: showPicker });
    view.replaceChildren(screen.node);
  }

  function showPicker() {
    screen?.destroy();
    screen = null;
    renderCards();
    view.replaceChildren(picker);
  }

  showPicker();

  return {
    intent(kind) {
      if (RULES[kind]) open(kind);
      else showPicker();
    },
    unmount() {
      screen?.destroy();
    },
  };
}
