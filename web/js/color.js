// Colour maths for the sky: blending and WCAG contrast.

function channels(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function mixHex(a, b, t) {
  const from = channels(a);
  const to = channels(b);
  const mixed = from.map((c, i) => Math.round(c * (1 - t) + to[i] * t));
  return '#' + ((mixed[0] << 16) | (mixed[1] << 8) | mixed[2]).toString(16).padStart(6, '0');
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
