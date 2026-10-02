// Turns Open-Meteo's WMO weather codes into words and an icon name.

const CODES = new Map([
  [0, ['Sunny', 'clear']],
  [1, ['Mostly sunny', 'partly']],
  [2, ['Partly cloudy', 'partly']],
  [3, ['Cloudy', 'cloud']],
  [45, ['Foggy', 'fog']],
  [48, ['Foggy', 'fog']],
  [51, ['Drizzle', 'drizzle']],
  [53, ['Drizzle', 'drizzle']],
  [55, ['Drizzle', 'drizzle']],
  [56, ['Freezing drizzle', 'drizzle']],
  [57, ['Freezing drizzle', 'drizzle']],
  [61, ['Light rain', 'rain']],
  [63, ['Rain', 'rain']],
  [65, ['Heavy rain', 'rain']],
  [66, ['Freezing rain', 'rain']],
  [67, ['Freezing rain', 'rain']],
  [71, ['Light snow', 'snow']],
  [73, ['Snow', 'snow']],
  [75, ['Heavy snow', 'snow']],
  [77, ['Snow', 'snow']],
  [80, ['Showers', 'rain']],
  [81, ['Showers', 'rain']],
  [82, ['Heavy showers', 'rain']],
  [85, ['Snow showers', 'snow']],
  [86, ['Snow showers', 'snow']],
  [95, ['Thunderstorms', 'storm']],
  [96, ['Storms with hail', 'storm']],
  [99, ['Storms with hail', 'storm']],
]);

const NIGHT_LABELS = { Sunny: 'Clear', 'Mostly sunny': 'Mostly clear' };

export function describeWeather(code, isDay = true) {
  const [label, kind] = CODES.get(code) ?? ['Cloudy', 'cloud'];
  if (kind === 'clear') return { label: isDay ? label : NIGHT_LABELS[label], icon: isDay ? 'sun' : 'moon' };
  if (kind === 'partly') {
    return { label: isDay ? label : NIGHT_LABELS[label] ?? label, icon: isDay ? 'partly-day' : 'partly-night' };
  }
  return { label, icon: kind };
}

// "2026-10-02" parsed by Date() would be UTC midnight, i.e. the day before in the Americas.
export function localDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
