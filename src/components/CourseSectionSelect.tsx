import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStyles, useTheme, type ThemeColors } from '@/theme/ThemeContext';

export interface CourseGroup {
  courseName: string;
  /** Section labels in sheet order (already sorted by the caller). */
  sections: string[];
}

/**
 * Course+section picker for the custom-timetable builder.
 *
 * The plain Dropdown listed one option per (course, section) pair — the same
 * course repeated per section, which read badly and hid the section step.
 * This variant keeps the same field + bottom-sheet affordance but groups by
 * course: name once, then section chips inline (the exact visual grammar of
 * the electives panel on the Timetable tab). The emitted value keeps the
 * legacy row format `Course Name | Section`, so BundleRow storage/matching
 * need no changes.
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
  const [open, setOpen] = useState(false);

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
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          {/* Sheet: claims taps so they don't bubble to the dismiss-backdrop,
              but YIELDS to the list's drag (termination grants) — the
              respondent Pressable pattern it replaces ate chip-start drags. */}
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>{placeholder}</Text>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.courseName}
              renderItem={({ item: g }) => (
                <View style={styles.groupRow}>
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
              )}
              style={{ maxHeight: 340 }}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </Pressable>
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
    backdrop: {
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
    courseName: { fontSize: 14, fontWeight: '700', color: colors.text },
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
  });
