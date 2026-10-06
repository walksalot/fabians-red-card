// Contrast probe: for a crop region of a screenshot, find the background color
// (most frequent pixel) and the text color (pixel with luminance furthest from bg),
// then compute the WCAG contrast ratio between them.
// usage: node contrast.mjs <png> <left> <top> <width> <height> <label>
import sharp from 'sharp';

const [, , file, l, t, w, h, ...labelParts] = process.argv;
const label = labelParts.join(' ');

function lum([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [hi, lo] = [Math.max(a, b), Math.min(a, b)];
  return (hi + 0.05) / (lo + 0.05);
}

const { data, info } = await sharp(file)
  .extract({ left: +l, top: +t, width: +w, height: +h })
  .raw()
  .toBuffer({ resolveWithObject: true });

const counts = new Map();
const px = [];
for (let i = 0; i < data.length; i += info.channels) {
  const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
  counts.set(key, (counts.get(key) || 0) + 1);
  px.push([data[i], data[i + 1], data[i + 2]]);
}
const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
const bg = bgKey.split(',').map(Number);
const bgL = lum(bg);
// text color: among pixels occurring >= 8 times (to skip stray AA), max |lum - bgL|
let best = null;
for (const [key, n] of counts) {
  if (n < 8) continue;
  const c = key.split(',').map(Number);
  const d = Math.abs(lum(c) - bgL);
  if (!best || d > best.d) best = { c, d };
}
const fg = best.c;
const r = ratio(lum(fg), bgL);
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
console.log(
  `${label}\n  bg ${hex(bg)}  fg ${hex(fg)}  contrast ${r.toFixed(2)}:1  ${r >= 4.5 ? 'AA-pass(body)' : r >= 3 ? 'AA-large-only' : 'FAIL'}`
);
