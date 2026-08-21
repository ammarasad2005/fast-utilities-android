import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { colors } from '@/theme/colors';
import { API_BASE_URL } from '@/api/config';
import { Card } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';

export default function AboutScreen() {
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={styles.safe}>
      <ScreenHeader title="About" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={styles.appName}>FAST Utilities</Text>
          <Text style={styles.version}>Version {version} · Android</Text>
          <Text style={styles.body}>
            A native companion to the FAST Exam Table web app — timetables, exam schedules,
            free rooms, faculty info, semester plan and campus events for FAST-NU Islamabad,
            all in one place.
          </Text>
        </Card>

        <View style={{ marginTop: 16, gap: 10 }}>
          <LinkRow
            icon="globe-outline"
            title="Web app"
            subtitle={API_BASE_URL.replace('https://', '')}
            onPress={() => Linking.openURL('https://fast-nuces-isb.vercel.app')}
          />
          <LinkRow
            icon="logo-github"
            title="Source (web)"
            subtitle="github.com/ammarasad2005/exam-table"
            onPress={() => Linking.openURL('https://github.com/ammarasad2005/exam-table')}
          />
        </View>

        <Text style={styles.note}>
          All data is served by the existing FAST Exam Table backend on Vercel. The mobile app
          caches recently-viewed data so it keeps working offline; refresh to get the latest.
        </Text>
      </ScrollView>
    </View>
  );
}

function LinkRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} android_ripple={{ color: colors.border }} style={styles.linkRow}>
      <Ionicons name={icon} size={20} color={colors.brand} />
      <View style={{ flex: 1 }}>
        <Text style={styles.linkTitle}>{title}</Text>
        <Text style={styles.linkSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  appName: { fontSize: 22, fontWeight: '800', color: colors.text },
  version: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  body: { fontSize: 14, color: colors.text, lineHeight: 21, marginTop: 12 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  linkTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  linkSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  note: { fontSize: 12, color: colors.textTertiary, lineHeight: 18, marginTop: 24 },
});
