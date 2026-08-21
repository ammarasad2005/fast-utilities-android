import React from 'react';
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
import { getUpcomingKeyDates, formatKeyDateRange, daysUntil } from '@/core/semester';
import type { SemesterCalendar } from '@/core/types';

type Feature = {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  tab?: string;
};

const FEATURES: Feature[] = [
  { id: 'exams', title: 'Exam Finder', description: 'Every exam date & time for your batch and department.', icon: 'document-text', route: '/(tabs)/exams' },
  { id: 'timetable', title: 'Timetable', description: 'Your full weekly schedule — courses, rooms, timings.', icon: 'calendar', route: '/(tabs)/timetable' },
  { id: 'rooms', title: 'Free Rooms', description: 'Find empty classrooms and labs for any time slot.', icon: 'location', route: '/(tabs)/rooms' },
  { id: 'faculty', title: 'Faculty Info', description: 'Emails, offices and details for all faculty.', icon: 'people', route: '/faculty' },
  { id: 'semester', title: 'Semester Schedule', description: 'Academic calendar — key dates, sessionals, finals.', icon: 'flag', route: '/semester' },
  { id: 'events', title: 'Campus Events', description: 'Seminars, drives and activities in one calendar.', icon: 'sparkles', route: '/events' },
];

export default function HomeScreen() {
  const router = useRouter();
  const { data: calendar } = useCachedData<SemesterCalendar>(
    'data:semester',
    fetchSemesterCalendar,
    CACHE_TTL.semester
  );

  const next = calendar ? getUpcomingKeyDates(calendar, 1)[0] : null;

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

        {/* Semester banner */}
        {calendar ? (
          <View style={styles.semesterBanner}>
            <View style={styles.semesterRow}>
              <Ionicons name="school" size={18} color="#fff" />
              <Text style={styles.semesterName}>{calendar.semester}</Text>
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
    marginBottom: 8,
  },
  semesterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  semesterName: { color: '#fff', fontSize: 17, fontWeight: '700' },
  nextRow: { marginTop: 10 },
  nextLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  nextDate: { color: '#fff', fontSize: 13, marginTop: 2 },
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
