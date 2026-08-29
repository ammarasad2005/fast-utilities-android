import { Tabs } from 'expo-router';

import { FloatingTabBar } from '@/components/FloatingTabBar';

/**
 * Tab order is deliberate (accessibility): Home sits in the MIDDLE with the
 * two highest-traffic flows next to it — Exams on the left, Timetable on the
 * right — Rooms outer-left and More outer-right. The bar itself is a floating
 * pill; see FloatingTabBar for why (system-nav overlap fix).
 */
export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="rooms" options={{ title: 'Rooms' }} />
      <Tabs.Screen name="exams" options={{ title: 'Exams' }} />
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="timetable" options={{ title: 'Timetable' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
