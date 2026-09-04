import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { API_BASE_URL } from '@/api/config';
import { Card } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UpdateCheckCard } from '@/components/UpdateCheckCard';

export default function AboutScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={styles.safe}>
      <ScreenHeader title="About" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Card>
          <Text style={styles.appName}>FAST Utilities</Text>
          <Text style={styles.version}>Version {version} · Android</Text>
          <Text style={styles.body}>
            The native companion for FAST-NU Islamabad students — timetables, exam schedules,
            free rooms, faculty info, semester plan and campus events, all in one place.
          </Text>
        </Card>

        <View style={{ marginTop: 16 }}>
          <UpdateCheckCard />
        </View>

        <View style={{ marginTop: 16 }}>
          <Card>
            <Text style={styles.devEyebrow}>Developer</Text>
          <Text style={styles.devName}>Muhammad Ammar Asad</Text>
          <Text style={styles.body}>BS Computer Science · FAST-NU Islamabad</Text>
          <View style={styles.devIcons}>
            <Pressable
              onPress={() => Linking.openURL('https://www.linkedin.com/in/muhammad-ammar-asad')}
              style={styles.devIconBtn}
              android_ripple={{ color: colors.border, borderless: true, radius: 22 }}
              accessibilityLabel="Open LinkedIn profile"
            >
              <Ionicons name="logo-linkedin" size={22} color={colors.brand} />
            </Pressable>
            <Pressable
              onPress={() => Linking.openURL('https://github.com/ammarasad2005')}
              style={styles.devIconBtn}
              android_ripple={{ color: colors.border, borderless: true, radius: 22 }}
              accessibilityLabel="Open GitHub profile"
            >
              <Ionicons name="logo-github" size={22} color={colors.text} />
            </Pressable>
          </View>
          </Card>
        </View>

        <View style={{ marginTop: 16, gap: 10 }}>
          <LinkRow
            icon="globe-outline"
            title="Web app"
            subtitle={API_BASE_URL.replace('https://', '')}
            onPress={() => Linking.openURL('https://fast-nuces-isb.vercel.app')}
          />
          <LinkRow
            icon="logo-github"
            title="App source"
            subtitle="github.com/ammarasad2005/fast-utilities-android"
            onPress={() => Linking.openURL('https://github.com/ammarasad2005/fast-utilities-android')}
          />
          <LinkRow
            icon="chatbox-ellipses-outline"
            title="Send feedback"
            subtitle="Bug reports, wrong data, ideas — straight to the developer"
            onPress={() => router.push('/feedback')}
          />
        </View>


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
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
  devEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
    color: colors.textTertiary,
    textTransform: 'uppercase',
  },
  devName: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 4 },
  devIcons: { flexDirection: 'row', gap: 8, marginTop: 12 },
  devIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.raised,
  },
});
