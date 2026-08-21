import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';

// ─── Text primitives ──────────────────────────────────────────────────────────

export function H1({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}

export function H2({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}

export function Body({ children, style, secondary }: { children: React.ReactNode; style?: TextStyle; secondary?: boolean }) {
  return <Text style={[styles.body, secondary && { color: colors.textSecondary }, style]}>{children}</Text>;
}

export function Mono({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  const content = <View style={[styles.card, style]}>{children}</View>;
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        android_ripple={{ color: colors.border }}
        style={({ pressed }) => pressed && { opacity: 0.85 }}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

// ─── Chip / Pill ──────────────────────────────────────────────────────────────

export function Chip({
  label,
  active,
  onPress,
  color,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  const accent = color ?? colors.brand;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.border }}
      style={[
        styles.chip,
        active && { backgroundColor: accent, borderColor: accent },
      ]}
    >
      <Text style={[styles.chipText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Mono style={styles.sectionTitle}>{title.toUpperCase()}</Mono>
      {right}
    </View>
  );
}

// ─── States ───────────────────────────────────────────────────────────────────

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.stateWrap}>
      <ActivityIndicator size="large" color={colors.brand} />
      <Body secondary style={{ marginTop: 12 }}>
        {label}
      </Body>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
}) {
  return (
    <View style={styles.stateWrap}>
      <Ionicons name={icon} size={44} color={colors.textTertiary} />
      <H2 style={{ marginTop: 12, color: colors.text }}>{title}</H2>
      {message ? (
        <Body secondary style={{ marginTop: 6, textAlign: 'center' }}>
          {message}
        </Body>
      ) : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.stateWrap}>
      <Ionicons name="cloud-offline-outline" size={44} color={colors.textTertiary} />
      <H2 style={{ marginTop: 12 }}>Could not load data</H2>
      <Body secondary style={{ marginTop: 6, textAlign: 'center' }}>
        {message ?? 'Check your connection and try again.'}
      </Body>
      {onRetry ? (
        <Pressable onPress={onRetry} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function OfflineNotice({ cached }: { cached: boolean }) {
  return (
    <View style={styles.offlineNotice}>
      <Ionicons name={cached ? 'time-outline' : 'cloud-offline-outline'} size={14} color="#92400e" />
      <Text style={styles.offlineText}>
        {cached ? 'Showing cached data — refresh when online for the latest.' : 'You are offline.'}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  h1: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  h2: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 21,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.brand,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  offlineText: {
    color: '#92400e',
    fontSize: 12,
    flexShrink: 1,
  },
});
