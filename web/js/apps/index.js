// Every app on the board. Each module exports id, name, description, widgetSize,
// iconBackground and iconGlyph, plus createWidget(context) and, if it opens full
// screen, mount(root, context). Apps with mount() get a dock icon.
import * as calendar from './calendar/index.js';
import * as games from './games/index.js';
import * as lights from './lights/index.js';
import * as notes from './notes/index.js';
import * as shopping from './shopping/index.js';
import * as weather from './weather/index.js';

export const APPS = [calendar, shopping, weather, notes, games, lights];

// New screens start with all of them, and this order is what page 1 lays out as:
// the clock top left, the Calendar beside it, the Shopping list down the right,
// then Weather and Notes along the bottom. Games starts page 2, with Lights beside it.
// Screens that saved a layout before a widget existed pick it up here too, at the
// place this order puts it (see SCHEMA_VERSION 3 in services/settings.js).
export const DEFAULT_WIDGETS = ['calendar', 'shopping', 'weather', 'notes', 'games', 'lights'];

// The settings version each widget arrived in, for widgets added after version 3.
// A screen saved on an older version picks these up once, so a widget someone has
// since taken off the board stays off.
export const WIDGETS_SINCE = { lights: 4 };
