// Кольори схеми для темної теми. Excalidraw у своєму dark mode просто інвертує картинку фільтром,
// від чого пастельні заливки стають брудними. Тому в темній темі ми НЕ вмикаємо його dark mode,
// а перефарбовуємо елементи самі: заливка темна того ж відтінку, текст і рамки світлі.

export const DARK_CANVAS_BACKGROUND = '#111317';

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h / 6, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue2rgb = (p: number, q: number, t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const to = (v: number): string => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Світла пастельна заливка стає спокійним темним тоном того ж відтінку; сіра лишається темно-сірою.
 *  Насиченість беремо не з HSL "s" (у блідих кольорів він майже завжди 1), а з хроми: наскільки колір
 *  далекий від сірого. Бліда заливка (#e7f5ff) стає ледь помітною, виразна (#a5d8ff) лишається помітною.
 *  Жовті й помаранчеві у темряві стають оливковими, тому їх притлумлюємо сильніше. */
export function darkFill(hex: string): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const chroma = hsl.s * (1 - Math.abs(2 * hsl.l - 1));
  if (chroma < 0.06) return '#1d2026';
  const hueDeg = hsl.h * 360;
  const warm = hueDeg >= 30 && hueDeg <= 75;
  const s = Math.min(0.4, 0.2 + chroma * 0.55) * (warm ? 0.7 : 1);
  return hslToHex({ h: hsl.h, s, l: warm ? 0.2 : 0.22 });
}

/** Темні лінії і текст стають світлими, сірий текст лишається приглушеним; кольорові стрілки яскравішають. */
export function darkStroke(hex: string): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  if (hsl.s < 0.12) return hsl.l < 0.25 ? '#e6e8eb' : '#aeb4bb';
  return hslToHex({ h: hsl.h, s: Math.max(hsl.s, 0.55), l: 0.7 });
}

/** Перефарбовує копію елементів Excalidraw під темне полотно. Форму елементів не змінює. */
export function recolorForDark(elements: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return elements.map((el) => {
    const next: Record<string, unknown> = { ...el };
    if (typeof el.backgroundColor === 'string' && el.backgroundColor !== 'transparent') {
      next.backgroundColor = darkFill(el.backgroundColor);
    }
    if (typeof el.strokeColor === 'string') {
      next.strokeColor = darkStroke(el.strokeColor);
    }
    return next;
  });
}
