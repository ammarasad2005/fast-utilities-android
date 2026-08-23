/**
 * Branded launch screen.
 *
 * The native splash (icon on navy) covers the pre-JS gap; this overlay is
 * already mounted behind it, and takes over the moment the JS bundle is
 * ready — same navy gradient, so the handoff is invisible. It then plays a
 * short brand moment: emblem badge, name, tagline, version pill, creator
 * credit — and fades out into the app.
 *
 * Splash research that shaped this (and the budget it gets):
 *  - Keep it SHORT: ~1.5–2s perceived; never block on network. We hard-cap
 *    the whole moment at ~2.2s and guarantee unmount via a safety timer.
 *  - Simple, high-contrast, on-brand beats busy.
 *  - Seamless native → JS handoff (matching background) avoids the flash.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, ImageBackground, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { setStatusBarStyle } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import Constants from 'expo-constants';
import { useTheme } from '@/theme/ThemeContext';

const SPLASH_BG = require('../../assets/images/splash-bg.png');
const EMBLEM = require('../../assets/images/splash-icon.png');

// Brand palette (fixed — the splash is a brand moment, identical across app themes)
const NAVY = '#0D2547';
const INK = '#FFFFFF';
const SLATE = '#B9C6D8';
const DIM = '#93A5BF';
const AMBER = '#FFC24B';
const HEART = '#FB7185';

// Timing — total ≈ 2.2s: entrance ≈ 0.55s, dwell ≈ 1.25s, exit 0.3s.
const EXIT_AT = 1900;
const FADE_OUT = 300;
const HARD_CAP = 2800; // absolute failsafe — the app must never be held hostage

export function BrandedSplash({ onDone }: { onDone: () => void }) {
  const { colors, isDark } = useTheme();
  // useState with an initializer = a stable Animated.Value per mount
  // (reading .current of a ref during render is forbidden by the compiler lint).
  const [root] = useState(() => new Animated.Value(1));
  const [badge] = useState(() => new Animated.Value(0));
  const [line1] = useState(() => new Animated.Value(0));
  const [line2] = useState(() => new Animated.Value(0));
  const [chip] = useState(() => new Animated.Value(0));
  const [credit] = useState(() => new Animated.Value(0));
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  const finish = React.useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    // System chrome while the brand screen owns the window.
    SystemUI.setBackgroundColorAsync(NAVY).catch(() => {});
    setStatusBarStyle('light', true);

    // Handoff: reveal the JS splash only once a frame is actually painted.
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
    });

    // Brand moment choreography (native driver only).
    const rise = (v: Animated.Value, delay: number) =>
      Animated.timing(v, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([
      Animated.spring(badge, { toValue: 1, tension: 46, friction: 7, useNativeDriver: true }),
      rise(line1, 140),
      rise(line2, 260),
      rise(chip, 380),
      rise(credit, 500),
    ]).start();

    const exit = setTimeout(() => {
      setLeaving(true);
      Animated.timing(root, { toValue: 0, duration: FADE_OUT, easing: Easing.in(Easing.ease), useNativeDriver: true }).start(() =>
        finish()
      );
    }, EXIT_AT);
    const safety = setTimeout(finish, HARD_CAP); // never trap the user

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(exit);
      clearTimeout(safety);
      // Restore app chrome for the theme that will now be visible.
      SystemUI.setBackgroundColorAsync(colors.bg).catch(() => {});
      setStatusBarStyle(isDark ? 'light' : 'dark', true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const riseStyle = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
  });

  const version = Constants.expoConfig?.version ?? '';

  return (
    <Animated.View
      pointerEvents={leaving ? 'none' : 'auto'}
      style={[StyleSheet.absoluteFill, { opacity: root, zIndex: 100 }]}
    >
      <ImageBackground source={SPLASH_BG} style={styles.bg} resizeMode="cover">
        <View style={styles.center}>
          <Animated.View
            style={{
              opacity: badge,
              transform: [{ scale: badge.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
            }}
          >
            <Image source={EMBLEM} style={styles.emblem} resizeMode="contain" />
          </Animated.View>

          <Animated.View style={[styles.stack, riseStyle(line1)]}>
            <Text style={styles.name}>FAST UTILITIES</Text>
          </Animated.View>
          <Animated.View style={[styles.stack, riseStyle(line2)]}>
            <Text style={styles.tagline}>Timetables · Exams · Rooms · Campus</Text>
          </Animated.View>
          <Animated.View style={[styles.stack, riseStyle(chip)]}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>v{version} · Android</Text>
            </View>
          </Animated.View>
        </View>

        <Animated.View style={[styles.credits, { opacity: credit }]}>
          <View style={styles.creditRow}>
            <Text style={styles.creditText}>Made with </Text>
            <Ionicons name="heart" size={12} color={HEART} />
            <Text style={styles.creditText}> by Ammar Asad</Text>
          </View>
          <Text style={styles.handle}>@ammarasad2005 · FAST-NU Islamabad</Text>
        </Animated.View>
      </ImageBackground>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  emblem: { width: 148, height: 148 },
  stack: { alignItems: 'center' },
  name: {
    marginTop: 26,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 4,
    color: INK,
  },
  tagline: {
    marginTop: 8,
    fontSize: 12.5,
    fontWeight: '500',
    letterSpacing: 1.1,
    color: SLATE,
  },
  chip: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  chipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: AMBER },
  credits: { alignItems: 'center', paddingBottom: 46 },
  creditRow: { flexDirection: 'row', alignItems: 'center' },
  creditText: { fontSize: 12, fontWeight: '600', color: SLATE },
  handle: { marginTop: 4, fontSize: 10.5, fontWeight: '500', letterSpacing: 0.6, color: DIM },
});
