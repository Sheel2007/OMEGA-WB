// Every app on the board. Each module exports id, name, description, widgetSize,
// iconBackground and iconGlyph, plus createWidget(context) and, if it opens full
// screen, mount(root, context). Apps with mount() get a dock icon.
import * as games from './games/index.js';
import * as notes from './notes/index.js';
import * as shopping from './shopping/index.js';
import * as weather from './weather/index.js';

export const APPS = [shopping, weather, notes, games];

// New screens start with all of them; Games doesn't fit on page 1, so it starts page 2.
export const DEFAULT_WIDGETS = ['shopping', 'weather', 'notes', 'games'];
