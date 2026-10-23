// Which season the Blocks scenery is dressed for: the real one, from today's date.
// Meteorological seasons, in whole months the way people talk about them
// (winter is December to February), turned round south of the equator.

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

const NORTHERN = [
  'winter', 'winter', // January, February
  'spring', 'spring', 'spring',
  'summer', 'summer', 'summer',
  'autumn', 'autumn', 'autumn',
  'winter', // December
];

export function seasonAt(date, latitude = 0) {
  const month = date.getMonth();
  return NORTHERN[latitude < 0 ? (month + 6) % 12 : month];
}

// ?season=winter previews the scenery in another season.
export function parseSeason(value) {
  return SEASONS.includes(value) ? value : null;
}
