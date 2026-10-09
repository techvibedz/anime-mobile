import { classifyProvider, VIDEO_USER_AGENT } from '../videoProviders';

export type WitBrowserIdentity = { ua?: string; language?: string; brands?: string; mobile?: boolean; platform?: string };
type GateResponse = { url: string; headers: { get(name: string): string | null } };
type GateFetch = (url: string, init: { credentials: 'include'; redirect: 'manual'; headers: Record<string,string>; signal: AbortSignal }) => Promise<GateResponse>;

export function witGateHeaders(identity: WitBrowserIdentity, applicationId: string): Record<string,string> {
  const ua = identity.ua || VIDEO_USER_AGENT;
  const major = ua.match(/Chrome\/(\d+)/)?.[1] || '120';
  return {
    'User-Agent': ua, 'X-Requested-With': applicationId,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': identity.language || 'en-US,en;q=0.9',
    'Sec-CH-UA': identity.brands || `"Chromium";v="${major}", "Not_A Brand";v="99"`,
    'Sec-CH-UA-Mobile': identity.mobile === false ? '?0' : '?1',
    'Sec-CH-UA-Platform': JSON.stringify(identity.platform || 'Android'),
    'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1', Priority: 'u=0, i',
  };
}

export async function resolveWitGateRedirect(url: string, identity: WitBrowserIdentity, applicationId: string, fetcher: GateFetch): Promise<string | null> {
  if (!/^https:\/\/witanime\.site\/watch\/stream-gate\/[a-f0-9]{64}$/.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, { credentials:'include', redirect:'manual', headers:witGateHeaders(identity, applicationId), signal:controller.signal });
    const destination = response.headers.get('location') || response.url;
    // Location preserves MEGA's key and does not require a provider's landing
    // page to be fetchable. Older networking may follow despite manual mode.
    if (!/^https?:\/\//i.test(destination) || classifyProvider(destination) === 'generic') return null;
    return destination;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
