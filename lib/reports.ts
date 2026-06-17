// User issue-reports. A report is one row in the Supabase `reports` table; an
// optional screenshot is uploaded to the public `report-screenshots` bucket and
// its URL is stored on the row. View incoming reports in the Supabase dashboard
// (Table editor → reports). No server code needed — the client writes directly
// under RLS (insert-only for anon/authenticated).

import { Platform } from "react-native";
import * as Device from "expo-device";
import { supabase, isSupabaseConfigured } from "./supabase";
import appVersion from "../version.json";

export interface ReportInput {
  message: string;
  category?: string | null;
  email?: string | null;
  /** Base64-encoded JPEG of the attached screenshot (no data: prefix). */
  screenshotBase64?: string | null;
}

export type ReportResult = { ok: true } | { ok: false; error: string };

// Minimal base64 → bytes decoder. Avoids pulling in atob/Buffer (not reliably
// present in the RN runtime) just to upload one screenshot.
function base64ToBytes(b64: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  let len = clean.length;
  let padding = 0;
  if (clean[len - 1] === "=") padding++;
  if (clean[len - 2] === "=") padding++;
  const byteLength = (len / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = lookup[clean.charCodeAt(i)];
    const e2 = lookup[clean.charCodeAt(i + 1)];
    const e3 = lookup[clean.charCodeAt(i + 2)];
    const e4 = lookup[clean.charCodeAt(i + 3)];
    if (p < byteLength) bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < byteLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < byteLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }
  return bytes;
}

async function uploadScreenshot(base64: string, userId: string): Promise<string | null> {
  try {
    const bytes = base64ToBytes(base64);
    if (!bytes.length) return null;
    const path = `${userId}/${Date.now()}.jpg`;
    const { error } = await supabase.storage
      .from("report-screenshots")
      .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (error) return null;
    const { data } = supabase.storage.from("report-screenshots").getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch {
    return null;
  }
}

export async function submitReport(input: ReportInput): Promise<ReportResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "not_configured" };
  const message = (input.message || "").trim();
  if (!message) return { ok: false, error: "empty" };

  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user ?? null;

    let screenshot_url: string | null = null;
    if (input.screenshotBase64) {
      screenshot_url = await uploadScreenshot(input.screenshotBase64, user?.id ?? "anon");
    }

    const device =
      [Device.manufacturer, Device.modelName].filter(Boolean).join(" ").trim() || null;

    const { error } = await supabase.from("reports").insert({
      user_id: user?.id ?? null,
      email: (input.email || "").trim() || user?.email || null,
      category: input.category ?? null,
      message,
      screenshot_url,
      app_version: appVersion.version,
      platform: Platform.OS,
      device,
      os_version: String(Platform.Version),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "failed" };
  }
}
