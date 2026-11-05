// Ideal companion colors for a target, in OKLCH. The app then snaps each ideal to the nearest real paint.
window.Harmony = (() => {
  const { hexToOklch } = window.ColorMath;
  const NEUTRAL_CHROMA = 0.035;
  const rot = (h, d) => (((h + d) % 360) + 360) % 360;
  const clampL = L => Math.min(0.96, Math.max(0.22, L));

  function tonal({ L, C, h }) {
    const steps = [0.16, -0.16, 0.3, -0.3, 0.44, -0.44]
      .map(d => L + d)
      .filter(l => l >= 0.24 && l <= 0.96)
      .slice(0, 3)
      .sort((a, b) => b - a);
    return steps.map(l => ({
      L: l,
      C: l > L ? C * 0.7 : C * 0.95,
      h,
      role: l > L ? 'Lighter' : 'Deeper',
    }));
  }

  function neutrals({ L, C, h }) {
    const tint = Math.min(C, 0.018);
    return [
      { L: 0.955, C: Math.min(tint, 0.01), h, role: 'Ceiling & trim' },
      { L: 0.82, C: tint, h, role: 'Soft neutral' },
      { L: 0.62, C: tint, h, role: 'Mid neutral' },
      { L: 0.3, C: tint, h, role: 'Dark anchor' },
    ].filter(n => Math.abs(n.L - L) > 0.07);
  }

  const contrastL = L => clampL(L > 0.55 ? L - 0.28 : L + 0.28);
  // Accents stay muted: a fully saturated opposite is too loud for walls and furniture.
  const accentC = (C, f) => Math.min(0.08, Math.max(0.04, C * f));

  const SCHEMES = {
    tonal: {
      name: 'Tone on tone',
      blurb: 'Your hue in lighter and deeper shades. The calmest, safest choice: walls, woodwork and furniture in one family.',
      ideals: tonal,
    },
    neutrals: {
      name: 'Neutral partners',
      blurb: 'Whites, greiges and a dark anchor with a hint of your color, for ceilings, trim, floors and large surfaces.',
      ideals: neutrals,
    },
    analogous: {
      name: 'Neighbours',
      blurb: 'The hues just beside yours on the color wheel. Relaxed and harmonious, good for adjoining rooms.',
      ideals: ({ L, C, h }) => [
        { L: clampL(L + 0.04), C: C * 0.9, h: rot(h, -30), role: 'Neighbour' },
        { L: clampL(L - 0.04), C: C * 0.9, h: rot(h, 30), role: 'Neighbour' },
      ],
    },
    complementary: {
      name: 'Contrast accent',
      blurb: 'The opposite hue, toned down. Use it sparingly (a door, a cabinet, cushions) to make your color stand out.',
      ideals: ({ L, C, h }) => [
        { L, C: accentC(C, 0.6), h: rot(h, 180), role: 'Soft accent' },
        { L: contrastL(L), C: accentC(C, 0.85), h: rot(h, 180), role: L > 0.55 ? 'Deep accent' : 'Light accent' },
      ],
    },
    split: {
      name: 'Split contrast',
      blurb: 'The two hues on either side of the opposite. Livelier than neighbours, gentler than a direct contrast.',
      ideals: ({ L, C, h }) => [
        { L, C: accentC(C, 0.7), h: rot(h, 150), role: 'Accent' },
        { L: contrastL(L), C: accentC(C, 0.7), h: rot(h, 210), role: 'Accent' },
      ],
    },
    triad: {
      name: 'Triad',
      blurb: 'Three hues spread evenly around the wheel. Playful; let your color dominate and keep the other two small.',
      ideals: ({ L, C, h }) => [
        { L, C: accentC(C, 0.7), h: rot(h, 120), role: 'Accent' },
        { L: contrastL(L), C: accentC(C, 0.7), h: rot(h, 240), role: 'Accent' },
      ],
    },
    accents: {
      name: 'Accent colors',
      blurb: 'Your color is a neutral, so it has no real opposite. These classic, slightly muted accents all sit well against it.',
      ideals: ({ L }) => {
        const dark = L > 0.5;
        return [
          { L: dark ? 0.4 : 0.7, C: 0.08, h: 255, role: 'Blue' },
          { L: dark ? 0.55 : 0.75, C: 0.055, h: 140, role: 'Sage' },
          { L: dark ? 0.55 : 0.72, C: 0.11, h: 40, role: 'Terracotta' },
          { L: dark ? 0.68 : 0.8, C: 0.11, h: 85, role: 'Ochre' },
        ];
      },
    },
  };

  function schemesFor(hex) {
    const lch = hexToOklch(hex);
    const ids = lch.C < NEUTRAL_CHROMA
      ? ['neutrals', 'accents']
      : ['tonal', 'neutrals', 'analogous', 'complementary', 'split', 'triad'];
    return ids.map(id => ({ id, ...SCHEMES[id], ideals: SCHEMES[id].ideals(lch) }));
  }

  return { schemesFor };
})();
