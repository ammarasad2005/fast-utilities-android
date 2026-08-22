import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchStudentEvents } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import {
  getCalendarCells,
  getEventsForMonth,
  MONTH_NAMES,
  DAY_NAMES,
  type CalendarEvent,
} from '@/core/events';
import type { StudentEvent, StudentEventsPayload } from '@/core/types';
import { ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';

export default function EventsScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(now.getDate());

  const { data: payload, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<StudentEventsPayload>('data:student_events', fetchStudentEvents, CACHE_TTL.events);

  const events = useMemo<StudentEvent[]>(
    () => (payload && Array.isArray(payload.events) ? payload.events : []),
    [payload]
  );

  const cells = useMemo(() => getCalendarCells(month, year), [month, year]);
  const eventsByDay = useMemo(
    () => getEventsForMonth(events, month, year),
    [events, month, year]
  );
  const selectedEvents: CalendarEvent[] =
    selectedDay != null ? (eventsByDay[selectedDay] ?? []) : [];

  const navigate = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setMonth(d.getMonth());
    setYear(d.getFullYear());
    setSelectedDay(null);
  };

  const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

  if (isLoading) return <LoadingState label="Loading events…" />;
  if (!payload || error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Campus Events" subtitle={`${MONTH_NAMES[month]} ${year}`} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {isFromCache ? (
          <View style={{ marginBottom: 12 }}>
            <OfflineNotice cached />
          </View>
        ) : null}

        {/* Month nav */}
        <View style={styles.navRow}>
          <Pressable onPress={() => navigate(-1)} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.monthTitle}>
            {MONTH_NAMES[month]} {year}
          </Text>
          <Pressable onPress={() => navigate(1)} hitSlop={10} style={styles.navBtn}>
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
        </View>

        {/* Day-of-week header */}
        <View style={styles.weekRow}>
          {DAY_NAMES.map((d) => (
            <Text key={d} style={styles.weekDay}>
              {d}
            </Text>
          ))}
        </View>

        {/* Calendar grid */}
        <View style={styles.grid}>
          {cells.map((c, i) => {
            const isToday = `${c.year}-${c.month}-${c.day}` === todayKey;
            const isSelected = selectedDay === c.day && c.inCurrentMonth;
            const hasEvents = c.inCurrentMonth && (eventsByDay[c.day]?.length ?? 0) > 0;
            return (
              <Pressable
                key={i}
                onPress={() => c.inCurrentMonth && setSelectedDay(c.day)}
                style={[
                  styles.cell,
                  isToday && styles.cellToday,
                  isSelected && styles.cellSelected,
                ]}
              >
                <Text
                  style={[
                    styles.cellDay,
                    !c.inCurrentMonth && { color: colors.textTertiary },
                    isSelected && { color: colors.onBrand },
                    isToday && !isSelected && { color: colors.brand, fontWeight: '800' },
                  ]}
                >
                  {c.day}
                </Text>
                {hasEvents ? <View style={[styles.dot, isSelected && { backgroundColor: colors.onBrand }]} /> : null}
              </Pressable>
            );
          })}
        </View>

        {/* Selected day events */}
        <SectionHeader
          title={selectedDay != null ? `Events · ${MONTH_NAMES[month]} ${selectedDay}` : 'Select a day'}
        />
        {selectedEvents.length === 0 ? (
          <Text style={styles.noneText}>No events on this day.</Text>
        ) : (
          selectedEvents.map((e, i) => (
            <View key={`${e.event_name}-${i}`} style={styles.eventCard}>
              <View style={styles.eventTime}>
                <Text style={styles.eventTimeText}>{e.time}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventName}>{e.event_name}</Text>
                <View style={styles.eventMetaRow}>
                  <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.eventMeta}>{e.event_location}</Text>
                </View>
                {e.from ? <Text style={styles.eventFrom}>By {e.from}</Text> : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekDay: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: colors.textTertiary },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  cellToday: { backgroundColor: colors.infoBg },
  cellSelected: { backgroundColor: colors.brand },
  cellDay: { fontSize: 14, color: colors.text },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent, marginTop: 2 },
  noneText: { color: colors.textTertiary, fontSize: 13 },
  eventCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  eventTime: { width: 76, justifyContent: 'center' },
  eventTimeText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  eventName: { fontSize: 15, fontWeight: '600', color: colors.text },
  eventMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  eventMeta: { fontSize: 12, color: colors.textSecondary },
  eventFrom: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
});
