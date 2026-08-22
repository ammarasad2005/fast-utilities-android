import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { deptAccent, deptAccentBg } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { formatISODateShort, parseTimeRange } from '@/core/dates';
import type { TimetableEntry } from '@/core/types';

/**
 * True week-grid timetable: a time axis (08:30–17:20) × day columns, with
 * class cells positioned by start time and sized proportionally to their
 * duration — the same model the website's weekly grid / PNG export uses.
 */

// ── Layout constants (mirroring the web export's geometry, scaled for phones) ─
const DAY_START_MIN = 8 * 60 + 30; // 08:30
const DAY_END_MIN = 17 * 60 + 20; // 17:20
const DAY_SPAN_MIN = DAY_END_MIN - DAY_START_MIN; // 530
const PX_PER_MIN = 1.2;
const GRID_HEIGHT = DAY_SPAN_MIN * PX_PER_MIN; // ~636
const TIME_COL_WIDTH = 48;
const DAY_COL_WIDTH = 150;

const HOUR_MARKERS = [
  { min: 8 * 60 + 30, label: '08:30' },
  { min: 10 * 60, label: '10:00' },
  { min: 11 * 60 + 30, label: '11:30' },
  { min: 13 * 60, label: '01:00' },
  { min: 14 * 60 + 30, label: '02:30' },
  { min: 15 * 60 + 55, label: '03:55' },
  { min: 17 * 60 + 20, label: '05:20' },
];

export interface WeekGridDay {
  dayName: string; // 'Monday'
  isoDate?: string; // '2026-08-17'
  entries: TimetableEntry[];
  /** 'today' | 'tomorrow' | null — badge to show on this column. */
  badge: 'today' | 'tomorrow' | null;
}

export function WeekGrid({ days }: { days: WeekGridDay[] }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {/* Day header row */}
        <View style={styles.headerRow}>
          <View style={{ width: TIME_COL_WIDTH }} />
          {days.map((d) => (
            <View
              key={d.dayName}
              style={[styles.dayHeader, d.badge ? { backgroundColor: colors.infoBg } : null]}
            >
              <Text style={styles.dayHeaderText}>
                {d.dayName.slice(0, 3).toUpperCase()}
                {d.isoDate ? <Text style={styles.dayHeaderDate}>{`  ${formatISODateShort(d.isoDate)}`}</Text> : null}
              </Text>
              {d.badge ? (
                <Text style={styles.dayHeaderBadge}>{d.badge === 'today' ? 'TODAY' : 'TOMORROW'}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={styles.bodyRow}>
          {/* Time axis */}
          <View style={[styles.timeCol, { width: TIME_COL_WIDTH }]}>
            {HOUR_MARKERS.map((m, i) => {
              const top = (m.min - DAY_START_MIN) * PX_PER_MIN;
              const adjustedTop = i === 0 ? 0 : i === HOUR_MARKERS.length - 1 ? GRID_HEIGHT - 12 : top - 6;
              return (
                <Text key={m.label} style={[styles.timeLabel, { top: adjustedTop }]}>
                  {m.label}
                </Text>
              );
            })}
          </View>

          {/* Day columns */}
          {days.map((d) => (
            <View
              key={d.dayName}
              style={[styles.dayCol, { width: DAY_COL_WIDTH }, d.badge ? { backgroundColor: colors.infoBg } : null]}
            >
              {/* Hour gridlines */}
              {HOUR_MARKERS.map((m) => (
                <View
                  key={m.label}
                  style={[styles.gridLine, { top: (m.min - DAY_START_MIN) * PX_PER_MIN }]}
                />
              ))}

              {/* Class cells — positioned by start time, height ∝ duration */}
              {d.entries.map((e, i) => {
                const { start, end } = parseTimeRange(e.time);
                const startMin = start || DAY_START_MIN;
                const endMin = end || startMin + 80;
                const top = Math.max(0, (startMin - DAY_START_MIN) * PX_PER_MIN);
                const height = Math.min(Math.max((endMin - startMin) * PX_PER_MIN - 4, 40), GRID_HEIGHT - top - 4);
                const deptKey = e.department.split('/')[0];
                const accent = deptAccent[deptKey] ?? colors.brand;
                const bg = deptAccentBg[deptKey] ?? colors.subtle;
                const isLab = e.type === 'lab';
                const cancelled = e.cancelled;
                return (
                  <View
                    key={`${e.courseName}-${e.time}-${i}`}
                    style={[
                      styles.cell,
                      {
                        top: top + 2,
                        height,
                        backgroundColor: isLab ? colors.successBg : bg,
                        borderLeftColor: accent,
                      },
                      cancelled && { opacity: 0.55 },
                    ]}
                  >
                    <Text
                      style={[styles.cellCourse, cancelled && styles.cellCancelled]}
                      numberOfLines={height < 60 ? 1 : 3}
                    >
                      {e.courseName}
                    </Text>
                    {height >= 44 ? (
                      <Text style={styles.cellMeta} numberOfLines={1}>
                        {e.section}
                        {e.room && e.room !== 'TBA' ? ` · ${e.room}` : ''}
                      </Text>
                    ) : null}
                    {height >= 60 ? (
                      <View style={styles.cellBadgeRow}>
                        {isLab ? <Text style={[styles.cellBadge, { color: colors.success }]}>LAB</Text> : null}
                        {cancelled ? <Text style={[styles.cellBadge, { color: colors.danger }]}>CANCELLED</Text> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}
              {d.entries.length === 0 ? <Text style={styles.emptyCol}>—</Text> : null}
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    headerRow: { flexDirection: 'row' },
    dayHeader: {
      width: DAY_COL_WIDTH,
      paddingVertical: 8,
      paddingHorizontal: 6,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayHeaderText: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5 },
    dayHeaderDate: { fontSize: 10, fontWeight: '600', color: colors.textTertiary },
    dayHeaderBadge: { fontSize: 9, fontWeight: '800', color: colors.brand, letterSpacing: 0.6, marginTop: 2 },
    bodyRow: { flexDirection: 'row', height: GRID_HEIGHT },
    timeCol: {
      position: 'relative',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      backgroundColor: colors.bg,
    },
    timeLabel: {
      position: 'absolute',
      right: 6,
      fontSize: 9,
      fontWeight: '700',
      color: colors.textTertiary,
    },
    dayCol: {
      position: 'relative',
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
    },
    gridLine: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    cell: {
      position: 'absolute',
      left: 4,
      right: 4,
      borderRadius: 8,
      borderLeftWidth: 3,
      paddingHorizontal: 6,
      paddingVertical: 4,
      overflow: 'hidden',
    },
    cellCourse: { fontSize: 11, fontWeight: '700', color: colors.text },
    cellCancelled: { textDecorationLine: 'line-through' },
    cellMeta: { fontSize: 9.5, color: colors.textSecondary, marginTop: 2 },
    cellBadgeRow: { flexDirection: 'row', gap: 4, marginTop: 3 },
    cellBadge: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4 },
    emptyCol: { position: 'absolute', top: 8, alignSelf: 'center', color: colors.textTertiary, fontSize: 12 },
  });
