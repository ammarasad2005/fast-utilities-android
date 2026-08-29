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
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchExamVisibility, fetchFSCTimetable, fetchFSMTimetable, fetchSemesterCalendar, type ExamVisibility } from '@/api/endpoints';
import { exportTimetablePng } from '@/api/exportImage';
import { CACHE_TTL } from '@/api/config';
import {
  clearSavedSchedule,
  describeSavedSchedule,
  getSavedSchedule,
  setSavedSchedule,
  type SavedSchedule,
} from '@/prefs/savedSchedule';
import {
  detectConflicts,
  flattenTimetable,
  formatTimeRange,
  groupByDayTimetable,
  makeKey,
  matchCustomRows,
} from '@/core/timetable';
import { TIMETABLE_META_KEY, type RawTimetableJSON, type SemesterCalendar, type TimetableEntry } from '@/core/types';
import { getSemesterStartDate } from '@/core/semester';
import { attachEntries, resolveWeekPlan } from '@/core/weekPlan';
import {
  CUSTOM_TIMETABLE_NAME,
  loadBundles,
  migrateBundlesToSingle,
  saveBundles,
  type BundleRow,
  type CustomBundle,
} from '@/prefs/bundles';
import { DaySection } from '@/components/DaySection';
import { Dropdown } from '@/components/Dropdown';
import { CourseSectionSelect } from '@/components/CourseSectionSelect';
import { ScreenHeader } from '@/components/ScreenHeader';
import { WeekGrid, type WeekGridDay } from '@/components/WeekGrid';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '@/components/ui';

const CATEGORIES = ['regular', 'repeat'] as const;
const CATEGORY_LABELS: Record<string, string> = { regular: 'Regular', repeat: 'Repeat' };

// Shared shapes + storage live in prefs/bundles (the Home card reads them too)
type Row = BundleRow;
type Bundle = CustomBundle;

let counter = 0;
function makeRow(batch: string, dept = ''): Row {
  return { id: `row-${Date.now()}-${counter++}`, batch, dept, category: 'regular', selection: '' };
}



