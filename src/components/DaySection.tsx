import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStyles, type ThemeColors } from '@/theme/ThemeContext';

/**
 * A day's schedule section (list mode). When the day is the effective
 * today/tomorrow the section gets the web app's "boundary covering"
 * treatment: a prominent bordered, tinted, elevated card with a corner
 * TODAY/TOMORROW ribbon — making the current day apparently visibly
 * prominent against the quiet style of the other days.
 *
 * `badge` follows WeekPlan semantics: 'today' | 'tomorrow' | null.
 */
export function DaySection({
  dayName,
  dateStr,
  badge,
  isMakeup = false,
  classCount,
  children,
}: {
  dayName: string;
  dateStr?: string;
  badge: 'today' | 'tomorrow' | null;
  isMakeup?: boolean;
  classCount: number;
  children: React.ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const active = badge !== null;
  const badgeLabel = badge === 'tomorrow' ? 'TOMORROW' : 'TODAY';

  if (!active) {
    return (
      <View style={styles.plainWrap}>
        <View style={styles.plainHeader}>
          <Text style={styles.plainDay}>
            {dayName.toUpperCase()}
            {isMakeup ? ' (MKP)' : ''}
            {dateStr ? ` ${dateStr.toUpperCase()}` : ''}
          </Text>
          <Text style={styles.plainCount}>
            {classCount} {classCount === 1 ? 'class' : 'classes'}
          </Text>
        </View>
        {children}
      </View>
    );
  }

  return (
    <View style={styles.activeCard}>
      {/* Corner ribbon — like the web's gradient tab */}
      <View style={styles.ribbon}>
        <Text style={styles.ribbonText}>{badgeLabel}</Text>
      </View>

      <Text style={styles.activeHeader}>
        {badgeLabel} ({dayName.toUpperCase()}
        {isMakeup ? ' (MAKEUP)' : ''}
        {dateStr ? ` ${dateStr.toUpperCase()}` : ''})
      </Text>

      {classCount === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No classes scheduled for today</Text>
        </View>
      ) : (
        children
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    plainWrap: { marginBottom: 12 },
    plainHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
      paddingTop: 4,
    },
    plainDay: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
      color: colors.textTertiary,
    },
    plainCount: { fontSize: 12, color: colors.textTertiary },

    // ── Highlighted (today/tomorrow) day — the web's bordered card ──────────
    activeCard: {
      marginBottom: 14,
      borderRadius: 16,
      borderWidth: 2.5,
      borderColor: colors.brand,
      backgroundColor: colors.infoBg,
      padding: 14,
      paddingTop: 26,
      // elevation so it lifts off the page like the web's shadow-2xl
      shadowColor: colors.brand,
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
      overflow: 'hidden',
    },
    ribbon: {
      position: 'absolute',
      top: 0,
      right: 0,
      backgroundColor: colors.brand,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderBottomLeftRadius: 12,
    },
    ribbonText: {
      color: colors.onBrand,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 2,
    },
    activeHeader: {
      fontSize: 13,
      fontWeight: '800',
      letterSpacing: 1,
      color: colors.text,
      marginBottom: 12,
    },
    emptyBox: {
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingVertical: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: { fontSize: 13, fontStyle: 'italic', color: colors.textSecondary },
  });
