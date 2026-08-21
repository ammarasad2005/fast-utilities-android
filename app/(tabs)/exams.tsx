import React, { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, deptAccent, deptAccentBg } from '@/theme/colors';
import { useCachedData } from '@/hooks/useCachedData';
import { usePref } from '@/hooks/usePref';
import { fetchRegularSchedule } from '@/api/endpoints';
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
  const [school, setSchool] = usePref(PREF_KEYS.examSchool, 'FSC');
  const [batch, setBatch] = usePref(PREF_KEYS.examBatch, '');
  const [dept, setDept] = usePref(PREF_KEYS.examDept, '');
  const [query, setQuery] = useState('');

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

const styles = StyleSheet.create({
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
});
