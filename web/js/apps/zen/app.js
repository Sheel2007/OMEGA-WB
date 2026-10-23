// Zen mode: the widgets fade away and the Blocks world is all there is, with a few
// gentle things to do in it. Moods change the sky and what falls, a visitor can be
// called over, a big pixel sun leads a few minutes of slow breathing, and the
// browser can make soft rain, wind, stream or campfire sounds. The controls rest
// out of sight after a few seconds; a tap anywhere brings them back.
//
// The app only asks the world to change (context.world, from main.js) and puts it
// all back when it closes. Every timer, listener and sound is let go on unmount.
import { dataUri, pixelSvg } from '../../pixel-art.js';
import { sunBetween } from '../../sky.js';
import { el, haptic, reducedMotion, toast } from '../../ui.js';
import { breathAt, breathCount, SESSIONS } from './breathe.js';
import { MOODS, moodById } from './moods.js';
import { createSoundscape } from './sounds.js';
import { SOUNDS } from './sounds-plan.js';
import {
  BREATH_TICK_MS,
  CLOCK_TICK_MS,
  CONTROLS_REST_MS,
  FIRST_STAR_AFTER_MS,
  HINT_MS,
  nextShootingStar,
  SKY_CHANGE_MS,
  SKY_STEP_MS,
  skySteps,
} from './zen-timing.js';

// The breathing sun: our own 16 x 16 drawing.
const SUN = {
  rows: [
    '.......yy.......',
    '.......yy.......',
    '..y..........y..',
    '...y........y...',
    '....oooooooo....',
    '....oWWYYYYo....',
    '....oWYYYYYo....',
    'yy..oYYYYYYo..yy',
    'yy..oYYYYYYo..yy',
    '....oYYYYYYo....',
    '....oYYYYYdo....',
    '....oooooooo....',
    '...y........y...',
    '..y..........y..',
    '.......yy.......',
    '.......yy.......',
  ],
  palette: { y: '#ffd23f', o: '#e89a00', Y: '#ffe066', W: '#fff6c4', d: '#f4b400' },
};
// While breathing, if motion is turned down: the sun stays still at this size.
const STILL_SCALE = 0.8;
// Shooting stars on screen at once, at most (they remove themselves when done).
const MAX_STARS = 3;
const SOUND_NAMES = Object.keys(SOUNDS);

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });

