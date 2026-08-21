import React, { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { colors } from '@/theme/colors';
import { useCachedData } from '@/hooks/useCachedData';
import { usePref } from '@/hooks/usePref';
import { fetchFSCTimetable, fetchFSMTimetable } from '@/api/endpoints';
import { CACHE_TTL, PREF_KEYS } from '@/api/config';
import {
  buildRoomCalendar,
  getAvailableRooms,
  groupRoomsByBlock,
  STANDARD_SLOTS,
} from '@/core/roomLogic';
import type { RawTimetableJSON } from '@/core/types';
import { Chip, EmptyState, ErrorState, LoadingState, OfflineNotice, SectionHeader } from '@/components/ui';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function defaultDay(): string {
  const d = new Date().getDay(); // 0 Sun .. 6 Sat
  if (d >= 1 && d <= 6) return WEEKDAYS[d - 1];
  return 'Monday';
}

function defaultSlotIndex(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const idx = STANDARD_SLOTS.findIndex((s) => mins < s.end);
  return idx === -1 ? 0 : idx;
}

export default function RoomsScreen() {
  const [school, setSchool] = usePref(PREF_KEYS.timetableSchool, 'FSC');
  const [day, setDay] = useState(defaultDay());
  const [slotIndex, setSlotIndex] = useState(defaultSlotIndex());

  const fetcher = school === 'FSM' ? fetchFSMTimetable : fetchFSCTimetable;
  const { data: raw, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<RawTimetableJSON>(`data:timetable:${school}`, fetcher, CACHE_TTL.timetable);

  const calendar = useMemo(() => (raw ? buildRoomCalendar(raw) : null), [raw]);

  const slot = STANDARD_SLOTS[slotIndex];
  const availability = useMemo(
    () => (calendar ? getAvailableRooms(calendar, day, slot.raw) : null),
    [calendar, day, slot]
  );

  const fullyGrouped = availability ? groupRoomsByBlock(availability.fullyVacant) : {};
  const partiallyGrouped = availability ? groupRoomsByBlock(availability.partiallyVacant) : {};

  const copyRooms = async (rooms: string[]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(rooms.join(', '));
  };

  if (isLoading) return <LoadingState label="Building room availability…" />;
  if (!raw || error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <Text style={styles.title}>Free Rooms</Text>
        <Text style={styles.subtitle}>Find empty classrooms and labs for any time slot.</Text>

        {isFromCache ? (
          <View style={{ marginTop: 12 }}>
            <OfflineNotice cached />
          </View>
        ) : null}

        <SectionHeader title="School" />
        <View style={styles.chipRow}>
          <Chip label="FSC · Computing" active={school === 'FSC'} onPress={() => setSchool('FSC')} />
          <Chip label="FSM · Management" active={school === 'FSM'} onPress={() => setSchool('FSM')} />
        </View>

        <SectionHeader title="Day" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {WEEKDAYS.map((d) => (
              <Chip key={d} label={d.slice(0, 3)} active={day === d} onPress={() => setDay(d)} />
            ))}
          </View>
        </ScrollView>

        <SectionHeader title="Time slot" />
        <View style={styles.chipColumn}>
          {STANDARD_SLOTS.map((s, i) => (
            <Chip key={s.raw} label={s.label} active={slotIndex === i} onPress={() => setSlotIndex(i)} />
          ))}
        </View>

        {availability ? (
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
              <Text style={styles.noneText}>No fully free rooms for this slot.</Text>
            ) : (
              <RoomGroups groups={fullyGrouped} />
            )}

            <SectionHeader title={`Partially free · ${availability.partiallyVacant.length}`} />
            {availability.partiallyVacant.length === 0 ? (
              <Text style={styles.noneText}>No partially free rooms for this slot.</Text>
            ) : (
              <RoomGroups groups={partiallyGrouped} />
            )}
          </>
        ) : (
          <EmptyState icon="location-outline" title="No data" message="Could not build the room calendar." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RoomGroups({ groups }: { groups: Record<string, string[]> }) {
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipColumn: { gap: 8 },
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
