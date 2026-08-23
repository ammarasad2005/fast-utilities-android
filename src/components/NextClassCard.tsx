import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { formatDuration, formatISODateShort, parseTimeRange } from '@/core/dates';
import { formatSlotEnd, formatSlotStart } from '@/core/timetable';
import type { ClassStatus } from '@/core/liveClass';
import type { WeekPlan } from '@/core/weekPlan';

/**
 * Home bento card: the web app's "Ongoing Class / Next Up" tracker (DesktopTicker),
 * adapted for the phone-height bento slot beside the semester cards.
 *
 * States:
 *  - needsTag   → no timetable tagged yet (prompt to set one up)
 *  - ongoing    → class in progress: name, section/room, "Xm left" + progress bar
 *  - next       → earliest upcoming class: "in 2h 15m" (+ day/date when not today)
 *  - none       → tracked but nothing upcoming (shouldn't normally happen)
 *  - loading    → timetable not fetched yet
 */
export function NextClassCard({
  status,
  plan,
  needsTag,
  loading,
  onPress,
}: {
  status: ClassStatus | null;
  plan: WeekPlan | null;
  needsTag: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  const ongoing = status?.type === 'ongoing';
  const next = status?.type === 'next';
  const primary = status?.classes[0];
  const extra = (status?.classes.length ?? 1) - 1;

  // Occurrence-date label when the next class isn't on the effective today
  const occLabel =
    next && primary && primary.dateISO !== plan?.todayISO
      ? (() => {
          const d = new Date(primary.dateISO + 'T00:00:00');
          const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
          return `${weekday} · ${formatISODateShort(primary.dateISO)}`;
        })()
      : null;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.border }}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }, ongoing && styles.cardOngoing]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: ongoing ? colors.success : colors.warning }]} />
        <Text style={styles.headerText}>{ongoing ? 'ONGOING NOW' : 'NEXT UP'}</Text>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <Text style={styles.muted}>Loading schedule…</Text>
        </View>
      ) : needsTag ? (
        <View style={styles.centerFill}>
          <Ionicons name="pricetag-outline" size={20} color={colors.textTertiary} />
          <Text style={styles.placeholderTitle}>No timetable tagged</Text>
          <Text style={styles.placeholderText}>
            Tag your timetable in the Timetable tab to track classes live here.
          </Text>
        </View>
      ) : !status || !primary ? (
        <View style={styles.centerFill}>
          <Ionicons name="calendar-clear-outline" size={20} color={colors.textTertiary} />
          <Text style={styles.placeholderTitle}>Nothing scheduled</Text>
          <Text style={styles.placeholderText}>No upcoming classes found for your tagged timetable.</Text>
        </View>
      ) : (
        <View style={styles.centerFill}>
          <Text style={styles.course} numberOfLines={2}>
            {primary.courseName}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            Sec {primary.section}
            {primary.type === 'lab' ? ' · Lab' : ''}
            {primary.room && primary.room !== 'TBA' ? ` · ${primary.room}` : ''}
          </Text>

          <View style={{ flex: 1 }} />

          <Text style={[styles.countdown, { color: ongoing ? colors.success : colors.brand }]}>
            {ongoing ? `${formatDuration(primary.remaining)} left` : `in ${formatDuration(primary.until)}`}
          </Text>
          <Text style={styles.subLine} numberOfLines={1}>
            {ongoing ? `ends ${formatSlotEnd(primary.time)}` : occLabel ? `${occLabel} · ${formatSlotStart(primary.time)}` : `starts ${formatSlotStart(primary.time)}`}
          </Text>

          {/* progress bar for ongoing classes */}
          {ongoing ? <OngoingProgress time={primary.time} remaining={primary.remaining} colors={colors} /> : null}

          {/* parallel classes (the web's "Critical Conflict" case) */}
          {extra > 0 ? (
            <View style={styles.extraRow}>
              <Ionicons name="albums-outline" size={11} color={colors.warning} />
              <Text style={styles.extraText}>+{extra} more at this time</Text>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

function OngoingProgress({ time, remaining, colors }: { time: string; remaining: number; colors: ThemeColors }) {
  const { start, end } = parseTimeRange(time);
  const total = Math.max(1, end - start);
  const done = Math.max(0, Math.min(1, (total - remaining) / total));
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 8, overflow: 'hidden' }}>
      <View style={{ width: `${done * 100}%`, height: 4, borderRadius: 2, backgroundColor: colors.success }} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flex: 1,
      backgroundColor: colors.raised,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    cardOngoing: {
      borderColor: colors.success,
      borderWidth: 1.5,
      backgroundColor: colors.successBg,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    headerText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: colors.textTertiary },
    centerFill: { flex: 1, marginTop: 10 },
    course: { fontSize: 15, fontWeight: '700', color: colors.text, lineHeight: 20 },
    meta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
    countdown: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
    subLine: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
    extraRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
    extraText: { fontSize: 10, fontWeight: '700', color: colors.warning },
    muted: { fontSize: 12, color: colors.textTertiary },
    placeholderTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 8 },
    placeholderText: { fontSize: 11, color: colors.textTertiary, marginTop: 4, lineHeight: 15 },
  });
