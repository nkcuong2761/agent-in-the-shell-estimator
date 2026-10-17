/** 4×4 ordered-dither (Bayer) threshold matrix: used for the light stipple on the uncertain part of bars. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function bayerOn(x: number, y: number, density: number): boolean {
  const row = BAYER4[y & 3] as readonly number[];
  return (row[x & 3] as number) < density * 16;
}

function maskSvg(density: number): string {
  let rects = '';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (bayerOn(x, y, density)) rects += `<rect x='${x}' y='${y}' width='1' height='1'/>`;
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 4' shape-rendering='crispEdges'>${rects}</svg>`)}")`;
}

/** Inject the dither mask as a CSS custom property once. */
export function installDitherMasks(): void {
  document.documentElement.style.setProperty('--dither-50', maskSvg(0.5));
}
