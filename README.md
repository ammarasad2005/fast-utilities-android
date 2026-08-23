# FAST Utilities — Android

A **native Android companion** to the [FAST Exam Table](https://fast-nuces-isb.vercel.app) web app, built with **React Native + Expo + TypeScript**.

Timetables, exam schedules, free rooms, faculty info, the semester plan and campus events for **FAST-NUCES Islamabad** — designed for one-handed, offline-friendly use on Android.

> This is a **separate project/repository** from the web app. It does **not** modify or wrap the web app — it is a genuinely native client that consumes the *same backend, data files and APIs*.

---

## Features

| Feature | What it does |
|---|---|
| **Exam Finder** | Every exam date & time, filtered by school → batch → department, with search, copy, and admin-controlled visibility (hidden until exams are published). |
| **Custom Exam Schedule** | Combine exams from any courses you pick (batch / dept / code) into one schedule, with saved bundles. |
| **Timetable** | Weekly class schedule for FSC & FSM with list **and grid** views, image export/share, and search. |
| **Custom Timetable** | Build a clash-checked schedule from any classes, with time-clash highlighting and saved bundles. |
| **Free Rooms** | Campus-wide room availability (no school split), grouped by block, for a specific time slot **or** a custom time range. |
| **Faculty Info** | Searchable directory with emails, offices and profiles (tap to copy). |
| **Semester Schedule** | Academic calendar with key dates, **holidays**, sessionals and finals, plus an "up next" list. |
| **Semester Timeline** | A sleek live progress bar (with S1/S2/FE markers) on the landing screen. |
| **Next / Ongoing Class** | Bento card on the landing screen tracking your **tagged timetable** (default config or a saved custom bundle): shows the class in progress with a live "← time left" countdown and progress bar, or the next class with "in Xh Ym" (+ date when it's not today). Uses the web app's exact rules — 5:30 PM rollover to tomorrow, semester-start suppression, cancelled/rescheduled handling, parallel-class grouping. |
| **Campus Events** | Monthly calendar of student events, seminars and drives. |

All data is served by the **existing web app's Vercel backend** — no duplicate database, backend or AI infrastructure was created. The only backend addition is a tiny, additive [`/api/exam-visibility`](https://github.com/ammarasad2005/FAST-Utilities/blob/main/src/app/api/exam-visibility/route.ts) endpoint in the web repo so the app can honour the admin "show exams" toggle without shipping Supabase credentials.

---

## Architecture

```
┌────────────────────────┐        ┌─────────────────────────────────────┐
│  React Native (Expo)   │  HTTP  │   Existing web app (Next.js/Vercel) │
│  - Android client      │ ─────► │   fast-nuces-isb.vercel.app         │
│  - Local cache         │        │   /data/*.json  (static data CDN)   │
│  - Offline-first UX    │        │   /api/*        (API routes)        │
└────────────────────────┘        └──────────────┬──────────────────────┘
                                                 │
                                   ┌─────────────▼─────────────┐
                                   │  Supabase (Postgres)      │
                                   │  + existing LLM providers │
                                   └───────────────────────────┘
```

Key principles:

- **No duplicated backend.** The mobile app reads the same static data files and API routes the web app already publishes.
- **No secrets in the APK.** Everything sensitive (Supabase service roles, LLM keys) stays server-side on Vercel. The app only ships a public base URL.
- **Offline-first.** Recently-viewed data is cached on-device and revalidated in the background; the UI labels cached data honestly.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full breakdown.

---

## Tech stack

- **Expo SDK 57** (managed workflow), React Native 0.86, React 19
- **Expo Router** (file-based navigation, bottom tabs + stack)
- **TypeScript** (strict)
- **AsyncStorage** for on-device caching + preferences
- **@react-native-community/netinfo** for connectivity awareness
- Native features: haptics, clipboard, system-bar theming, pull-to-refresh, Android back navigation

---

## Getting started

### Prerequisites

- **Node.js 20+** and npm
- **VS Code** (recommended) — Android Studio is **not** required for normal development
- A physical Android device with **Expo Go**, **or** an Android emulator (optional)

### Install & run

```bash
# 1. Install dependencies
npm install

# 2. (Optional) set the backend base URL — defaults to the production backend
cp .env.example .env.local

# 3. Start the dev server
npm start
```

Scan the QR code with **Expo Go** on your Android device, or press `a` to open an emulator.

### Useful commands

| Command | Purpose |
|---|---|
| `npm start` | Start the Metro dev server |
| `npm run android` | Start and open on Android |
| `npm run typecheck` | Run TypeScript checks |
| `npm test` | Run the unit tests (ported business logic) |
| `npm run lint` | Lint the project |

---

## Environment variables

Only **public, client-safe** configuration is used:

| Variable | Description | Default |
|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Base URL of the existing backend | `https://fast-nuces-isb.vercel.app` |

Set it in `.env.local` (see [`.env.example`](.env.example)) or as an EAS build-time variable.

> **Never** put GitHub PATs, Vercel PATs, Supabase keys or LLM API keys in this repo or in the app. They belong on the server only.

---

## Building the APK (Google Colab — no EAS/Android Studio needed)

The fastest zero-setup way to produce an installable APK is the included Colab notebook. It installs
JDK 17, Node 20 and the Android SDK in a free Colab runtime, then builds `app-release.apk` with Gradle:

1. Open [`colab/build_apk.ipynb`](colab/build_apk.ipynb) on GitHub.
2. Click **"Open in Colab"** (or upload the `.ipynb` to https://colab.research.google.com).
3. **Run all cells** top-to-bottom (first run ≈ 10–20 min).
4. The APK downloads automatically; optionally copy it to Google Drive.

> The Colab APK is signed with the Expo debug keystore — fine for sideloading, but **not** for Google
> Play. For a Play Store AAB, configure a release keystore (see below) or use EAS.

## Building the APK (GitHub Actions — manual trigger)

A [`build-apk` workflow](.github/workflows/build-apk.yml) is included. It installs JDK 17, Node 20
and the Android SDK on a GitHub-hosted runner, then builds `app-release.apk` and uploads it as an
artifact.

It is **manual-trigger only** (`workflow_dispatch`) — it never runs automatically:

1. Open the repo on GitHub → **Actions** tab.
2. Select **"Build Android APK"** → **"Run workflow"** → confirm.
3. When it finishes, download the `fast-utilities-apk` artifact.

> Same caveat as Colab: this APK is signed with the Expo debug keystore (fine for sideloading,
> not for Google Play). For Play, configure a release keystore or use EAS.

## Building for Android (EAS)

Android builds can also run in the cloud via **Expo EAS Build** — no local Android Studio or SDK required.

### 1. One-time EAS setup

```bash
npm install -g eas-cli
eas login          # sign in to your Expo account
eas build:configure
```

### 2. Build an installable APK (development / internal testing)

```bash
eas build -p android --profile preview
```

### 3. Build an AAB for Google Play

```bash
eas build -p android --profile production
```

The `production` profile produces an `.aab` (Android App Bundle) and can be submitted directly:

```bash
eas submit -p android
```

### App identity (configurable in `app.json`)

| Field | Value |
|---|---|
| App name | `FAST Utilities` |
| Package ID | `com.ammarasad.fastutilities` |
| `versionCode` / `version` | `7` / `1.3.0` |
| Orientation | `portrait` |

Adaptive icon, monochrome icon and splash screen are all derived from the FAST branding.

---

## Project structure

```
app/                 # Expo Router routes
  (tabs)/            # Bottom tabs: Home, Exams, Timetable, Rooms, More
  faculty.tsx        # Faculty directory (stack screen)
  semester.tsx       # Semester schedule
  events.tsx         # Campus events calendar
  about.tsx
src/
  api/               # Data fetching + TTL cache (config, client, endpoints, cache)
  core/              # Ported business logic (pure TS, unit-tested)
  hooks/             # useCachedData, usePref
  components/        # Shared UI primitives
  theme/             # Brand palette
__tests__/           # Unit tests for core logic
eas.json             # EAS build profiles (development / preview / production)
app.json             # Expo + Android config
```

---

## Offline & caching model

| Data | Type | Cache TTL |
|---|---|---|
| Timetable (FSC/FSM) | Cacheable | 6 h |
| Exam schedule | Cacheable | 6 h |
| Faculty | Cacheable | 24 h |
| Semester calendar | Cacheable | 24 h |
| Campus events | Cacheable | 6 h |

Cached data is served immediately (works offline) and revalidated in the background. When the UI is showing cached data it displays an explicit **"Showing cached data"** notice so it never pretends to be live. User selections (school, batch, department, section) are persisted locally.

**Auto-refresh:** the app revalidates cached data in the background every time a screen regains focus or the app returns to the foreground (throttled to once a minute), so updated timetables/exams are fetched and persisted automatically — no manual pull-to-refresh needed.

**Background sync:** an `expo-background-task` (Android WorkManager) also refreshes campus data into AsyncStorage periodically *while the app is closed* — battery-friendly and OS-scheduled (min ~15 min, deferred by Doze), so data stays eventually-fresh without the app running. Prompt change alerts (e.g. a cancelled class) will come via push notifications, planned as a follow-up on top of this sync.

---

## Backend / data compatibility

This app consumes the existing production backend **as-is**. No backend, database, Vercel or LLM changes were required:

- **Static data** — `/data/*.json` files (timetables, schedules, faculty, calendar, events).
- **Business logic** — ported 1:1 into `src/core/` and covered by unit tests to guarantee identical semantics.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a mapping of every endpoint used.

---

## License

See [LICENSE](LICENSE).
