// Every app on the board. Each module exports id, name, description, widgetSize
// (the size its widget starts at), widgetSizes (every size it can be resized to),
// iconBackground and iconGlyph, plus createWidget(context) and, if it opens full
// screen, mount(root, context). Apps with mount() get a dock icon.
import * as calendar from './calendar/index.js';
import * as games from './games/index.js';
import * as grocery from './grocery/index.js';
import * as lights from './lights/index.js';
import * as notes from './notes/index.js';
import * as roommateGames from './roommate-games/index.js';
import * as weather from './weather/index.js';

export const APPS = [calendar, weather, notes, games, lights, roommateGames, grocery];

// New screens start with all of them, and this order is what page 1 lays out as:
// the clock top left with the Calendar and Weather beside it, then Notes, Games
// and Lights along the bottom. The Roommate Cup and Grocery start page 2.
// Screens that saved a layout before a widget existed pick it up here too, at the
// place this order puts it (see SCHEMA_VERSION 3 in services/settings.js).
export const DEFAULT_WIDGETS = ['calendar', 'weather', 'notes', 'games', 'lights', 'roommate-games', 'grocery'];

// The settings version each widget arrived in, for widgets added after version 3.
// A screen saved on an older version picks these up once, so a widget someone has
// since taken off the board stays off.
export const WIDGETS_SINCE = { lights: 4, 'roommate-games': 5, grocery: 6 };
