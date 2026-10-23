// Pixel art drawn as text: one string per row, '.' for nothing and any other
// character for a colour from a palette. Used by the Blocks theme's critters,
// scenery, falling weather and clock digits. Pure, so it runs in node too.

// The SVG path for every cell holding `ch`, one rectangle per horizontal run so
// the markup stays small. (x, y) moves the whole drawing.
export function pathData(rows, ch, { x = 0, y = 0 } = {}) {
  let d = '';
  rows.forEach((line, row) => {
    let col = 0;
    while (col < line.length) {
      if (line[col] !== ch) {
        col++;
        continue;
      }
      let end = col;
      while (end < line.length && line[end] === ch) end++;
      const w = end - col;
      d += `M${x + col} ${y + row}h${w}v1h-${w}z`;
      col = end;
    }
  });
  return d;
}

export function svgOpen(width, height, attrs = '') {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}' shape-rendering='crispEdges'${attrs ? ' ' + attrs : ''}>`;
}

// One crisp SVG with a <path> per colour, in the order the colours first appear.
export function pixelSvg(rows, palette) {
  const order = [];
  for (const line of rows) {
    for (const ch of line) {
      if (ch === '.' || order.includes(ch)) continue;
      if (!palette[ch]) throw new Error(`No colour for "${ch}" in the palette`);
      order.push(ch);
    }
  }
  const width = Math.max(0, ...rows.map((line) => line.length));
  const paths = order.map((ch) => `<path fill='${palette[ch]}' d='${pathData(rows, ch)}'/>`).join('');
  return `${svgOpen(width, rows.length)}${paths}</svg>`;
}

export function dataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function mirror(rows) {
  return rows.map((line) => [...line].reverse().join(''));
}

// Grids side by side, padded to the tallest, with `gap` empty columns between.
export function hconcat(grids, gap = 0) {
  const height = Math.max(...grids.map((g) => g.length));
  const spacer = '.'.repeat(gap);
  return Array.from({ length: height }, (_, row) =>
    grids
      .map((g) => {
        const width = Math.max(0, ...g.map((line) => line.length));
        return (g[row] ?? '').padEnd(width, '.');
      })
      .join(spacer),
  );
}

// Every cell drawn as a k x k square of cells.
export function upscale(rows, k) {
  return rows.flatMap((line) => {
    const wide = [...line].map((ch) => ch.repeat(k)).join('');
    return Array(k).fill(wide);
  });
}

// Empty cells around the drawing.
export function pad(rows, { top = 0, right = 0, bottom = 0, left = 0 } = {}) {
  const width = Math.max(0, ...rows.map((line) => line.length)) + left + right;
  const blank = '.'.repeat(width);
  return [
    ...Array(top).fill(blank),
    ...rows.map((line) => ('.'.repeat(left) + line).padEnd(width, '.')),
    ...Array(bottom).fill(blank),
  ];
}

// Every cell next to (or on) a filled one, diagonals included, filled with `ch`.
// Same size as the input: pad first to leave room.
export function dilate8(rows, ch = '#') {
  const filled = (r, c) => r >= 0 && r < rows.length && c >= 0 && c < rows[r].length && rows[r][c] !== '.';
  return rows.map((line, r) =>
    [...line]
      .map((_, c) => {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (filled(r + dr, c + dc)) return ch;
        return '.';
      })
      .join(''),
  );
}

// The drawing moved right by dx and down by dy, same size (what falls off is lost).
export function shift(rows, dx, dy) {
  return rows.map((line, r) =>
    [...line]
      .map((_, c) => {
        const from = rows[r - dy];
        const ch = from?.[c - dx];
        return ch === undefined ? '.' : ch;
      })
      .join(''),
  );
}
