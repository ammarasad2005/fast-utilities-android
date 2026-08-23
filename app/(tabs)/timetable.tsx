import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { deptAccent } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { usePref } from '@/hooks/usePref';
import { fetchExamVisibility, fetchFSCTimetable, fetchFSMTimetable, fetchSemesterCalendar, type ExamVisibility } from '@/api/endpoints';
import { exportTimetablePng } from '@/api/exportImage';
import { CACHE_TTL, PREF_KEYS } from '@/api/config';
import { getSemesterStartDate } from '@/core/semester';
import { attachEntries, resolveWeekPlan } from '@/core/weekPlan';
import {
  clearSavedSchedule,
  describeSavedSchedule,
  getSavedSchedule,
  setSavedSchedule,
  type SavedSchedule,
} from '@/prefs/savedSchedule';
import {
  filterTimetable,
  flattenTimetable,
  formatTimeRange,
  getAvailableBatchesForTimetable,
  getAvailableDepartments,
  getAvailableSections,
  groupByDayTimetable,
  makeKey,
} from '@/core/timetable';
import { TIMETABLE_META_KEY, type RawTimetableJSON, type SemesterCalendar, type TimetableEntry } from '@/core/types';
import { DaySection } from '@/components/DaySection';
import { WeekGrid, type WeekGridDay } from '@/components/WeekGrid';
import { Chip, EmptyState, ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';

type ViewMode = 'list' | 'grid';

/** Course identity for section-choice: same course (dept+category+name) across sections. */
function courseKeyOf(e: Pick<TimetableEntry, 'department' | 'category' | 'courseName'>): string {
  return `${e.department}|${e.category}|${e.courseName}`;
}

function isDeptMatch(entryDept: string, filterDept: string): boolean {
  if (entryDept === filterDept) return true;
  return entryDept.split('/').map((d) => d.trim()).includes(filterDept);
}

interface ResultPrefs {
  sectionByCourse: Record<string, string>;
  /** `${courseKey}|${section}` — electives/repeats the user picked into view. */
  pickedElectives: string[];
}
const EMPTY_PREFS: ResultPrefs = { sectionByCourse: {}, pickedElectives: [] };

export default function TimetableScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const [school, setSchool] = usePref(PREF_KEYS.timetableSchool, 'FSC');
  const [batch, setBatch] = usePref(PREF_KEYS.timetableBatch, '');
  const [dept, setDept] = usePref(PREF_KEYS.timetableDept, '');
  const [section, setSection] = usePref(PREF_KEYS.timetableSection, '');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [exporting, setExporting] = useState(false);

  // ── Saved-preference tag ────────────────────────────────────────────────────
  const [saved, setSaved] = useState<SavedSchedule | null>(null);
  const [savedBundleName, setSavedBundleName] = useState<string | null>(null);

  const reloadSaved = useCallback(async () => {
    const s = await getSavedSchedule();
    setSaved(s);
    if (s?.kind === 'bundle') {
      try {
        const raw = await AsyncStorage.getItem('custom:timetable_bundles');
        const list = raw ? (JSON.parse(raw) as { id: string; name: string }[]) : [];
        setSavedBundleName(list.find((b) => b.id === s.bundleId)?.name ?? null);
      } catch {
        setSavedBundleName(null);
      }
    } else {
      setSavedBundleName(null);
    }
  }, []);

  // Reload the tag whenever the tab gains focus (it may change on other screens).
  useFocusEffect(
    useCallback(() => {
      reloadSaved();
    }, [reloadSaved])
  );

  // ── Data ────────────────────────────────────────────────────────────────────
  const fetcher = school === 'FSM' ? fetchFSMTimetable : fetchFSCTimetable;
  const { data: raw, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<RawTimetableJSON>(`data:timetable:${school}`, fetcher, CACHE_TTL.timetable);

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

  // Auto-display the tagged default configuration (vii): when the tag points at
  // a default batch/dept/section, the timetable opens onto exactly that.
  useEffect(() => {
    if (saved?.kind !== 'default') return;
    if (saved.school && saved.school !== school) setSchool(saved.school);
    if (saved.batch) setBatch(saved.batch);
    if (saved.dept) setDept(saved.dept);
    if (saved.section) setSection(saved.section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  // ── Per-course section choice + picked electives (persisted per scope) ──────
  const scopeKey = `${school}:${effBatch}:${effDept}:${effSection}`;
  const [resultPrefs, setResultPrefs] = useState<ResultPrefs>(EMPTY_PREFS);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(`pref:resultprefs:${scopeKey}`)
      .then((rawData) => {
        if (!active) return;
        if (rawData) {
          try {
            const parsed = JSON.parse(rawData);
            setResultPrefs({
              sectionByCourse: parsed.sectionByCourse ?? {},
              pickedElectives: parsed.pickedElectives ?? [],
            });
            return;
          } catch {
            /* fall through */
          }
        }
        setResultPrefs(EMPTY_PREFS);
      })
      .catch(() => {
        if (active) setResultPrefs(EMPTY_PREFS);
      });
    return () => {
      active = false;
    };
  }, [scopeKey]);

  const updateResultPrefs = useCallback(
    (next: ResultPrefs) => {
      setResultPrefs(next);
      AsyncStorage.setItem(`pref:resultprefs:${scopeKey}`, JSON.stringify(next)).catch(() => {});
    },
    [scopeKey]
  );

  // ── Course-section model ────────────────────────────────────────────────────
  // Base: courses visible in the user's own section (normalized A1/A2 → A).
  const baseEntries = useMemo(
    () =>
      filterTimetable(entries, {
        batch: effBatch,
        department: effDept,
        section: effSection,
        query: '',
      }),
    [entries, effBatch, effDept, effSection]
  );

  const defaultSectionByCourse = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of baseEntries) {
      const key = courseKeyOf(e);
      if (!map.has(key)) map.set(key, e.section);
    }
    return map;
  }, [baseEntries]);

  // All sections a course runs in (any section, same batch+dept, non-elective, non-repeat).
  const courseSectionsByKey = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of entries) {
      if (e.batch !== effBatch || !isDeptMatch(e.department, effDept)) continue;
      if (e.isElective || e.category === 'repeat') continue;
      const key = courseKeyOf(e);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(e.section);
    }
    const sorted = new Map<string, string[]>();
    for (const [key, set] of map) {
      if (set.size > 1) {
        sorted.set(key, [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
      }
    }
    return sorted;
  }, [entries, effBatch, effDept]);

  // Chosen section per course (manual override or the user's own-section default).
  const effectiveSectionFor = useCallback(
    (key: string): string | undefined =>
      resultPrefs.sectionByCourse[key] ?? defaultSectionByCourse.get(key),
    [resultPrefs.sectionByCourse, defaultSectionByCourse]
  );

  // ── Electives / Others model ────────────────────────────────────────────────
  const electivesCtx = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.batch === effBatch &&
          isDeptMatch(e.department, effDept) &&
          (e.isElective || e.category === 'repeat')
      ),
    [entries, effBatch, effDept]
  );

  const electiveGroups = useMemo(() => {
    const map = new Map<string, { key: string; courseName: string; category: string; sections: Set<string> }>();
    for (const e of electivesCtx) {
      const key = courseKeyOf(e);
      if (!map.has(key)) map.set(key, { key, courseName: e.courseName, category: e.category, sections: new Set() });
      map.get(key)!.sections.add(e.section);
    }
    return [...map.values()]
      .map((g) => ({
        ...g,
        sections: [...g.sections].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      }))
      .sort((a, b) => a.courseName.localeCompare(b.courseName));
  }, [electivesCtx]);

  // ── Displayed schedule ──────────────────────────────────────────────────────
  const displayed = useMemo(() => {
    const out: TimetableEntry[] = [];
    const seen = new Set<string>();
    // Main: chosen section per course.
    for (const e of entries) {
      if (e.batch !== effBatch || !isDeptMatch(e.department, effDept)) continue;
      if (e.isElective || e.category === 'repeat') continue;
      const key = courseKeyOf(e);
      const chosen = effectiveSectionFor(key);
      if (chosen == null || e.section !== chosen) continue;
      const k = makeKey(e);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(e);
      }
    }
    // Picked electives/repeats.
    for (const e of electivesCtx) {
      const pickKey = `${courseKeyOf(e)}|${e.section}`;
      if (!resultPrefs.pickedElectives.includes(pickKey)) continue;
      const k = makeKey(e);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }, [entries, effBatch, effDept, electivesCtx, effectiveSectionFor, resultPrefs.pickedElectives]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return displayed;
    return displayed.filter(
      (e) =>
        e.courseName.toLowerCase().includes(q) ||
        e.room.toLowerCase().includes(q) ||
        e.section.toLowerCase().includes(q)
    );
  }, [displayed, query]);

  const grouped = useMemo(() => groupByDayTimetable(filtered), [filtered]);

  // Full week resolution, exactly as the web app does it: dates are rolled
  // onto the calendar week containing the EFFECTIVE today (never the stale
  // sheet-generation dates), Monday clamped to semester start, makeup sheets
  // parsed out, today pinned first (suppressed before the semester starts).
  const weekPlan = useMemo(
    () =>
      resolveWeekPlan(raw?.[TIMETABLE_META_KEY]?.days, {
        semesterStartISO: getSemesterStartDate(calendar ?? null),
      }),
    [raw, calendar]
  );

  // Today-first ordering; the today day survives even with no classes (so the
  // app can say "No classes scheduled for today" like the web does).
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

  const pickedElectiveKeys = useMemo(() => new Set(resultPrefs.pickedElectives), [resultPrefs.pickedElectives]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const chooseCourseSection = (key: string, nextSection: string) => {
    Haptics.selectionAsync().catch(() => {});
    const next = { ...resultPrefs.sectionByCourse };
    const def = defaultSectionByCourse.get(key);
    if (def === nextSection) delete next[key];
    else next[key] = nextSection;
    updateResultPrefs({ ...resultPrefs, sectionByCourse: next });
  };

  const toggleElective = (key: string, sec: string) => {
    Haptics.selectionAsync().catch(() => {});
    const pickKey = `${key}|${sec}`;
    const next = resultPrefs.pickedElectives.includes(pickKey)
      ? resultPrefs.pickedElectives.filter((p) => p !== pickKey)
      : [...resultPrefs.pickedElectives, pickKey];
    updateResultPrefs({ ...resultPrefs, pickedElectives: next });
  };

  /** Tag the current configuration as "my timetable" — enforcing the single-tag rule. */
  const onTagDefault = () => {
    Haptics.selectionAsync().catch(() => {});
    if (saved) {
      const holder = describeSavedSchedule(saved, savedBundleName ?? undefined);
      Alert.alert(
        'Saved preference already set',
        `Your saved preference is currently on ${holder}. Remove it there first, then tag this configuration.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove current tag',
            style: 'destructive',
            onPress: async () => {
              await clearSavedSchedule();
              await reloadSaved();
            },
          },
        ]
      );
      return;
    }
    setSavedSchedule({ kind: 'default', school, batch: effBatch, dept: effDept, section: effSection }).then(reloadSaved);
  };

  const onRemoveTag = () => {
    Haptics.selectionAsync().catch(() => {});
    clearSavedSchedule().then(reloadSaved);
  };

  // Server-rendered PNG export (identical layout to the website's export).
  const onExport = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExporting(true);
    try {
      const uri = await exportTimetablePng(filtered, {
        batch: effBatch,
        dept: effDept,
        section: effSection,
        semesterName,
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

  const isCurrentTagged =
    saved?.kind === 'default' &&
    saved.school === school &&
    saved.batch === effBatch &&
    saved.dept === effDept &&
    saved.section === effSection;

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

        {/* Saved-preference tag */}
        {saved?.kind === 'bundle' ? (
          <Pressable
            onPress={() => router.push('/custom-timetable')}
            android_ripple={{ color: colors.border }}
            style={({ pressed }) => [styles.savedCard, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="bookmark" size={16} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.savedText}>
                My timetable: bundle “{savedBundleName ?? 'Custom'}”
              </Text>
              <Text style={styles.savedHint}>Shown in Custom Timetable · tap to open</Text>
            </View>
            <Pressable onPress={onRemoveTag} hitSlop={8}>
              <Text style={styles.savedRemove}>Remove</Text>
            </Pressable>
          </Pressable>
        ) : isCurrentTagged ? (
          <View style={styles.savedCard}>
            <Ionicons name="bookmark" size={16} color={colors.brand} />
            <Text style={[styles.savedText, { flex: 1 }]}>My timetable — opens here automatically</Text>
            <Pressable onPress={onRemoveTag} hitSlop={8}>
              <Text style={styles.savedRemove}>Remove</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={onTagDefault}
            android_ripple={{ color: colors.border }}
            style={({ pressed }) => [styles.tagBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="bookmark-outline" size={16} color={colors.brand} />
            <Text style={styles.tagBtnText}>Save this configuration as my timetable</Text>
          </Pressable>
        )}

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
                  color={viewMode === v ? colors.onBrand : colors.textSecondary}
                />
                <Text style={[styles.segmentText, viewMode === v && { color: colors.onBrand }]}>
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
              {s.entries.map((e, i) => {
                const key = courseKeyOf(e);
                const options = courseSectionsByKey.get(key) ?? [];
                const isPickedElective = pickedElectiveKeys.has(`${key}|${e.section}`);
                return (
                  <ClassRow
                    key={`${e.courseName}-${e.room}-${i}`}
                    entry={e}
                    sectionOptions={options}
                    isElectivePick={isPickedElective}
                    onChooseSection={(sec) => chooseCourseSection(key, sec)}
                  />
                );
              })}
            </DaySection>
          ))
        ) : (
          <WeekGrid days={gridDays} />
        )}

        {/* Electives / Others */}
        {electiveGroups.length > 0 ? (
          <>
            <SectionHeader title="Electives / Others" />
            <Text style={styles.electivesHint}>
              Pick elective or repeat courses into your schedule — choose the section that suits you.
            </Text>
            {electiveGroups.map((g) => (
              <View key={g.key} style={styles.electiveCard}>
                <View style={styles.electiveTopRow}>
                  <Text style={styles.electiveName}>{g.courseName}</Text>
                  <View style={[styles.electiveBadge, g.category === 'repeat' ? styles.repeatBadge : styles.electiveBadgeBg]}>
                    <Text style={[styles.electiveBadgeText, g.category === 'repeat' ? styles.repeatBadgeText : styles.electiveBadgeTextColor]}>
                      {g.category === 'repeat' ? 'REPEAT' : 'ELECTIVE'}
                    </Text>
                  </View>
                </View>
                <View style={styles.electiveSections}>
                  {g.sections.map((sec) => {
                    const picked = pickedElectiveKeys.has(`${g.key}|${sec}`);
                    return (
                      <Pressable
                        key={sec}
                        onPress={() => toggleElective(g.key, sec)}
                        style={[styles.electiveSectionChip, picked && { backgroundColor: colors.brand, borderColor: colors.brand }]}
                      >
                        <Text style={[styles.electiveSectionText, picked && { color: colors.onBrand }]}>
                          {sec}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </>
        ) : null}
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

function ClassRow({
  entry,
  sectionOptions,
  isElectivePick,
  onChooseSection,
}: {
  entry: TimetableEntry;
  sectionOptions: string[];
  isElectivePick?: boolean;
  onChooseSection?: (section: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const isLab = entry.type === 'lab';
  const cancelled = entry.cancelled;
  // Scenario badges mirror the web TimetableCard cascade; when any scenario
  // badge shows, the plain Lab/Lecture badge is suppressed (web parity).
  const hasScenario = cancelled || entry.rescheduled || entry.exam;

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
          {isLab && !hasScenario ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.infoBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.info }]}>LAB</Text>
            </View>
          ) : null}
          {isElectivePick ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.successBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.success }]}>PICKED</Text>
            </View>
          ) : null}
          {cancelled ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.dangerBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.danger }]}>CANCELLED</Text>
            </View>
          ) : null}
          {entry.exam ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.dangerBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.danger }]}>EXAM</Text>
            </View>
          ) : null}
          {entry.rescheduled ? (
            <View style={[styles.typeBadge, { backgroundColor: colors.warningBg }]}>
              <Text style={[styles.typeBadgeText, { color: colors.warning }]}>RESCHEDULED</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.classMetaRow}>
          <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.classMeta}>Room {entry.room}</Text>
        </View>
      </View>
      {sectionOptions.length > 1 && onChooseSection ? (
        <>
          <Pressable
            onPress={() => setPickerOpen(true)}
            hitSlop={6}
            style={({ pressed }) => [styles.secChip, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.secChipText}>Sec {entry.section}</Text>
            <Ionicons name="chevron-down" size={13} color={colors.brand} />
          </Pressable>

          <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
            <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
              <Pressable style={styles.pickerSheet} onPress={() => {}}>
                <View style={styles.pickerHandle} />
                <Text style={styles.pickerTitle} numberOfLines={1}>
                  {entry.courseName} — SECTION
                </Text>
                {sectionOptions.map((sec) => {
                  const active = sec === entry.section;
                  return (
                    <Pressable
                      key={sec}
                      onPress={() => {
                        onChooseSection(sec);
                        setPickerOpen(false);
                      }}
                      style={({ pressed }) => [styles.pickerOption, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={[styles.pickerOptionText, active && { color: colors.brand, fontWeight: '700' }]}>
                        Section {sec}
                      </Text>
                      {active ? <Ionicons name="checkmark" size={18} color={colors.brand} /> : null}
                    </Pressable>
                  );
                })}
              </Pressable>
            </Pressable>
          </Modal>
        </>
      ) : (
        <Text style={styles.secStatic}>Sec {entry.section}</Text>
      )}
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
  savedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.infoBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  savedText: { fontSize: 13, fontWeight: '700', color: colors.brand },
  savedHint: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  savedRemove: { fontSize: 13, fontWeight: '700', color: colors.danger },
  tagBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.brand,
    borderStyle: 'dashed',
    marginTop: 12,
  },
  tagBtnText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  viewModeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  segmented: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: 10, padding: 3 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.brand },
  exportText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
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
  secChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'center',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  secChipText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  secStatic: { alignSelf: 'center', fontSize: 12, fontWeight: '600', color: colors.textTertiary, marginLeft: 6 },
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
    letterSpacing: 1,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pickerOptionText: { fontSize: 15, color: colors.text },
  electivesHint: { fontSize: 13, color: colors.textSecondary, marginTop: -4, marginBottom: 10 },
  electiveCard: {
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  electiveTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  electiveName: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1 },
  electiveBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  electiveBadgeBg: { backgroundColor: colors.infoBg },
  repeatBadge: { backgroundColor: colors.warningBg },
  electiveBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  electiveBadgeTextColor: { color: colors.info },
  repeatBadgeText: { color: colors.warning },
  electiveSections: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  electiveSectionChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  electiveSectionText: { fontSize: 13, fontWeight: '600', color: colors.text },
});
