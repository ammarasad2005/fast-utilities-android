/**
 * Semester pulse — the "now / up next" rows rendered from
 * computeCurrentPhase(). Used by the home timeline popup; kept shared so the
 * presentation stays consistent wherever the pulse appears.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import type { PulseKind, SemesterPulse } from '@/core/semester';

export const PULSE_TINT: Record<
  PulseKind,
  { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  holiday: { color: '#B45309', bg: '#FFFBEB', icon: 'partly-sunny' },
  exam: { color: '#B45309', bg: '#FFFBEB', icon: 'ribbon' },
  classes: { color: '#1D4ED8', bg: '#EFF6FF', icon: 'school' },
  'pre-semester': { color: '#0F766E', bg: '#F0FDFA', icon: 'hourglass' },
  'post-semester': { color: '#475569', bg: '#F8FAFC', icon: 'checkmark-done' },
};

function PulseRow({
  eyebrow,
  kind,
  label,
  dates,
  badge,
  badgeSolid,
}: {
  eyebrow: string;
  kind: PulseKind;
  label: string;
  dates: string;
  badge?: string;
  badgeSolid?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const tint = PULSE_TINT[kind];
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: tint.bg }]}>
        <Ionicons name={tint.icon} size={18} color={tint.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {dates}
        </Text>
      </View>
      {badge ? (
        <View style={[styles.badge, badgeSolid ? { backgroundColor: colors.brand } : { backgroundColor: tint.bg }]}>
          <Text style={[styles.badgeText, { color: badgeSolid ? colors.onBrand : tint.color }]}>
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function SemesterPulseRows({ pulse }: { pulse: SemesterPulse }) {
  const styles = useStyles(makeStyles);
  return (
    <View>
      <PulseRow
        eyebrow="Now"
        kind={pulse.current.kind}
        label={pulse.current.label}
        dates={pulse.current.dates}
        badge={pulse.current.context}
      />
      {pulse.next ? (
        <>
          <View style={styles.divider} />
          <PulseRow
            eyebrow="Up next"
            kind={pulse.next.kind}
            label={pulse.next.label}
            dates={pulse.next.dates}
            badge={pulse.next.daysUntil === 0 ? 'Today' : `${pulse.next.daysUntil}d`}
            badgeSolid
          />
        </>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    icon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    eyebrow: {
      fontSize: 10.5,
      fontWeight: '800',
      letterSpacing: 0.8,
      color: colors.textTertiary,
      textTransform: 'uppercase',
    },
    label: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 1 },
    sub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    badge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, alignSelf: 'flex-start' },
    badgeText: { fontSize: 11.5, fontWeight: '800' },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
  });
