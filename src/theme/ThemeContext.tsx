import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_THEME_ID, getTheme, THEMES, type Theme, type ThemeColors } from './themes';

const THEME_PREF_KEY = 'pref:theme';

interface ThemeContextValue {
  theme: Theme;
  /** Shortcut for `theme` minus metadata — the palette used by styles. */
  colors: ThemeColors;
  isDark: boolean;
  setThemeId: (id: string) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: getTheme(DEFAULT_THEME_ID),
  colors: getTheme(DEFAULT_THEME_ID),
  isDark: false,
  setThemeId: () => {},
  themes: THEMES,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);

  // Hydrate the persisted choice once on startup.
  useEffect(() => {
    AsyncStorage.getItem(THEME_PREF_KEY)
      .then((stored) => {
        if (stored) setThemeIdState(stored);
      })
      .catch(() => {});
  }, []);

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
    AsyncStorage.setItem(THEME_PREF_KEY, id).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const theme = getTheme(themeId);
    return { theme, colors: theme, isDark: theme.isDark, setThemeId, themes: THEMES };
  }, [themeId, setThemeId]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Build a StyleSheet from the active palette, memoized so it is only
 * recomputed when the theme changes:
 *
 *   const makeStyles = (colors: ThemeColors) => StyleSheet.create({ ... });
 *   function Screen() { const styles = useStyles(makeStyles); }
 */
export function useStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}

export type { Theme, ThemeColors };