export function mount(root, { world, goHome }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const sounds = createSoundscape();
  let mood = MOODS[0];
  let skyMoved = false;
  let hinted = false;
  let breathing = null;
  let shownScale = null;
  const timers = { rest: null, hint: null, sky: null, star: null, breath: null };

  const button = (label, onclick, attrs = {}) => el('button', { class: 'zen__button', type: 'button', onclick, ...attrs }, label);

  // Controls

  const moodButtons = MOODS.map((m) =>
    button(m.label, () => setMood(m.id), { class: 'zen__button zen__button--mood', 'aria-pressed': String(m === mood) }),
  );
  const soundLabel = el('span', { text: 'Sounds: Off' });
  const soundsButton = button(soundLabel, () => showView('sounds'));
  const clock = el('p', { class: 'zen__clock' });
  const mainView = el(
    'div',
    { class: 'zen__view' },
    el('div', { class: 'zen__head' }, el('h1', { class: 'zen__title', text: 'Zen' }), clock),
    el('div', { class: 'zen__row', role: 'group', 'aria-label': 'Sky' }, moodButtons),
    el(
      'div',
      { class: 'zen__row' },
      button('Call a visitor', callVisitor),
      button('Breathe', () => showView('breathe')),
      soundsButton,
      button('Leave', goHome, { class: 'zen__button zen__button--leave' }),
    ),
  );

  const breatheView = el(
    'div',
    { class: 'zen__view', hidden: true },
    el('h2', { class: 'zen__subtitle', text: 'Breathe along for' }),
    el(
      'div',
      { class: 'zen__row' },
      SESSIONS.map((minutes) => button(`${minutes} min`, () => startBreathing(minutes))),
      button('Back', () => showView('main')),
    ),
  );

  const soundButtons = [null, ...SOUND_NAMES].map((name) =>
    button(name ? SOUNDS[name].label : 'Off', () => playSound(name), { 'aria-pressed': String(name === null) }),
  );
  const volumeButton = button('Volume: Quiet', toggleVolume);
  const soundsView = el(
    'div',
    { class: 'zen__view', hidden: true },
    el('h2', { class: 'zen__subtitle', text: 'Sounds' }),
    el('div', { class: 'zen__row', role: 'group', 'aria-label': 'Sounds' }, soundButtons),
    el('div', { class: 'zen__row' }, volumeButton, button('Back', () => showView('main'))),
  );
  const panel = el('section', { class: 'zen__panel', 'aria-label': 'Zen controls' }, mainView, breatheView, soundsView);

  // Breathing, shooting stars, the hint

  const breathSun = el('img', { class: 'zen__breath-sun', src: dataUri(pixelSvg(SUN.rows, SUN.palette)), alt: '' });
  const prompt = el('p', { class: 'zen__prompt', 'aria-live': 'polite' });
  const count = el('p', { class: 'zen__count' });
  const breath = el(
    'div',
    { class: 'zen__breath', hidden: true },
    breathSun,
    prompt,
    count,
    button('Stop', stopBreathing, { class: 'zen__button zen__button--quiet' }),
  );
  const stars = el('div', { class: 'zen__stars', 'aria-hidden': 'true' });
  const hint = el('p', { class: 'zen__hint', text: 'Tap anywhere for the controls', hidden: true });
  const view = el('div', { class: 'zen' }, stars, breath, panel, hint);
  root.append(view);

  function showView(name) {
    mainView.hidden = name !== 'main';
    breatheView.hidden = name !== 'breathe';
    soundsView.hidden = name !== 'sounds';
  }

  // The controls rest after a while; a tap anywhere (or a key) brings them back.
  function rest() {
    view.classList.add('zen--resting');
    showView('main');
    if (hinted || breathing) return;
    hinted = true;
    hint.hidden = false;
    timers.hint = setTimeout(() => (hint.hidden = true), HINT_MS);
  }

  function wake() {
    view.classList.remove('zen--resting');
    hint.hidden = true;
    clearTimeout(timers.rest);
    timers.rest = setTimeout(rest, CONTROLS_REST_MS);
  }

  document.addEventListener('pointerdown', wake, { capture: true, signal });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') goHome();
      else wake();
    },
    { capture: true, signal },
  );

  function tickClock() {
    clock.textContent = timeFormat.format(new Date());
  }

  // Moods

  function setMood(id) {
    mood = moodById(id);
    moodButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(MOODS[i] === mood)));
    world.setFall(mood.fall);
    moveSky(mood.sun);
    if (sounds.playing && mood.sound) playSound(mood.sound);
    scheduleStar(mood.id === 'night' ? FIRST_STAR_AFTER_MS : undefined);
    haptic();
  }

  // Moves the sun to a mood's place (or back to the real one) a step at a time,
  // like a time-lapse, rather than jumping.
  function moveSky(target) {
    clearTimeout(timers.sky);
    if (!target && !skyMoved) return;
    const from = world.currentSun();
    const to = target ? { ...target, noonElevation: from?.noonElevation ?? 60 } : world.realSun();
    const finish = () => {
      world.setSun(target ? to : null);
      skyMoved = Boolean(target);
      timers.sky = null;
    };
    if (!from || reducedMotion.matches) {
      finish();
      return;
    }
    const steps = skySteps(SKY_CHANGE_MS);
    const direction = target ? 'forward' : 'shortest';
    let step = 0;
    const next = () => {
      step++;
      if (step >= steps) {
        finish();
        return;
      }
      world.setSun(sunBetween(from, to, step / steps, { direction }));
      skyMoved = true;
      timers.sky = setTimeout(next, SKY_STEP_MS);
    };
    next();
  }

  // A shooting star now and then, while it's night.
  function scheduleStar(firstIn) {
    clearTimeout(timers.star);
    timers.star = setTimeout(() => {
      if (world.isNight() && !reducedMotion.matches && stars.childElementCount < MAX_STARS) shootStar();
      scheduleStar();
    }, firstIn ?? nextShootingStar(Math.random));
  }

  function shootStar() {
    const star = el('span', {
      class: 'zen__shooting-star',
      style: `left: ${(8 + Math.random() * 55).toFixed(1)}%; top: ${(4 + Math.random() * 22).toFixed(1)}%`,
    });
    star.addEventListener('animationend', () => star.remove(), { once: true });
    stars.append(star);
  }

  // A visitor

  function callVisitor() {
    if (world.summon()) {
      haptic();
      toast('A visitor is on the way');
    } else {
      toast('The world is keeping still while motion is turned down');
    }
  }

  // Breathing

  function startBreathing(minutes) {
    stopBreathing();
    breathing = { started: performance.now(), breaths: breathCount(minutes) };
    shownScale = null;
    breath.hidden = false;
    view.classList.add('zen--breathing');
    breathTick();
    rest();
  }

  function breathTick() {
    const now = breathAt(performance.now() - breathing.started, breathing.breaths);
    const scale = reducedMotion.matches ? STILL_SCALE : now.scale;
    if (scale !== shownScale) {
      breathSun.style.transform = `scale(${scale})`;
      shownScale = scale;
    }
    if (prompt.textContent !== now.prompt) prompt.textContent = now.prompt;
    const counted = now.done ? '' : `Breath ${now.breath} of ${breathing.breaths}`;
    if (count.textContent !== counted) count.textContent = counted;
    timers.breath = now.done ? setTimeout(stopBreathing, 4000) : setTimeout(breathTick, BREATH_TICK_MS);
  }

  function stopBreathing() {
    clearTimeout(timers.breath);
    timers.breath = null;
    breathing = null;
    breath.hidden = true;
    view.classList.remove('zen--breathing');
  }

  // Sounds (made the moment one is picked: browsers only start sound from a tap)

  function playSound(name) {
    sounds.play(name);
    soundButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? null : SOUND_NAMES[i - 1]) === sounds.playing)));
    soundLabel.textContent = `Sounds: ${sounds.playing ? SOUNDS[sounds.playing].label : 'Off'}`;
  }

  function toggleVolume() {
    sounds.setVolume(sounds.volume === 'quiet' ? 'normal' : 'quiet');
    volumeButton.textContent = `Volume: ${sounds.volume === 'quiet' ? 'Quiet' : 'Normal'}`;
  }

  tickClock();
  const clockTimer = setInterval(tickClock, CLOCK_TICK_MS);
  scheduleStar();
  wake();

  return {
    unmount() {
      lifetime.abort();
      Object.values(timers).forEach((id) => clearTimeout(id));
      clearInterval(clockTimer);
      sounds.close();
      world.setFall(undefined);
      world.setSun(null);
      view.remove();
    },
  };
}
