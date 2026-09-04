import React, { useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';
import { scrollbarThumb } from '@/core/scrollbar';

export interface CourseGroup {
  courseName: string;
  /** Section labels in sheet order (already sorted by the caller). */
  sections: string[];
}

const ARROW_SLOT = 22;
const TRACK_GAP = 4;

/**
 * Course+section picker for the custom-timetable builder.
 *
 * The sheet is one single scroll surface: title, course rows AND the gaps
 * between them all belong to the same ScrollView, so a drag ANYWHERE in the
 * panel scrolls — no "scrollable area" hunting. The overlay is SPLIT (dim
 * Pressable and sheet are siblings, not nested), so nothing ever claims the
 * touch responder above the ScrollView — the old pattern that made drags
 * dead over most of the panel.
 *
 * The scrollbar is a slim directional rail (▲ / thumb / ▼) on the right
 * edge; the chevrons page a viewport per tap and dim at the ends. The thumb
 * is DRAGGABLE — grab it like a wheel and it scrubs the list directly, the
 * fallback for users whose swipes don't register. The stock system
 * indicator stays hidden; it gets covered by chip rows and reads badly.
 */
export function CourseSectionSelect({
  value,
  groups,
  onSelect,
  placeholder = 'Select course & section',
  disabled = false,
}: {
  /** Current `Course | Section` value (or placeholder when null/'' ). */
  value: string | null;
  groups: CourseGroup[];
  onSelect: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const { height: windowH } = useWindowDimensions();
  const [open, setOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const offsetRef = useRef(0); // live mirror for the pan responder
  offsetRef.current = offsetY;

  const sheetMaxH = Math.min(windowH * 0.66, 460);
  const canScroll = contentH > viewH + 8;
  const canUp = canScroll && offsetY > 8;
  const canDown = canScroll && offsetY < contentH - viewH - 8;

  const trackH = Math.max(0, viewH - 2 * ARROW_SLOT - 2 * TRACK_GAP);
  const thumb = scrollbarThumb(trackH, viewH, contentH, offsetY);

  const pageBy = (dir: -1 | 1) => {
    const span = Math.max(80, viewH * 0.85) * dir;
    const target = Math.min(Math.max(0, offsetY + span), Math.max(0, contentH - viewH));
    scrollRef.current?.scrollTo({ y: target, animated: true });
  };

  // ── Draggable scroll thumb ("the wheel") ─────────────────────────────────
  // 1px of thumb travel = 1px of track travel; converting through the track
  // maps it to content offset:  offset = thumbTravel * (contentH / trackH).
  // Delta from grab point, so there's no jump when the grab isn't centered.
  const thumbDragStart = useRef(0);
  const thumbPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        thumbDragStart.current = offsetRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const trackPxMax = Math.max(1, trackH - thumb.height);
        const contentMax = Math.max(0, contentH - viewH);
        const ratio = contentMax / trackPxMax;
        const target = Math.min(Math.max(0, thumbDragStart.current + g.dy * ratio), contentMax);
        scrollRef.current?.scrollTo({ y: target, animated: false });
      },
    })
  ).current;

  const display = value ? value.replace(' | ', ' · Sec ') : null;

  return (
    <>
      <Pressable
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
        style={({ pressed }) => [styles.field, pressed && !disabled && { opacity: 0.85 }, disabled && { opacity: 0.55 }]}
      >
        <Text style={[styles.fieldText, !display && { color: colors.textTertiary }]} numberOfLines={1}>
          {display ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        {/* Siblings, not nested: the dim layer dismisses; the sheet is inert
            so its children (ScrollView, chips, rail) own all gestures. */}
        <View style={styles.overlayRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.bodyRow}>
              <ScrollView
                ref={scrollRef}
                style={{ flex: 1, maxHeight: sheetMaxH }}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
                onContentSizeChange={(_w, h) => setContentH(h)}
                onScroll={(e) => setOffsetY(e.nativeEvent.contentOffset.y)}
              >
                <Text style={styles.sheetTitle}>{placeholder}</Text>
                {groups.map((g) => (
                  <View key={g.courseName} style={styles.groupRow}>
                    <Text style={styles.courseName} numberOfLines={1}>
                      {g.courseName}
                    </Text>
                    <View style={styles.sectionsRow}>
                      {g.sections.map((sec) => {
                        const pickValue = `${g.courseName} | ${sec}`;
                        const active = pickValue === value;
                        return (
                          <Pressable
                            key={sec}
                            unstable_pressDelay={90}
                            onPress={() => {
                              onSelect(pickValue);
                              setOpen(false);
                            }}
                            style={({ pressed }) => [
                              styles.sectionChip,
                              active && { backgroundColor: colors.brand, borderColor: colors.brand },
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            <Text style={[styles.sectionChipText, active && { color: colors.onBrand }]}>
                              {sec}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>

              {/* Directional scrollbar rail: ▲ / draggable thumb / ▼ */}
              {canScroll ? (
                <View style={[styles.rail, { height: viewH || undefined }]}>
                  <Pressable
                    onPress={() => pageBy(-1)}
                    disabled={!canUp}
                    hitSlop={8}
                    style={styles.railArrow}
                    accessibilityLabel="Scroll up"
                  >
                    <Ionicons
                      name="chevron-up"
                      size={15}
                      color={canUp ? colors.brand : colors.textTertiary}
                    />
                  </Pressable>
                  <View style={[styles.railTrack, { height: trackH }]}>
                    {/* invisible wide grab strip around the slim thumb */}
                    <View
                      {...thumbPan.panHandlers}
                      style={[styles.railThumbHit, {
                        height: Math.max(28, thumb.height),
                        top: Math.max(0, thumb.top - (Math.max(28, thumb.height) - thumb.height) / 2),
                      }]}
                      accessibilityLabel="Drag to scroll"
                    >
                      <View
                        style={[
                          styles.railThumb,
                          { height: thumb.height, backgroundColor: colors.brand },
                        ]}
                      >
                        {thumb.height >= 26 ? (
                          <View style={styles.railThumbGrip}>
                            <View style={styles.railThumbGroove} />
                            <View style={styles.railThumbGroove} />
                            <View style={styles.railThumbGroove} />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                  <Pressable
                    onPress={() => pageBy(1)}
                    disabled={!canDown}
                    hitSlop={8}
                    style={styles.railArrow}
                    accessibilityLabel="Scroll down"
                  >
                    <Ionicons
                      name="chevron-down"
                      size={15}
                      color={canDown ? colors.brand : colors.textTertiary}
                    />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      backgroundColor: colors.raised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    fieldText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '600' },
    overlayRoot: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.raised,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderStrong,
      marginTop: 10,
      marginBottom: 8,
    },
    bodyRow: { flexDirection: 'row', alignItems: 'flex-start' },
    sheetTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    groupRow: {
      paddingVertical: 12,
      gap: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    courseName: { fontSize: 14, fontWeight: '700', color: colors.text, paddingRight: 8 },
    sectionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    sectionChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 5,
      backgroundColor: colors.subtle,
    },
    sectionChipText: { fontSize: 12.5, fontWeight: '600', color: colors.text },
    // ── Directional scrollbar rail ─────────────────────────────────────────
    rail: {
      width: 22,
      marginLeft: 6,
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    railArrow: {
      width: ARROW_SLOT,
      height: ARROW_SLOT,
      borderRadius: ARROW_SLOT / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    railTrack: {
      width: 5,
      borderRadius: 3,
      backgroundColor: colors.subtle,
      marginVertical: TRACK_GAP,
      overflow: 'hidden',
      position: 'relative',
    },
    railThumb: {
      // visual grip: slightly wider than the track so it reads as a wheel
      width: 8,
      borderRadius: 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    railThumbHit: {
      // invisible widened touch target (~31pt) around the slim visual thumb
      position: 'absolute',
      left: -13,
      right: -13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    railThumbGrip: { gap: 3, alignItems: 'center' },
    railThumbGroove: {
      width: 4,
      height: 1.5,
      borderRadius: 1,
      backgroundColor: 'rgba(255,255,255,0.55)',
    },
  });
