import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { deptAccent, deptAccentBg } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { usePref } from '@/hooks/usePref';
import { fetchExamVisibility, fetchRegularSchedule } from '@/api/endpoints';
import { CACHE_TTL, PREF_KEYS } from '@/api/config';
import {
  filterExams,
  groupByDay,
  sortByChronological,
} from '@/core/exams';
import { SCHOOL_DEPARTMENTS, SCHOOLS, type ExamEntry } from '@/core/types';
import { getDaysUntil } from '@/core/dates';
import { Chip, EmptyState, ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';

export default function ExamsScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const [school, setSchool] = usePref(PREF_KEYS.examSchool, 'FSC');
  const [batch, setBatch] = usePref(PREF_KEYS.examBatch, '');
  const [dept, setDept] = usePref(PREF_KEYS.examDept, '');
  const [query, setQuery] = useState('');

  // Admin-controlled visibility (from Supabase, resolved server-side).
  const [showExams, setShowExams] = useState<boolean | null>(null);
  const loadVisibility = useCallback(async () => {
    try {
      const v = await fetchExamVisibility();
      setShowExams(v.show_exams ?? false);
    } catch {
      setShowExams(false); // default hidden, matching the web client
    }
  }, []);
  useEffect(() => {
    // Fetching external state (admin toggle) — async, so no synchronous setState.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadVisibility();
  }, [loadVisibility]);

  const { data: allExams, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<ExamEntry[]>('data:regular_schedule', fetchRegularSchedule, CACHE_TTL.schedule);

  const batches = useMemo(
    () => (allExams ? [...new Set(allExams.map((e) => e.batch))].sort().reverse() : []),
    [allExams]
  );
  const departments = useMemo(() => SCHOOL_DEPARTMENTS[school] ?? [], [school]);

  // Ensure the selected batch/dept are valid for the current data.
  const effectiveBatch = batches.includes(batch) ? batch : batches[0] ?? '';
  const effectiveDept = departments.includes(dept) ? dept : departments[0] ?? '';

  const filtered = useMemo(() => {
    if (!allExams) return [];
    return sortByChronological(
      filterExams(allExams, {
        batch: effectiveBatch,
        school,
        department: effectiveDept,
        query,
      })
    );
  }, [allExams, effectiveBatch, school, effectiveDept, query]);

  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const onCopy = async (e: ExamEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(`${e.courseCode} — ${e.courseName}\n${e.date} · ${e.time}`);
  };

  // Visibility gate (admin-controlled): show placeholder while exams are hidden.
  if (showExams === null) return <LoadingState label="Checking exam availability…" />;
  if (!showExams) {
    return (
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={{ padding: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={loadVisibility} tintColor={colors.brand} />
          }
        >
          <Text style={styles.title}>Exam Finder</Text>
          <Text style={styles.subtitle}>Every exam date &amp; time for your batch and department.</Text>
          <View style={styles.noExamsWrap}>
            <View style={styles.noExamsIcon}>
              <Ionicons name="document-text-outline" size={40} color={colors.textTertiary} />
              <View style={styles.noExamsClock}>
                <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
              </View>
            </View>
            <Text style={styles.noExamsTitle}>No exams right now</Text>
            <Text style={styles.noExamsBody}>
              {"Exam schedules haven't been published yet for this semester. Check back closer to exam week — we'll have your full schedule ready as soon as it's announced."}
            </Text>
            <View style={styles.noExamsTip}>
              <Ionicons name="book-outline" size={18} color={colors.info} />
              <Text style={styles.noExamsTipText}>
                {"Stay focused on your classes — we'll notify you when exams go live."}
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (isLoading) return <LoadingState label="Loading exam schedule…" />;
  if (!allExams || error) {
    return <ErrorState message={error ?? undefined} onRetry={refresh} />;
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <Text style={styles.title}>Exam Finder</Text>
        <Text style={styles.subtitle}>Every exam date & time for your batch and department.</Text>

        <Pressable
          onPress={() => router.push('/custom-exams')}
          android_ripple={{ color: colors.border }}
          style={({ pressed }) => [styles.customCard, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.customIcon}>
            <Ionicons name="construct-outline" size={20} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.customTitle}>Custom exam schedule</Text>
            <Text style={styles.customDesc}>Combine exams from any courses you choose.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
        </Pressable>

        {isFromCache ? (
          <View style={{ marginTop: 12 }}>
            <OfflineNotice cached />
          </View>
        ) : null}

        {/* School */}
        <SectionHeader title="School" />
        <View style={styles.chipRow}>
          {SCHOOLS.map((s) => (
            <Chip key={s} label={s} active={school === s} onPress={() => { setSchool(s); setDept(''); }} />
          ))}
        </View>

        {/* Batch */}
        <SectionHeader title="Batch" />
        <View style={styles.chipRow}>
          {batches.map((b) => (
            <Chip key={b} label={b} active={effectiveBatch === b} onPress={() => setBatch(b)} />
          ))}
        </View>

        {/* Department */}
        <SectionHeader title="Department" />
        <View style={styles.chipRow}>
          {departments.map((d) => (
            <Chip
              key={d}
              label={d}
              active={effectiveDept === d}
              color={deptAccent[d]}
              onPress={() => setDept(d)}
            />
          ))}
        </View>

        {/* Search */}
        <SectionHeader title="Search" />
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search by course code or name"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
          />
          {query ? (
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} onPress={() => setQuery('')} />
          ) : null}
        </View>

        {/* Results */}
        <SectionHeader title={`${filtered.length} exam${filtered.length === 1 ? '' : 's'}`} />

        {filtered.length === 0 ? (
          <EmptyState icon="search-outline" title="No exams found" message="Try a different batch, department or search term." />
        ) : (
          grouped.map((g) => (
            <View key={g.label}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{g.label}</Text>
              </View>
              {g.entries.map((e, i) => (
                <ExamRow key={`${e.courseCode}-${i}`} exam={e} onCopy={() => onCopy(e)} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ExamRow({ exam, onCopy }: { exam: ExamEntry; onCopy: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const days = getDaysUntil(exam.date);
  const countdown =
    days === null ? null : days > 0 ? `${days}d` : days === 0 ? 'Today' : `${Math.abs(days)}d ago`;

  return (
    <View style={[styles.examCard, { borderLeftColor: deptAccent[exam.department] ?? colors.brand }]}>
      <View style={styles.examMain}>
        <View style={styles.examTopRow}>
          <View style={[styles.codeBadge, { backgroundColor: deptAccentBg[exam.department] ?? colors.infoBg }]}>
            <Text style={[styles.codeText, { color: deptAccent[exam.department] ?? colors.brand }]}>
              {exam.courseCode}
            </Text>
          </View>
          {countdown ? (
            <View style={styles.countdownBadge}>
              <Text style={styles.countdownText}>{countdown}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.examName}>{exam.courseName}</Text>
        <View style={styles.examMetaRow}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.examMeta}>{exam.time}</Text>
        </View>
      </View>
      <Ionicons
        name="copy-outline"
        size={18}
        color={colors.textTertiary}
        onPress={onCopy}
        hitSlop={8}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: colors.text },
  dayHeader: { marginTop: 8, marginBottom: 8 },
  dayLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.brand,
    letterSpacing: 0.4,
  },
  examCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 8,
  },
  examMain: { flex: 1 },
  examTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  codeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeText: { fontSize: 12, fontWeight: '700' },
  countdownBadge: { backgroundColor: colors.successBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  countdownText: { fontSize: 12, fontWeight: '700', color: colors.success },
  examName: { fontSize: 15, fontWeight: '600', color: colors.text },
  examMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  examMeta: { fontSize: 13, color: colors.textSecondary },
  noExamsWrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 },
  noExamsIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  noExamsClock: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noExamsTitle: { fontSize: 24, fontWeight: '800', color: colors.text },
  noExamsBody: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 10,
    maxWidth: 320,
  },
  noExamsTip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.infoBg,
  },
  noExamsTipText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  customCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginTop: 16,
  },
  customIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: colors.infoBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  customDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
});
