/**
 * Theme palettes for FAST Utilities.
 *
 * Every palette exposes the same keys as the original `colors` object, so
 * styles written against the default theme work with all themes. `isDark`
 * drives StatusBar style and other chrome decisions.
 */

export interface ThemeColors {
  // Brand
  brand: string;
  brandDark: string;
  accent: string;

  // Surfaces
  bg: string;
  raised: string;
  subtle: string;
  border: string;
  borderStrong: string;

  // Text
  text: string;
  textSecondary: string;
  textTertiary: string;

  // Semantic
  /** Text/icons rendered on top of `brand` (e.g. filled banners, active chips). */
  onBrand: string;

  success: string;
  successBg: string;
  danger: string;
  dangerBg: string;
  warning: string;
  warningBg: string;
  info: string;
  infoBg: string;

  /** Timetable grid: wash behind the today/tomorrow column (thematic, must
   *  never collide with a course-cell fill). */
  gridTodayBg: string;
}

export interface Theme extends ThemeColors {
  id: string;
  label: string;
  tagline: string;
  isDark: boolean;
  /** Colors used (in order) for the picker swatch preview. */
  swatches: [string, string, string];
}

export const THEMES: Theme[] = [
  {
    id: 'classic',
    label: 'Classic',
    tagline: 'The original warm paper look',
    isDark: false,
    swatches: ['#FAFAF8', '#FFFFFF', '#073366'],
    onBrand: '#FFFFFF',
    // Brand
    brand: '#073366',
    brandDark: '#052a52',
    accent: '#ea580c',
    // Surfaces
    bg: '#FAFAF8',
    raised: '#FFFFFF',
    subtle: '#F2F1EE',
    border: 'rgba(0,0,0,0.08)',
    borderStrong: 'rgba(0,0,0,0.14)',
    // Text
    text: '#1A1A18',
    textSecondary: '#6B6B66',
    textTertiary: '#A0A09A',
    // Semantic
    success: '#059669',
    successBg: '#ecfdf5',
    danger: '#E11D48',
    dangerBg: '#FFF1F2',
    warning: '#B45309',
    warningBg: '#FFFBEB',
    info: '#1D4ED8',
    infoBg: '#EFF6FF',
    gridTodayBg: 'rgba(7,51,102,0.05)',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    tagline: 'Deep navy, easy on the eyes at night',
    isDark: true,
    swatches: ['#0B1220', '#141D2E', '#5B9BFF'],
    onBrand: '#0B1220',
    brand: '#5B9BFF',
    brandDark: '#3D7BE0',
    accent: '#F59E0B',
    bg: '#0B1220',
    raised: '#141D2E',
    subtle: '#1C2940',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.16)',
    text: '#EDF1F7',
    textSecondary: '#9AA6BC',
    textTertiary: '#5E6C84',
    success: '#34D399',
    successBg: 'rgba(52,211,153,0.14)',
    danger: '#FB7185',
    dangerBg: 'rgba(251,113,133,0.14)',
    warning: '#FBBF24',
    warningBg: 'rgba(251,191,36,0.14)',
    info: '#60A5FA',
    infoBg: 'rgba(96,165,250,0.14)',
    gridTodayBg: 'rgba(91,155,255,0.09)',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    tagline: 'Cool and airy, with sea-blue depth',
    isDark: false,
    swatches: ['#F2F7FA', '#FFFFFF', '#0369A1'],
    onBrand: '#FFFFFF',
    brand: '#0369A1',
    brandDark: '#075985',
    accent: '#0891B2',
    bg: '#F2F7FA',
    raised: '#FFFFFF',
    subtle: '#E4EEF4',
    border: 'rgba(3,54,84,0.09)',
    borderStrong: 'rgba(3,54,84,0.16)',
    text: '#0F2532',
    textSecondary: '#546E7E',
    textTertiary: '#91A5B0',
    success: '#00796B',
    successBg: '#E0F2F1',
    danger: '#C62828',
    dangerBg: '#FFEBEE',
    warning: '#B26A00',
    warningBg: '#FFF8E1',
    info: '#0277BD',
    infoBg: '#E1F5FE',
    gridTodayBg: 'rgba(3,105,161,0.06)',
  },
  {
    id: 'forest',
    label: 'Forest',
    tagline: 'Soft sage surfaces and pine green',
    isDark: false,
    swatches: ['#F4F7F2', '#FFFFFF', '#166534'],
    onBrand: '#FFFFFF',
    brand: '#166534',
    brandDark: '#14532D',
    accent: '#65A30D',
    bg: '#F4F7F2',
    raised: '#FFFFFF',
    subtle: '#E7EEE3',
    border: 'rgba(20,60,32,0.09)',
    borderStrong: 'rgba(20,60,32,0.17)',
    text: '#17271C',
    textSecondary: '#5C6F60',
    textTertiary: '#97A69B',
    success: '#15803D',
    successBg: '#DCFCE7',
    danger: '#BE123C',
    dangerBg: '#FFE4E6',
    warning: '#92400E',
    warningBg: '#FEF3C7',
    info: '#1D4ED8',
    infoBg: '#EFF6FF',
    gridTodayBg: 'rgba(22,101,52,0.07)',
  },
  {
    id: 'dusk',
    label: 'Dusk',
    tagline: 'Warm charcoal with a soft amber glow',
    isDark: true,
    swatches: ['#17141A', '#221D26', '#F0A35E'],
    onBrand: '#17141A',
    brand: '#F0A35E',
    brandDark: '#D98A3D',
    accent: '#7DD3FC',
    bg: '#17141A',
    raised: '#221D26',
    subtle: '#2E2733',
    border: 'rgba(255,255,255,0.08)',
    borderStrong: 'rgba(255,255,255,0.15)',
    text: '#F5F0EF',
    textSecondary: '#AFA4B0',
    textTertiary: '#6E6472',
    success: '#4ADE80',
    successBg: 'rgba(74,222,128,0.14)',
    danger: '#FB7185',
    dangerBg: 'rgba(251,113,133,0.15)',
    warning: '#FBBF24',
    warningBg: 'rgba(251,191,36,0.15)',
    info: '#93C5FD',
    infoBg: 'rgba(147,197,253,0.15)',
    gridTodayBg: 'rgba(240,163,94,0.10)',
  },
];

export const DEFAULT_THEME_ID = 'classic';

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
