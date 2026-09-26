/**
 * Pixel-art upscaling for the hand-drawn text grids (piece sprites, coordinate glyphs), so they can be
 * drawn at twice the scene's original resolution without redrawing them by hand.
 */

/**
 * Scale2x (EPX): doubles a grid, rounding off diagonal edges instead of just making blocks bigger.
 * `empty` is the background character; cells outside the grid count as background.
 */
export function scale2x(grid: string[], empty = "."): string[] {
  const at = (x: number, y: number) => grid[y]?.[x] ?? empty;
  const out: string[][] = [];
  grid.forEach((line, y) => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (let x = 0; x < line.length; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      top.push(c === a && c !== d && a !== b ? a : p, a === b && a !== c && b !== d ? b : p);
      bottom.push(d === c && d !== b && c !== a ? c : p, b === d && b !== a && d !== c ? d : p);
    }
    out.push(top, bottom);
  });
  return out.map((row) => row.join(""));
}

/**
 * After doubling, a 1px silhouette outline becomes 2px thick. Thin straight runs back to 1px: an
 * outline cell whose outer neighbour is outline with background beyond it (the inner half of a 2px
 * edge) takes the colour of its inner neighbour. Corners of diagonal steps and outlines drawn inside
 * the sprite (windows, eyes) are left alone.
 */
export function thinOutline(doubled: string[], outline = "o", empty = "."): string[] {
  const at = (x: number, y: number) => doubled[y]?.[x] ?? empty;
  return doubled.map((line, y) =>
    [...line]
      .map((cell, x) => {
        if (cell !== outline) return cell;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const inner = at(x - dx, y - dy);
          if (at(x + dx, y + dy) === outline && at(x + 2 * dx, y + 2 * dy) === empty && inner !== outline && inner !== empty) {
            return inner;
          }
        }
        return cell;
      })
      .join(""),
  );
}

const cache = new WeakMap<string[], string[]>();

/** A sprite at double resolution with a 1px outline; cached per sprite. */
export function hiResSprite(sprite: string[]): string[] {
  let hi = cache.get(sprite);
  if (!hi) {
    hi = thinOutline(scale2x(sprite));
    cache.set(sprite, hi);
  }
  return hi;
}
