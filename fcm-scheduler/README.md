# FAST Utilities — push-notification scheduler

> **Status: SUPERSEDED (kept as the Blaze-plan upgrade path).** The live
> sender now runs on GitHub Actions in the web repo (`ammarasad2005/
> FAST-Utilities` — see `PUSH-SETUP.md` and `scripts/push/` there): instant
> fan-out from the timetable update workflows plus a `*/20` sweep — $0, no
> billing account needed. The Cloud Function below is the equivalent
> implementation to be deployed ONLY if a billing-backed Blaze project ever
> exists; it is not currently deployed.

Replaces the app's open-only local notification checks with **server-driven pings**:

```
Cloud Function (every 20 min)
  └─ fetches the 8 campus datasets your app caches
  └─ sha1-hashes each, diffs vs. Firestore state
  └─ on ANY change → high-priority, data-only FCM → topic `campus_updates`
        └─ PushMessagingService (native, wakes even a killed app through Doze)
             ├─ repaints placed widgets from their snapshot
             └─ expedited one-off BackgroundTaskWork → existing JS headless task
                  └─ re-fetches, runs the SAME tagged-only merged-summary diff,
                     posts alerts + republishes widgets
```

Per-user scoping (batch/dept/section tags) never leaves the phone — the server
only knows "dataset X changed", nothing about *who* cares. That keeps the
privacy story identical to today.

The app's old 15-minute WorkManager periodic sync stays registered as the
fallback for force-stopped/data-restricted states.

---

## One-time setup (~15 min)

### 1. Firebase console

1. <https://console.firebase.google.com> → **Add project** → name: `fast-utilities`
   (Google Analytics: off, not needed).
2. **Build → Firestore Database → Create database** → Production mode → region
   `eur3 (europe-west)` or `asia-south1` — whatever's fine, one doc is stored.
3. **Build → Functions**: upgrading to the **Blaze (pay-as-you-go) plan** is
   required for outbound network calls + scheduled functions. Expected cost:
   **$0.00/month** — 2,160 tiny invocations/mo + a handful of reads; far below
   the always-free tier (2M invocations). Set a budget alert at $1 under
   *Billing → Budgets* for peace of mind.

### 2. Android app linking

1. Firebase project → ⚙️ Project settings → **Add app → Android**:
   package `com.ammarasad.fastutilities`, nickname anything.
2. Download **`google-services.json`** → drop it into
   `fast-utilities-android/android/app/google-services.json`.
   (Root `build.gradle` already has the plugin classpath; `android/app/build.gradle`
   applies it **only when the file exists**, so builds without it still work.)
3. (Optional but do it) add your release debug fingerprints later if you ever
   enable App Check — **not needed** for plain FCM topic delivery.

### 3. Deploy the function

```bash
npm i -g firebase-tools
firebase login
cd fcm-scheduler
firebase use --add            # pick the fast-utilities project
firebase deploy --only functions
```

Watch the first scheduled run (or trigger manually from console → Functions →
⋮ → Run now): it seeds baseline hashes with **no alert storm**; the second run
with a real diff fans the ping.

### 4. Rebuild the APK

The native side (`PushMessagingService`, `PushSetupModule`, manifest, FCM dep)
is already in the repo — just produce a signed APK as usual and ship it.
`PushSetupModule` safely no-ops if the json is missing, so you can even test
in between.

### 5. Smoke test

- **Instant path**: in Firebase console → *Messaging → Send test message* is
  for token targeting; instead, edit `data/timetable.json` on Vercel (bump a
  comment) and wait ≤20 min — your phone should alert without opening the app,
  even when it was force-closed.
- **Fallback path**: with the function paused, the old 15-min WorkManager sync
  still notices changes on its own.

## Files here

- `firebase.json` — functions codebase config (Node 20 runtime)
- `functions/index.js` — `scheduleChangeCheck`, every 20 min, Asia/Karachi; also add the repo-side `plugins/withGoogleServices.js` (already committed, registered in app.json) and drop `android/app/google-services.json` in, re-run `npx expo prebuild`, rebuild
- `functions/package.json` — `firebase-admin` + `firebase-functions` v5

## App-side pieces already committed

- `modules/.../PushMessagingService.kt` — receives data-only pings, repaints
  widgets, enqueues the expedited JS re-sync
- `modules/.../PushSetupModule.kt` — idempotent `campus_updates` topic sub
- `src/notifications/push.ts` + `app/_layout.tsx` — bootstrap on app start
- `modules/widget-store/android/build.gradle` — `firebase-bom` + `firebase-messaging`
- Root + app `build.gradle` — `google-services` plugin (conditional on the json)
