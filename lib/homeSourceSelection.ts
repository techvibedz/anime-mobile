export async function loadWitanimeHome<T>(
  direct: () => Promise<T | null>,
  webView: () => Promise<T | null>,
): Promise<T | null> {
  return await direct().catch(() => null) || await webView().catch(() => null);
}
