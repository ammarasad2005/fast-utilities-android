import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchFSCTimetable, fetchFSMTimetable, fetchSemesterCalendar } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import {
  getUpcomingKeyDates,
  formatKeyDateRange,
  daysUntil,
  getSemesterProgress,
  getSemesterMilestones,
  getSemesterWeekNumber,
  getSemesterStartDate,
} from '@/core/semester';
import {
  computeDisplayedEntries,
  EMPTY_DISPLAY_PREFS,
  flattenTimetable,
  matchCustomRows,
  type DisplayPrefs,
} from '@/core/timetable';
import { computeClassStatus } from '@/core/liveClass';
import { resolveWeekPlan } from '@/core/weekPlan';
import { TIMETABLE_META_KEY, type RawTimetableJSON, type SemesterCalendar, type TimetableEntry } from '@/core/types';
import { NextClassCard } from '@/components/NextClassCard';
import { getSavedSchedule, type SavedSchedule } from '@/prefs/savedSchedule';
import { loadBundles, type CustomBundle } from '@/prefs/bundles';
import { buildSnapshot, publishNextClassWidget } from '@/widgets/nextClassWidget';

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
  const styles = useStyles(makeStyles);
  const { colors, theme, themes, setThemeId } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
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

  // ── Live class tracking (port of the web's DesktopTicker) ──────────────────
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000); // 30s refresh
    return () => clearInterval(timer);
  }, []);

  const fsc = useCachedData<RawTimetableJSON>('data:timetable:FSC', fetchFSCTimetable, CACHE_TTL.timetable);
  const fsm = useCachedData<RawTimetableJSON>('data:timetable:FSM', fetchFSMTimetable, CACHE_TTL.timetable);
  const entriesBySchool = useMemo(() => {
    const map: Record<string, TimetableEntry[]> = {};
    if (fsc.data) map.FSC = flattenTimetable(fsc.data);
    if (fsm.data) map.FSM = flattenTimetable(fsm.data);
    return map;
  }, [fsc.data, fsm.data]);

  // The tagged "my timetable" (default config or a custom bundle) + its prefs.
  // Reloaded on every focus so tagging then returning home updates the card.
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  const [bundles, setBundles] = useState<CustomBundle[]>([]);
  const [resultPrefs, setResultPrefs] = useState<DisplayPrefs>(EMPTY_DISPLAY_PREFS);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setNow(new Date());
      (async () => {
        const spref = await getSavedSchedule();
        const bl = await loadBundles();
        if (!active) return;
        setSaved(spref);
        setBundles(bl);
        if (spref?.kind === 'default') {
          const scope = `${spref.school}:${spref.batch}:${spref.dept}:${spref.section}`;
          try {
            const rawRaw = await AsyncStorage.getItem(`pref:resultprefs:${scope}`);
            if (!active) return;
            const parsed = rawRaw ? JSON.parse(rawRaw) : null;
            setResultPrefs({
              sectionByCourse: parsed?.sectionByCourse ?? {},
              pickedElectives: parsed?.pickedElectives ?? [],
            });
          } catch {
            if (active) setResultPrefs(EMPTY_DISPLAY_PREFS);
          }
        } else if (active) {
          setResultPrefs(EMPTY_DISPLAY_PREFS);
        }
      })();
      return () => {
        active = false;
      };
    }, [])
  );

  const liveSchool =
    saved?.kind === 'bundle'
      ? bundles.find((b) => b.id === saved.bundleId)?.school ?? null
      : saved?.kind === 'default'
        ? saved.school
        : null;
  const liveRaw = liveSchool === 'FSM' ? fsm.data : liveSchool === 'FSC' ? fsc.data : null;

  const myEntries = useMemo((): TimetableEntry[] => {
    if (!saved || !liveSchool) return [];
    const entries = entriesBySchool[liveSchool] ?? [];
    if (!entries.length) return [];
    if (saved.kind === 'bundle') {
      const bundle = bundles.find((b) => b.id === saved.bundleId);
      return bundle ? matchCustomRows(entries, bundle.rows) : [];
    }
    return computeDisplayedEntries(
      entries,
      { batch: saved.batch, department: saved.dept, section: saved.section },
      resultPrefs
    );
  }, [saved, liveSchool, entriesBySchool, bundles, resultPrefs]);

  const livePlan = useMemo(
    () =>
      liveRaw
        ? resolveWeekPlan(liveRaw[TIMETABLE_META_KEY]?.days, {
            semesterStartISO: getSemesterStartDate(calendar ?? null),
          })
        : null,
    [liveRaw, calendar]
  );

  const classStatus = useMemo(
    () => (livePlan ? computeClassStatus(myEntries, livePlan, now) : null),
    [myEntries, livePlan, now]
  );
  const classLoading =
    !!saved && !liveRaw && (liveSchool === 'FSM' ? fsm.isLoading : fsc.isLoading);

  // Keep the home-screen widget in lock-step with the card (30s tick).
  // Skipped while the timetable is still loading so we don't flash a
  // transient "none" state on the widget.
  useEffect(() => {
    if (classLoading) return;
    publishNextClassWidget(buildSnapshot(classStatus, livePlan, !saved, now));
  }, [classStatus, livePlan, saved, classLoading, now]);

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
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setPickerOpen(true);
            }}
            hitSlop={10}
            accessibilityLabel="Change app theme"
            style={({ pressed }) => [styles.themeBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="color-palette-outline" size={20} color={colors.brand} />
          </Pressable>
        </View>

        {/* Bento row: compressed semester cards (left) + live class tracker (right) */}
        <View style={styles.bentoRow}>
          <View style={styles.bentoLeft}>
            {/* Semester banner, compressed: full milestone label becomes
                "NEXT ACADEMIC MILESTONE" (spec) — the date line stays as-is. */}
            {calendar ? (
              <Pressable
                onPress={() => router.push('/semester')}
                android_ripple={{ color: 'rgba(255,255,255,0.15)' }}
                style={({ pressed }) => [styles.semesterBanner, styles.bentoBanner, pressed && { opacity: 0.92 }]}
              >
                <View style={styles.semesterRow}>
                  <Ionicons name="school" size={15} color={colors.onBrand} />
                  <Text style={styles.semesterNameCompact} numberOfLines={1}>
                    {calendar.semester}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.onBrand} style={{ opacity: 0.7 }} />
                </View>
                {next ? (
                  <View style={styles.nextRowCompact}>
                    <Text style={styles.nextLabelCompact}>NEXT ACADEMIC MILESTONE</Text>
                    <Text style={styles.nextDateCompact} numberOfLines={1}>
                      {formatKeyDateRange(next)}
                      {daysUntil(next.date) >= 0 ? ` · in ${daysUntil(next.date)}d` : ''}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ) : null}

            {/* Thin semester timeline, compressed */}
            {timeline ? (
              <View style={styles.timelineCardCompact}>
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
          </View>

          {/* Right column: next / ongoing class (spans both left cards) */}
          <NextClassCard
            status={classStatus}
            plan={livePlan}
            needsTag={!saved}
            loading={classLoading}
            onPress={() => router.push('/(tabs)/timetable' as any)}
          />
        </View>

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

      {/* Theme picker */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>APP THEME</Text>
            {themes.map((t) => {
              const active = t.id === theme.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => {
                    if (!active) {
                      Haptics.selectionAsync().catch(() => {});
                      setThemeId(t.id);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.themeRow,
                    active && styles.themeRowActive,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.swatchRow}>
                    {t.swatches.map((s) => (
                      <View key={s} style={[styles.swatch, { backgroundColor: s }]} />
                    ))}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.themeName}>{t.label}</Text>
                    <Text style={styles.themeTagline}>{t.tagline}</Text>
                  </View>
                  {active ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  logo: { width: 48, height: 48, borderRadius: 12 },
  headerText: { flex: 1 },
  brand: { fontSize: 20, fontWeight: '800', color: colors.brand, letterSpacing: -0.3 },
  tagline: { fontSize: 13, color: colors.textSecondary },
  bentoRow: { flexDirection: 'row', gap: 10, marginBottom: 10, alignItems: 'stretch' },
  bentoLeft: { flex: 1.04, gap: 10 },
  semesterBanner: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  semesterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bentoBanner: { marginBottom: 0, padding: 12, flex: 1 },
  semesterNameCompact: { color: colors.onBrand, fontSize: 14, fontWeight: '700', flex: 1 },
  nextRowCompact: { marginTop: 8 },
  nextLabelCompact: { color: colors.onBrand, opacity: 0.75, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  nextDateCompact: { color: colors.onBrand, fontSize: 12.5, marginTop: 3, fontWeight: '600' },
  timelineCardCompact: {
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    flex: 1,
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
  themeBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: colors.raised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  pickerHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: 10,
    marginBottom: 10,
  },
  pickerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  themeRowActive: { backgroundColor: colors.subtle },
  swatchRow: {
    flexDirection: 'row',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  swatch: { width: 16, height: 32 },
  themeName: { fontSize: 15, fontWeight: '700', color: colors.text },
  themeTagline: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
});
