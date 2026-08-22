# Architecture

This document explains how the Android app relates to the existing FAST Exam Table
backend, what it reuses, and why nothing on the backend needed to change.

## High-level topology

```
                 ┌──────────────────────────────┐
                 │  Existing web app (unchanged) │
                 │  Next.js 14 on Vercel         │
                 │  fast-nuces-isb.vercel.app    │
                 └──────────────┬───────────────┘
                                │  HTTP(S)
                ┌───────────────┴───────────────┐
                │                               │
      ┌─────────▼──────────┐          ┌─────────▼──────────┐
      │  FAST Utilities     │          │  Supabase (Postgres)│
      │  React Native/Expo  │          │  + server-side LLM  │
      │  (Android)          │          │  (GitHub Models)    │
      └────────────────────┘          └────────────────────┘
```

The Android app is a **second client** of the same backend. It never talks to
Supabase or any LLM provider directly — those stay behind the existing Vercel
deployment, which holds all secrets.

## What the app consumes

### 1. Static data files (public, cached by Vercel CDN)

Served from `/data/*` on the production origin:

| Path | Used by | Notes |
|---|---|---|
| `/data/timetable.json` | Timetable, Free Rooms | FSC (School of Computing) |
| `/data/fsm_timetable.json` | Timetable, Free Rooms | FSM (School of Management) |
| `/data/regular_schedule.json` | Exam Finder | Regular-semester exams |
| `/data/summer_schedule.json` | (reserved) | Summer-semester exams |
| `/data/faculty/faculty_data.json` | Faculty Info | Grouped by department |
| `/data/semester_calendar.json` | Semester Schedule | Key dates, sessionals, finals |
| `/data/student_events.json` | Campus Events | Student events calendar |

### 2. API routes

| Path | Used by | Notes |
|---|---|---|
| `/api/exam-visibility` | Exam Finder | Returns the admin-controlled `show_exams` flag (plus `semester_type` / `semester_name`), resolved server-side from Supabase so the app never ships DB credentials. |

These are the exact files the web app bundles at build time; the mobile app fetches
them over HTTPS and caches them locally.

### 3. Business logic (ported, not duplicated service-side)

The web app's pure data logic lives in `src/lib/*`. The Android app ports the same
functions into `src/core/*` so results are byte-for-byte consistent:

| Web (`src/lib`) | Android (`src/core`) |
|---|---|
| `types.ts` | `types.ts` |
| `timetable-filter.ts` | `timetable.ts` |
| `filter.ts` | `exams.ts` |
| `room-logic.ts` | `roomLogic.ts` |
| `faculty.ts` | `faculty.ts` |
| `events.ts` | `events.ts` |
| `dates.ts` (semester parts) | `dates.ts` + `semester.ts` |

These modules are **pure TypeScript** (no React Native imports) and are covered by
unit tests in `__tests__/core.test.ts`. This is the one place where code is
intentionally shared conceptually — it is the minimum required to reproduce
identical behaviour, and the web repo was not modified to achieve it.

## What was deliberately *not* done

- ❌ No WebView wrapper around `fast-nuces-isb.vercel.app`.
- ❌ No duplicate database / tables / RLS policies.
- ❌ No duplicate backend or new Vercel project.
- ❌ No LLM keys or Supabase keys embedded in the APK.
- ❌ No modification to the `ammarasad2005/exam-table` repository.

## Secrets model

| Secret | Where it lives | Shipped in APK? |
|---|---|---|
| Supabase URL / anon key | Vercel env (server) | ❌ |
| Supabase service role | Vercel env (server) | ❌ |
| `GITHUB_TOKEN` (LLM) | Vercel env (server) | ❌ |
| `EXPO_PUBLIC_API_BASE_URL` | Public config | ✅ (intentionally public) |

The only value the app knows is the public backend base URL. If the backend moves,
change `EXPO_PUBLIC_API_BASE_URL` — no code change required.

## Caching & offline behaviour

`src/hooks/useCachedData.ts` implements **stale-while-revalidate**:

1. Read from AsyncStorage → render immediately (offline-capable).
2. If the cache is fresh (within TTL), stop on mount.
3. Otherwise re-fetch in the background and update the cache.
4. On network failure, keep the cached copy and show a "cached data" notice.

**Automatic refresh:** beyond the mount-time fetch, the hook revalidates in the
background whenever the screen regains focus or the app returns to the
foreground (throttled to once per minute via `minRevalidateIntervalMs`). This
means a daily timetable/exam update is picked up and persisted to AsyncStorage
automatically as the user opens the app or switches back to a tab — no manual
pull-to-refresh required. Pull-to-refresh still exists as an explicit force.

**Background sync (`src/background/sync.ts`):** when the app is closed, an
`expo-background-task` (Android WorkManager) periodically refreshes the
read-heavy campus data and writes it to AsyncStorage — without the app running
in the foreground. This is *opportunistic* (min 15-min interval, but the OS
schedules actual runs to save battery / during Doze), so it keeps data
eventually-fresh rather than guaranteeing a timer. Prompt "class cancelled /
room shifted" alerts require push notifications (planned follow-up), which will
layer on top of this sync.

TTLs are defined in `src/api/config.ts`. Dynamic/user-generated data (none in the
core feature set) would not be cached this way.

## Navigation & UX

- **Bottom tabs** — Home, Exams, Timetable, Rooms, More.
- **Stack screens** — Faculty, Semester, Events, About (pushed on top of tabs).
- Android hardware/gesture back works because stack screens use the native stack.
- Light haptics on tab press; clipboard copy for emails/rooms/exams.

## Future work (not in v1)

- Lost & Found (Supabase-backed CRUD + the existing `/api/smart-search` LLM endpoint).
- Timetable Optimizer (clash-free section combination).
- Push notifications for exam/key-date reminders.
