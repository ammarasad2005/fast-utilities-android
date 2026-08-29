/**
 * About-screen "Check for updates" card — the always-reachable manual entry
 * point for the sideload updater. Reflects the last automatic check from the
 * persisted manifest cache, and force-checks (bypassing throttle + snooze)
 * when tapped. On a hit it renders the real UpdateBanner inline, so the
 * download/install path is identical to the Home banner.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { Card } from '@/components/ui';
import { UpdateBanner } from '@/components/UpdateBanner';
import {
  dismissUpdate,
  forceCheckNow,
  localVersionCode,
  readUpdateDiagnostics,
  type RemoteVersion,
  type UpdateDiagnostics,
} from '@/updates/checkUpdate';

type State =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'current'; remote: RemoteVersion }
  | { kind: 'update'; remote: RemoteVersion }
  | { kind: 'unreachable' };

function timeAgo(at: number, now: number): string {
  const mins = Math.max(1, Math.round((now - at) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function UpdateCheckCard() {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [diag, setDiag] = useState<{ data: UpdateDiagnostics; at: number } | null>(null);

  const refreshDiag = useCallback(() => {
    readUpdateDiagnostics().then((data) => setDiag({ data, at: Date.now() }));
  }, []);
  useEffect(refreshDiag, [refreshDiag]);

  const checkNow = async () => {
    setState({ kind: 'checking' });
    const res = await forceCheckNow();
    refreshDiag();
    setState(
      res.kind === 'update'
        ? { kind: 'update', remote: res.remote }
        : res.kind === 'current'
          ? { kind: 'current', remote: res.remote }
          : { kind: 'unreachable' }
    );
  };

  const versionName = Constants.expoConfig?.version ?? '?';

  return (
    <Card>
      <Text style={styles.eyebrow}>App updates</Text>
      <Text style={styles.installed}>
        Installed: build {localVersionCode()} · v{versionName}
      </Text>

      {state.kind === 'update' ? (
        <View style={{ marginTop: 10 }}>
          <UpdateBanner
            remote={state.remote}
            onDismiss={() => {
              dismissUpdate(state.remote.versionCode);
              setState({ kind: 'idle' });
            }}
          />
        </View>
      ) : (
        <>
          {state.kind === 'checking' ? (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color={colors.brand} />
              <Text style={styles.status}>Checking for updates…</Text>
            </View>
          ) : state.kind === 'current' ? (
            <View style={styles.statusRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.status}>
                You’re on the latest build (server build {state.remote.versionCode}).
              </Text>
            </View>
          ) : state.kind === 'unreachable' ? (
            <View style={styles.statusRow}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
              <Text style={styles.status}>
                Couldn’t reach the update server — check your connection and try again.
              </Text>
            </View>
          ) : diag ? (
            <Text style={styles.statusMuted}>
              {diag.data.lastCheckAt
                ? `Last checked ${timeAgo(diag.data.lastCheckAt, diag.at)} · server build ${
                    diag.data.cached?.versionCode ?? '—'
                  }`
                : 'No successful update check yet.'}
            </Text>
          ) : null}

          <Pressable
            onPress={checkNow}
            disabled={state.kind === 'checking'}
            android_ripple={{ color: colors.border }}
            style={[styles.checkBtn, state.kind === 'checking' && { opacity: 0.6 }]}
          >
            <Ionicons name="refresh" size={15} color={colors.onBrand} />
            <Text style={styles.checkBtnText}>Check now</Text>
          </Pressable>
        </>
      )}
    </Card>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    eyebrow: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.9,
      color: colors.textTertiary,
      textTransform: 'uppercase',
    },
    installed: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 6 },
    statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginTop: 10 },
    status: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary },
    statusMuted: { fontSize: 12.5, lineHeight: 18, color: colors.textTertiary, marginTop: 8 },
    checkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      backgroundColor: colors.brand,
      borderRadius: 9,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginTop: 12,
    },
    checkBtnText: { fontSize: 12, fontWeight: '800', color: colors.onBrand },
  });
