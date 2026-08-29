import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '@/theme/ThemeContext';

/**
 * Structural subset of react-navigation's BottomTabBarProps — the real props
 * object satisfies this shape. We deliberately avoid importing the library's
 * type package (keeping it a transitive-only dependency); the component takes
 * `unknown` and narrows here because the navigation emit signature fights
 * parameter contravariance.
 */
interface TabBarPropsLike {
  state: {
    index: number;
    routes: { key: string; name: string; params?: object }[];
  };
  descriptors: Record<
    string,
    {
      options: {
        title?: string;
        tabBarLabel?: unknown;
        tabBarAccessibilityLabel?: unknown;
      };
    }
  >;
  navigation: {
    emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string, params?: object) => void;
  };
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: 'home',
  exams: 'document-text',
  timetable: 'calendar',
  rooms: 'location',
  more: 'grid',
};

/**
 * Floating-pill tab bar.
 *
 * Why custom: the default bar hugs the physical bottom edge, and with Android
 * edge-to-edge (enforced on API 35+) the 3-button system navigation bar
 * overlaps it on devices without gesture nav — a serious accessibility bug in
 * the field. This bar floats inside a transparent, safe-area-padded shell:
 * the pill always clears the system nav area, and the surrounding layout
 * space is transparent (scenes keep rendering full-height beneath the shell).
 */
// Props arrive from React Navigation's tabBar render callback; the library's
// own BottomTabBarProps would need a transitive-only package's types, so the
// parameter stays structurally loose (accepts any object) and is narrowed
// immediately on entry.
export function FloatingTabBar(props: Record<string, unknown>) {
  const { state, descriptors, navigation } = props as unknown as TabBarPropsLike;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.shell,
        { paddingBottom: Math.max(insets.bottom, 8) + 6 },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.pill,
          {
            backgroundColor: colors.raised,
            borderColor: colors.border,
            shadowColor: '#000',
          },
          Platform.select({
            android: { elevation: 8 },
            default: {
              shadowOpacity: 0.16,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 4 },
            },
          }),
        ]}
      >
        {state.routes.map((route, idx) => {
          const { options } = descriptors[route.key];
          const label =
            options.title !== undefined
              ? options.title
              : typeof options.tabBarLabel === 'string'
                ? options.tabBarLabel
                : route.name;
          const focused = state.index === idx;
          const icon = TAB_ICONS[route.name] ?? 'ellipse';
          const color = focused ? colors.brand : colors.textTertiary;

          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              android_ripple={{ color: colors.border, borderless: true }}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={
                typeof options.tabBarAccessibilityLabel === 'string'
                  ? options.tabBarAccessibilityLabel
                  : `${label} tab`
              }
              style={styles.tab}
            >
              <View
                style={[
                  styles.iconPill,
                  focused && { backgroundColor: colors.infoBg },
                ]}
              >
                <Ionicons
                  name={focused ? icon : (`${icon}-outline` as keyof typeof Ionicons.glyphMap)}
                  size={21}
                  color={color}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  { color, fontWeight: focused ? '700' : '600' },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    paddingHorizontal: 12,
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  pill: {
    flexDirection: 'row',
    height: 64,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  iconPill: {
    width: 46,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 10.5 },
});
