import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchSemesterCalendar } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import {
  formatKeyDateRange,
  daysUntil,
  getSemesterStartDate,
  getSemesterEndDate,
  getSemesterWeekNumber,
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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { data: calendar, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<SemesterCalendar>('data:semester', fetchSemesterCalendar, CACHE_TTL.semester);

  const upcoming = useMemo(() => (calendar ? getUpcomingKeyDates(calendar, 5) : []), [calendar]);
  const weekNow = useMemo(() => (calendar ? getSemesterWeekNumber(calendar) : null), [calendar]);

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
              <Text style={styles.summaryText}>Started {formatKeyDateRange({ date: start })}</Text>
            </View>
          ) : null}
          {end ? (
            <View style={styles.summaryRow}>
              <Ionicons name="flag" size={14} color="#fff" />
              <Text style={styles.summaryText}>Finals {formatKeyDateRange({ date: end })}</Text>
            </View>
          ) : null}
        </View>

        {/* Holidays */}
        {calendar.holidays && calendar.holidays.length > 0 ? (
          <>
            <SectionHeader title="Holidays" />
            <View style={styles.holidaysGrid}>
              {calendar.holidays.map((h) => (
                <View key={h.label} style={styles.holidayCard}>
                  <View style={[styles.holidayIcon, h.type === 'religious' ? { backgroundColor: colors.successBg } : { backgroundColor: colors.warningBg }]}>
                    <Ionicons
                      name={h.type === 'religious' ? 'moon-outline' : 'flag-outline'}
                      size={16}
                      color={h.type === 'religious' ? colors.success : colors.warning}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.holidayLabel}>{h.label}</Text>
                    <Text style={styles.holidayDate}>{formatKeyDateRange(h)}</Text>
                  </View>
                  <Text style={styles.holidayType}>{h.type === 'religious' ? 'Religious' : 'National'}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

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

        {/* Full timeline with live tracker */}
        <SectionHeader title="Full calendar" />
        {(() => {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const tISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
            now.getDate()
          ).padStart(2, '0')}`;
          const sorted = [...calendar.keyDates].sort((a, b) => a.date.localeCompare(b.date));
          const spansToday = (kd: KeyDate) => {
            const end = kd.endDate ?? kd.date;
            return kd.date <= tISO && tISO <= end;
          };
          const nodes: React.ReactNode[] = [];
          let marked = false;
          const mark = (
            <View key="__live" style={styles.liveRow}>
              <View style={[styles.liveLine, { backgroundColor: colors.brand }]} />
              <Text style={[styles.liveText, { color: colors.brand }]}>
                Now{weekNow ? ` · Week ${weekNow}` : ''}
              </Text>
              <View style={[styles.liveLine, { backgroundColor: colors.brand }]} />
            </View>
          );
          for (const kd of sorted) {
            const live = spansToday(kd);
            if (!marked && kd.date > tISO && !live) {
              nodes.push(mark);
              marked = true;
            }
            nodes.push(
              <View key={kd.label} style={[styles.timelineItem, live && styles.timelineItemNow]}>
                <View style={[styles.timelineDot, live && { backgroundColor: colors.brand, transform: [{ scale: 1.25 }] }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineDate}>{formatKeyDateRange(kd)}</Text>
                  <Text style={styles.timelineLabel}>{kd.label}</Text>
                </View>
                {live ? (
                  <View style={[styles.nowBadge, { backgroundColor: colors.brand }]}>
                    <Text style={styles.nowBadgeText}>NOW</Text>
                  </View>
                ) : null}
                <TypeBadge type={kd.type} />
              </View>
            );
            if (!marked && live) {
              marked = true; // the live line sits at the current event itself
            }
          }
          if (!marked) nodes.push(mark);
          return nodes;
        })()}
      </ScrollView>
    </View>
  );
}

function KeyDateRow({ kd, highlight }: { kd: KeyDate; highlight?: boolean }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
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
            <Text style={[styles.daysBadgeText, highlight && { color: colors.onBrand }]}>
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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const st = TYPE_STYLE[type] ?? { color: colors.textSecondary, bg: colors.subtle, icon: 'ellipse' as const };
  return (
    <View style={[styles.typeBadge, { backgroundColor: st.bg }]}>
      <Ionicons name={st.icon} size={11} color={st.color} />
      <Text style={[styles.typeBadgeText, { color: st.color }]}>{type.toUpperCase()}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  summary: { backgroundColor: colors.brand, borderRadius: 16, padding: 18, marginBottom: 4 },
  summarySemester: { color: colors.onBrand, fontSize: 22, fontWeight: '800' },
  summaryYear: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  summaryText: { color: colors.onBrand, fontSize: 13 },
  noneText: { color: colors.textTertiary, fontSize: 13 },
  holidaysGrid: { gap: 8 },
  holidayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
  },
  holidayIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holidayLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  holidayDate: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  holidayType: { fontSize: 11, color: colors.textTertiary, fontWeight: '600' },
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
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  liveLine: { flex: 1, height: StyleSheet.hairlineWidth },
  liveText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  timelineItemNow: {
    backgroundColor: colors.subtle,
    borderColor: colors.brand,
    borderWidth: 1,
  },
  nowBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 8 },
  nowBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  timelineDate: { fontSize: 12, fontWeight: '700', color: colors.brand },
  timelineLabel: { fontSize: 14, color: colors.text, marginTop: 2 },
});
