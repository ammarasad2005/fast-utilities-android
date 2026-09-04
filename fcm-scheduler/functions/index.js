/**
 * FAST Utilities — server-side change detector & push fanout.
 *
 * Every 20 minutes: fetch the same public campus datasets the app caches,
 * sha1-hash each payload, diff against the hashes persisted in Firestore
 * (notifications_state/hashes). Any changed dataset key is bundled into a
 * SINGLE data-only, high-priority FCM message to the `campus_updates` topic.
 *
 * Why data-only + one topic:
 *  - Per-user scoping NEVER leaves the device. The phone receives the ping,
 *    re-fetches, and its EXISTING local diff decides what the *tagged* user
 *    should actually be told about (merged summaries stay untouched).
 *  - No user prefs/tokens in Firestore → privacy story stays one line long.
 *  - High priority data messages wake killed apps on Android even under
 *    Doze/OEM battery restrictions (the reported failure mode of periodic
 *    client-side timers).
 */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('node:crypto');

initializeApp();
const db = getFirestore();
const STATE_DOC = db.doc('notifications_state/hashes');

const API_BASE = process.env.CAMPUS_API_BASE ?? 'https://fast-nuces-isb.vercel.app';

/** key → endpoint (keys mirror the app's AsyncStorage cache keys). */
const DATASETS = {
  'data:timetable:FSC': '/data/timetable.json',
  'data:timetable:FSM': '/data/fsm_timetable.json',
  'data:regular_schedule': '/data/regular_schedule.json',
  'data:summer_schedule': '/data/summer_schedule.json',
  'data:faculty': '/data/faculty/faculty_data.json',
  'data:semester': '/data/semester_calendar.json',
  'data:student_events': '/data/student_events.json',
  'data:exam_visibility': '/api/exam-visibility',
};

const TIMEZONE = 'Asia/Karachi';

async function fetchAndHash(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'user-agent': 'fast-utilities-change-detector/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const text = await res.text();
  return crypto.createHash('sha1').update(text).digest('hex');
}

exports.scheduleChangeCheck = onSchedule(
  {
    schedule: 'every 20 minutes',
    timeZone: TIMEZONE,
    retryCount: 1,
    timeoutSeconds: 120,
    memory: '128MiB',
  },
  async () => {
    const snap = await STATE_DOC.get();
    const previous = snap.exists ? snap.data() : {};

    // Fetch all datasets independently; per-dataset failure just skips it this run.
    const entries = await Promise.all(
      Object.entries(DATASETS).map(async ([key, path]) => {
        try {
          return [key, await fetchAndHash(path)];
        } catch (err) {
          logger.warn(`fetch failed for ${key}: ${err.message}`);
          return [key, null];
        }
      })
    );

    const next = { ...previous };
    const changed = [];
    for (const [key, hash] of entries) {
      if (!hash) continue;
      if (previous[key] === undefined) {
        next[key] = hash; // first run: seed baseline, no alert storm
        continue;
      }
      if (previous[key] !== hash) {
        changed.push(key);
        next[key] = hash;
      }
    }
    await STATE_DOC.set(next, { merge: true });

    if (changed.length === 0) {
      logger.info('no dataset changes');
      return;
    }

    const payload = {
      keys: changed.join(','),
      at: Date.now().toString(),
    };
    await getMessaging().send({
      topic: 'campus_updates',
      data: payload,
      android: { priority: 'HIGH', ttl: 60 * 60 * 1000 }, // 1h — pings are re-computable, don't let them pile up
    });
    logger.info(`fanned out change ping: ${payload.keys}`);
  }
);
