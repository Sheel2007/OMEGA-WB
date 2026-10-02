// Every app on the board. Each module exports id, name, description, widgetSize,
// iconBackground and iconGlyph, plus createWidget(context) and, if it opens full
// screen, mount(root, context). Apps with mount() get a dock icon.
import * as calendar from './calendar/index.js';
import * as games from './games/index.js';
import * as notes from './notes/index.js';
import * as shopping from './shopping/index.js';
import * as weather from './weather/index.js';

export const APPS = [shopping, weather, notes, calendar, games];

// New screens start with all of them; page 1 holds the clock, the shopping list,
// the weather and the notes, so the Calendar and Games start page 2.
export const DEFAULT_WIDGETS = ['shopping', 'weather', 'notes', 'calendar', 'games'];
