// NODE_PATH=<directory containing pg> node --test tests/database.test.cjs
// Uses a disposable database on a LOCAL PostgreSQL server; never live Supabase.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {Client} = require('pg');
const root = resolve(__dirname, '..');
const url = new URL(process.env.DB_TEST_URL || 'postgres://postgres@127.0.0.1:55432/postgres');
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Tests require local PostgreSQL');

test('Supabase migration, audit, restoration, permissions and PIN', async t => {
  const admin = new Client({connectionString:url.href}); await admin.connect();
  const name = 'finance_test_' + Date.now();
  await admin.query(`create database ${name}`);
  const dbUrl = new URL(url); dbUrl.pathname = '/' + name;
  const db = new Client({connectionString:dbUrl.href}); await db.connect();
  const owner = '00000000-0000-4000-8000-000000000001';
  const editor = '00000000-0000-4000-8000-000000000002';
  const viewer = '00000000-0000-4000-8000-000000000003';
  const outsider = '00000000-0000-4000-8000-000000000004';
  const hh = '10000000-0000-4000-8000-000000000001';
  const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
  async function login(id, session='session-a') {
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:session})]);
    await db.query('set role authenticated');
  }
  const asset = (id,sym) => ({id,sym,name:sym,type:'stock',owner:'Chồng',price:100,priceAt:'2026-01-01'});
  const trade = (id,type,qty,owner='Chồng') => ({id,asset:'fpt',type,qty,owner,price:100,date:'2026-01-01',at:'2026-01-01T00:00:00Z',fee:0,tax:0});
  let initial, version;
  try {
    await db.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on all functions in schema auth to authenticated,anon;
    create publication supabase_realtime;`);
    await db.query(readFileSync(resolve(root,'supabase-setup.sql'),'utf8'));
    await db.query(readFileSync(resolve(root,'supabase-update-0.0.9.sql'),'utf8'));
    await db.query('grant select,update on public.finance_data to authenticated; grant select on public.households,public.household_members to authenticated');
    await db.query(`insert into auth.users(id,email,raw_user_meta_data) values
      ($1,'owner@example.test','{"name":"Chồng"}'),($2,'editor@example.test','{"name":"Vợ"}'),
      ($3,'viewer@example.test','{}'),($4,'outsider@example.test','{}');`,[owner,editor,viewer,outsider]);
    initial = {v:2, assets:[asset('fpt','FPT'),asset('vnm','VNM')],itx:[trade('buy','buy',10)],inc:[{id:'income',amt:999}],exp:[]};
    await db.query('insert into public.households(id,name) values($1,\'Test\')',[hh]);
    await db.query("insert into public.household_members values($1,$2,'owner'),($1,$3,'editor'),($1,$4,'viewer')",[hh,owner,editor,viewer]);
    await db.query('insert into public.finance_data(household_id,data) values($1,$2)',[hh,initial]);
    const migration = readFileSync(resolve(root,'supabase-update-0.3.0.sql'),'utf8');
    await t.test('migration runs twice without duplicating baselines',async()=>{
      await db.query(migration); await db.query(migration);
      assert.equal(await scalar('select count(*)::int from investment_history'),2);
      assert.equal(await scalar('select revision::int from finance_data'),0);
    });
    await t.test('default PIN off; version captures real actor and before/after, including deletes',async()=>{
      await login(owner);
      assert.deepEqual(await scalar('select public.pin_status()'),{enabled:false,unlocked:true});
      const data = structuredClone(initial); data.itx.push({...trade('sell','sell',2),at:'2026-01-02'});
      await db.query('update finance_data set data=$1, updated_by=$2 where household_id=$3',[data,outsider,hh]);
      let h = (await db.query('select * from investment_history order by id desc limit 1')).rows[0];
      assert.equal(h.actor_id,owner); assert.equal(h.actor_email,'owner@example.test');
      assert.equal(h.before_data.trades.length,1); assert.equal(h.after_data.trades.length,2);
      version = h.id;
      await login(editor); data.itx[0].price=120;
      await db.query('update finance_data set data=$1 where household_id=$2',[data,hh]);
      h = (await db.query('select * from investment_history order by id desc limit 1')).rows[0];
      assert.equal(h.actor_id,editor); assert.equal(h.before_data.trades[0].price,100); assert.equal(h.after_data.trades[0].price,120);
      data.itx.pop(); await db.query('update finance_data set data=$1 where household_id=$2',[data,hh]);
      h = (await db.query('select * from investment_history order by id desc limit 1')).rows[0];
      assert.equal(h.before_data.trades.length,2); assert.equal(h.after_data.trades.length,1);
    });
    await t.test('market prices do not create audit noise',async()=>{
      const count = await scalar('select count(*)::int from investment_history');
      await db.query("update finance_data set data=jsonb_set(data,'{assets,0,price}','150') where household_id=$1",[hh]);
      assert.equal(await scalar('select count(*)::int from investment_history'),count);
    });
    await t.test('restore preserves other assets/income, keeps current price, creates undoable version',async()=>{
      const revision = await scalar('select revision from finance_data');
      await db.query("select restore_investment($1,$2,'after',$3)",[hh,version,revision]);
      const d = await scalar('select data from finance_data');
      assert.equal(d.itx.length,2); assert.equal(d.itx[0].price,100);
      assert.equal(d.assets.find(a=>a.id==='fpt').price,150);
      assert.deepEqual(d.assets.find(a=>a.id==='vnm'),initial.assets[1]);
      assert.deepEqual(d.inc,initial.inc);
      const h = (await db.query('select * from investment_history order by id desc limit 1')).rows[0];
      assert.equal(h.action,'restore'); assert.equal(h.restored_from,version); assert.equal(h.actor_id,editor);
      await assert.rejects(db.query("select restore_investment($1,$2,'after',$3)",[hh,version,revision]),/Dữ liệu đã thay đổi/);
      await db.query("select restore_investment($1,$2,'before',(select revision from finance_data))",[hh,h.id]);
      assert.equal((await scalar('select data from finance_data')).itx.length,1);
    });
    await t.test('optimistic revision prevents stale save and audit cannot be forged',async()=>{
      const r=await db.query('update finance_data set data=$1 where household_id=$2 and revision=-1',[initial,hh]);
      assert.equal(r.rowCount,0);
      await assert.rejects(db.query("insert into investment_history(household_id,asset_id,actor_name,action) values($1,'fpt','fake','change')",[hh]),/permission denied/);
      await assert.rejects(db.query('delete from investment_history'),/permission denied/);
    });
    await t.test('viewer can read, cannot restore; nonmember cannot read or restore',async()=>{
      await login(viewer);
      assert.ok(await scalar('select count(*)::int from investment_history'));
      const revision=await scalar('select revision from finance_data');
      await assert.rejects(db.query("select restore_investment($1,$2,'after',$3)",[hh,version,revision]),/Không có quyền/);
      await login(outsider);
      assert.equal(await scalar('select count(*)::int from investment_history'),0);
      assert.equal(await scalar('select count(*)::int from finance_data'),0);
      assert.deepEqual((await db.query('select * from archived_investments($1)',[hh])).rows,[]);
      await assert.rejects(db.query("select restore_investment($1,$2,'after',$3)",[hh,version,revision]),/Không có quyền/);
    });
    await t.test('PIN enabled per account, hashed privately, new sessions blocked by RLS',async()=>{
      await login(owner);
      assert.equal((await scalar("select pin_configure(null,'0123')")).ok,true);
      assert.deepEqual(await scalar('select pin_status()'),{enabled:true,unlocked:true});
      await assert.rejects(db.query('select * from finance_private.account_pins'),/permission denied/);
      await db.query('reset role');
      const hash=await scalar('select pin_hash from finance_private.account_pins');
      assert.notEqual(hash,'0123'); assert.ok(hash.startsWith('$2'));
      await login(owner,'session-b');
      assert.deepEqual(await scalar('select pin_status()'),{enabled:true,unlocked:false});
      assert.equal(await scalar('select count(*)::int from finance_data'),0);
      assert.equal(await scalar('select count(*)::int from investment_history'),0);
      assert.equal(await scalar('select count(*)::int from household_members'),0);
      await assert.rejects(db.query("select create_household('bypass')"),/PIN/);
      await assert.rejects(db.query("select restore_investment($1,$2,'after',0)",[hh,version]),/Không có quyền/);
      await login(editor);
      assert.deepEqual(await scalar('select pin_status()'),{enabled:false,unlocked:true});
      assert.equal(await scalar('select count(*)::int from finance_data'),1);
    });
    await t.test('failed PIN persists, rate limit survives sessions, cannot disable without PIN',async()=>{
      await login(owner,'session-b');
      for(let i=0;i<5;i++) assert.equal((await scalar("select pin_unlock('9999')")).ok,false);
      await login(owner,'session-c');
      assert.equal((await scalar("select pin_unlock('0123')")).ok,false);
      assert.equal((await scalar("select pin_configure('9999',null)")).ok,false);
      assert.equal((await scalar('select pin_status()')).enabled,true);
      await db.query('reset role');
      assert.equal(await scalar('select failures from finance_private.account_pins'),5);
      await db.query("update finance_private.account_pins set locked_until=now()-interval '1 second'");
      await login(owner,'session-c');
      assert.equal((await scalar("select pin_unlock('0123')")).ok,true);
      assert.equal(await scalar('select count(*)::int from finance_data'),1);
      assert.equal((await scalar("select pin_configure('9999',null)")).ok,false);
      assert.equal((await scalar("select pin_configure('0123','9876')")).ok,true);
      await login(owner,'session-a');
      assert.equal((await scalar('select pin_status()')).unlocked,false);
      assert.equal((await scalar("select pin_unlock('0123')")).ok,false);
      assert.equal((await scalar("select pin_unlock('9876')")).ok,true);
      assert.equal((await scalar("select pin_configure('9876',null)")).ok,true);
      await login(owner,'session-new');
      assert.deepEqual(await scalar('select pin_status()'),{enabled:false,unlocked:true});
    });
    await t.test('deleted asset is discoverable and restorable from archive',async()=>{
      const data=await scalar('select data from finance_data');
      data.assets=data.assets.filter(x=>x.id!=='fpt'); data.itx=[];
      await db.query('update finance_data set data=$1 where household_id=$2',[data,hh]);
      assert.deepEqual((await db.query('select * from archived_investments($1)',[hh])).rows,[{asset_id:'fpt',symbol:'FPT'}]);
      const h = (await db.query('select * from investment_history order by id desc limit 1')).rows[0];
      await db.query("select restore_investment($1,$2,'before',(select revision from finance_data))",[hh,h.id]);
      assert.equal((await scalar('select data from finance_data')).assets.length,2);
    });
    await t.test('same-timestamp trades retain their original order during restoration',async()=>{
      const data=await scalar('select data from finance_data');
      data.itx=[trade('z-buy','buy',10),trade('a-sell','sell',2)];
      await db.query('update finance_data set data=$1 where household_id=$2',[data,hh]);
      const h=(await db.query('select * from investment_history order by id desc limit 1')).rows[0];
      assert.deepEqual(h.after_data.trades.map(x=>x.id),['z-buy','a-sell']);
      await db.query("select restore_investment($1,$2,'after',(select revision from finance_data))",[hh,h.id]);
      assert.deepEqual((await scalar('select data from finance_data')).itx.map(x=>x.id),['z-buy','a-sell']);
      assert.equal(await scalar("select action from investment_history order by id desc limit 1"),'restore');
    });
    await t.test('restoring an invalid legacy oversell is rejected without modifying finance data',async()=>{
      const before=await scalar('select data from finance_data');
      await db.query('reset role');
      const snap={asset:asset('fpt','FPT'),trades:[trade('bad-sell','sell',100)]};
      const id=await scalar("insert into investment_history(household_id,asset_id,actor_name,action,after_data) values($1,'fpt','Legacy','baseline',$2) returning id",[hh,snap]);
      await login(owner);
      await assert.rejects(db.query("select restore_investment($1,$2,'after',(select revision from finance_data))",[hh,id]),/bán vượt/);
      assert.deepEqual(await scalar('select data from finance_data'),before);
    });
    await t.test('anonymous cannot inspect PIN or restore',async()=>{
      await db.query('reset role'); await db.query('set role anon');
      await assert.rejects(db.query('select pin_status()'),/permission denied/);
      await assert.rejects(db.query('select * from investment_history'),/permission denied/);
    });
  } finally {
    await db.end(); await admin.query(`drop database ${name} with (force)`); await admin.end();
  }
});
