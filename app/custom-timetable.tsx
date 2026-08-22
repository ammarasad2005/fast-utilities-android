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
import * as Haptics from 'expo-haptics';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchFSCTimetable, fetchFSMTimetable } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
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
  rows: Row[];
}

let counter = 0;
function makeRow(batch: string): Row {
  return { id: `row-${Date.now()}-${counter++}`, batch, dept: '', category: 'regular', selection: '' };
}

export default function CustomTimetableScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const fsc = useCachedData<RawTimetableJSON>('data:timetable:FSC', fetchFSCTimetable, CACHE_TTL.timetable);
  const fsm = useCachedData<RawTimetableJSON>('data:timetable:FSM', fetchFSMTimetable, CACHE_TTL.timetable);

  const entries = useMemo(() => {
    const all: TimetableEntry[] = [];
    if (fsc.data) all.push(...flattenTimetable(fsc.data));
    if (fsm.data) all.push(...flattenTimetable(fsm.data));
    return all;
  }, [fsc.data, fsm.data]);

  const isLoading = fsc.isLoading || fsm.isLoading;
  const isRefreshing = fsc.isRefreshing || fsm.isRefreshing;
  const error = fsc.error || fsm.error;
  const refresh = () => {
    fsc.refresh();
    fsm.refresh();
  };

  const batches = useMemo(
    () => [...new Set(entries.map((e) => e.batch))].sort().reverse(),
    [entries]
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [showSaved, setShowSaved] = useState(false);

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
    batch ? [...new Set(entries.filter((e) => e.batch === batch).map((e) => e.department))].sort() : [];

  const selectionsFor = (batch: string, dept: string, category: string) => {
    if (!batch || !dept) return [];
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.batch === batch && e.department === dept && e.category === category) {
        const key = `${e.courseName} | ${e.section}`;
        if (!map.has(key)) map.set(key, key);
      }
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  };

  const matched = useMemo(() => {
    const seen = new Set<string>();
    const out: TimetableEntry[] = [];
    for (const r of rows) {
      if (!r.batch || !r.dept || !r.category || !r.selection) continue;
      const [courseName, section] = r.selection.split(' | ');
      for (const e of entries) {
        if (e.batch === r.batch && e.department === r.dept && e.category === r.category && e.courseName === courseName && e.section === section) {
          const key = `${e.day}|${e.time}|${e.courseName}|${e.section}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push(e);
          }
        }
      }
    }
    return out;
  }, [rows, entries]);

  const conflicts = useMemo(() => detectConflicts(matched), [matched]);
  const grouped = useMemo(() => groupByDayTimetable(matched), [matched]);

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, makeRow(batches[0] ?? '')]);
  const removeRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const saveBundle = () => {
    if (rows.length === 0) return;
    const bundle: Bundle = { id: `b-${Date.now()}`, name: `Timetable ${bundles.length + 1}`, rows: rows.map((r) => ({ ...r })) };
    persistBundles([...bundles, bundle]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };
  const loadBundle = (b: Bundle) => {
    setRows(b.rows.map((r) => ({ ...r, id: `row-${Date.now()}-${counter++}` })));
    setShowSaved(false);
  };
  const deleteBundle = (id: string) => persistBundles(bundles.filter((b) => b.id !== id));

  if (isLoading) return <LoadingState label="Loading timetables…" />;
  if ((fsc.error && fsm.error) || entries.length === 0) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  const conflictCount = conflicts.size;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Custom Timetable" subtitle="Build a clash-checked schedule" />
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
                    <Text style={styles.bundleMeta}>{b.rows.length} class{b.rows.length !== 1 ? 'es' : ''}</Text>
                  </Pressable>
                  <Ionicons name="trash-outline" size={20} color={colors.danger} onPress={() => deleteBundle(b.id)} />
                </View>
              ))}
            </View>
          )
        ) : null}

        {/* Rows */}
        <SectionHeader title="Add classes" />
        {rows.length === 0 ? (
          <EmptyState icon="add-circle-outline" title="No classes yet" message="Add a class to build your custom timetable." />
        ) : (
          <View style={{ gap: 12 }}>
            {rows.map((row, idx) => (
              <View key={row.id} style={styles.rowCard}>
                <View style={styles.rowHeader}>
                  <Text style={styles.rowTitle}>Class {idx + 1}</Text>
                  <Ionicons name="close" size={20} color={colors.textTertiary} onPress={() => removeRow(row.id)} />
                </View>

                <Text style={styles.fieldLabel}>Batch</Text>
                <Dropdown value={row.batch} placeholder="Select batch" options={batches.map((b) => ({ value: b, label: b }))} onSelect={(b) => updateRow(row.id, { batch: b, dept: '', selection: '' })} />

                <Text style={styles.fieldLabel}>Department</Text>
                <Dropdown value={row.dept || null} placeholder="Select department" options={deptsFor(row.batch).map((d) => ({ value: d, label: d }))} onSelect={(d) => updateRow(row.id, { dept: d, selection: '' })} />

                <Text style={styles.fieldLabel}>Type</Text>
                <Dropdown value={row.category} placeholder="Select type" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} onSelect={(c) => updateRow(row.id, { category: c, selection: '' })} />

                <Text style={styles.fieldLabel}>Course &amp; section</Text>
                <Dropdown
                  value={row.selection || null}
                  placeholder={row.dept ? 'Select course & section' : 'Select dept first'}
                  options={selectionsFor(row.batch, row.dept, row.category).map((s) => ({ value: s, label: s }))}
                  onSelect={(s) => updateRow(row.id, { selection: s })}
                />
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={addRow} style={styles.addBtn}>
          <Ionicons name="add" size={18} color={colors.brand} />
          <Text style={styles.addBtnText}>Add class</Text>
        </Pressable>

        {rows.length > 0 ? (
          <Pressable onPress={saveBundle} style={styles.saveBtn}>
            <Ionicons name="bookmark-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.saveBtnText}>Save as bundle</Text>
          </Pressable>
        ) : null}

        {/* Results */}
        <SectionHeader
          title={`Your timetable · ${matched.length} class${matched.length === 1 ? '' : 'es'}`}
          right={
            conflictCount > 0 ? (
              <View style={styles.conflictBadge}>
                <Ionicons name="warning" size={13} color={colors.danger} />
                <Text style={styles.conflictBadgeText}>{conflictCount} clash{conflictCount > 1 ? 'es' : ''}</Text>
              </View>
            ) : null
          }
        />
        {matched.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No classes match" message="Select at least one course with a valid section." />
        ) : (
          grouped.map((g) => (
            <View key={g.day} style={{ marginBottom: 12 }}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayName}>{g.day}</Text>
                <Text style={styles.dayCount}>{g.entries.length} classes</Text>
              </View>
              {g.entries.map((e, i) => (
                <CustomClassRow key={`${e.courseName}-${e.room}-${i}`} entry={e} conflict={conflicts.has(makeKey(e))} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
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
        <Text style={styles.classMeta}>Room {entry.room}</Text>
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
});
