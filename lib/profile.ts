// Profile editing — display name, bio, and avatar.
//
// Backend-light, consistent with the rest of the app: there is no `profiles`
// table. We persist editable fields into Supabase Auth `user_metadata`
// (`full_name`, `bio`, `avatar_url`), which the profile screen already reads
// from. The avatar image is uploaded to the public `avatars` storage bucket
// under the user's own folder (`<uid>/<ts>.jpg`) and its public URL is stored
// on the metadata.

import { supabase, isSupabaseConfigured } from "./supabase";

export interface ProfileUpdate {
  name: string;
  bio: string;
  /** Base64-encoded JPEG of a freshly picked avatar (no data: prefix). */
  avatarBase64?: string | null;
}

export type ProfileResult =
  | { ok: true; avatarUrl: string | null }
  | { ok: false; error: string };

// Minimal base64 → bytes decoder. Mirrors lib/reports.ts — avoids relying on
// atob/Buffer, which aren't reliably present in the RN runtime.
function base64ToBytes(b64: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
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

async function uploadAvatar(base64: string, userId: string): Promise<string | null> {
  const bytes = base64ToBytes(base64);
  if (!bytes.length) return null;
  // Fresh path each save → URL changes → expo-image / CDN can't serve a stale
  // cached avatar after an update.
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl ?? null;
}

export async function updateProfile(input: ProfileUpdate): Promise<ProfileResult> {
  if (!isSupabaseConfigured) return { ok: false, error: "not_configured" };

  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user ?? null;
    if (!user) return { ok: false, error: "not_signed_in" };

    let avatarUrl: string | null =
      (user.user_metadata?.avatar_url as string) ||
      (user.user_metadata?.picture as string) ||
      null;

    if (input.avatarBase64) {
      avatarUrl = await uploadAvatar(input.avatarBase64, user.id);
    }

    const name = input.name.trim();
    const bio = input.bio.trim();

    const { error } = await supabase.auth.updateUser({
      data: {
        full_name: name,
        name, // keep both keys in sync (screen falls back to `name`)
        bio,
        ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
      },
    });
    if (error) return { ok: false, error: error.message };

    return { ok: true, avatarUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "failed" };
  }
}
