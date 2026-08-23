import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from '@/theme/ThemeContext';
import { registerBackgroundSyncAsync } from '@/background/sync';
import { BrandedSplash } from '@/components/BrandedSplash';

// Keep the native splash up until the JS branded splash has painted its
// first frame — the handoff is invisible because both use the same navy.
SplashScreen.preventAutoHideAsync().catch(() => {});

/** Applies theme-aware system chrome (status bar + root background). */
function ThemedChrome({ children, splashDone }: { children: React.ReactNode; splashDone: boolean }) {
  const { colors, isDark } = useTheme();

  useEffect(() => {
    // Match the Android system bars to the active theme.
    if (splashDone) SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
  }, [colors.bg, splashDone]);

  return (
    <>
      {splashDone ? <StatusBar style={isDark ? 'light' : 'dark'} /> : null}
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="faculty" options={{ title: 'Faculty' }} />
        <Stack.Screen name="semester" options={{ title: 'Semester Schedule' }} />
        <Stack.Screen name="events" options={{ title: 'Campus Events' }} />
        <Stack.Screen name="custom-exams" options={{ title: 'Custom Exam Schedule' }} />
        <Stack.Screen name="custom-timetable" options={{ title: 'Custom Timetable' }} />
        <Stack.Screen name="about" options={{ title: 'About' }} />
        <Stack.Screen name="+not-found" />
        {children}
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    // Idempotent — registers the background auto-sync task (WorkManager) so
    // campus data refreshes into AsyncStorage even when the app is closed.
    registerBackgroundSyncAsync();
  }, []);

  return (
    <ThemeProvider>
      <ThemedChrome splashDone={splashDone}>{null}</ThemedChrome>
      {/* Brand splash overlays the app only at cold start; never blocks the
          app (hard-capped) and never waits on the network. */}
      {!splashDone && <BrandedSplash onDone={() => setSplashDone(true)} />}
    </ThemeProvider>
  );
}
