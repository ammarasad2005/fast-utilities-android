import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { deptAccent, deptAccentBg } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchRegularSchedule } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import { groupByDay, sortByChronological } from '@/core/exams';
import type { ExamEntry } from '@/core/types';
import { getDaysUntil } from '@/core/dates';
import { Dropdown } from '@/components/Dropdown';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '@/components/ui';

const BUNDLES_KEY = 'custom:exam_bundles';

interface Row {
  id: string;
  batch: string;
  dept: string;
  code: string;
}

interface Bundle {
  id: string;
  name: string;
  rows: Row[];
}

let rowCounter = 0;
function makeRow(batch: string): Row {
  return { id: `row-${Date.now()}-${rowCounter++}`, batch, dept: '', code: '' };
}

export default function CustomExamsScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { data: allExams, isLoading, isRefreshing, error, refresh } = useCachedData<ExamEntry[]>(
    'data:regular_schedule',
    fetchRegularSchedule,
    CACHE_TTL.schedule
  );

  const batches = useMemo(
    () => (allExams ? [...new Set(allExams.map((e) => e.batch))].sort().reverse() : []),
    [allExams]
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  // Load saved bundles on mount.
  useEffect(() => {
    AsyncStorage.getItem(BUNDLES_KEY)
      .then((raw) => {
        if (raw) setBundles(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  const persistBundles = (next: Bundle[]) => {
    setBundles(next);
    AsyncStorage.setItem(BUNDLES_KEY, JSON.stringify(next)).catch(() => {});
  };

  const deptsFor = (batch: string) =>
    batch
      ? [...new Set((allExams ?? []).filter((e) => e.batch === batch).map((e) => e.department))].sort()
      : [];

  const codesFor = (batch: string, dept: string) =>
    batch && dept
      ? [...new Set((allExams ?? []).filter((e) => e.batch === batch && e.department === dept).map((e) => e.courseCode))].sort()
      : [];

  const matched = useMemo(() => {
    const out: ExamEntry[] = [];
    for (const r of rows) {
      if (!r.batch || !r.dept || !r.code) continue;
      for (const e of allExams ?? []) {
        if (e.batch === r.batch && e.department === r.dept && e.courseCode === r.code) {
          out.push(e);
        }
      }
    }
    return sortByChronological(out);
  }, [rows, allExams]);

  const grouped = useMemo(() => groupByDay(matched), [matched]);

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, makeRow(batches[0] ?? '')]);
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const saveBundle = () => {
    if (rows.length === 0) return;
    const bundle: Bundle = {
      id: `b-${Date.now()}`,
      name: `Bundle ${bundles.length + 1}`,
      rows: rows.map((r) => ({ ...r })),
    };
    persistBundles([...bundles, bundle]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  const loadBundle = (b: Bundle) => {
    setRows(b.rows.map((r) => ({ ...r, id: `row-${Date.now()}-${rowCounter++}` })));
    setShowSaved(false);
  };

  const deleteBundle = (id: string) => persistBundles(bundles.filter((b) => b.id !== id));

  const copyAll = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const text = matched
      .map((e) => `${e.courseCode} — ${e.courseName}\n${e.date} · ${e.time}`)
      .join('\n\n');
    await Clipboard.setStringAsync(text);
  };

  if (isLoading) return <LoadingState label="Loading exam schedule…" />;
  if (!allExams || error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Custom Exam Schedule" subtitle="Combine exams from any courses" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {/* Saved bundles */}
        <SectionHeader
          title="Saved bundles"
          right={
            <Text style={styles.linkText} onPress={() => setShowSaved((s) => !s)}>
              {showSaved ? 'Hide' : `View (${bundles.length})`}
            </Text>
          }
        />
        {showSaved ? (
          bundles.length === 0 ? (
            <Text style={styles.noneText}>No saved bundles yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {bundles.map((b) => (
                <View key={b.id} style={styles.bundleRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => loadBundle(b)}>
                    <Text style={styles.bundleName}>{b.name}</Text>
                    <Text style={styles.bundleMeta}>{b.rows.length} course{b.rows.length !== 1 ? 's' : ''}</Text>
                  </Pressable>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} onPress={() => deleteBundle(b.id)} />
                </View>
              ))}
            </View>
          )
        ) : null}

        {/* Course rows */}
        <SectionHeader title="Add courses" />
        {rows.length === 0 ? (
          <EmptyState icon="add-circle-outline" title="No courses yet" message="Add a course to start building your custom schedule." />
        ) : (
          <View style={{ gap: 12 }}>
            {rows.map((row, idx) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>Course {idx + 1}</Text>
                  <Ionicons name="close" size={20} color={colors.textTertiary} onPress={() => removeRow(row.id)} />
                </View>

                <Text style={styles.fieldLabel}>Batch</Text>
                <Dropdown
                  value={row.batch}
                  placeholder="Select batch"
                  options={batches.map((b) => ({ value: b, label: b }))}
                  onSelect={(b) => updateRow(row.id, { batch: b, dept: '', code: '' })}
                />

                <Text style={styles.fieldLabel}>Department</Text>
                <Dropdown
                  value={row.dept || null}
                  placeholder="Select department"
                  options={deptsFor(row.batch).map((d) => ({ value: d, label: d }))}
                  onSelect={(d) => updateRow(row.id, { dept: d, code: '' })}
                />

                <Text style={styles.fieldLabel}>Course code</Text>
                <Dropdown
                  value={row.code || null}
                  placeholder="Select course code"
                  options={codesFor(row.batch, row.dept).map((c) => ({ value: c, label: c }))}
                  onSelect={(c) => updateRow(row.id, { code: c })}
                />
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={addRow} style={styles.addBtn}>
          <Ionicons name="add" size={18} color={colors.brand} />
          <Text style={styles.addBtnText}>Add course</Text>
        </Pressable>

        {rows.length > 0 ? (
          <Pressable onPress={saveBundle} style={styles.saveBtn}>
            <Ionicons name="bookmark-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.saveBtnText}>Save as bundle</Text>
          </Pressable>
        ) : null}

        {/* Results */}
        <SectionHeader
          title={`Your schedule · ${matched.length} exam${matched.length === 1 ? '' : 's'}`}
          right={matched.length ? <Text style={styles.linkText} onPress={copyAll}>Copy all</Text> : null}
        />
        {matched.length === 0 ? (
          <EmptyState icon="document-text-outline" title="No exams match" message="Select at least one course with a valid code." />
        ) : (
          grouped.map((g) => (
            <View key={g.label}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{g.label}</Text>
              </View>
              {g.entries.map((e, i) => (
                <CustomExamRow key={`${e.courseCode}-${i}`} exam={e} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function CustomExamRow({ exam }: { exam: ExamEntry }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const days = getDaysUntil(exam.date);
  const countdown = days === null ? null : days > 0 ? `${days}d` : days === 0 ? 'Today' : `${Math.abs(days)}d ago`;
  return (
    <View style={[styles.examCard, { borderLeftColor: deptAccent[exam.department] ?? colors.brand }]}>
      <View style={{ flex: 1 }}>
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
        <Text style={styles.examMeta}>{exam.time}</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  linkText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  noneText: { color: colors.textTertiary, fontSize: 13, marginBottom: 8 },
  bundleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
  },
  bundleName: { fontSize: 14, fontWeight: '700', color: colors.text },
  bundleMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rowCard: {
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    borderStyle: 'dashed',
    marginTop: 14,
  },
  addBtnText: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 10,
  },
  saveBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  dayHeader: { marginTop: 8, marginBottom: 8 },
  dayLabel: { fontSize: 13, fontWeight: '700', color: colors.brand, letterSpacing: 0.4 },
  examCard: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: 14,
    marginBottom: 8,
  },
  examTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  codeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeText: { fontSize: 12, fontWeight: '700' },
  countdownBadge: { backgroundColor: colors.successBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  countdownText: { fontSize: 12, fontWeight: '700', color: colors.success },
  examName: { fontSize: 15, fontWeight: '600', color: colors.text },
  examMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
});
