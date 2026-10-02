// The home grid packs widgets in DOM order, and only biggest-first always fits
// (tall 5×4 next to the clock, then wide 4×2 and medium 3×2 underneath it).
// Any other order can push a widget below the board and squash the rest.
const SIZE_RANK = { tall: 0, wide: 1, medium: 2 };

export function layoutOrder(ids, apps) {
  const rank = (id) => SIZE_RANK[apps.find((a) => a.id === id).widgetSize] ?? Object.keys(SIZE_RANK).length;
  return ids
    .filter((id) => apps.some((a) => a.id === id))
    .map((id, index) => ({ id, index }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.index - b.index)
    .map(({ id }) => id);
}
