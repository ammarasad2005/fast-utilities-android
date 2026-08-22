import React, { useMemo } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/theme/colors';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchSemesterCalendar } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import {
  getUpcomingKeyDates,
  formatKeyDateRange,
  daysUntil,
  getSemesterProgress,
  getSemesterMilestones,
  getSemesterWeekNumber,
} from '@/core/semester';
import type { SemesterCalendar } from '@/core/types';

type Feature = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
};

const FEATURES: Feature[] = [
  { id: 'exams', title: 'Exam Finder', description: 'Every exam date & time for your batch and department.', icon: 'document-text', route: '/(tabs)/exams' },
  { id: 'timetable', title: 'Timetable', description: 'Your full weekly schedule — courses, rooms, timings.', icon: 'calendar', route: '/(tabs)/timetable' },
  { id: 'rooms', title: 'Free Rooms', description: 'Find empty classrooms and labs for any time slot.', icon: 'location', route: '/(tabs)/rooms' },
  { id: 'faculty', title: 'Faculty Info', description: 'Emails, offices and details for all faculty.', icon: 'people', route: '/faculty' },
  { id: 'semester', title: 'Semester Schedule', description: 'Academic calendar — key dates, sessionals, finals.', icon: 'flag', route: '/semester' },
  { id: 'events', title: 'Campus Events', description: 'Seminars, drives and activities in one calendar.', icon: 'sparkles', route: '/events' },
];

// green → amber → red (mirrors the web app's timeline bar)
function interpolateColor(pct: number): string {
  if (pct <= 0) return '#18A36B';
  if (pct >= 100) return '#D94A59';
  const stops = [
    { p: 0, r: 0x18, g: 0xa3, b: 0x6b },
    { p: 50, r: 0xdc, g: 0xa1, b: 0x2d },
    { p: 100, r: 0xd9, g: 0x4a, b: 0x59 },
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (pct >= a.p && pct <= b.p) {
      const t = (pct - a.p) / (b.p - a.p);
      const r = Math.round(a.r + (b.r - a.r) * t);
      const g = Math.round(a.g + (b.g - a.g) * t);
      const bl = Math.round(a.b + (b.b - a.b) * t);
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
    }
  }
  return '#18A36B';
}

export default function HomeScreen() {
  const router = useRouter();
  const { data: calendar } = useCachedData<SemesterCalendar>(
    'data:semester',
    fetchSemesterCalendar,
    CACHE_TTL.semester
  );

  const next = calendar ? getUpcomingKeyDates(calendar, 1)[0] : null;

  const timeline = useMemo(() => {
    if (!calendar) return null;
    const progress = getSemesterProgress(calendar);
    const week = getSemesterWeekNumber(calendar);
    const milestones = getSemesterMilestones(calendar);
    if (progress == null) return null;
    const pct = Math.max(0, Math.min(100, progress));
    return { pct, week, milestones, color: interpolateColor(pct) };
  }, [calendar]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Image source={require('../../assets/images/icon.png')} style={styles.logo} />
          <View style={styles.headerText}>
            <Text style={styles.brand}>FAST NUCES · ISB</Text>
            <Text style={styles.tagline}>Your campus, at a glance.</Text>
          </View>
        </View>

        {/* Semester banner (tap → semester schedule) */}
        {calendar ? (
          <Pressable
            onPress={() => router.push('/semester')}
            android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
            style={({ pressed }) => [styles.semesterBanner, pressed && { opacity: 0.92 }]}
          >
            <View style={styles.semesterRow}>
              <Ionicons name="school" size={18} color="#fff" />
              <Text style={styles.semesterName}>{calendar.semester}</Text>
              <View style={{ flex: 1 }} />
              <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
            </View>
            {next ? (
              <View style={styles.nextRow}>
                <Text style={styles.nextLabel}>NEXT · {next.label}</Text>
                <Text style={styles.nextDate}>
                  {formatKeyDateRange(next)}
                  {daysUntil(next.date) >= 0 ? ` · in ${daysUntil(next.date)}d` : ''}
                </Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {/* Thin semester timeline */}
        {timeline ? (
          <View style={styles.timelineCard}>
            <View style={styles.timelineMeta}>
              <Text style={styles.timelineWeek}>
                {timeline.week ? `Week ${timeline.week}` : 'Semester progress'}
              </Text>
              <Text style={styles.timelinePct}>{Math.round(timeline.pct)}%</Text>
            </View>
            <View style={styles.timelineTrack}>
              <View
                style={[
                  styles.timelineFill,
                  { width: `${timeline.pct}%`, backgroundColor: timeline.color },
                ]}
              />
              {timeline.milestones.map((m) => (
                <View
                  key={m.shortLabel}
                  style={[styles.timelineMarker, { left: `${m.progressPercent}%` }]}
                >
                  <View style={[styles.timelineDot, { backgroundColor: timeline.color }]} />
                  <Text style={styles.timelineMarkerLabel}>{m.shortLabel}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Feature grid */}
        <Text style={styles.sectionLabel}>FEATURES</Text>
        <View style={styles.grid}>
          {FEATURES.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => router.push(f.route as any)}
              android_ripple={{ color: colors.border }}
              style={({ pressed }) => [styles.featureCard, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon} size={22} color={colors.brand} />
              </View>
              <Text style={styles.featureTitle}>{f.title}</Text>
              <Text style={styles.featureDesc} numberOfLines={2}>
                {f.description}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Footer */}
        <Pressable onPress={() => router.push('/about')} style={styles.aboutLink}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.aboutText}>About this app</Text>
        </Pressable>
        <Text style={styles.footerNote}>FAST NUCES · Islamabad Campus</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  logo: { width: 48, height: 48, borderRadius: 12 },
  headerText: { flex: 1 },
  brand: { fontSize: 20, fontWeight: '800', color: colors.brand, letterSpacing: -0.3 },
  tagline: { fontSize: 13, color: colors.textSecondary },
  semesterBanner: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  semesterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  semesterName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  nextRow: { marginTop: 10 },
  nextLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  nextDate: { color: '#fff', fontSize: 13, marginTop: 2 },
  timelineCard: {
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 4,
  },
  timelineMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  timelineWeek: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.4 },
  timelinePct: { fontSize: 12, fontWeight: '800', color: colors.text },
  timelineTrack: {
    position: 'relative',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.subtle,
    marginBottom: 14,
  },
  timelineFill: { height: 6, borderRadius: 3 },
  timelineMarker: { position: 'absolute', top: -3, alignItems: 'center', marginLeft: -4 },
  timelineDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.raised },
  timelineMarkerLabel: { fontSize: 9, fontWeight: '800', color: colors.textSecondary, marginTop: 3 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  featureCard: {
    width: '48.2%',
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.infoBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  featureTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  featureDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  aboutLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 24, alignSelf: 'center' },
  aboutText: { color: colors.textSecondary, fontSize: 13 },
  footerNote: { textAlign: 'center', color: colors.textTertiary, fontSize: 11, marginTop: 6 },
});
