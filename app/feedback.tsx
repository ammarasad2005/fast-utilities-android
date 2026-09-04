import React, { useMemo, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/ui';

/** Where feedback emails land. Single constant — change freely. */
const FEEDBACK_EMAIL = 'ammarasad321993@gmail.com';
const REPO_ISSUES_URL = 'https://github.com/ammarasad2005/fast-utilities-android/issues/new';

const TYPES = ['Bug report', 'Suggestion', 'Wrong data', 'Other'] as const;
type FeedbackType = (typeof TYPES)[number];

/**
 * Convenient user feedback. No backend: the message + auto context (version,
 * build, Android version) is prefilled into the user's email app — sends only
 * when they press send. GitHub issues offered as an alternative for devs.
 */
export default function FeedbackScreen() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [type, setType] = useState<FeedbackType>('Bug report');
  const [message, setMessage] = useState('');

  const version = Constants.expoConfig?.version ?? 'unknown';
  const build = Constants.expoConfig?.android?.versionCode ?? 'unknown';
  const api = Platform.Version;

  const contextLines = useMemo(
    () =>
      [
        '',
        '—',
        `App: FAST Utilities v${version} (build ${build})`,
        `OS: Android API ${api}`,
        `Type: ${type}`,
      ].join('\n'),
    [version, build, api, type]
  );

  const bodyText = `${message.trim() || '(write your message here)'}\n${contextLines}`;
  const subject = `[FAST Utilities] ${type} — v${version}`;

  const sendEmail = () => {
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    Linking.openURL(url).catch(() => {});
  };

  const openGitHub = () => {
    const url = `${REPO_ISSUES_URL}?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    Linking.openURL(url).catch(() => {});
  };

  const canSend = message.trim().length >= 4;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="Send Feedback" subtitle="One screen, two taps — it genuinely helps." />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>What's this about?</Text>
        <View style={styles.chipsRow}>
          {TYPES.map((t) => (
            <Pressable
              key={t}
              onPress={() => setType(t)}
              style={[styles.chip, type === t && { backgroundColor: colors.brand, borderColor: colors.brand }]}
            >
              <Text style={[styles.chipText, type === t && { color: colors.onBrand }]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Message</Text>
        <Card style={{ padding: 0 }}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={
              type === 'Wrong data'
                ? 'e.g. “Algo Sec D on Tuesday shows Room C-405 but it was D-411…”'
                : type === 'Bug report'
                  ? 'e.g. “The widget kept showing yesterday’s class on my phone…”'
                  : 'Tell me what you saw, or what you wish the app did…'
            }
            placeholderTextColor={colors.textTertiary}
            multiline
            style={[styles.input, { color: colors.text }]}
            textAlignVertical="top"
          />
        </Card>

        <Text style={styles.autoNote}>
          Your app version ({version} · build {build}) and Android version are attached automatically — no
          screenshots or personal data are collected.
        </Text>

        <Pressable
          onPress={sendEmail}
          disabled={!canSend}
          style={[styles.primaryBtn, !canSend && { opacity: 0.45 }]}
          android_ripple={{ color: colors.border }}
        >
          <Ionicons name="mail" size={17} color={colors.onBrand} />
          <Text style={styles.primaryBtnText}>Send in my email app</Text>
        </Pressable>

        <Pressable onPress={openGitHub} style={styles.secondaryBtn} android_ripple={{ color: colors.border }}>
          <Ionicons name="logo-github" size={16} color={colors.text} />
          <Text style={styles.secondaryBtnText}>Prefer GitHub? Open an issue instead</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, paddingBottom: 40 },
    label: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginTop: 14,
      marginBottom: 8,
    },
    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 7,
      backgroundColor: colors.raised,
    },
    chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
    input: { minHeight: 140, padding: 14, fontSize: 15, lineHeight: 21 },
    autoNote: { fontSize: 12, color: colors.textTertiary, lineHeight: 18, marginTop: 12 },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brand,
      borderRadius: 12,
      paddingVertical: 14,
      marginTop: 18,
    },
    primaryBtnText: { color: colors.onBrand, fontWeight: '700', fontSize: 15 },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 12,
      marginTop: 6,
    },
    secondaryBtnText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  });
