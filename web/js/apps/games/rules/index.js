import * as dotsAndBoxes from './dots-and-boxes.js';
import * as fourInARow from './four-in-a-row.js';
import * as reversi from './reversi.js';

// In the order they're offered.
export const RULES = {
  [fourInARow.KIND]: fourInARow,
  [reversi.KIND]: reversi,
  [dotsAndBoxes.KIND]: dotsAndBoxes,
};
