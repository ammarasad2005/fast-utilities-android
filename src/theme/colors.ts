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

/** School brand colours. */
export const schoolAccent: Record<string, string> = {
  FSC: '#073366',
  FSM: '#047857',
  FSE: '#E11D48',
};
