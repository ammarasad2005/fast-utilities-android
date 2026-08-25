/**
 * Home banner shown when version.json advertises a newer build.
 *
 * Download via expo-file-system (progress shown live in MB), then hand off to
 * the system installer through the local AppUpdater native module. If Android's
 * "install unknown apps" gate is closed for us, the module deep-links its
 * setting and we invite the user to retry.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, Animated } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as FileSystem from 'expo-file-system/legacy';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import type { RemoteVersion } from '@/updates/checkUpdate';
import { getAppUpdater } from '../../modules/widget-store/src/AppUpdaterModule';

type Phase =
  | { kind: 'offer' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'needsPermission' }
  | { kind: 'failed' };

export function UpdateBanner({ remote, onDismiss }: { remote: RemoteVersion; onDismiss: () => void }) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>({ kind: 'offer' });
  const fade = useState(() => new Animated.Value(0))[0];

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startDownload = async () => {
    const updater = getAppUpdater();
    if (!updater) return;
    const dest = `${FileSystem.cacheDirectory}fast-utilities-update.apk`;
    try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch {}
    setPhase({ kind: 'downloading', done: 0, total: 0 });
    try {
      const dl = FileSystem.createDownloadResumable(remote.apkUrl, dest, {}, (p) => {
        setPhase((prev) =>
          prev.kind === 'downloading'
            ? { kind: 'downloading', done: p.totalBytesWritten, total: p.totalBytesExpectedToWrite }
            : prev
        );
      });
      const res = await dl.downloadAsync();
      if (!res || res.status !== 200) {
        setPhase({ kind: 'failed' });
        return;
      }
      setPhase({ kind: 'ready' });
      const launched = updater.installApk(res.uri);
      if (!launched) setPhase({ kind: 'needsPermission' });
    } catch {
      setPhase({ kind: 'failed' });
    }
  };

  const retryInstall = () => {
    const updater = getAppUpdater();
    if (!updater) return;
    const launched = updater.installApk(`${FileSystem.cacheDirectory}fast-utilities-update.apk`);
    if (!launched) setPhase({ kind: 'needsPermission' });
  };

  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

  return (
    <Animated.View style={[styles.banner, { opacity: fade }]}>
      <View style={styles.headerRow}>
        <Ionicons name="cloud-download" size={18} color={colors.warning} />
        <Text style={styles.title}>Update available · build {remote.versionCode}</Text>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Ionicons name="close" size={17} color={colors.textTertiary} />
        </Pressable>
      </View>

      {remote.notes ? (
        <Text style={styles.notes} numberOfLines={3}>
          {remote.notes}
        </Text>
      ) : null}

      {phase.kind === 'downloading' ? (
        <View>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                {
                  width:
                    phase.total > 0
                      ? `${Math.min(100, Math.round((phase.done / phase.total) * 100))}%`
                      : '8%',
                },
              ]}
            />
          </View>
          <Text style={styles.progress}>
            {phase.total > 0 ? `${mb(phase.done)} / ${mb(phase.total)} MB` : `${mb(phase.done)} MB…`}
          </Text>
        </View>
      ) : phase.kind === 'needsPermission' ? (
        <View style={styles.noteRow}>
          <Ionicons name="shield-checkmark-outline" size={15} color={colors.warning} />
          <Text style={styles.smallText}>
            Allow “Install unknown apps” for FAST Utilities in the screen that opened, then tap Install again.
          </Text>
        </View>
      ) : phase.kind === 'failed' ? (
        <Text style={styles.smallText}>Download failed — check your connection and try again.</Text>
      ) : null}

      <View style={styles.actions}>
        {phase.kind === 'offer' || phase.kind === 'failed' ? (
          <Pressable onPress={startDownload} style={styles.primaryBtn} android_ripple={{ color: colors.border }}>
            <Ionicons name="download-outline" size={15} color={colors.onBrand} />
            <Text style={styles.primaryText}>{phase.kind === 'failed' ? 'Retry download' : 'Download & Install'}</Text>
          </Pressable>
        ) : null}
        {phase.kind === 'ready' || phase.kind === 'needsPermission' ? (
          <Pressable onPress={retryInstall} style={styles.primaryBtn} android_ripple={{ color: colors.border }}>
            <Ionicons name="build-outline" size={15} color={colors.onBrand} />
            <Text style={styles.primaryText}>Install now</Text>
          </Pressable>
        ) : null}
        {phase.kind === 'offer' ? (
          <Pressable onPress={onDismiss} style={styles.laterBtn} android_ripple={{ color: colors.border }}>
            <Text style={styles.laterText}>Later</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    banner: {
      backgroundColor: colors.raised,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: colors.warning,
      padding: 13,
      marginBottom: 12,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 13.5, fontWeight: '800', color: colors.text },
    notes: { marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    track: { marginTop: 10, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
    fill: { height: 6, borderRadius: 3, backgroundColor: colors.warning },
    progress: { marginTop: 5, fontSize: 11, fontWeight: '600', color: colors.textTertiary },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
    smallText: { flex: 1, fontSize: 11.5, lineHeight: 16, color: colors.textSecondary },
    actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.brand,
      borderRadius: 9,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    primaryText: { fontSize: 12, fontWeight: '800', color: colors.onBrand },
    laterBtn: {
      borderRadius: 9,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    laterText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  });
