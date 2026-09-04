import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';

const ITEMS: {
  id: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}[] = [
  { id: 'faculty', title: 'Faculty Info', description: 'Emails, offices and details for all faculty members.', icon: 'people', route: '/faculty' },
  { id: 'semester', title: 'Semester Schedule', description: 'Academic calendar — key dates, sessionals and finals.', icon: 'flag', route: '/semester' },
  { id: 'events', title: 'Campus Events', description: 'Seminars, drives and activities in a monthly view.', icon: 'sparkles', route: '/events' },
  { id: 'feedback', title: 'Send Feedback', description: 'Report a bug, flag wrong data, or suggest something — in two taps.', icon: 'chatbox-ellipses', route: '/feedback' },
  { id: 'about', title: 'About', description: 'App details, data sources and attribution.', icon: 'information-circle', route: '/about' },
];

export default function MoreScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.subtitle}>Everything else FAST Islamabad has to offer.</Text>

        <View style={{ marginTop: 20, gap: 10 }}>
          {ITEMS.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(item.route as any)}
              android_ripple={{ color: colors.border }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={22} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.footer}>FAST NUCES · Islamabad Campus</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 32 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.raised,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 11,
    backgroundColor: colors.infoBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowDesc: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  footer: { textAlign: 'center', color: colors.textTertiary, fontSize: 11, marginTop: 32 },
});
