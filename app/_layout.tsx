import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { colors } from '@/theme/colors';
import { registerBackgroundSyncAsync } from '@/background/sync';

// Match the Android system bars to the app's light theme.
SystemUI.setBackgroundColorAsync(colors.bg);

export default function RootLayout() {
  useEffect(() => {
    // Idempotent — registers the background auto-sync task (WorkManager) so
    // campus data refreshes into AsyncStorage even when the app is closed.
    registerBackgroundSyncAsync();
  }, []);

  return (
    <>
      <StatusBar style="dark" />
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
      </Stack>
    </>
  );
}
