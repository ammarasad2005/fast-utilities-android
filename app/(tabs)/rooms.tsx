import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchFSCTimetable, fetchFSMTimetable } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import {
  buildRoomCalendar,
  getAvailableRooms,
  groupRoomsByBlock,
  mergeRoomCalendars,
  STANDARD_SLOTS,
} from '@/core/roomLogic';
import type { RawTimetableJSON } from '@/core/types';
import { Dropdown, type DropdownOption } from '@/components/Dropdown';
import { EmptyState, ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Custom time-range options: 30-min increments, 08:00 → 18:00 (24h).
const TIME_RANGE_OPTIONS: DropdownOption<string>[] = (() => {
  const opts: DropdownOption<string>[] = [];
  for (let m = 8 * 60; m <= 18 * 60; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const label = `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    opts.push({ value: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, label });
  }
  return opts;
})();

function defaultDay(): string {
  const d = new Date().getDay();
  if (d >= 1 && d <= 6) return WEEKDAYS[d - 1];
  return 'Monday';
}

function defaultSlotIndex(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const idx = STANDARD_SLOTS.findIndex((s) => mins < s.end);
  return idx === -1 ? 0 : idx;
}

type Mode = 'slot' | 'range';

export default function RoomsScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [day, setDay] = useState(defaultDay());
  const [mode, setMode] = useState<Mode>('slot');
  const [slotIndex, setSlotIndex] = useState(defaultSlotIndex());
  const [rangeStart, setRangeStart] = useState<string>('09:00');
  const [rangeEnd, setRangeEnd] = useState<string>('13:00');

  const fsc = useCachedData<RawTimetableJSON>('data:timetable:FSC', fetchFSCTimetable, CACHE_TTL.timetable);
  const fsm = useCachedData<RawTimetableJSON>('data:timetable:FSM', fetchFSMTimetable, CACHE_TTL.timetable);

  const isLoading = fsc.isLoading || fsm.isLoading;
  const isFromCache = fsc.isFromCache || fsm.isFromCache;
  const isRefreshing = fsc.isRefreshing || fsm.isRefreshing;
  const error = fsc.error || fsm.error;
  const refresh = () => {
    fsc.refresh();
    fsm.refresh();
  };

  // Merge FSC + FSM into a single campus-wide calendar (no school filter).
  const calendar = useMemo(() => {
    const a = fsc.data ? buildRoomCalendar(fsc.data) : {};
    const b = fsm.data ? buildRoomCalendar(fsm.data) : {};
    return mergeRoomCalendars(a, b);
  }, [fsc.data, fsm.data]);

  const slot = STANDARD_SLOTS[slotIndex];
  const rawRange = mode === 'slot' ? slot.raw : `${rangeStart}-${rangeEnd}`;

  const rangeValid = mode === 'slot' || rangeEnd > rangeStart;

  const availability = useMemo(
    () => (rangeValid ? getAvailableRooms(calendar, day, rawRange) : { fullyVacant: [], partiallyVacant: [] }),
    [calendar, day, rawRange, rangeValid]
  );

  const fullyGrouped = groupRoomsByBlock(availability.fullyVacant);
  const partiallyGrouped = groupRoomsByBlock(availability.partiallyVacant);

  const copyRooms = async (rooms: string[]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(rooms.join(', '));
  };

  if (isLoading) return <LoadingState label="Building room availability…" />;
  if (fsc.error && fsm.error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <Text style={styles.title}>Free Rooms</Text>
        <Text style={styles.subtitle}>Find empty classrooms and labs across campus.</Text>

        {isFromCache ? (
          <View style={{ marginTop: 12 }}>
            <OfflineNotice cached />
          </View>
        ) : null}

        <SectionHeader title="Day" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {WEEKDAYS.map((d) => (
              <ChipLocal key={d} label={d.slice(0, 3)} active={day === d} onPress={() => setDay(d)} />
            ))}
          </View>
        </ScrollView>

        <SectionHeader title="Time" />
        <View style={styles.segmented}>
          <Pressable onPress={() => setMode('slot')} style={[styles.segment, mode === 'slot' && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode === 'slot' && { color: colors.onBrand }]}>Time slot</Text>
          </Pressable>
          <Pressable onPress={() => setMode('range')} style={[styles.segment, mode === 'range' && styles.segmentActive]}>
            <Text style={[styles.segmentText, mode === 'range' && { color: colors.onBrand }]}>Time range</Text>
          </Pressable>
        </View>

        {mode === 'slot' ? (
          <Dropdown
            value={slotIndex}
            placeholder="Select time slot"
            options={STANDARD_SLOTS.map((s, i) => ({ value: i, label: s.label }))}
            onSelect={(i) => setSlotIndex(i)}
          />
        ) : (
          <View style={{ gap: 10 }}>
            <View style={styles.rangeRow}>
              <Text style={styles.rangeLabel}>From</Text>
              <View style={{ flex: 1 }}>
                <Dropdown value={rangeStart} placeholder="Start time" options={TIME_RANGE_OPTIONS} onSelect={setRangeStart} />
              </View>
              <Text style={styles.rangeLabel}>To</Text>
              <View style={{ flex: 1 }}>
                <Dropdown value={rangeEnd} placeholder="End time" options={TIME_RANGE_OPTIONS} onSelect={setRangeEnd} />
              </View>
            </View>
            {!rangeValid ? (
              <Text style={styles.rangeError}>End time must be after the start time.</Text>
            ) : null}
          </View>
        )}

        {!rangeValid ? (
          <EmptyState icon="time-outline" title="Invalid range" message="Pick an end time after the start time." />
        ) : (
          <>
            <SectionHeader
              title={`Fully free · ${availability.fullyVacant.length}`}
              right={
                availability.fullyVacant.length ? (
                  <Text style={styles.copyLink} onPress={() => copyRooms(availability.fullyVacant)}>
                    Copy
                  </Text>
                ) : null
              }
            />
            {availability.fullyVacant.length === 0 ? (
              <Text style={styles.noneText}>No fully free rooms for this time.</Text>
            ) : (
              <RoomGroups groups={fullyGrouped} />
            )}

            <SectionHeader title={`Partially free · ${availability.partiallyVacant.length}`} />
            {availability.partiallyVacant.length === 0 ? (
              <Text style={styles.noneText}>No partially free rooms for this time.</Text>
            ) : (
              <RoomGroups groups={partiallyGrouped} />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChipLocal({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: colors.brand, borderColor: colors.brand }]}
    >
      <Text style={[styles.chipText, active && { color: colors.onBrand }]}>{label}</Text>
    </Pressable>
  );
}

function RoomGroups({ groups }: { groups: Record<string, string[]> }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <>
      {Object.entries(groups).map(([block, rooms]) => (
        <View key={block} style={styles.block}>
          <Text style={styles.blockName}>{block}</Text>
          <View style={styles.roomChips}>
            {rooms.map((r) => (
              <View key={r} style={styles.roomChip}>
                <Text style={styles.roomChipText}>{r}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  segmented: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: 10, padding: 3, marginBottom: 10 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.brand },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, width: 38 },
  rangeError: { color: colors.danger, fontSize: 12, marginTop: 4 },
  copyLink: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  noneText: { color: colors.textTertiary, fontSize: 13, marginBottom: 8 },
  block: { marginBottom: 12 },
  blockName: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: 6 },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roomChip: {
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: 'rgba(5,150,105,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  roomChipText: { fontSize: 13, fontWeight: '600', color: colors.success },
});
