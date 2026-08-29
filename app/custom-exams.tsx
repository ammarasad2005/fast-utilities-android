import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { deptAccent, deptAccentBg } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchExamVisibility, fetchRegularSchedule } from '@/api/endpoints';
import { exportExamsPng } from '@/api/exportImage';
import { CACHE_TTL } from '@/api/config';
import { courseGroupsForExams, groupByDay, matchExamRows } from '@/core/exams';
import type { ExamEntry } from '@/core/types';
import { getDaysUntil } from '@/core/dates';
import {
  clearSavedExams,
  describeSavedExams,
  getSavedExams,
  setSavedExams,
  type SavedExams,
} from '@/prefs/savedExams';
import {
  CUSTOM_EXAMS_NAME,
  loadExamBundles,
  migrateExamBundlesToSingle,
  saveExamBundles,
  type ExamBundleRow,
  type ExamCustomBundle,
} from '@/prefs/examBundles';
import { syncExamWidgetsFromCache } from '@/widgets/examWidgets';
import { syncSemesterWidgetFromCache } from '@/widgets/semesterWidgets';
import { CourseSectionSelect } from '@/components/CourseSectionSelect';
import { Dropdown } from '@/components/Dropdown';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '@/components/ui';

type Row = ExamBundleRow;
type Bundle = ExamCustomBundle;

let rowCounter = 0;
function makeRow(batch: string, dept = ''): Row {
  return { id: `row-${Date.now()}-${rowCounter++}`, batch, dept, selection: '' };
}

const SCHOOL_CHOICES = [
  { key: 'FSC', label: 'FSC · Computing' },
  { key: 'FSM', label: 'FSM · Management' },
  { key: 'FSE', label: 'FSE · Engineering' },
] as const;