export default function CustomTimetableScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const fsc = useCachedData<RawTimetableJSON>('data:timetable:FSC', fetchFSCTimetable, CACHE_TTL.timetable);
  const fsm = useCachedData<RawTimetableJSON>('data:timetable:FSM', fetchFSMTimetable, CACHE_TTL.timetable);
  const { data: visibility } = useCachedData<ExamVisibility>(
    'data:exam_visibility',
    fetchExamVisibility,
    CACHE_TTL.schedule
  );
  const semesterName = visibility?.semester_name ?? undefined;
  const { data: calendar } = useCachedData<SemesterCalendar>(
    'data:semester',
    fetchSemesterCalendar,
    CACHE_TTL.semester
  );

  const entriesBySchool = useMemo(() => {
    const map: Record<string, TimetableEntry[]> = {};
    if (fsc.data) map.FSC = flattenTimetable(fsc.data);
    if (fsm.data) map.FSM = flattenTimetable(fsm.data);
    return map;
  }, [fsc.data, fsm.data]);

  const isLoading = fsc.isLoading || fsm.isLoading;
  const isRefreshing = fsc.isRefreshing || fsm.isRefreshing;
  const error = fsc.error || fsm.error;
  const refresh = () => {
    fsc.refresh();
    fsm.refresh();
  };

  // ── Screen state ────────────────────────────────────────────────────────────
  // Single-slot model: at most ONE custom timetable exists at a time.
  // 'auto' resolves on focus: saved custom timetable → view; else build.
  const [mode, setMode] = useState<'auto' | 'build' | 'view'>('auto');
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  // Post-save "keep as your preference?" benefits prompt.
  const [prefPromptOpen, setPrefPromptOpen] = useState(false);

  // Builder state
  const [school, setSchool] = useState<string>('FSC');
  const [rows, setRows] = useState<Row[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [exporting, setExporting] = useState(false);

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
        await migrateBundlesToSingle();
        const list = await loadBundles();
        const spref = await getSavedSchedule();
        if (cancelled) return;
        setBundles(list);
        setSaved(spref);
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
    saveBundles(next);
  };

  const activeBundle = bundles.find((b) => b.id === activeBundleId) ?? null;
  const buildEntries = useMemo(() => entriesBySchool[school] ?? [], [entriesBySchool, school]);

  const batches = useMemo(
    () => [...new Set(buildEntries.map((e) => e.batch))].sort().reverse(),
    [buildEntries]
  );

  const deptsFor = useCallback(
    (batch: string) =>
      batch ? [...new Set(buildEntries.filter((e) => e.batch === batch).map((e) => e.department))].sort() : [],
    [buildEntries]
  );

  /** Courses for a row grouped by name: course once, sections in sheet
   *  order — feeds the grouped course+section sheet. */
  const courseGroupsFor = useCallback(
    (batch: string, dept: string, category: string) => {
      if (!batch || !dept) return [];
      const map = new Map<string, Set<string>>();
      for (const e of buildEntries) {
        if (e.batch === batch && e.department === dept && e.category === category) {
          if (!map.has(e.courseName)) map.set(e.courseName, new Set());
          map.get(e.courseName)!.add(e.section);
        }
      }
      return [...map.entries()]
        .map(([courseName, secs]) => ({
          courseName,
          sections: [...secs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        }))
        .sort((a, b) => a.courseName.localeCompare(b.courseName));
    },
    [buildEntries]
  );

  /** Match a set of builder rows against a school's entries → concrete classes. */
  const matchedFor = useCallback(
    (rs: Row[], schoolKey: string): TimetableEntry[] =>
      matchCustomRows(entriesBySchool[schoolKey] ?? [], rs),
    [entriesBySchool]
  );

  // The schedule currently displayed: builder rows in build mode, bundle rows in view mode.
  const matched = useMemo(() => {
    const rs = mode === 'view' && activeBundle ? activeBundle.rows : rows;
    const sk = mode === 'view' && activeBundle ? activeBundle.school : school;
    return matchedFor(rs, sk);
  }, [matchedFor, mode, activeBundle, rows, school]);
  const conflicts = useMemo(() => detectConflicts(matched), [matched]);
  const grouped = useMemo(() => groupByDayTimetable(matched), [matched]);

  // Same week resolution as the main timetable (web parity): rolling dates for
  // the effective-today week, today pinned first, TODAY/TOMORROW badge.
  const activeSchool = mode === 'view' && activeBundle ? activeBundle.school : school;
  const activeRaw = activeSchool === 'FSM' ? fsm.data : fsc.data;
  const weekPlan = useMemo(
    () =>
      resolveWeekPlan(activeRaw?.[TIMETABLE_META_KEY]?.days, {
        semesterStartISO: getSemesterStartDate(calendar ?? null),
      }),
    [activeRaw, calendar]
  );
  const dayItems = useMemo(
    () => attachEntries(weekPlan, new Map(grouped.map((g) => [g.day, g.entries]))),
    [weekPlan, grouped]
  );
  const gridDays = useMemo<WeekGridDay[]>(
    () =>
      dayItems.map((s) => ({
        dayName: s.day,
        sheetName: s.sheetName,
        isoDate: s.isoDate,
        entries: s.entries,
        badge: s.isToday ? (weekPlan.tomorrowPreview ? 'tomorrow' : 'today') : null,
      })),
    [dayItems, weekPlan.tomorrowPreview]
  );

  // ── Builder actions ─────────────────────────────────────────────────────────
  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  /** New rows inherit the previous row's batch AND department (iii). */
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
    };
    if (hasWork) {
      Alert.alert(
        'Switch school?',
        'Timetables are built per school. Switching clears the classes you are adding.',
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
   * Single-slot save: overwrites the one custom timetable (keeping its id so
   * an existing preference tag stays valid), then offers the preference tag
   * with a clear description of what it unlocks — unless already tagged.
   */
  const saveCustom = () => {
    if (rows.length === 0) return;
    const existing = bundles[0] ?? null;
    const bundle: Bundle = {
      id: existing?.id ?? (editingBundleId ?? `b-${Date.now()}`),
      name: CUSTOM_TIMETABLE_NAME,
      school,
      rows: rows.map((r) => ({ ...r })),
    };
    persistBundles([bundle]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setActiveBundleId(bundle.id);
    setEditingBundleId(null);
    setMode('view');
    if (!(saved?.kind === 'bundle' && saved.bundleId === bundle.id)) {
      setPrefPromptOpen(true);
    }
  };

  const editBundle = (b: Bundle) => {
    setSchool(b.school);
    setRows(b.rows.map((r) => ({ ...r, id: `row-${Date.now()}-${counter++}` })));
    setEditingBundleId(b.id);
    setActiveBundleId(b.id);
    setMode('build');
  };

  const deleteCustom = async (b: Bundle) => {
    Alert.alert(
      'Delete custom timetable?',
      'Your saved custom timetable will be removed permanently. You can then build a new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            persistBundles([]);
            if (saved?.kind === 'bundle' && saved.bundleId === b.id) {
              await clearSavedSchedule();
              setSaved(await getSavedSchedule());
            }
            startFreshBuild();
          },
        },
      ]
    );
  };

  // ── Preference tag actions ──────────────────────────────────────────────────
  const isBundleTagged = (id: string) => saved?.kind === 'bundle' && saved.bundleId === id;

  const tagThisCustom = async (b: Bundle) => {
    await setSavedSchedule({ kind: 'bundle', bundleId: b.id });
    setSaved(await getSavedSchedule());
  };

  const toggleTag = async (b: Bundle) => {
    Haptics.selectionAsync().catch(() => {});
    if (isBundleTagged(b.id)) {
      await clearSavedSchedule();
      setSaved(await getSavedSchedule());
      return;
    }
    if (saved) {
      // The single-tag rule: something else (usually the default config on
      // the Timetable tab) already holds it — surface that, offer to move.
      const holder = describeSavedSchedule(saved);
      Alert.alert(
        'A preference is already saved',
        `Your preference is currently ${holder}. A preference must be removed before another can take its place.`,
        [
          { text: 'Keep current', style: 'cancel' },
          {
            text: 'Remove & use this',
            onPress: async () => {
              await clearSavedSchedule();
              await tagThisCustom(b);
            },
          },
        ]
      );
      return;
    }
    await tagThisCustom(b);
  };

  // ── Export (ix) — server-rendered PNG, custom layout ────────────────────────
  const onExport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExporting(true);
    try {
      const uri = await exportTimetablePng(matched, { isCustom: true, semesterName });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share timetable' });
      }
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return <LoadingState label="Loading timetables…" />;
  if ((fsc.error && fsm.error) || Object.keys(entriesBySchool).length === 0) {
    return <ErrorState message={error ?? undefined} onRetry={refresh} />;
  }

  const conflictCount = conflicts.size;
  const canBuildFSC = !!entriesBySchool.FSC;
  const canBuildFSM = !!entriesBySchool.FSM;

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title="Custom Timetable"
        subtitle={
          mode === 'view' && activeBundle
            ? 'Your custom timetable'
            : 'Build a clash-checked schedule'
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {/* Custom timetable bar (view mode) — actions for the single slot.
            Building "new" is only possible after deleting this one. */}
        {mode === 'view' && activeBundle ? (
          <>
            <View style={styles.bundleBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bundleBarName}>My custom timetable</Text>
                <Text style={styles.bundleBarMeta}>
                  {activeBundle.school} · {activeBundle.rows.length} class{activeBundle.rows.length !== 1 ? 'es' : ''}
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
              <Text style={styles.deleteLinkText}>Delete this timetable to build a different one</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Builder (rows only visible when building/editing — vii) ── */}
        {mode === 'build' ? (
          <>
            <SectionHeader title={editingBundleId ? 'Edit your custom timetable' : 'Add classes'} />

            {/* School (ii): timetables are built per school — departments never mix. */}
            <Text style={styles.fieldLabel}>School</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => switchSchool('FSC')}
                disabled={!canBuildFSC}
                style={[styles.schoolChip, school === 'FSC' && styles.schoolChipActive, !canBuildFSC && { opacity: 0.4 }]}
              >
                <Text style={[styles.schoolChipText, school === 'FSC' && { color: colors.onBrand }]}>
                  FSC · Computing
                </Text>
              </Pressable>
              <Pressable
                onPress={() => switchSchool('FSM')}
                disabled={!canBuildFSM}
                style={[styles.schoolChip, school === 'FSM' && styles.schoolChipActive, !canBuildFSM && { opacity: 0.4 }]}
              >
                <Text style={[styles.schoolChipText, school === 'FSM' && { color: colors.onBrand }]}>
                  FSM · Management
                </Text>
              </Pressable>
            </View>

            {rows.map((row, idx) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>Class {idx + 1}</Text>
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

                <Text style={styles.fieldLabel}>Type</Text>
                <Dropdown
                  value={row.category}
                  placeholder="Select type"
                  options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
                  onSelect={(c) => updateRow(row.id, { category: c, selection: '' })}
                />

                <Text style={styles.fieldLabel}>Course &amp; section</Text>
                <CourseSectionSelect
                  value={row.selection || null}
                  placeholder={row.dept ? 'Select course & section' : 'Select dept first'}
                  groups={courseGroupsFor(row.batch, row.dept, row.category)}
                  onSelect={(s) => updateRow(row.id, { selection: s })}
                  disabled={!row.dept}
                />
              </View>
            ))}

            <Pressable onPress={addRow} style={styles.addBtn}>
              <Ionicons name="add" size={18} color={colors.brand} />
              <Text style={styles.addBtnText}>Add class</Text>
            </Pressable>

            {rows.length > 0 ? (
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
        <View style={styles.viewModeRow}>
          <SectionHeader
            title={`Your timetable · ${matched.length} class${matched.length === 1 ? '' : 'es'}`}
          />
          {conflictCount > 0 ? (
            <View style={styles.conflictBadge}>
              <Ionicons name="warning" size={13} color={colors.danger} />
              <Text style={styles.conflictBadgeText}>{conflictCount} clash{conflictCount > 1 ? 'es' : ''}</Text>
            </View>
          ) : null}
        </View>

        {matched.length > 0 ? (
          <View style={styles.resultTools}>
            <View style={styles.segmented}>
              {(['list', 'grid'] as const).map((v) => (
                <Pressable key={v} onPress={() => setViewMode(v)} style={[styles.segment, viewMode === v && styles.segmentActive]}>
                  <Ionicons name={v === 'list' ? 'list' : 'grid'} size={15} color={viewMode === v ? colors.onBrand : colors.textSecondary} />
                  <Text style={[styles.segmentText, viewMode === v && { color: colors.onBrand }]}>
                    {v === 'list' ? 'List' : 'Grid'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={onExport} style={styles.exportBtn} disabled={exporting}>
              <Ionicons name="share-outline" size={15} color={colors.brand} />
              <Text style={styles.exportText}>{exporting ? 'Exporting…' : 'Export'}</Text>
            </Pressable>
          </View>
        ) : null}

        {matched.length === 0 ? (
          <EmptyState
            icon="calendar-outline"
            title="No classes match"
            message={mode === 'view' ? 'Your custom timetable no longer matches any classes in the current data.' : 'Select at least one course with a valid section.'}
          />
        ) : viewMode === 'list' ? (
          dayItems.map((s) => (
            <DaySection
              key={s.sheetName}
              dayName={s.day}
              dateStr={s.dateStr}
              isMakeup={s.isMakeup}
              badge={s.isToday ? (weekPlan.tomorrowPreview ? 'tomorrow' : 'today') : null}
              classCount={s.entries.length}
            >
              {s.entries.map((e, i) => (
                <CustomClassRow
                  key={`${e.courseName}-${e.room}-${i}`}
                  entry={e}
                  conflict={conflicts.has(makeKey(e))}
                />
              ))}
            </DaySection>
          ))
        ) : (
          <WeekGrid days={gridDays} />
        )}
      </ScrollView>

      {/* Post-save: offer to make this the preference (the "tag"), and tell
          the user exactly what the preference unlocks. */}
      <Modal
        visible={prefPromptOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPrefPromptOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPrefPromptOpen(false)}>
          <Pressable style={styles.nameSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <Text style={styles.nameTitle}>KEEP AS YOUR PREFERENCE?</Text>
            <Text style={styles.nameHint}>
              Saved — your custom timetable is kept on this device.{'\n\n'}
              Keep it as your preference and it will also power:{'\n'}
              {'  •  '}the next / ongoing class card on Home{'\n'}
              {'  •  '}the home-screen widget{'\n'}
              {'  •  '}class-change alerts (if enabled){'\n'}
              {'  •  '}opening automatically when you visit Timetable
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

function CustomClassRow({ entry, conflict }: { entry: TimetableEntry; conflict: boolean }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const cancelled = entry.cancelled;
  return (
    <View style={[styles.classCard, conflict && styles.classCardConflict, cancelled && { opacity: 0.55 }]}>
      <View style={styles.classTime}>
        <Text style={styles.classTimeText}>{formatTimeRange(entry.time)}</Text>
      </View>
      <View style={styles.classBody}>
        <Text style={[styles.className, cancelled && { textDecorationLine: 'line-through' }]}>
          {entry.courseName}
          <Text style={styles.classSection}> · {entry.section}</Text>
        </Text>
        <Text style={styles.classMeta}>
          Room {entry.room} · {entry.department}-{entry.batch ? entry.batch.slice(-2) : ''}
        </Text>
        {/* Scenario badges — same cascade the web's TimetableCard uses. */}
        <View style={styles.badgeRow}>
          {cancelled ? (
            <View style={[styles.tagBadge, { backgroundColor: colors.dangerBg }]}>
              <Text style={[styles.tagBadgeText, { color: colors.danger }]}>CANCELLED</Text>
            </View>
          ) : null}
          {entry.category === 'repeat' ? (
            <View style={[styles.tagBadge, { backgroundColor: colors.warningBg }]}>
              <Text style={[styles.tagBadgeText, { color: colors.warning }]}>REPEAT</Text>
            </View>
          ) : null}
          {entry.exam ? (
            <View style={[styles.tagBadge, { backgroundColor: colors.dangerBg }]}>
              <Text style={[styles.tagBadgeText, { color: colors.danger }]}>EXAM</Text>
            </View>
          ) : null}
          {entry.rescheduled ? (
            <View style={[styles.tagBadge, { backgroundColor: colors.warningBg }]}>
              <Text style={[styles.tagBadgeText, { color: colors.warning }]}>RESCHEDULED</Text>
            </View>
          ) : null}
          {entry.type === 'lab' && !cancelled && !entry.rescheduled && !entry.exam ? (
            <View style={[styles.tagBadge, { backgroundColor: colors.infoBg }]}>
              <Text style={[styles.tagBadgeText, { color: colors.info }]}>LAB</Text>
            </View>
          ) : null}
        </View>
        {conflict ? (
          <View style={styles.inlineConflict}>
            <Ionicons name="warning" size={12} color={colors.danger} />
            <Text style={styles.inlineConflictText}>Time clash</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
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
  viewModeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  resultTools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  segmented: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: 10, padding: 3 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.brand },
  exportText: { color: colors.brand, fontWeight: '700', fontSize: 12 },
  conflictBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.dangerBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  conflictBadgeText: { fontSize: 12, fontWeight: '700', color: colors.danger },
  classCard: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 6,
  },
  classCardConflict: { borderColor: colors.danger, borderLeftWidth: 4 },
  classTime: { width: 96, justifyContent: 'center' },
  classTimeText: { fontSize: 12, fontWeight: '600', color: colors.brand },
  classBody: { flex: 1 },
  className: { fontSize: 15, fontWeight: '600', color: colors.text },
  classSection: { fontSize: 13, color: colors.textSecondary, fontWeight: '400' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  tagBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  tagBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  inlineConflict: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  classMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  inlineConflictText: { fontSize: 12, color: colors.danger, fontWeight: '600' },
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
  nameHint: { fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: 12 },
  nameInput: {
    backgroundColor: colors.subtle,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  nameActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  nameCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  nameCancelText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  nameSave: { backgroundColor: colors.brand, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  nameSaveText: { color: colors.onBrand, fontWeight: '700', fontSize: 14 },
});
