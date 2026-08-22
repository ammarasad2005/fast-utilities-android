import * as FileSystem from 'expo-file-system/legacy';
import type { ExamEntry, TimetableEntry } from '@/core/types';
import { API_BASE_URL } from './config';

/**
 * Server-rendered PNG exports.
 *
 * The exported image's formatting is produced by the EXISTING web backend
 * (the same /api/export-* routes the website uses), so the file the app
 * shares is byte-for-byte the web export layout — no snapshotting of app
 * screens and no reimplemented rendering logic in the APK.
 */

// ── ArrayBuffer → base64 (chunk-safe, no Buffer dependency) ──────────────────
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 !== undefined ? b1 >> 4 : 0)];
    out += b1 !== undefined ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 !== undefined ? b2 >> 6 : 0)] : '=';
    out += b2 !== undefined ? BASE64_CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

interface PostImageOptions {
  filename: string;
}

async function postPng(path: string, payload: unknown, opts: PostImageOptions): Promise<string> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Image export failed (${res.status})`);
  }
  const buffer = await res.arrayBuffer();
  const uri = `${FileSystem.cacheDirectory}${opts.filename}`;
  await FileSystem.writeAsStringAsync(uri, arrayBufferToBase64(buffer), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

// ── Timetable (weekly week-grid PNG) ─────────────────────────────────────────

export interface TimetableExportConfig {
  batch?: string;
  dept?: string;
  section?: string;
  semesterName?: string;
  isCustom?: boolean;
  isSummer?: boolean;
}

/** Returns the local file URI of the generated PNG. */
export function exportTimetablePng(
  entries: TimetableEntry[],
  config: TimetableExportConfig
): Promise<string> {
  return postPng('/api/export-timetable-image', { entries, config }, { filename: 'fast-timetable.png' });
}

// ── Exam schedule (table PNG) ────────────────────────────────────────────────

export interface ExamExportConfig {
  isCustom?: boolean;
  subtitle?: string;
  semesterName?: string;
}

/** Returns the local file URI of the generated PNG. */
export function exportExamsPng(entries: ExamEntry[], config: ExamExportConfig): Promise<string> {
  return postPng('/api/export-image', { entries, config }, { filename: 'fast-exam-schedule.png' });
}
