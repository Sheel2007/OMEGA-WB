// Every app on the board. Each module exports id, name, description, widgetSize,
// iconBackground and iconGlyph, plus createWidget(context) and, if it opens full
// screen, mount(root, context). Apps with mount() get a dock icon.
import * as calendar from './calendar/index.js';
import * as games from './games/index.js';
import * as notes from './notes/index.js';
import * as shopping from './shopping/index.js';
import * as weather from './weather/index.js';

export const APPS = [calendar, shopping, weather, notes, games];

// New screens start with all of them, and this order is what page 1 lays out as:
// the clock top left, the Calendar beside it, the Shopping list down the right,
// then Weather and Notes along the bottom. Games starts page 2.
// Screens that saved a layout before a widget existed pick it up here too, at the
// place this order puts it (see SCHEMA_VERSION 3 in services/settings.js).
export const DEFAULT_WIDGETS = ['calendar', 'shopping', 'weather', 'notes', 'games'];
