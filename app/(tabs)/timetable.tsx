import React, { useMemo, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { colors, deptAccent, deptAccentBg } from '@/theme/colors';
import { useCachedData } from '@/hooks/useCachedData';
import { usePref } from '@/hooks/usePref';
import { fetchFSCTimetable, fetchFSMTimetable } from '@/api/endpoints';
import { CACHE_TTL, PREF_KEYS } from '@/api/config';
import {
  filterTimetable,
  flattenTimetable,
  formatTimeRange,
  getAvailableBatchesForTimetable,
  getAvailableDepartments,
  getAvailableSections,
  groupByDayTimetable,
} from '@/core/timetable';
import { type RawTimetableJSON, type TimetableEntry } from '@/core/types';
import { Chip, EmptyState, ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';

const TODAY = new Date().toLocaleString('en', { weekday: 'long' });
type ViewMode = 'list' | 'grid';

export default function TimetableScreen() {
  const router = useRouter();
  const [school, setSchool] = usePref(PREF_KEYS.timetableSchool, 'FSC');
  const [batch, setBatch] = usePref(PREF_KEYS.timetableBatch, '');
  const [dept, setDept] = usePref(PREF_KEYS.timetableDept, '');
  const [section, setSection] = usePref(PREF_KEYS.timetableSection, '');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [exporting, setExporting] = useState(false);

  const scheduleRef = useRef<View>(null);

  const fetcher = school === 'FSM' ? fetchFSMTimetable : fetchFSCTimetable;
  const { data: raw, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<RawTimetableJSON>(`data:timetable:${school}`, fetcher, CACHE_TTL.timetable);

  const entries = useMemo(() => (raw ? flattenTimetable(raw) : []), [raw]);

  const batches = useMemo(() => getAvailableBatchesForTimetable(entries), [entries]);
  const departments = useMemo(() => getAvailableDepartments(entries, effectiveBatch(batches, batch)), [entries, batches, batch]);
  const sections = useMemo(
    () => getAvailableSections(entries, effectiveBatch(batches, batch), effectiveDept(departments, dept)),
    [entries, batches, batch, departments, dept]
  );

  const effBatch = effectiveBatch(batches, batch);
  const effDept = effectiveDept(departments, dept);
  const effSection = sections.includes(section) ? section : sections[0] ?? '';

  const filtered = useMemo(() => {
    if (!entries.length) return [];
    return filterTimetable(entries, {
      batch: effBatch,
      department: effDept,
      section: effSection,
      query,
    });
  }, [entries, effBatch, effDept, effSection, query]);

  const grouped = useMemo(() => groupByDayTimetable(filtered), [filtered]);

  const onExport = async () => {
    if (!scheduleRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExporting(true);
    try {
      const uri = await captureRef(scheduleRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share timetable' });
      }
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return <LoadingState label="Loading timetable…" />;
  if (!raw || error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <Text style={styles.title}>Timetable</Text>
        <Text style={styles.subtitle}>Your full weekly class schedule.</Text>

        <Pressable
          onPress={() => router.push('/custom-timetable')}
          android_ripple={{ color: colors.border }}
          style={({ pressed }) => [styles.customCard, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.customIcon}>
            <Ionicons name="construct-outline" size={20} color={colors.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.customTitle}>Custom timetable</Text>
            <Text style={styles.customDesc}>Build a clash-checked schedule from any classes.</Text>
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
          <Chip label="FSC · Computing" active={school === 'FSC'} onPress={() => { setSchool('FSC'); setBatch(''); setDept(''); setSection(''); }} />
          <Chip label="FSM · Management" active={school === 'FSM'} onPress={() => { setSchool('FSM'); setBatch(''); setDept(''); setSection(''); }} />
        </View>

        {/* Batch */}
        <SectionHeader title="Batch" />
        <View style={styles.chipRow}>
          {batches.map((b) => (
            <Chip key={b} label={b} active={effBatch === b} onPress={() => { setBatch(b); setDept(''); setSection(''); }} />
          ))}
        </View>

        {/* Department */}
        <SectionHeader title="Department" />
        <View style={styles.chipRow}>
          {departments.map((d) => (
            <Chip key={d} label={d} active={effDept === d} color={deptAccent[d]} onPress={() => { setDept(d); setSection(''); }} />
          ))}
        </View>

        {/* Section */}
        <SectionHeader title="Section" />
        <View style={styles.chipRow}>
          {sections.map((s) => (
            <Chip key={s} label={s} active={effSection === s} onPress={() => setSection(s)} />
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
            placeholder="Search course, room or section"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="search"
          />
          {query ? (
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} onPress={() => setQuery('')} />
          ) : null}
        </View>

        {/* View mode + export */}
        <View style={styles.viewModeRow}>
          <View style={styles.segmented}>
            {(['list', 'grid'] as ViewMode[]).map((v) => (
              <Pressable key={v} onPress={() => setViewMode(v)} style={[styles.segment, viewMode === v && styles.segmentActive]}>
                <Ionicons
                  name={v === 'list' ? 'list' : 'grid'}
                  size={16}
                  color={viewMode === v ? '#fff' : colors.textSecondary}
                />
                <Text style={[styles.segmentText, viewMode === v && { color: '#fff' }]}>
                  {v === 'list' ? 'List' : 'Grid'}
                </Text>
              </Pressable>
            ))}
          </View>
          {filtered.length > 0 ? (
            <Pressable onPress={onExport} style={styles.exportBtn} disabled={exporting}>
              <Ionicons name="share-outline" size={16} color={colors.brand} />
              <Text style={styles.exportText}>{exporting ? 'Exporting…' : 'Export'}</Text>
            </Pressable>
          ) : null}
        </View>

        <SectionHeader title="Weekly schedule" />

        {filtered.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No classes found" message="Adjust your batch, department, section or search term." />
        ) : (
          <View ref={scheduleRef} collapsable={false} style={styles.scheduleArea}>
            {viewMode === 'list' ? (
              grouped.map((g) => (
                <View key={g.day} style={{ marginBottom: 12 }}>
                  <View style={styles.dayHeader}>
                    <Text style={styles.dayName}>{g.day}</Text>
                    {g.day === TODAY ? <View style={styles.todayBadge}><Text style={styles.todayText}>TODAY</Text></View> : null}
                    <Text style={styles.dayCount}>{g.entries.length} classes</Text>
                  </View>
                  {g.entries.map((e, i) => (
                    <ClassRow key={`${e.courseName}-${e.room}-${i}`} entry={e} />
                  ))}
                </View>
              ))
            ) : (
              <GridSchedule grouped={grouped} />
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function effectiveBatch(batches: string[], current: string): string {
  return batches.includes(current) ? current : batches[0] ?? '';
}
function effectiveDept(depts: string[], current: string): string {
  return depts.includes(current) ? current : depts[0] ?? '';
}

function ClassRow({ entry }: { entry: TimetableEntry }) {
  const isLab = entry.type === 'lab';
  const cancelled = entry.cancelled;
  return (
    <View style={[styles.classCard, cancelled && { opacity: 0.5 }]}>
      <View style={styles.classTime}>
        <Text style={styles.classTimeText}>{formatTimeRange(entry.time)}</Text>
      </View>
      <View style={styles.classBody}>
        <View style={styles.classNameRow}>
          <Text style={[styles.className, cancelled && { textDecorationLine: 'line-through' }]}>
            {entry.courseName}
          </Text>
          {isLab ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.infoBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.info }]}>LAB</Text>
            </View>
          ) : null}
          {cancelled ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.dangerBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.danger }]}>CANCELLED</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.classMetaRow}>
          <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.classMeta}>Room {entry.room}</Text>
          <Text style={styles.classMeta}>·</Text>
          <Text style={styles.classMeta}>Sec {entry.section}</Text>
        </View>
      </View>
    </View>
  );
}

/** Horizontal day-column grid view. */
function GridSchedule({ grouped }: { grouped: { day: string; entries: TimetableEntry[] }[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.gridRow}>
        {grouped.map((g) => (
          <View key={g.day} style={[styles.gridCol, g.day === TODAY && styles.gridColToday]}>
            <View style={styles.gridDayHeader}>
              <Text style={styles.gridDayName}>{g.day.slice(0, 3).toUpperCase()}</Text>
              {g.day === TODAY ? <Text style={styles.gridTodayText}>TODAY</Text> : null}
            </View>
            {g.entries.map((e, i) => (
              <View
                key={`${e.courseName}-${e.room}-${i}`}
                style={[
                  styles.gridCell,
                  { backgroundColor: deptAccentBg[deptKeyOf(e)] ?? colors.subtle, borderLeftColor: deptAccent[deptKeyOf(e)] ?? colors.brand },
                ]}
              >
                <Text style={styles.gridCellCourse} numberOfLines={2}>
                  {e.courseName}
                </Text>
                <Text style={styles.gridCellTime}>{formatTimeRange(e.time)}</Text>
                <Text style={styles.gridCellRoom} numberOfLines={1}>
                  {e.room}
                </Text>
              </View>
            ))}
            {g.entries.length === 0 ? <Text style={styles.gridEmpty}>—</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function deptKeyOf(e: TimetableEntry): string {
  return e.department.split('/')[0];
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
  customIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: colors.infoBg, alignItems: 'center', justifyContent: 'center' },
  customTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  customDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  viewModeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  segmented: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: 10, padding: 3 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.brand },
  exportText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  scheduleArea: { backgroundColor: colors.bg },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingTop: 4 },
  dayName: { fontSize: 16, fontWeight: '700', color: colors.text },
  dayCount: { fontSize: 12, color: colors.textTertiary },
  todayBadge: { backgroundColor: colors.brand, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  todayText: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  classCard: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 6,
  },
  classTime: { width: 96, justifyContent: 'center' },
  classTimeText: { fontSize: 12, fontWeight: '600', color: colors.brand },
  classBody: { flex: 1 },
  classNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  className: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  typeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  classMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  classMeta: { fontSize: 12, color: colors.textSecondary },
  gridRow: { flexDirection: 'row', gap: 8 },
  gridCol: { width: 148, borderRadius: 12, paddingBottom: 8 },
  gridColToday: { backgroundColor: colors.infoBg },
  gridDayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: 4 },
  gridDayName: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
  gridTodayText: { fontSize: 9, fontWeight: '800', color: colors.brand },
  gridCell: {
    borderRadius: 10,
    borderLeftWidth: 3,
    padding: 10,
    marginBottom: 6,
  },
  gridCellCourse: { fontSize: 12, fontWeight: '700', color: colors.text },
  gridCellTime: { fontSize: 10, color: colors.textSecondary, marginTop: 3 },
  gridCellRoom: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  gridEmpty: { textAlign: 'center', color: colors.textTertiary, paddingVertical: 12 },
});
