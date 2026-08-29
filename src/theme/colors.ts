/**
 * Brand palette — mirrored from the FAST Exam Table web app (src/styles/globals.css)
 * so the mobile UI stays visually consistent with the existing product.
 */

export const colors = {
  // Brand
  brand: '#073366', // FAST NUCES blue
  brandDark: '#052a52',
  accent: '#ea580c', // orange accent

  // Light theme surfaces
  bg: '#FAFAF8',
  raised: '#FFFFFF',
  subtle: '#F2F1EE',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.14)',

  text: '#1A1A18',
  textSecondary: '#6B6B66',
  textTertiary: '#A0A09A',

  success: '#059669',
  successBg: '#ecfdf5',
  danger: '#E11D48',
  dangerBg: '#FFF1F2',
  warning: '#B45309',
  warningBg: '#FFFBEB',
  info: '#1D4ED8',
  infoBg: '#EFF6FF',
} as const;

/** Department accent colors (same values as the web app). */
export const deptAccent: Record<string, string> = {
  CS: '#1D4ED8',
  AI: '#7C3AED',
  DS: '#0F766E',
  CY: '#B45309',
  SE: '#BE185D',
  BBA: '#1D4ED8',
  AF: '#047857',
  BA: '#D97706',
  FT: '#9333EA',
  EE: '#E11D48',
  CE: '#0284C7',
};

/** Tinted background variants for department chips/cards. */
export const deptAccentBg: Record<string, string> = {
  CS: '#EFF6FF',
  AI: '#F5F3FF',
  DS: '#F0FDFA',
  CY: '#FFFBEB',
  SE: '#FDF2F8',
  BBA: '#EFF6FF',
  AF: '#ECFDF5',
  BA: '#FFFBEB',
  FT: '#FAF5FF',
  EE: '#FFF1F2',
  CE: '#F0F9FF',
};

/**
 * Dark-theme counterparts for deptAccent/deptAccentBg — the light pastels are
 * blinding on navy/charcoal surfaces and the mid-dark accents fail contrast on
 * them. Fills are translucent tints that compose over the dark `raised` surface;
 * accents are their tailwind-300-ish bright equivalents.
 */
export const deptAccentDark: Record<string, string> = {
  CS: '#93C5FD',
  AI: '#C4B5FD',
  DS: '#5EEAD4',
  CY: '#FCD34D',
  SE: '#F9A8D4',
  BBA: '#93C5FD',
  AF: '#6EE7B7',
  BA: '#FBBF24',
  FT: '#C4B5FD',
  EE: '#FDA4AF',
  CE: '#7DD3FC',
};

export const deptAccentBgDark: Record<string, string> = {
  CS: 'rgba(96,165,250,0.17)',
  AI: 'rgba(167,139,250,0.17)',
  DS: 'rgba(45,212,191,0.15)',
  CY: 'rgba(251,191,36,0.15)',
  SE: 'rgba(244,114,182,0.15)',
  BBA: 'rgba(96,165,250,0.17)',
  AF: 'rgba(52,211,153,0.16)',
  BA: 'rgba(251,191,36,0.15)',
  FT: 'rgba(167,139,250,0.17)',
  EE: 'rgba(251,113,133,0.16)',
  CE: 'rgba(56,189,248,0.16)',
};

/**
 * One-step "shade combo" for a fill sitting on a tinted band (e.g. a course
 * cell inside the today column): hex pastels are pulled ~10% toward `accent`
 * => clearly distinct same-family shade; rgba fills get an alpha bump so they
 * stand out over translucent theme washes. Unknown formats pass through.
 */
export function deepenFill(bg: string, accent: string): string {
  const rgba = bg.match(/^rgba?\(\s*([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(',').map((s) => s.trim());
    if (parts.length === 4) {
      const alpha = parseFloat(parts[3]);
      if (Number.isFinite(alpha)) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Math.min(alpha + 0.08, 0.85).toFixed(2)})`;
      }
    }
    return bg;
  }
  const a = bg.replace('#', '');
  const b = accent.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(a) || !/^[0-9a-fA-F]{6}$/.test(b)) return bg;
  const mix = (i: number) =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * 0.9 + parseInt(b.slice(i, i + 2), 16) * 0.1);
  return `#${[0, 2, 4].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

/** School brand colours. */
export const schoolAccent: Record<string, string> = {
  FSC: '#073366',
  FSM: '#047857',
  FSE: '#E11D48',
};
