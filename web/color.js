window.ColorMath = (() => {
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const rad = d => (d * Math.PI) / 180;

  function parseHex(s) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s).trim());
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = [...h].map(c => c + c).join('');
    return '#' + h.toUpperCase();
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }

  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function hexToLab(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => lin(v / 255));
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function deltaE2000([L1, a1, b1], [L2, a2, b2]) {
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const Cb7 = ((C1 + C2) / 2) ** 7;
    const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const h1p = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
    const h2p = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dh = h2p - h1p;
    if (C1p * C2p === 0) dh = 0;
    else if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
    const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
    let hbp;
    if (C1p * C2p === 0) hbp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    const T = 1 - 0.17 * Math.cos(rad(hbp - 30)) + 0.24 * Math.cos(rad(2 * hbp))
      + 0.32 * Math.cos(rad(3 * hbp + 6)) - 0.2 * Math.cos(rad(4 * hbp - 63));
    const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
    const Cbp7 = Cbp ** 7;
    const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
    const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
    const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
    const Rt = -Math.sin(rad(2 * dth)) * Rc;
    return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
  }

  function relLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => lin(v / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const gam = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function hexToOklch(hex) {
    const [r, g, b] = hexToRgb(hex).map(v => lin(v / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
  }

  function oklchToLinear({ L, C, h }) {
    const A = C * Math.cos(rad(h)), B = C * Math.sin(rad(h));
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  // Out-of-gamut colors keep their lightness and hue and lose chroma until they fit sRGB.
  function oklchToHex(lch) {
    const fits = c => oklchToLinear({ ...lch, C: c }).every(v => v >= -1e-4 && v <= 1 + 1e-4);
    let C = lch.C;
    if (!fits(C)) {
      let lo = 0, hi = C;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; fits(mid) ? (lo = mid) : (hi = mid); }
      C = lo;
    }
    const rgb = oklchToLinear({ ...lch, C }).map(v => 255 * gam(Math.min(1, Math.max(0, v))));
    return rgbToHex(rgb);
  }

  return { parseHex, hexToRgb, rgbToHex, hexToLab, deltaE2000, relLuminance, hexToOklch, oklchToHex };
})();
