import React from 'react';
import { PanResponder, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

/**
 * Horizontal swipe navigation — the "circular chain" across the main flows.
 *
 * Chain (left ↔ right, wraps at both ends):
 *
 *   Campus Events ↔ Faculty Info ↔ Free Rooms ↔ Home ↔ Timetable
 *     ↔ Exam Finder ↔ Semester Schedule
 *
 * From Home a single right-swipe lands on Timetable, one more on Exams, and
 * so on (the "double/triple swipe" idea emerges naturally); at either end the
 * chain wraps around, so it is one continuous loop.
 *
 * Built on RN's PanResponder — no gesture-handler/reanimated dependency. The
 * capture callback only claims a gesture that is already unambiguously
 * horizontal (|dx| > 28 and 1.75× the vertical travel), so vertical scrolling
 * and horizontal chip rows are never hijacked.
 */

const CHAIN: string[] = ['/events', '/faculty', '/rooms', '/', '/timetable', '/exams', '/semester'];

function normalize(pathname: string): string {
  if (!pathname) return '/';
  const p = pathname.replace(/\/+$/, '') || '/';
  return p;
}

export function SwipeChain({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const idx = CHAIN.indexOf(normalize(pathname));

  // A fresh responder per render is deliberate: handlers must see the CURRENT
  // chain position (no refs — react-hooks/refs compliant), and an active
  // gesture never survives a route change anyway (the screen swaps out).
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponderCapture: () => false,
    // BUBBLE phase only, and only for unambiguous horizontal intent — so:
    //  - the horizontal WeekGrid claims its own pans and never loses scrolling
    //    to a navigation swipe;
    //  - vertical screens' ScrollViews keep vertical scrolls untouched;
    //  - a clean horizontal flick in scrollable content (unclaimed by an
    //    axis-locked child) still reaches us and navigates.
    onMoveShouldSetPanResponder: (_evt, g) =>
      idx >= 0 && Math.abs(g.dx) > 28 && Math.abs(g.dx) > Math.abs(g.dy) * 1.75,
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: (_evt, g) => {
      if (idx < 0) return;
      if (g.dx <= -64) {
        // flick left → one step LEFT in the chain (wraps circularly)
        const target = CHAIN[(idx - 1 + CHAIN.length) % CHAIN.length];
        void Haptics.selectionAsync().catch(() => {});
        router.push(target as never);
      } else if (g.dx >= 64) {
        // flick right → one step RIGHT in the chain (wraps circularly)
        const target = CHAIN[(idx + 1) % CHAIN.length];
        void Haptics.selectionAsync().catch(() => {});
        router.push(target as never);
      }
    },
  });

  return (
    <View style={{ flex: 1 }} collapsable={false} {...pan.panHandlers}>
      {children}
    </View>
  );
}
