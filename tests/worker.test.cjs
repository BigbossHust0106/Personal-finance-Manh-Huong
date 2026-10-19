const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

test('price API respects login and server-side PIN before fetching prices',async t=>{
  const source=readFileSync(resolve(__dirname,'../src/worker.js'),'utf8');
  const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const env={SUPABASE_URL:'https://supabase.example.test',SUPABASE_ANON_KEY:'public-test'};
  const req=(method='GET',token='session')=>new Request('https://app.example.test/api/prices?symbols=FPT',{method,headers:token?{authorization:'Bearer '+token}:{}});
  const original=global.fetch;let calls=[];let unlocked=true,validUser=true,accessService=true;
  global.fetch=async url=>{
    calls.push(String(url));
    if(String(url).endsWith('/auth/v1/user'))return new Response('{}',{status:validUser?200:401});
    if(String(url).endsWith('/rpc/pin_access'))return new Response(JSON.stringify(unlocked),{status:accessService?200:503});
    if(String(url).includes('dchart-api.vndirect.com.vn'))return Response.json({s:'ok',c:[123.4],t:[1700000000]});
    throw new Error('Unexpected network request');
  };
  try{
    await t.test('missing login and wrong method do not call upstream',async()=>{
      assert.equal((await worker.fetch(req('GET',''),env)).status,401);
      assert.equal((await worker.fetch(req('POST'),env)).status,405);
      assert.equal(calls.length,0);
    });
    await t.test('invalid session denied',async()=>{
      validUser=false;assert.equal((await worker.fetch(req(),env)).status,401);validUser=true;
    });
    await t.test('locked PIN denied; unavailable PIN service fails closed',async()=>{
      calls=[];unlocked=false;assert.equal((await worker.fetch(req(),env)).status,403);
      assert.equal(calls.some(x=>x.includes('vndirect')),false);
      unlocked=true;accessService=false;assert.equal((await worker.fetch(req(),env)).status,503);accessService=true;
    });
    await t.test('unlocked account can fetch quote',async()=>{
      const r=await worker.fetch(req(),env);assert.equal(r.status,200);
      const j=await r.json();assert.equal(j.prices.FPT.price,123400);
    });
  }finally{global.fetch=original;}
});
