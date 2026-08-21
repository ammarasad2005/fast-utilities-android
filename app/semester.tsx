import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchSemesterCalendar } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import {
  formatKeyDateRange,
  daysUntil,
  getSemesterStartDate,
  getSemesterEndDate,
  getUpcomingKeyDates,
} from '@/core/semester';
import type { KeyDate, SemesterCalendar } from '@/core/types';
import { ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';

const TYPE_STYLE: Record<string, { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  exam: { color: '#B45309', bg: '#FFFBEB', icon: 'ribbon' },
  deadline: { color: '#E11D48', bg: '#FFF1F2', icon: 'alarm' },
  academic: { color: '#1D4ED8', bg: '#EFF6FF', icon: 'school' },
};

export default function SemesterScreen() {
  const { data: calendar, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<SemesterCalendar>('data:semester', fetchSemesterCalendar, CACHE_TTL.semester);

  const upcoming = useMemo(() => (calendar ? getUpcomingKeyDates(calendar, 5) : []), [calendar]);

  if (isLoading) return <LoadingState label="Loading semester calendar…" />;
  if (!calendar || error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  const start = getSemesterStartDate(calendar);
  const end = getSemesterEndDate(calendar);

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Semester Schedule" subtitle={calendar.semester} />
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

        {/* Summary card */}
        <View style={styles.summary}>
          <Text style={styles.summarySemester}>{calendar.semester}</Text>
          {calendar.academicYear ? <Text style={styles.summaryYear}>{calendar.academicYear}</Text> : null}
          {start ? (
            <View style={styles.summaryRow}>
              <Ionicons name="play" size={14} color="#fff" />
              <Text style={styles.summaryText}>Started {formatKeyDateRange({ label: '', date: start, type: '' })}</Text>
            </View>
          ) : null}
          {end ? (
            <View style={styles.summaryRow}>
              <Ionicons name="flag" size={14} color="#fff" />
              <Text style={styles.summaryText}>Finals {formatKeyDateRange({ label: '', date: end, type: '' })}</Text>
            </View>
          ) : null}
        </View>

        {/* Upcoming */}
        <SectionHeader title="Up next" />
        {upcoming.length === 0 ? (
          <Text style={styles.noneText}>No upcoming key dates.</Text>
        ) : (
          upcoming.map((kd, i) => (
            <View key={kd.label} style={[styles.upcomingCard, i === 0 && { borderColor: colors.brand, borderWidth: 1.5 }]}>
              <KeyDateRow kd={kd} highlight={i === 0} />
            </View>
          ))
        )}

        {/* Full timeline */}
        <SectionHeader title="Full calendar" />
        {[...calendar.keyDates]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((kd) => (
            <View key={kd.label} style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.timelineDate}>{formatKeyDateRange(kd)}</Text>
                <Text style={styles.timelineLabel}>{kd.label}</Text>
              </View>
              <TypeBadge type={kd.type} />
            </View>
          ))}
      </ScrollView>
    </View>
  );
}

function KeyDateRow({ kd, highlight }: { kd: KeyDate; highlight?: boolean }) {
  const d = daysUntil(kd.date);
  return (
    <View style={styles.upcomingInner}>
      <View style={{ flex: 1 }}>
        <Text style={styles.upcomingLabel}>{kd.label}</Text>
        <Text style={styles.upcomingDate}>{formatKeyDateRange(kd)}</Text>
      </View>
      <View style={styles.upcomingRight}>
        {d >= 0 ? (
          <View style={[styles.daysBadge, highlight && { backgroundColor: colors.brand }]}>
            <Text style={[styles.daysBadgeText, highlight && { color: '#fff' }]}>
              {d === 0 ? 'Today' : `${d}d`}
            </Text>
          </View>
        ) : null}
        <TypeBadge type={kd.type} />
      </View>
    </View>
  );
}

function TypeBadge({ type }: { type: string }) {
  const st = TYPE_STYLE[type] ?? { color: colors.textSecondary, bg: colors.subtle, icon: 'ellipse' as const };
  return (
    <View style={[styles.typeBadge, { backgroundColor: st.bg }]}>
      <Ionicons name={st.icon} size={11} color={st.color} />
      <Text style={[styles.typeBadgeText, { color: st.color }]}>{type.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  summary: { backgroundColor: colors.brand, borderRadius: 16, padding: 18, marginBottom: 4 },
  summarySemester: { color: '#fff', fontSize: 22, fontWeight: '800' },
  summaryYear: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  summaryText: { color: '#fff', fontSize: 13 },
  noneText: { color: colors.textTertiary, fontSize: 13 },
  upcomingCard: {
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  upcomingInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  upcomingLabel: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
  upcomingDate: { fontSize: 12, color: colors.textSecondary, marginTop: 3 },
  upcomingRight: { alignItems: 'flex-end', gap: 6 },
  daysBadge: { backgroundColor: colors.successBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  daysBadgeText: { fontSize: 12, fontWeight: '800', color: colors.success },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  typeBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },
  timelineItem: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 6 },
  timelineDate: { fontSize: 12, fontWeight: '700', color: colors.brand },
  timelineLabel: { fontSize: 14, color: colors.text, marginTop: 2 },
});
