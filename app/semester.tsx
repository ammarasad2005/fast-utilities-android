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
  getUpcomingKeyDates,
  computeCurrentPhase,
  type PulseKind,
} from '@/core/semester';
import type { KeyDate, SemesterCalendar } from '@/core/types';
import { ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';

const PULSE_TINT: Record<PulseKind, { color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  holiday: { color: '#B45309', bg: '#FFFBEB', icon: 'partly-sunny' },
  exam: { color: '#B45309', bg: '#FFFBEB', icon: 'ribbon' },
  classes: { color: '#1D4ED8', bg: '#EFF6FF', icon: 'school' },
  'pre-semester': { color: '#0F766E', bg: '#F0FDFA', icon: 'hourglass' },
  'post-semester': { color: '#475569', bg: '#F8FAFC', icon: 'checkmark-done' },
};

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
  const pulse = useMemo(() => (calendar ? computeCurrentPhase(calendar) : null), [calendar]);

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

        {/* Semester pulse — current stage + what comes next (holidays included) */}
        {pulse ? (
          <View style={styles.pulseCard}>
            <View style={styles.pulseRow}>
              <View style={[styles.pulseIcon, { backgroundColor: PULSE_TINT[pulse.current.kind].bg }]}>
                <Ionicons name={PULSE_TINT[pulse.current.kind].icon} size={18} color={PULSE_TINT[pulse.current.kind].color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pulseEyebrow}>Now</Text>
                <Text style={styles.pulseLabel}>{pulse.current.label}</Text>
                <Text style={styles.pulseSub}>{pulse.current.dates}</Text>
              </View>
              {pulse.current.context ? (
                <View style={[styles.pulseBadge, { backgroundColor: PULSE_TINT[pulse.current.kind].bg }]}>
                  <Text style={[styles.pulseBadgeText, { color: PULSE_TINT[pulse.current.kind].color }]}>
                    {pulse.current.context}
                  </Text>
                </View>
              ) : null}
            </View>
            {pulse.next ? (
              <>
                <View style={styles.pulseDivider} />
                <View style={styles.pulseRow}>
                  <View style={[styles.pulseIcon, { backgroundColor: PULSE_TINT[pulse.next.kind].bg }]}>
                    <Ionicons name={PULSE_TINT[pulse.next.kind].icon} size={18} color={PULSE_TINT[pulse.next.kind].color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pulseEyebrow}>Up next</Text>
                    <Text style={styles.pulseLabel}>{pulse.next.label}</Text>
                    <Text style={styles.pulseSub}>{pulse.next.dates}</Text>
                  </View>
                  <View style={[styles.pulseBadge, { backgroundColor: colors.brand }]}>
                    <Text style={[styles.pulseBadgeText, { color: colors.onBrand }]}>
                      {pulse.next.daysUntil === 0 ? 'Today' : `${pulse.next.daysUntil}d`}
                    </Text>
                  </View>
                </View>
              </>
            ) : null}
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
  pulseCard: {
    backgroundColor: colors.raised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
  },
  pulseRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pulseIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseEyebrow: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
  pulseLabel: { fontSize: 15, fontWeight: '800', color: colors.text, marginTop: 1 },
  pulseSub: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  pulseBadge: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  pulseBadgeText: { fontSize: 11.5, fontWeight: '800' },
  pulseDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
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
  timelineDate: { fontSize: 12, fontWeight: '700', color: colors.brand },
  timelineLabel: { fontSize: 14, color: colors.text, marginTop: 2 },
});
