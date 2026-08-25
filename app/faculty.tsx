import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { deptAccent, deptAccentBg } from '@/theme/colors';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { useCachedData } from '@/hooks/useCachedData';
import { fetchFaculty } from '@/api/endpoints';
import { CACHE_TTL } from '@/api/config';
import { flattenFaculty, searchFaculty, formatFacultyShareText, DEPT_LABELS, DEPT_ORDER, type DeptFileKey } from '@/core/faculty';
import type { FacultyMember, RawFacultyDepartment } from '@/core/types';
import { Chip, ErrorState, LoadingState, OfflineNotice } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';

type FlatMember = FacultyMember & { deptKey: DeptFileKey };

async function copyMember(m: FlatMember) {
  await Clipboard.setStringAsync(formatFacultyShareText(m));
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

async function shareMember(m: FlatMember) {
  try {
    await Share.share({ message: formatFacultyShareText(m) });
  } catch {
    // user cancelled the sheet — nothing to do
  }
}

export default function FacultyScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [activeDept, setActiveDept] = useState<'ALL' | DeptFileKey>('ALL');
  const [selected, setSelected] = useState<FlatMember | null>(null);

  const { data: raw, isLoading, isFromCache, isRefreshing, error, refresh } =
    useCachedData<RawFacultyDepartment[]>('data:faculty', fetchFaculty, CACHE_TTL.faculty);

  const allMembers = useMemo<FlatMember[]>(() => (raw ? flattenFaculty(raw) : []), [raw]);

  const filtered = useMemo(() => {
    const byDept = activeDept === 'ALL' ? allMembers : allMembers.filter((m) => m.deptKey === activeDept);
    return searchFaculty(byDept, query);
  }, [allMembers, activeDept, query]);

  if (isLoading) return <LoadingState label="Loading faculty…" />;
  if (!raw || error) return <ErrorState message={error ?? undefined} onRetry={refresh} />;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Faculty Info" subtitle={`${allMembers.length} faculty members`} />
      <FlatList
        data={filtered}
        keyExtractor={(item, i) => `${item.email}-${i}`}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.brand} />}
        ListHeaderComponent={
          <View>
            {isFromCache ? (
              <View style={{ marginBottom: 12 }}>
                <OfflineNotice cached />
              </View>
            ) : null}

            <View style={styles.searchBox}>
              <Ionicons name="search" size={18} color={colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name, email, office…"
                placeholderTextColor={colors.textTertiary}
                returnKeyType="search"
              />
              {query ? (
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} onPress={() => setQuery('')} />
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginBottom: 8 }}>
              <View style={styles.chipRow}>
                <Chip label="All" active={activeDept === 'ALL'} onPress={() => setActiveDept('ALL')} />
                {DEPT_ORDER.map((d) => (
                  <Chip
                    key={d}
                    label={DEPT_LABELS[d]}
                    active={activeDept === d}
                    onPress={() => setActiveDept(d)}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => <FacultyRow member={item} onPress={() => setSelected(item)} />}
        ListEmptyComponent={
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <Text style={{ color: colors.textTertiary }}>No faculty match your search.</Text>
          </View>
        }
      />

      <FacultyModal member={selected} onClose={() => setSelected(null)} />
    </View>
  );
}

function FacultyRow({ member, onPress }: { member: FlatMember; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.border }}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <Image source={{ uri: member.image_url }} style={styles.avatar} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{member.name}</Text>
        <Text style={styles.status} numberOfLines={1}>
          {member.status}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={[styles.deptBadge, { backgroundColor: deptAccentBg[member.deptKey] ?? colors.infoBg }]}>
          <Text style={[styles.deptBadgeText, { color: deptAccent[member.deptKey] ?? colors.brand }]}>
            {member.deptKey}
          </Text>
        </View>
        <View style={styles.rowIcons}>
          <Pressable
            onPress={() => copyMember(member)}
            hitSlop={8}
            android_ripple={{ color: colors.border, borderless: true, radius: 18 }}
            accessibilityLabel={`Copy ${member.name}'s details`}
          >
            <Ionicons name="copy-outline" size={16} color={colors.textTertiary} />
          </Pressable>
          <Pressable
            onPress={() => shareMember(member)}
            hitSlop={8}
            android_ripple={{ color: colors.border, borderless: true, radius: 18 }}
            accessibilityLabel={`Share ${member.name}'s contact`}
          >
            <Ionicons name="share-social-outline" size={17} color={colors.textTertiary} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function FacultyModal({ member, onClose }: { member: FlatMember | null; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  if (!member) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <View style={{ alignItems: 'center' }}>
            <Image source={{ uri: member.image_url }} style={styles.modalAvatar} />
            <Text style={styles.modalName}>{member.name}</Text>
            <Text style={styles.modalStatus}>{member.status}</Text>
            <View style={[styles.deptBadge, { backgroundColor: deptAccentBg[member.deptKey] ?? colors.infoBg, marginTop: 6 }]}>
              <Text style={[styles.deptBadgeText, { color: deptAccent[member.deptKey] ?? colors.brand }]}>
                {DEPT_LABELS[member.deptKey]}
              </Text>
            </View>
          </View>

          <View style={{ gap: 10, marginTop: 18 }}>
            {member.email ? (
              <ActionRow
                icon="mail-outline"
                label={member.email}
                onPress={async () => {
                  await Clipboard.setStringAsync(member.email);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                }}
              />
            ) : null}
            <ActionRow
              icon="copy-outline"
              label="Copy details"
              onPress={() => copyMember(member)}
            />
            <ActionRow
              icon="share-social-outline"
              label="Share contact"
              onPress={() => shareMember(member)}
            />
            {member.office_room ? (
              <ActionRow icon="business-outline" label={`Office: ${member.office_room}`} />
            ) : null}
            {member.profile_url ? (
              <ActionRow
                icon="open-outline"
                label="View NU profile"
                onPress={() => Linking.openURL(member.profile_url)}
              />
            ) : null}
            {member.linkedin_profile ? (
              <ActionRow
                icon="logo-linkedin"
                label="LinkedIn"
                onPress={() => Linking.openURL(member.linkedin_profile!)}
              />
            ) : null}
          </View>

          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress?: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.border }} style={styles.actionRow}>
      <Ionicons name={icon} size={18} color={colors.brand} />
      <Text style={styles.actionLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
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
  chipRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.subtle },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  status: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  deptBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  rowIcons: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 2 },
  deptBadgeText: { fontSize: 11, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.raised, borderRadius: 20, padding: 20 },
  modalAvatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.subtle },
  modalName: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 10, textAlign: 'center' },
  modalStatus: { fontSize: 13, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  actionLabel: { flex: 1, fontSize: 14, color: colors.text },
  closeBtn: { marginTop: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: colors.subtle, alignItems: 'center' },
  closeText: { color: colors.text, fontWeight: '700' },
});
