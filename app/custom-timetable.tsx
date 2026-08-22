import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchExamVisibility, fetchFSCTimetable, fetchFSMTimetable, type ExamVisibility } from '@/api/endpoints';
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
} from '@/core/timetable';
import type { RawTimetableJSON, TimetableEntry } from '@/core/types';
import { Dropdown } from '@/components/Dropdown';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScheduleGrid } from '@/components/ScheduleGrid';
import { EmptyState, ErrorState, LoadingState, SectionHeader } from '@/components/ui';

const BUNDLES_KEY = 'custom:timetable_bundles';
const CATEGORIES = ['regular', 'repeat'] as const;
const CATEGORY_LABELS: Record<string, string> = { regular: 'Regular', repeat: 'Repeat' };

interface Row {
  id: string;
  batch: string;
  dept: string;
  category: string;
  selection: string; // "Course Name | Section"
}

interface Bundle {
  id: string;
  name: string;
  school: string; // 'FSC' | 'FSM' — timetables are built per school
  rows: Row[];
}

let counter = 0;
function makeRow(batch: string, dept = ''): Row {
  return { id: `row-${Date.now()}-${counter++}`, batch, dept, category: 'regular', selection: '' };
}

function bundleLabel(b: Bundle): string {
  return `bundle “${b.name}”`;
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
  // 'auto' resolves on focus: tagged bundle → view; first bundle → view; else build.
  const [mode, setMode] = useState<'auto' | 'build' | 'view'>('auto');
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  const [bundlesOpen, setBundlesOpen] = useState(false);

  // Builder state
  const [school, setSchool] = useState<string>('FSC');
  const [rows, setRows] = useState<Row[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [exporting, setExporting] = useState(false);

  // Name prompt (iv)
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [newBundleName, setNewBundleName] = useState('');

  // Mirror of `mode` for the focus handler (stays stable across re-focuses).
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        let list: Bundle[] = [];
        try {
          const raw = await AsyncStorage.getItem(BUNDLES_KEY);
          list = raw ? JSON.parse(raw) : [];
        } catch {
          list = [];
        }
        // Migrate pre-school bundles: default to FSC.
        list = list.map((b) => ({ ...b, school: b.school ?? 'FSC' }));
        const spref = await getSavedSchedule();
        if (cancelled) return;
        setBundles(list);
        setSaved(spref);
        if (modeRef.current !== 'auto') return;
        // Auto-display (vii): the tagged bundle wins; otherwise the most recent
        // bundle; nothing saved → straight into the builder.
        const tagged =
          spref?.kind === 'bundle' ? list.find((b) => b.id === spref.bundleId) ?? null : null;
        const target = tagged ?? list[0] ?? null;
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
    AsyncStorage.setItem(BUNDLES_KEY, JSON.stringify(next)).catch(() => {});
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

  const selectionsFor = useCallback(
    (batch: string, dept: string, category: string) => {
      if (!batch || !dept) return [];
      const seen = new Set<string>();
      for (const e of buildEntries) {
        if (e.batch === batch && e.department === dept && e.category === category) {
          seen.add(`${e.courseName} | ${e.section}`);
        }
      }
      return [...seen].sort((a, b) => a.localeCompare(b));
    },
    [buildEntries]
  );

  /** Match a set of builder rows against a school's entries → concrete classes. */
  const matchedFor = useCallback(
    (rs: Row[], schoolKey: string): TimetableEntry[] => {
      const schoolEntries = entriesBySchool[schoolKey] ?? [];
      const seen = new Set<string>();
      const out: TimetableEntry[] = [];
      for (const r of rs) {
        if (!r.batch || !r.dept || !r.category || !r.selection) continue;
        const [courseName, section] = r.selection.split(' | ');
        for (const e of schoolEntries) {
          if (
            e.batch === r.batch &&
            e.department === r.dept &&
            e.category === r.category &&
            e.courseName === courseName &&
            e.section === section
          ) {
            const key = `${e.day}|${e.time}|${e.courseName}|${e.section}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push(e);
            }
          }
        }
      }
      return out;
    },
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

  const startNewBuild = () => {
    setEditingBundleId(null);
    setRows([makeRow(batches[0] ?? '')]);
    setActiveBundleId(null);
    setMode('build');
  };

  /** (iv) — open the name prompt instead of auto-saving with a synthetic name. */
  const openNamePrompt = () => {
    if (rows.length === 0) return;
    setNewBundleName(`Timetable ${bundles.length + 1}`);
    setNameModalOpen(true);
  };

  const createBundle = () => {
    const name = newBundleName.trim();
    if (!name) return;
    const bundle: Bundle = {
      id: `b-${Date.now()}`,
      name,
      school,
      rows: rows.map((r) => ({ ...r })),
    };
    persistBundles([bundle, ...bundles]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setNameModalOpen(false);
    setNewBundleName('');
    setActiveBundleId(bundle.id);
    setMode('view');
  };

  const updateBundle = () => {
    if (!editingBundleId) return;
    persistBundles(
      bundles.map((b) =>
        b.id === editingBundleId ? { ...b, school, rows: rows.map((r) => ({ ...r })) } : b
      )
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setActiveBundleId(editingBundleId);
    setEditingBundleId(null);
    setMode('view');
  };

  const editBundle = (b: Bundle) => {
    setSchool(b.school);
    setRows(b.rows.map((r) => ({ ...r, id: `row-${Date.now()}-${counter++}` })));
    setEditingBundleId(b.id);
    setActiveBundleId(b.id);
    setMode('build');
  };

  const viewBundle = (b: Bundle) => {
    setActiveBundleId(b.id);
    setEditingBundleId(null);
    setMode('view');
  };

  const deleteBundle = async (b: Bundle) => {
    Alert.alert('Delete bundle?', `“${b.name}” will be removed permanently.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const next = bundles.filter((x) => x.id !== b.id);
          persistBundles(next);
          if (saved?.kind === 'bundle' && saved.bundleId === b.id) {
            await clearSavedSchedule();
            setSaved(await getSavedSchedule());
          }
          if (activeBundleId === b.id) {
            const follow = next[0] ?? null;
            if (follow) {
              setActiveBundleId(follow.id);
              setMode('view');
            } else {
              setActiveBundleId(null);
              setRows([makeRow(batches[0] ?? '')]);
              setMode('build');
            }
          }
        },
      },
    ]);
  };

  // ── Saved-preference tag actions (v) ────────────────────────────────────────
  const isBundleTagged = (id: string) => saved?.kind === 'bundle' && saved.bundleId === id;

  const toggleTag = async (b: Bundle) => {
    Haptics.selectionAsync().catch(() => {});
    if (isBundleTagged(b.id)) {
      await clearSavedSchedule();
      setSaved(await getSavedSchedule());
      return;
    }
    if (saved) {
      const holderName =
        saved.kind === 'bundle'
          ? bundles.find((x) => x.id === saved.bundleId)?.name
          : undefined;
      Alert.alert(
        'Saved preference already set',
        `Your saved preference is currently on ${describeSavedSchedule(saved, holderName)}. Remove it there first, then tag this bundle.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove current tag',
            style: 'destructive',
            onPress: async () => {
              await clearSavedSchedule();
              setSaved(await getSavedSchedule());
            },
          },
        ]
      );
      return;
    }
    await setSavedSchedule({ kind: 'bundle', bundleId: b.id });
    setSaved(await getSavedSchedule());
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
        subtitle={mode === 'view' && activeBundle ? bundleLabel(activeBundle) : 'Build a clash-checked schedule'}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        {/* Bundle bar (view mode) */}
        {mode === 'view' && activeBundle ? (
          <View style={styles.bundleBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bundleBarName}>{activeBundle.name}</Text>
              <Text style={styles.bundleBarMeta}>
                {activeBundle.school} · {activeBundle.rows.length} class{activeBundle.rows.length !== 1 ? 'es' : ''}
                {isBundleTagged(activeBundle.id) ? ' · My timetable' : ''}
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
          </View>
        ) : null}

        {/* Saved bundles list */}
        <SectionHeader
          title="Saved bundles"
          right={
            bundles.length > 0 ? (
              <Text style={styles.linkText} onPress={() => setBundlesOpen((s) => !s)}>
                {bundlesOpen ? 'Hide' : `View (${bundles.length})`}
              </Text>
            ) : undefined
          }
        />
        {bundlesOpen ? (
          bundles.length === 0 ? (
            <Text style={styles.noneText}>No saved bundles yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {bundles.map((b) => (
                <View key={b.id} style={styles.bundleRow}>
                  <Pressable style={{ flex: 1 }} onPress={() => viewBundle(b)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {isBundleTagged(b.id) ? (
                        <Ionicons name="bookmark" size={14} color={colors.brand} />
                      ) : null}
                      <Text style={styles.bundleName}>{b.name}</Text>
                    </View>
                    <Text style={styles.bundleMeta}>
                      {b.school} · {b.rows.length} class{b.rows.length !== 1 ? 'es' : ''}
                      {isBundleTagged(b.id) ? ' · My timetable' : ''}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => toggleTag(b)} hitSlop={6} style={styles.iconBtn}>
                    <Ionicons
                      name={isBundleTagged(b.id) ? 'bookmark' : 'bookmark-outline'}
                      size={18}
                      color={colors.brand}
                    />
                  </Pressable>
                  <Pressable onPress={() => editBundle(b)} hitSlop={6} style={styles.iconBtn}>
                    <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Pressable onPress={() => deleteBundle(b)} hitSlop={6} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          )
        ) : null}

        {/* New build entry point (when viewing a bundle) */}
        {mode === 'view' ? (
          <Pressable onPress={startNewBuild} style={styles.newBuildBtn}>
            <Ionicons name="add" size={18} color={colors.brand} />
            <Text style={styles.newBuildText}>Build a new custom timetable</Text>
          </Pressable>
        ) : null}

        {/* ── Builder (rows only visible when building/editing — vii) ── */}
        {mode === 'build' ? (
          <>
            <SectionHeader title={editingBundleId ? `Editing bundle · ${bundles.find((b) => b.id === editingBundleId)?.name ?? ''}` : 'Add classes'} />

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
                <Dropdown
                  value={row.selection || null}
                  placeholder={row.dept ? 'Select course & section' : 'Select dept first'}
                  options={selectionsFor(row.batch, row.dept, row.category).map((s) => ({ value: s, label: s }))}
                  onSelect={(s) => updateRow(row.id, { selection: s })}
                />
              </View>
            ))}

            <Pressable onPress={addRow} style={styles.addBtn}>
              <Ionicons name="add" size={18} color={colors.brand} />
              <Text style={styles.addBtnText}>Add class</Text>
            </Pressable>

            {rows.length > 0 ? (
              editingBundleId ? (
                <Pressable onPress={updateBundle} style={styles.saveBtn}>
                  <Ionicons name="checkmark-done-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.saveBtnText}>Update bundle</Text>
                </Pressable>
              ) : (
                <Pressable onPress={openNamePrompt} style={styles.saveBtn}>
                  <Ionicons name="bookmark-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.saveBtnText}>Save as bundle</Text>
                </Pressable>
              )
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
            message={mode === 'view' ? 'This bundle has no valid classes against current data.' : 'Select at least one course with a valid section.'}
          />
        ) : viewMode === 'list' ? (
          grouped.map((g) => (
            <View key={g.day} style={{ marginBottom: 12 }}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayName}>{g.day}</Text>
                <Text style={styles.dayCount}>{g.entries.length} classes</Text>
              </View>
              {g.entries.map((e, i) => (
                <CustomClassRow
                  key={`${e.courseName}-${e.room}-${i}`}
                  entry={e}
                  conflict={conflicts.has(makeKey(e))}
                />
              ))}
            </View>
          ))
        ) : (
          <ScheduleGrid grouped={grouped} />
        )}
      </ScrollView>

      {/* (iv) Name-the-bundle prompt */}
      <Modal visible={nameModalOpen} transparent animationType="fade" onRequestClose={() => setNameModalOpen(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setNameModalOpen(false)}>
          <Pressable style={styles.nameSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <Text style={styles.nameTitle}>SAVE AS BUNDLE</Text>
            <Text style={styles.nameHint}>Give this collection of classes a name.</Text>
            <TextInput
              style={styles.nameInput}
              value={newBundleName}
              onChangeText={setNewBundleName}
              placeholder="e.g. CS Electives, Morning classes"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={createBundle}
            />
            <View style={styles.nameActions}>
              <Pressable onPress={() => setNameModalOpen(false)} style={styles.nameCancel}>
                <Text style={styles.nameCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={createBundle}
                disabled={!newBundleName.trim()}
                style={[styles.nameSave, !newBundleName.trim() && { opacity: 0.4 }]}
              >
                <Text style={styles.nameSaveText}>Save bundle</Text>
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
  return (
    <View style={[styles.classCard, conflict && styles.classCardConflict]}>
      <View style={styles.classTime}>
        <Text style={styles.classTimeText}>{formatTimeRange(entry.time)}</Text>
      </View>
      <View style={styles.classBody}>
        <Text style={styles.className}>
          {entry.courseName}
          <Text style={styles.classSection}> · {entry.section}</Text>
        </Text>
        <Text style={styles.classMeta}>
          Room {entry.room} · {entry.department}-{entry.batch ? entry.batch.slice(-2) : ''}
        </Text>
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
  linkText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  noneText: { color: colors.textTertiary, fontSize: 13, marginBottom: 8 },
  iconBtn: { padding: 6 },
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
  newBuildBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  newBuildText: { color: colors.brand, fontWeight: '700', fontSize: 14 },
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
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: 10,
  },
  saveBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
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
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingTop: 4 },
  dayName: { fontSize: 16, fontWeight: '700', color: colors.text },
  dayCount: { fontSize: 12, color: colors.textTertiary },
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
  classMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  inlineConflict: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
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
