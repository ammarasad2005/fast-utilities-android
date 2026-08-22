import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { deptAccent, deptAccentBg } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { formatTimeRange } from '@/core/timetable';
import type { TimetableEntry } from '@/core/types';

/**
 * Horizontal day-column grid view of a weekly schedule.
 * Shared by the Timetable tab and the Custom Timetable screen.
 */
export function ScheduleGrid({
  grouped,
  todayName,
}: {
  grouped: { day: string; entries: TimetableEntry[] }[];
  todayName?: string;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.gridRow}>
        {grouped.map((g) => (
          <View key={g.day} style={[styles.gridCol, g.day === todayName && styles.gridColToday]}>
            <View style={styles.gridDayHeader}>
              <Text style={styles.gridDayName}>{g.day.slice(0, 3).toUpperCase()}</Text>
              {g.day === todayName ? <Text style={styles.gridTodayText}>TODAY</Text> : null}
            </View>
            {g.entries.map((e, i) => {
              const deptKey = e.department.split('/')[0];
              return (
                <View
                  key={`${e.courseName}-${e.room}-${i}`}
                  style={[
                    styles.gridCell,
                    {
                      backgroundColor: deptAccentBg[deptKey] ?? colors.subtle,
                      borderLeftColor: deptAccent[deptKey] ?? colors.brand,
                    },
                  ]}
                >
                  <Text style={styles.gridCellCourse} numberOfLines={2}>
                    {e.courseName}
                  </Text>
                  <Text style={styles.gridCellTime}>{formatTimeRange(e.time)}</Text>
                  <Text style={styles.gridCellRoom} numberOfLines={1}>
                    {e.room}
                  </Text>
                </View>
              );
            })}
            {g.entries.length === 0 ? <Text style={styles.gridEmpty}>—</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    gridRow: { flexDirection: 'row', gap: 8 },
    gridCol: { width: 148, borderRadius: 12, paddingBottom: 8 },
    gridColToday: { backgroundColor: colors.infoBg },
    gridDayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4 },
    gridDayName: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
    gridTodayText: { fontSize: 9, fontWeight: '800', color: colors.brand },
    gridCell: {
      borderRadius: 10,
      borderLeftWidth: 3,
      padding: 10,
      marginBottom: 6,
    },
    gridCellCourse: { fontSize: 12, fontWeight: '700', color: colors.text },
    gridCellTime: { fontSize: 10, color: colors.textSecondary, marginTop: 3 },
    gridCellRoom: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
    gridEmpty: { textAlign: 'center', color: colors.textTertiary, paddingVertical: 12 },
  });
