/**
 * Updater reliability suite (v1.9.4 hardening):
 *  · endpoint fallback chain (raw → GitHub API → jsDelivr)
 *  · failure-safe throttle — a failed check must NOT consume the window
 *  · cached manifest re-surfaces the banner while throttled ("Later" can't bury it)
 *  · per-version dismiss snooze; force check bypasses both throttle and snooze
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildManifestEndpoints,
  checkForUpdateNow,
  dismissUpdate,
  DISMISS_SNOOZE_MS,
  fetchRemoteVersion,
  forceCheckNow,
  localVersionCode,
  parseRemoteVersion,
  readCachedRemote,
  readUpdateDiagnostics,
  shouldShowUpdate,
  type RemoteVersion,
} from '@/updates/checkUpdate';

const LAST_CHECK_KEY = 'updater:last_check';

const manifest = (versionCode: number): RemoteVersion => ({
  versionCode,
  apkUrl: 'https://github.com/ammarasad2005/fast-utilities-android/releases/download/vX/app-release.apk',
  notes: 'test',
});

const res = (body: unknown, ok = true) =>
  ({ ok, status: ok ? 200 : 503, json: async () => body }) as unknown as Response;
const fail = () => Promise.reject(new Error('network down'));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('parseRemoteVersion', () => {
  it('accepts a well-formed manifest and rejects garbage', () => {
    expect(parseRemoteVersion(manifest(99))?.versionCode).toBe(99);
    expect(parseRemoteVersion(null)).toBeNull();
    expect(parseRemoteVersion({ versionCode: 'x', apkUrl: 5 })).toBeNull();
    expect(parseRemoteVersion({ apkUrl: 'https://x' })).toBeNull();
  });
});

describe('buildManifestEndpoints', () => {
  it('orders raw first (cache-busted), API second, jsDelivr last', () => {
    const eps = buildManifestEndpoints(12345);
    expect(eps).toHaveLength(3);
    expect(eps[0].url).toContain('raw.githubusercontent.com');
    expect(eps[0].url).toContain('t=12345');
    expect(eps[1].url).toContain('api.github.com/repos/');
    expect(eps[1].headers?.Accept).toContain('application/vnd.github.raw');
    expect(eps[2].url).toContain('cdn.jsdelivr.net');
  });
});

describe('fetchRemoteVersion fallback chain', () => {
  it('uses the primary endpoint when it works (single call)', async () => {
    const faux = jest.fn().mockResolvedValue(res(manifest(50)));
    const got = await fetchRemoteVersion(faux);
    expect(faux).toHaveBeenCalledTimes(1);
    expect(got?.versionCode).toBe(50);
  });

  it('falls through to the API endpoint when raw is unreachable', async () => {
    const faux = jest.fn()
      .mockImplementationOnce(fail)
      .mockResolvedValueOnce(res(manifest(51)));
    const got = await fetchRemoteVersion(faux);
    expect(faux).toHaveBeenCalledTimes(2);
    expect((faux.mock.calls[1][0] as string)).toContain('api.github.com');
    expect(got?.versionCode).toBe(51);
  });

  it('falls through to jsDelivr when earlier endpoints error', async () => {
    const faux = jest.fn()
      .mockResolvedValueOnce(res({}, false)) // raw → HTTP error
      .mockImplementationOnce(fail) // api → network error
      .mockResolvedValueOnce(res(manifest(52))); // jsdelivr
    const got = await fetchRemoteVersion(faux);
    expect(faux).toHaveBeenCalledTimes(3);
    expect((faux.mock.calls[2][0] as string)).toContain('cdn.jsdelivr.net');
    expect(got?.versionCode).toBe(52);
  });

  it('treats a valid HTTP response with a malformed body as a miss', async () => {
    const faux = jest.fn()
      .mockResolvedValueOnce(res({ hello: 'not a manifest' })) // parse fail → next
      .mockResolvedValueOnce(res(manifest(53)));
    const got = await fetchRemoteVersion(faux);
    expect(faux).toHaveBeenCalledTimes(2);
    expect(got?.versionCode).toBe(53);
  });

  it('returns null when every endpoint fails', async () => {
    const faux = jest.fn().mockImplementation(fail);
    expect(await fetchRemoteVersion(faux)).toBeNull();
    expect(faux).toHaveBeenCalledTimes(3);
  });
});

describe('failure-safe throttle', () => {
  it('a failed check does NOT consume the throttle window', async () => {
    const faux = jest.fn().mockImplementation(fail);
    expect(await checkForUpdateNow({ fetchImpl: faux })).toBeNull();
    expect(await AsyncStorage.getItem(LAST_CHECK_KEY)).toBeNull();

    // connectivity returns → the very next mount retries immediately
    faux.mockResolvedValue(res(manifest(localVersionCode() + 1)));
    const got = await checkForUpdateNow({ fetchImpl: faux });
    expect(got?.versionCode).toBe(localVersionCode() + 1);
    expect(await AsyncStorage.getItem(LAST_CHECK_KEY)).not.toBeNull();
  });

  it('a successful check commits throttle + caches the manifest', async () => {
    const faux = jest.fn().mockResolvedValue(res(manifest(localVersionCode() + 1)));
    await checkForUpdateNow({ fetchImpl: faux });
    const cached = await readCachedRemote();
    expect(cached?.versionCode).toBe(localVersionCode() + 1);
    expect(typeof cached?.fetchedAt).toBe('number');
  });

  it('while throttled, a cached newer manifest still surfaces (Later cannot bury it)', async () => {
    const vc = localVersionCode() + 1;
    const faux = jest.fn().mockResolvedValue(res(manifest(vc)));
    expect((await checkForUpdateNow({ fetchImpl: faux }))?.versionCode).toBe(vc);

    // Second mount within the 6h window: NO network call, update still returned
    const again = await checkForUpdateNow({ fetchImpl: jest.fn().mockImplementation(fail) });
    expect(again?.versionCode).toBe(vc);
  });

  it('cached manifest at/below local build suppresses the banner', async () => {
    const faux = jest.fn().mockResolvedValue(res(manifest(localVersionCode()))); // same build
    expect(await checkForUpdateNow({ fetchImpl: faux })).toBeNull();
    const again = await checkForUpdateNow({ fetchImpl: jest.fn().mockImplementation(fail) });
    expect(again).toBeNull();
  });
});

describe('dismiss snooze', () => {
  it('dismissing hides the same build for the snooze window, then it returns', async () => {
    const vc = localVersionCode() + 1;
    const remote = manifest(vc);
    await dismissUpdate(vc);
    expect(shouldShowUpdate(remote, { versionCode: vc, at: Date.now() }, Date.now())).toBe(false);
    expect(
      shouldShowUpdate(
        remote,
        { versionCode: vc, at: Date.now() - DISMISS_SNOOZE_MS - 60_000 },
        Date.now()
      )
    ).toBe(true);
  });

  it('a dismissal never hides a NEWER build', () => {
    const newer = manifest(localVersionCode() + 2);
    expect(
      shouldShowUpdate(newer, { versionCode: localVersionCode() + 1, at: Date.now() }, Date.now())
    ).toBe(true);
  });

  it('throttled cached check respects the dismissal …', async () => {
    const vc = localVersionCode() + 1;
    const faux = jest.fn().mockResolvedValue(res(manifest(vc)));
    await checkForUpdateNow({ fetchImpl: faux });
    await dismissUpdate(vc);
    const again = await checkForUpdateNow({ fetchImpl: jest.fn().mockImplementation(fail) });
    expect(again).toBeNull();
  });

  it('… but a force check bypasses it', async () => {
    const vc = localVersionCode() + 1;
    const faux = jest.fn().mockResolvedValue(res(manifest(vc)));
    await dismissUpdate(vc);
    const got = await checkForUpdateNow({ force: true, fetchImpl: faux });
    expect(got?.versionCode).toBe(vc);
  });
});

describe('forceCheckNow result kinds', () => {
  it('reports "update" when server is newer', async () => {
    const faux = jest.fn().mockResolvedValue(res(manifest(localVersionCode() + 1)));
    const r = await forceCheckNow(faux);
    expect(r.kind).toBe('update');
  });

  it('reports "current" when server is at/below local build', async () => {
    const faux = jest.fn().mockResolvedValue(res(manifest(localVersionCode())));
    const r = await forceCheckNow(faux);
    expect(r.kind).toBe('current');
  });

  it('reports "unreachable" when every endpoint fails', async () => {
    const faux = jest.fn().mockImplementation(fail);
    const r = await forceCheckNow(faux);
    expect(r.kind).toBe('unreachable');
  });
});

describe('diagnostics', () => {
  it('reflects the last successful check for the About card', async () => {
    const before = await readUpdateDiagnostics();
    expect(before.lastCheckAt).toBeNull();
    expect(before.cached).toBeNull();

    const faux = jest.fn().mockResolvedValue(res(manifest(localVersionCode() + 1)));
    await checkForUpdateNow({ fetchImpl: faux });
    const after = await readUpdateDiagnostics();
    expect(typeof after.lastCheckAt).toBe('number');
    expect(after.cached?.versionCode).toBe(localVersionCode() + 1);
    expect(after.dismissed).toBeNull();
  });
});