export default function CustomExamsScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { data: allExams, isLoading, isRefreshing, error, refresh } = useCachedData<ExamEntry[]>(
    'data:regular_schedule',
    fetchRegularSchedule,
    CACHE_TTL.schedule
  );

  // ── Screen state ──────────────────────────────────────────────────────────
  // Single-slot model (mirrors the custom timetable): at most ONE custom exam
  // schedule exists at a time. 'auto' resolves on focus: saved → view; else build.
  const [mode, setMode] = useState<'auto' | 'build' | 'view'>('auto');
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [savedExams, setSavedExamsState] = useState<SavedExams | null>(null);
  // Post-save "keep as your exam preference?" benefits prompt.
  const [prefPromptOpen, setPrefPromptOpen] = useState(false);

  // Builder state
  const [school, setSchool] = useState<string>('FSC');
  const [rows, setRows] = useState<Row[]>([]);
  const [exporting, setExporting] = useState(false);
  const [semesterName, setSemesterName] = useState<string | null>(null);

  useEffect(() => {
    fetchExamVisibility()
      .then((v) => setSemesterName(v.semester_name ?? null))
      .catch(() => {});
  }, []);

  // Mirror of `mode` for the focus handler (stays stable across re-focuses).
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // Collapse any legacy multi-bundle state to the single slot first.
        await migrateExamBundlesToSingle();
        const list = await loadExamBundles();
        const pref = await getSavedExams();
        if (cancelled) return;
        setBundles(list);
        setSavedExamsState(pref);
        if (modeRef.current !== 'auto') return;
        const target = list[0] ?? null;
        if (target) {
          setActiveBundleId(target.id);
          setMode('view');
        } else {
          setRows((prev) => (prev.length > 0 ? prev : [makeRow('')]));
          setMode('build');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const persistBundles = (next: Bundle[]) => {
    setBundles(next);
    saveExamBundles(next);
  };

  const activeBundle = bundles.find((b) => b.id === activeBundleId) ?? null;

  const batches = useMemo(
    () =>
      [...new Set((allExams ?? []).filter((e) => e.school === school).map((e) => e.batch))]
        .sort()
        .reverse(),
    [allExams, school]
  );

  const deptsFor = useCallback(
    (batch: string) =>
      batch
        ? [
            ...new Set(
              (allExams ?? [])
                .filter((e) => e.school === school && e.batch === batch)
                .map((e) => e.department)
            ),
          ].sort()
        : [],
    [allExams, school]
  );

  /** Courses for a row grouped by name with codes inline — the same grouped
   *  sheet the timetable builder uses (exams have no sections; chips = codes). */
  const courseGroupsFor = useCallback(
    (batch: string, dept: string) =>
      courseGroupsForExams(allExams ?? [], school, batch, dept),
    [allExams, school]
  );

  // The schedule currently displayed: builder rows in build mode, bundle rows in view mode.
  const matched = useMemo(() => {
    const rs = mode === 'view' && activeBundle ? activeBundle.rows : rows;
    const sk = mode === 'view' && activeBundle ? activeBundle.school : school;
    return matchExamRows(allExams ?? [], rs, sk);
  }, [mode, activeBundle, rows, school, allExams]);

  const grouped = useMemo(() => groupByDay(matched), [matched]);

  // ── Builder actions ───────────────────────────────────────────────────────
  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** New rows inherit the previous row's batch AND department (parity w/ timetable builder). */
  const addRow = () =>
    setRows((prev) => {
      const last = prev[prev.length - 1];
      const defaultBatch = last?.batch ?? batches[0] ?? '';
      const defaultDept = last?.dept ?? '';
      return [...prev, makeRow(defaultBatch, defaultDept)];
    });

  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const switchSchool = (next: string) => {
    if (next === school) return;
    const hasWork = rows.some((r) => r.batch || r.dept || r.selection);
    const apply = () => {
      setSchool(next);
      setRows([makeRow('')]);
      setEditingBundleId(null);
    };
    if (hasWork) {
      Alert.alert(
        'Switch school?',
        'Exam schedules are built per school. Switching clears the courses you are adding.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch', onPress: apply },
        ]
      );
    } else {
      apply();
    }
  };

  const startFreshBuild = () => {
    setEditingBundleId(null);
    setRows([makeRow(batches[0] ?? '')]);
    setActiveBundleId(null);
    setMode('build');
  };

  /**
   * Single-slot save: overwrites the one custom exam schedule (keeping its id
   * so an existing exam-preference tag stays valid), then offers the exam
   * preference tag — unless already tagged.
   */
  const saveCustom = () => {
    const complete = rows.filter((r) => r.batch && r.dept && r.selection);
    if (complete.length === 0) return;
    const existing = bundles[0] ?? null;
    const bundle: Bundle = {
      id: existing?.id ?? (editingBundleId ?? `b-${Date.now()}`),
      name: CUSTOM_EXAMS_NAME,
      school,
      rows: complete.map((r) => ({ ...r })),
    };
    persistBundles([bundle]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setActiveBundleId(bundle.id);
    setEditingBundleId(null);
    setMode('view');
    void syncExamWidgetsFromCache();
    void syncSemesterWidgetFromCache();
    if (!(savedExams?.kind === 'bundle' && savedExams.bundleId === bundle.id)) {
      setPrefPromptOpen(true);
    }
  };

  const editBundle = (b: Bundle) => {
    setSchool(b.school);
    setRows(b.rows.map((r) => ({ ...r, id: `row-${Date.now()}-${rowCounter++}` })));
    setEditingBundleId(b.id);
    setActiveBundleId(b.id);
    setMode('build');
  };

  const deleteCustom = async (b: Bundle) => {
    Alert.alert(
      'Delete custom exam schedule?',
      'Your saved custom exam schedule will be removed permanently. You can then build a new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            persistBundles([]);
            if (savedExams?.kind === 'bundle' && savedExams.bundleId === b.id) {
              await clearSavedExams();
              setSavedExamsState(await getSavedExams());
            }
            startFreshBuild();
            void syncExamWidgetsFromCache();
            void syncSemesterWidgetFromCache();
          },
        },
      ]
    );
  };

  // ── Exam preference tag actions (separate from the timetable tag) ─────────
  const isBundleTagged = (id: string) =>
    savedExams?.kind === 'bundle' && savedExams.bundleId === id;

  const tagThisCustom = async (b: Bundle) => {
    await setSavedExams({ kind: 'bundle', bundleId: b.id });
    setSavedExamsState(await getSavedExams());
    void syncExamWidgetsFromCache();
    void syncSemesterWidgetFromCache();
  };

  const toggleTag = async (b: Bundle) => {
    Haptics.selectionAsync().catch(() => {});
    if (isBundleTagged(b.id)) {
      await clearSavedExams();
      setSavedExamsState(await getSavedExams());
      void syncExamWidgetsFromCache();
      void syncSemesterWidgetFromCache();
      return;
    }
    if (savedExams) {
      // The single exam-tag rule: something else (usually the default
      // selection on the Exams tab) already holds it — surface that.
      const holder = describeSavedExams(savedExams);
      Alert.alert(
        'An exam preference is already saved',
        `Your exam preference is currently ${holder}. A preference must be removed before another can take its place.`,
        [
          { text: 'Keep current', style: 'cancel' },
          {
            text: 'Remove & use this',
            onPress: async () => {
              await clearSavedExams();
              await tagThisCustom(b);
            },
          },
        ]
      );
      return;
    }
    await tagThisCustom(b);
  };

  // ── Export / copy ─────────────────────────────────────────────────────────
  const onExport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExporting(true);
    try {
      const uri = await exportExamsPng(matched, {
        isCustom: true,
        semesterName: semesterName ?? undefined,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share exam schedule' });
      }
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

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
      <ScreenHeader
        title="Custom Exam Schedule"
        subtitle={
          mode === 'view' && activeBundle
            ? 'Your custom exam schedule'
            : 'Combine exams from any courses in one school'
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {/* Custom exam schedule bar (view mode) — actions for the single slot.
            Building "new" is only possible after deleting this one. */}
        {mode === 'view' && activeBundle ? (
          <>
            <View style={styles.bundleBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bundleBarName}>My exam schedule</Text>
                <Text style={styles.bundleBarMeta}>
                  {activeBundle.school} · {activeBundle.rows.length} course
                  {activeBundle.rows.length !== 1 ? 's' : ''}
                  {isBundleTagged(activeBundle.id) ? ' · Saved as preference' : ''}
                </Text>
              </View>
              <Pressable onPress={() => toggleTag(activeBundle)} hitSlop={6} style={styles.bundleBarAction}>
                <Ionicons
                  name={isBundleTagged(activeBundle.id) ? 'bookmark' : 'bookmark-outline'}
                  size={18}
                  color={colors.brand}
                />
              </Pressable>
              <Pressable onPress={() => editBundle(activeBundle)} hitSlop={6} style={styles.bundleBarAction}>
                <Ionicons name="create-outline" size={18} color={colors.brand} />
                <Text style={styles.bundleBarActionText}>Edit</Text>
              </Pressable>
              <Pressable onPress={() => deleteCustom(activeBundle)} hitSlop={6} style={styles.bundleBarAction}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
            <Pressable onPress={() => deleteCustom(activeBundle)} style={styles.deleteLink}>
              <Text style={styles.deleteLinkText}>Delete this exam schedule to build a different one</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Builder (rows only visible when building/editing) ── */}
        {mode === 'build' ? (
          <>
            <SectionHeader title={editingBundleId ? 'Edit your exam schedule' : 'Add courses'} />

            {/* School: exam schedules are built per school — departments never mix. */}
            <Text style={styles.fieldLabel}>School</Text>
            <View style={styles.chipRow}>
              {SCHOOL_CHOICES.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => switchSchool(s.key)}
                  style={[styles.schoolChip, school === s.key && styles.schoolChipActive]}
                >
                  <Text style={[styles.schoolChipText, school === s.key && { color: colors.onBrand }]}>
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {rows.map((row, idx) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>Course {idx + 1}</Text>
                  {rows.length > 1 ? (
                    <Ionicons name="close" size={20} color={colors.textTertiary} onPress={() => removeRow(row.id)} />
                  ) : null}
                </View>

                <Text style={styles.fieldLabel}>Batch</Text>
                <Dropdown
                  value={row.batch || null}
                  placeholder="Select batch"
                  options={batches.map((b) => ({ value: b, label: b }))}
                  onSelect={(b) => updateRow(row.id, { batch: b, dept: '', selection: '' })}
                />

                <Text style={styles.fieldLabel}>Department</Text>
                <Dropdown
                  value={row.dept || null}
                  placeholder="Select department"
                  options={deptsFor(row.batch).map((d) => ({ value: d, label: d }))}
                  onSelect={(d) => updateRow(row.id, { dept: d, selection: '' })}
                />

                <Text style={styles.fieldLabel}>Course</Text>
                <CourseSectionSelect
                  value={row.selection || null}
                  placeholder={row.dept ? 'Select course' : 'Select department first'}
                  groups={courseGroupsFor(row.batch, row.dept)}
                  onSelect={(s) => updateRow(row.id, { selection: s })}
                  disabled={!row.dept}
                />
              </View>
            ))}

            <Pressable onPress={addRow} style={styles.addBtn}>
              <Ionicons name="add" size={18} color={colors.brand} />
              <Text style={styles.addBtnText}>Add course</Text>
            </Pressable>

            {rows.some((r) => r.batch && r.dept && r.selection) ? (
              <Pressable onPress={saveCustom} style={styles.primarySave}>
                <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                <Text style={styles.primarySaveText}>
                  {editingBundleId ? 'Save changes' : 'Save'}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {/* ── Results ── */}
        <SectionHeader
          title={`Your schedule · ${matched.length} exam${matched.length === 1 ? '' : 's'}`}
          right={
            matched.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Text style={styles.linkText} onPress={copyAll}>Copy all</Text>
                <Pressable onPress={onExport} style={styles.exportBtn} disabled={exporting}>
                  <Ionicons name="share-outline" size={15} color={colors.brand} />
                  <Text style={styles.exportText}>{exporting ? 'Exporting…' : 'Export'}</Text>
                </Pressable>
              </View>
            ) : null
          }
        />
        {matched.length === 0 ? (
          <EmptyState
            icon="document-text-outline"
            title="No exams match"
            message={
              mode === 'view'
                ? 'Your custom exam schedule no longer matches any exams in the current data.'
                : 'Select at least one course to see its exam.'
            }
          />
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

      {/* Post-save: offer to make this the exam preference (separate from the
          timetable tag — exam widgets read this one). */}
      <Modal
        visible={prefPromptOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPrefPromptOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPrefPromptOpen(false)}>
          <Pressable style={styles.nameSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <Text style={styles.nameTitle}>KEEP AS YOUR EXAM PREFERENCE?</Text>
            <Text style={styles.nameHint}>
              Saved — your custom exam schedule is kept on this device.{'\n\n'}
              Keep it as your exam preference and it will also power:{'\n'}
              {'  •  '}the exam countdown / next-exam home-screen widgets{'\n'}
              {'  •  '}your personal exam list widget{'\n\n'}
              It is managed separately from your timetable preference — one does
              not replace the other.
            </Text>
            <View style={styles.nameActions}>
              <Pressable onPress={() => setPrefPromptOpen(false)} style={styles.nameCancel}>
                <Text style={styles.nameCancelText}>Not now</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setPrefPromptOpen(false);
                  const b = bundles[0] ?? null;
                  if (b) void toggleTag(b);
                }}
                style={styles.nameSave}
              >
                <Text style={styles.nameSaveText}>Keep as preference</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
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
  deleteLink: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 2 },
  deleteLinkText: { fontSize: 11, fontWeight: '600', color: colors.danger },
  bundleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  bundleBarName: { fontSize: 15, fontWeight: '700', color: colors.brand },
  bundleBarMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  bundleBarAction: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  bundleBarActionText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  schoolChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  schoolChipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  schoolChipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.brand },
  exportText: { color: colors.brand, fontWeight: '700', fontSize: 12 },
  rowCard: {
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
    marginBottom: 12,
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
  },
  addBtnText: { color: colors.brand, fontWeight: '700', fontSize: 15 },
  primarySave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: colors.brand,
  },
  primarySaveText: { fontSize: 15, fontWeight: '700', color: colors.onBrand },
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
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: 10,
    marginBottom: 10,
  },
  nameSheet: {
    backgroundColor: colors.raised,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  nameTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1.2 },
  nameHint: { fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: 12, lineHeight: 19 },
  nameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  nameCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  nameCancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  nameSave: { backgroundColor: colors.brand, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  nameSaveText: { color: colors.onBrand, fontWeight: '700', fontSize: 14 },
});
