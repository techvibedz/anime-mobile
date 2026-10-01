// Connectivity awareness — lightweight, OTA-safe.
//
// No native connectivity module (@react-native-community/netinfo / expo-network)
// is bundled in the build, and an OTA can't add one. So reachability is inferred
// from a fast request to a couple of highly-available, tiny endpoints:
// Google's `generate_204` returns an empty 204 in well under a second on any
// live connection. An abort/network error on ALL probes ⇒ treat as offline.
//
// This deliberately probes a neutral host (not our scraping sources): it answers
// "does this device have internet?", not "is the anime source reachable?" — so a
// Cloudflare challenge or a busy source never reads as "offline".

import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

const PROBES = [
  "https://www.google.com/generate_204",
  "https://clients3.google.com/generate_204",
  "https://cloudflare.com/cdn-cgi/trace",
];

/** Resolve true if any probe answers within `timeoutMs`, false otherwise. */
export async function checkOnline(timeoutMs = 4000): Promise<boolean> {
  // Race all probes: sequentially, a network that blocks the first two hosts
  // (common on restrictive carriers) made every check take 3× timeout. First
  // response of ANY status means the network is reachable.
  const probe = (url: string) =>
    new Promise<boolean>((resolve) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => { ctrl.abort(); resolve(false); }, timeoutMs);
      fetch(url, { method: "GET", signal: ctrl.signal, cache: "no-store" })
        .then(() => resolve(true), () => resolve(false))
        .finally(() => clearTimeout(timer));
    });
  return new Promise<boolean>((resolve) => {
    let remaining = PROBES.length;
    for (const url of PROBES) {
      void probe(url).then((ok) => {
        if (ok) resolve(true);
        else if (--remaining === 0) resolve(false);
      });
    }
  });
}

/**
 * Reactive online status. `online` is `null` until the first probe resolves,
 * then a boolean. Re-checks whenever the app returns to the foreground, and
 * exposes `recheck()` for manual retries (e.g. a "try again" button).
 */
export function useOnlineStatus(): { online: boolean | null; recheck: () => Promise<boolean> } {
  const [online, setOnline] = useState<boolean | null>(null);
  const mounted = useRef(true);

  const recheck = useCallback(async () => {
    const v = await checkOnline();
    if (mounted.current) setOnline(v);
    return v;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void recheck();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void recheck();
    });
    return () => { mounted.current = false; sub.remove(); };
  }, [recheck]);

  return { online, recheck };
}
