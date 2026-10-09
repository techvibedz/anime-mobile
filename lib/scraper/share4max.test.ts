import assert from 'node:assert/strict';
import { extractShare4max } from './direct';

async function main() {
  const originalFetch=globalThis.fetch;
  const calls:string[]=[];
  const embed='https://share4max.com/iframe/example';
  const high='https://s99.mp4upload.com/video/1080.mp4?token=high';
  const low='https://s99.mp4upload.com/video/720.mp4?token=low';
  globalThis.fetch=async(input,init)=>{
    const url=String(input);calls.push(url);
    const headers=init?.headers as Record<string,string>;
    if(url===embed) {
      if(headers['X-Inertia']==='true') {
        assert.equal(headers['X-Inertia-Version'],'live-version');
        assert.equal(headers['X-Inertia-Partial-Component'],'Iframe');
        assert.equal(headers['X-Inertia-Partial-Data'],'streams');
        return Response.json({props:{streams:{data:[
          {label:'720p',mirrors:[{driver:'mp4upload',link:'https://www.mp4upload.com/embed-low.html'}]},
          {label:'1080p',mirrors:[{driver:'mp4upload',link:'http://['}, {driver:'mp4upload',link:'https://evil.example/embed'}, {driver:'mp4upload',link:'https://www.mp4upload.com/embed-high.html'}]},
        ]}}});
      }
      return new Response('<script data-page="app">'+JSON.stringify({version:'live-version',component:'Iframe'})+'</script>');
    }
    if(url.includes('/embed-'))return new Response(`<script>player.src="${url.includes('high')?high:low}";</script>`);
    assert.equal(headers.Range,'bytes=0-1');
    assert.equal(headers.Referer,'https://www.mp4upload.com/');
    return new Response(null,{status:url===high?403:206});
  };
  try {
    assert.equal((await extractShare4max(embed))?.url,low);
    assert.ok(calls.indexOf(high)<calls.indexOf(low),'best quality is tried first; dead mirrors fall back');
    assert.ok(!calls.some(url=>url.includes('evil.example')),'only MP4Upload mirrors are fetched');
    console.log('PASS Megamax partial reload, live version, quality fallback and playback headers');
  } finally { globalThis.fetch=originalFetch; }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
