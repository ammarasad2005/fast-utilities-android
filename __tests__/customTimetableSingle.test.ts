/**
 * Single-slot custom-timetable migration + grid shade helpers.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BUNDLES_KEY, migrateBundlesToSingle, loadBundles } from '@/prefs/bundles';
import { getSavedSchedule } from '@/prefs/savedSchedule';
import { deepenFill } from '@/theme/colors';
import type { CustomBundle } from '@/prefs/bundles';

const b = (id: string): CustomBundle => ({
  id,
  name: id,
  school: 'FSC',
  rows: [{ id: `${id}-r1`, batch: '2024', dept: 'CS', category: 'regular', selection: 'Course | A' }],
});

const seed = async (bundles: CustomBundle[], saved?: unknown) => {
  await AsyncStorage.setItem(BUNDLES_KEY, JSON.stringify(bundles));
  if (saved !== undefined) {
    await AsyncStorage.setItem('pref:saved_schedule', JSON.stringify(saved));
  }
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('migrateBundlesToSingle (locked: delete extras silently)', () => {
  test('zero or one bundle → untouched', async () => {
    await seed([b('new')]);
    await migrateBundlesToSingle();
    expect((await loadBundles()).map((x) => x.id)).toEqual(['new']);
  });

  test('multiple, no tag → keeps the most recent (list[0], newest-first)', async () => {
    await seed([b('new'), b('old')]);
    await migrateBundlesToSingle();
    expect((await loadBundles()).map((x) => x.id)).toEqual(['new']);
  });

  test('multiple, tag on a NON-first bundle → keeps the TAGGED one', async () => {
    await seed([b('new'), b('old')], { kind: 'bundle', bundleId: 'old' });
    await migrateBundlesToSingle();
    expect((await loadBundles()).map((x) => x.id)).toEqual(['old']);
    const saved = await getSavedSchedule();
    expect(saved?.kind === 'bundle' && saved.bundleId).toBe('old');
  });

  test('tag dangling on a deleted bundle → tag cleared', async () => {
    // Tag points at a bundle not even in the list (shouldn't normally happen).
    await seed([b('new'), b('old')], { kind: 'bundle', bundleId: 'ghost' });
    await migrateBundlesToSingle();
    expect((await loadBundles()).map((x) => x.id)).toEqual(['new']);
    expect(await getSavedSchedule()).toBeNull();
  });

  test('default-config tag is never disturbed', async () => {
    const def = { kind: 'default', school: 'FSC', batch: '2024', dept: 'CS', section: 'A' };
    await seed([b('new'), b('old')], def);
    await migrateBundlesToSingle();
    expect(await getSavedSchedule()).toEqual(def);
    expect((await loadBundles()).map((x) => x.id)).toEqual(['new']);
  });
});

describe('deepenFill (today-column cell shade step)', () => {
  test('hex pastel is pulled toward the accent (stays #hex, all channels shift)', () => {
    const out = deepenFill('#EFF6FF', '#1D4ED8'); // CS light cell on classic
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.toLowerCase()).not.toBe('#eff6ff');
    // red channel: 0xEF*0.9 + 0x1D*0.1 = 217.5 → 218 = 0xDA
    expect(out.slice(1, 3).toLowerCase()).toBe('da');
  });

  test('rgba fill gets an alpha bump (dark themes)', () => {
    expect(deepenFill('rgba(96,165,250,0.17)', '#93C5FD')).toBe('rgba(96, 165, 250, 0.25)');
  });

  test('alpha is capped', () => {
    expect(deepenFill('rgba(1,2,3,0.82)', '#000000')).toBe('rgba(1, 2, 3, 0.85)');
  });

  test('opaque rgba-less rgb / unknown formats pass through', () => {
    expect(deepenFill('rgb(1,2,3)', '#000000')).toBe('rgb(1,2,3)');
    expect(deepenFill('transparent', '#000000')).toBe('transparent');
  });
});
