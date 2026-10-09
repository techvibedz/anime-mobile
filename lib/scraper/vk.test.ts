import assert from 'node:assert/strict';
import { extractVk } from './direct';

async function main() {
  const original = globalThis.fetch;
  const embed = 'https://vkvideo.ru/video_ext.php?oid=-1&id=2';
  const primary = 'https://vkvd196.okcdn.ru/?sig=valid&expires=1791800000';
  const alternate = primary.replace('vkvd196', 'vkvd296');
  const calls: string[] = [];
  let blocked = false;
  let failover = 'vkvd296.okcdn.ru';
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.startsWith('https://vk.com/video_ext.php')) return new Response(JSON.stringify({ files: { mp4_1080: primary, failover_host: failover } }));
    const headers = init?.headers as Record<string,string>;
    assert.equal(headers.Range, 'bytes=0-1');
    assert.equal(headers.Referer, 'https://vk.com/');
    return new Response(null, { status: blocked && url === primary ? 403 : 206 });
  };
  try {
    assert.equal((await extractVk(embed))?.url, primary);
    blocked = true; calls.length = 0;
    assert.equal((await extractVk(embed))?.url, alternate);
    assert.deepEqual(calls.slice(1), [primary, alternate]);
    failover = 'okcdn.ru.evil.example'; calls.length = 0;
    assert.equal(await extractVk(embed), null);
    assert.ok(!calls.some(url => url.includes('evil.example')));
    console.log('PASS VK current file keys, signed query, official failover and host validation');
  } finally { globalThis.fetch = original; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
