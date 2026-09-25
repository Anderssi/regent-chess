/** Anything the scene can be drawn onto: a canvas in the browser, a pixel buffer in tests and previews. */
export interface PixelTarget {
  /** Fill a rectangle. `color` is "#rrggbb" or "#rrggbbaa". */
  fillRect(x: number, y: number, w: number, h: number, color: string): void;
}

export function parseColor(color: string): [number, number, number, number] {
  const hex = color.replace("#", "");
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), hex.length >= 8 ? n(6) : 255];
}

/** An RGBA pixel buffer with alpha blending. */
export class PixelBuffer implements PixelTarget {
  readonly data: Uint8ClampedArray;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const [r, g, b, a] = parseColor(color);
    const alpha = a / 255;
    for (let py = Math.max(0, y); py < Math.min(this.height, y + h); py++) {
      for (let px = Math.max(0, x); px < Math.min(this.width, x + w); px++) {
        const i = (py * this.width + px) * 4;
        this.data[i] = r * alpha + this.data[i]! * (1 - alpha);
        this.data[i + 1] = g * alpha + this.data[i + 1]! * (1 - alpha);
        this.data[i + 2] = b * alpha + this.data[i + 2]! * (1 - alpha);
        this.data[i + 3] = Math.min(255, a + this.data[i + 3]! * (1 - alpha));
      }
    }
  }

  /** Colour at a pixel as "#rrggbb". */
  get(x: number, y: number): string {
    const i = (y * this.width + x) * 4;
    return "#" + [0, 1, 2].map((k) => this.data[i + k]!.toString(16).padStart(2, "0")).join("");
  }
}

export function canvasTarget(ctx: CanvasRenderingContext2D): PixelTarget {
  return {
    fillRect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    },
  };
}
