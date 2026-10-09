import assert from 'node:assert/strict';
import { resolveWitGateRedirect, witGateHeaders } from './witGate';

async function main() {
 const gate='https://witanime.site/watch/stream-gate/'+ 'a'.repeat(64);
 const identity={ua:'Mozilla Chrome/157.0.0.0',brands:'"Android WebView";v="157"',platform:'Android',mobile:true,language:'en-US,en;q=0.9'};
 const headers=witGateHeaders(identity,'com.anime.mobile');
 assert.equal(headers['Sec-CH-UA'],identity.brands);
 assert.equal(headers['Sec-Fetch-Dest'],'iframe');
 assert.equal(headers['User-Agent'],identity.ua);
 assert.equal(headers['X-Requested-With'],'com.anime.mobile');
 assert.ok(witGateHeaders({ua:'Chrome/134.0'},'com.anime.mobile')['Sec-CH-UA'].includes('134'));
 const mega='https://mega.nz/embed/abcdefgh#abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
 const result=await resolveWitGateRedirect(gate,identity,'com.anime.mobile',async (url,init)=>{
   assert.equal(url,gate);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'include');
   assert.equal(init.headers['Sec-CH-UA'],identity.brands);
   return {url:gate,headers:{get:name=>name==='location'?mega:null}};
 });
 assert.equal(result,mega,'MEGA fragment key survives the redirect');
 const videa='https://videa.hu/player?v=episode';
 assert.equal(await resolveWitGateRedirect(gate,identity,'com.anime.mobile',async()=>({url:videa,headers:{get:()=>null}})),videa,'older fetch may follow manual mode; landing status is irrelevant');
 assert.equal(await resolveWitGateRedirect(gate,identity,'com.anime.mobile',async()=>({url:gate,headers:{get:()=>null}})),null,'404 gates cannot become media candidates');
 assert.equal(await resolveWitGateRedirect(gate,identity,'com.anime.mobile',async()=>({url:gate,headers:{get:()=> 'javascript:alert(1)'}})),null);
 assert.equal(await resolveWitGateRedirect('https://example.com/'+gate,identity,'com.anime.mobile',async()=>{throw Error('must not fetch foreign gate');}),null);
 console.log('PASS WitAnime identity headers, redirect keys, legacy follow, and invalid gates');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
