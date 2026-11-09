import assert from 'node:assert/strict';
import { extractGoogleDrive, googleDriveConfirmUrl, googleDriveDownloadUrl, googleDriveFileId } from './direct';
import { classifyProvider, validateMediaUrl, videoPlaybackHeaders, isResolvedDownloadServer } from '../videoProviders';

const ID = '128PREjilaB7Y0jULVd7b8_VZLRPkvSPz';
for (const url of [
  `https://drive.google.com/file/d/${ID}/preview`,
  `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
  `https://drive.google.com/file/u/0/d/${ID}/preview`,
  `https://drive.google.com/uc?id=${ID}&export=download`,
  `https://drive.google.com/open?id=${ID}`,
  `https://docs.google.com/file/d/${ID}/preview`,
]) {
  assert.equal(googleDriveFileId(url), ID, url);
  assert.equal(classifyProvider(url), 'gdrive', url);
}
assert.equal(googleDriveFileId('https://evil.example/file/d/' + ID), null);
assert.equal(classifyProvider('https://www.googletagmanager.com/gtag/js'), 'generic', 'ad hosts stay out of gdrive');

const download = googleDriveDownloadUrl(ID);
assert.ok(validateMediaUrl(download, 'gdrive'));
assert.ok(!validateMediaUrl('https://drive.usercontent.google.com/uc', 'gdrive'));
assert.ok(isResolvedDownloadServer({ provider: 'gdrive', videoUrl: download }), 'Drive episodes are downloadable');
assert.equal(videoPlaybackHeaders(download, `https://drive.google.com/file/d/${ID}/preview`, 'gdrive').Origin, undefined);

const warning = `<form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
  <input type="hidden" name="id" value="${ID}"><input type="hidden" name="export" value="download">
  <input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="abc-123"></form>`;
const confirm = googleDriveConfirmUrl(warning);
assert.equal(new URL(confirm!).searchParams.get('uuid'), 'abc-123');
assert.equal(googleDriveConfirmUrl('<form id="download-form" action="https://evil.example/x"><input name="id" value="1"></form>'), null);

async function main() {
  const originalFetch = globalThis.fetch;
  try {
    // Big file: first answer is the virus-scan page, the uuid URL is the file.
    globalThis.fetch = (async (input: any, init: any) => {
      const url = String(input);
      assert.equal(init.headers.Range, 'bytes=0-1');
      return url.includes('uuid=')
        ? new Response('xx', { status: 206, headers: { 'content-type': 'video/mp4' } })
        : new Response(warning, { status: 200, headers: { 'content-type': 'text/html' } });
    }) as any;
    const big = await extractGoogleDrive(`https://drive.google.com/file/d/${ID}/preview`);
    assert.ok(big && big.url.includes('uuid=abc-123') && big.type === 'mp4');

    globalThis.fetch = (async () => new Response('xx', { status: 206, headers: { 'content-type': 'application/octet-stream' } })) as any;
    assert.equal((await extractGoogleDrive(`https://drive.google.com/file/d/${ID}/preview`))?.url, download);

    // Quota exceeded / private: HTML without a form → null (WebView fallback).
    globalThis.fetch = (async () => new Response('<p>Too many users have viewed or downloaded this file recently.</p>', { status: 200, headers: { 'content-type': 'text/html' } })) as any;
    assert.equal(await extractGoogleDrive(`https://drive.google.com/file/d/${ID}/preview`), null);
    console.log('PASS Google Drive id parsing, confirm form, direct + big-file + quota paths');
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
