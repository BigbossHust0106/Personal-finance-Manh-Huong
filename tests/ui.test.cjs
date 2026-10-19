const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {chromium} = require('playwright');
const publicDir = resolve(__dirname,'../public');

// Fixture Supabase transport; database policies/RPCs are tested against PostgreSQL
// in database.test.cjs. No request here reaches live financial data.
function fakeSupabase() {
  const clone = x => JSON.parse(JSON.stringify(x));
  const asset={id:'fpt',sym:'FPT',name:'Công nghệ FPT',type:'stock',owner:'Chồng',price:120,priceAt:''};
  const trade={id:'buy1',asset:'fpt',type:'buy',owner:'Chồng',date:'2025-01-01',at:'2025-01-01T00:00:00Z',qty:10,price:100,fee:0,tax:0,note:'Mua ban đầu'};
  const snapshot={asset:clone(asset),trades:[clone(trade)]};
  const data={v:2,assets:[asset],itx:[trade],inc:[],exp:[],dep:[],cash:[
    {id:'c1',owner:'Chồng',date:'2025-01-01',amt:1000},
    {id:'c2',owner:'Vợ',date:'2025-01-01',amt:2000},
    {id:'c3',owner:'Chung',date:'2025-01-01',amt:3000}
  ],goals:[],contrib:[],prices:[],invTarget:{value:0,ret:0}};
  const user={id:'owner',email:'owner@example.test',user_metadata:JSON.parse(localStorage.getItem('test_metadata')||'{"name":"Chồng"}')};
  const state=window.TEST_STATE={user,data,revision:0,role:'owner',enabled:false,unlocked:true,failSave:false,rows:[
    {id:1,asset_id:'fpt',household_id:'home',actor_name:'Vợ',actor_email:'wife@example.test',occurred_at:'2025-01-01T00:00:00Z',action:'change',before_data:{asset:clone(asset),trades:[]},after_data:snapshot}
  ],rpcCalls:[]};
  function builder(table) {
    const filters={};let update,lt,limit=100;
    const b={select(){return b},eq(k,v){filters[k]=v;return b},lt(k,v){lt=v;return b},order(){return b},limit(v){limit=v;return b},update(v){update=clone(v);return b},single(){return b},
      then(ok,fail){return Promise.resolve().then(()=>{
        if(table==='household_members')return {data:[{household_id:'home',role:state.role,households:{name:'Gia đình',created_at:'2025-01-01'}}]};
        if(table==='finance_data'){
          if(update){
            if(state.failSave)return {error:{code:'PGRST116',message:'No rows'}};
            if(filters.revision!==state.revision)return {error:{code:'PGRST116',message:'No rows'}};
            const before={asset:clone(state.data.assets[0]),trades:clone(state.data.itx)};
            state.data=update.data;state.revision++;
            const after={asset:clone(state.data.assets[0]),trades:clone(state.data.itx)};
            if(JSON.stringify(before)!==JSON.stringify(after))state.rows.push({id:state.rows.length+1,household_id:'home',asset_id:'fpt',actor_name:'Chồng',actor_email:user.email,occurred_at:new Date().toISOString(),action:'change',before_data:before,after_data:after});
          }
          return {data:{data:clone(state.data),revision:state.revision}};
        }
        if(table==='investment_history')return {data:clone(state.rows.filter(x=>x.asset_id===filters.asset_id&&(!lt||x.id<lt)).sort((a,b)=>b.id-a.id).slice(0,limit))};
        return {data:[]};
      }).then(ok,fail)}
    };return b;
  }
  window.supabase={createClient(){return {
    from:builder,
    auth:{getSession:async()=>({data:{session:{user:clone(state.user)}}}),updateUser:async({data})=>{
      Object.assign(state.user.user_metadata,data);localStorage.setItem('test_metadata',JSON.stringify(state.user.user_metadata));return {data:{user:clone(state.user)}};
    },signOut:async()=>({})},
    rpc:async(name,args)=>{
      state.rpcCalls.push({name,args});
      if(name==='pin_status')return {data:{enabled:state.enabled,unlocked:state.unlocked}};
      if(name==='pin_unlock'){
        if(args.p_pin!=='0123')return {data:{ok:false,error:'PIN không đúng'}};
        state.unlocked=true;return {data:{ok:true}};
      }
      if(name==='pin_configure'){
        if(state.enabled&&args.p_current_pin!=='0123')return {data:{ok:false,error:'PIN hiện tại không đúng'}};
        state.enabled=args.p_new_pin!==null;return {data:{ok:true}};
      }
      if(name==='archived_investments')return {data:[]};
      if(name==='restore_investment'){
        if(args.p_revision!==state.revision)return {error:{message:'Dữ liệu đã thay đổi'}};
        const h=state.rows.find(x=>x.id==args.p_history),snap=args.p_side==='before'?h.before_data:h.after_data;
        state.data.assets=[clone(snap.asset)];state.data.itx=clone(snap.trades);state.revision++;
        return {data:state.revision};
      }
      return {data:[]};
    },channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){}
  }}};
}

test('finance interface with isolated Supabase fixtures',async t=>{
  const server=http.createServer((req,res)=>{
    const path=(req.url||'/').split('?')[0];
    if(path==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.APP_CONFIG={url:"https://example.test",key:"public-test"}');}
    if(path==='/sw.js'){res.setHeader('Content-Type','text/javascript');return res.end('');}
    const file=path==='/'?'index.html':path.slice(1);
    if(!/^[a-zA-Z0-9_.-]+$/.test(file)){res.writeHead(404);return res.end();}
    try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(readFileSync(resolve(publicDir,file)));}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const errors=[];
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https:\/\//,route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.addInitScript(fakeSupabase);
  await page.addInitScript(()=>localStorage.setItem('mkt_auto','0'));
  try{
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.waitForSelector('[data-a="t"][data-k="dt"]');
    await t.test('PIN disabled by default, clicking stock opens all-time history and actor',async()=>{
      assert.equal(await page.locator('[data-a="pinunlock"]').count(),0);
      await page.click('[data-a="t"][data-k="dt"]');
      await page.click('[data-a="ihistory"]');
      await page.waitForSelector('.history-entry');
      assert.match(await page.locator('#mf').innerText(),/Mua ban đầu/);
      assert.match(await page.locator('#mf').innerText(),/wife@example.test/);
      assert.match(await page.locator('#mf').innerText(),/toàn bộ thời gian/);
      await page.click('summary');
      assert.match(await page.locator('#mf').innerText(),/Thêm giao dịch/);
      await page.click('#ms');
    });
    await t.test('edit and delete through forms save audit; restore works with confirmation',async()=>{
      await page.evaluate(()=>edit('itx','buy1'));
      await page.fill('[data-f="qty"]','12');
      await page.fill('[data-f="note"]','Đã sửa số lượng');
      await page.click('#ms');
      await page.waitForFunction(()=>!PENDING&&!SAVE_BUSY);
      assert.equal(await page.evaluate(()=>TEST_STATE.data.itx[0].qty),12);
      await page.click('[data-a="ihistory"]');
      await page.locator('summary').first().click();
      assert.match(await page.locator('#mf').innerText(),/Sửa giao dịch/);
      assert.match(await page.locator('#mf').innerText(),/Đã sửa số lượng/);
      await page.locator('[data-a="vrestore"][data-k="before"]').first().click();
      assert.match(await page.locator('#mt').innerText(),/Xác nhận khôi phục/);
      await page.click('#ms');
      await page.waitForFunction(()=>D.itx[0].qty===10);
      assert.equal(await page.evaluate(()=>TEST_STATE.data.itx[0].qty),10);
      await page.evaluate(()=>del('itx','buy1'));
      await page.click('#ms');
      await page.waitForFunction(()=>!PENDING&&!SAVE_BUSY);
      assert.equal(await page.evaluate(()=>TEST_STATE.data.itx.length),0);
      await page.click('[data-a="ihistory"]');
      await page.locator('summary').first().click();
      assert.match(await page.locator('#mf').innerText(),/Xoá giao dịch/);
      await page.click('#ms');
    });
    await t.test('add buy and sell records through UI',async()=>{
      async function addTrade(type,qty){
        await page.evaluate(()=>fItx(null,'fpt','Chồng'));
        await page.selectOption('[data-f="type"]',type);
        await page.fill('[data-f="qty"]',String(qty));await page.fill('[data-f="price"]','100');
        await page.click('#ms');await page.waitForFunction(()=>!PENDING&&!SAVE_BUSY);
      }
      await addTrade('buy',20);await addTrade('sell',5);
      assert.deepEqual(await page.evaluate(()=>TEST_STATE.data.itx.map(x=>x.type)),['buy','sell']);
    });
    await t.test('wealth configuration applies independently to husband, wife and shared balances',async()=>{
      await page.click('[data-a="t"][data-k="mt"]');
      await page.click('[data-a="wealthdisplay"]');
      for(const k of ['all','Chồng','Vợ','Chung'])await page.selectOption('[data-f="'+k+'"]','cash');
      await page.click('#ms');await page.waitForSelector('#md[hidden]',{state:'attached'});
      assert.deepEqual(await page.evaluate(()=>USER.user_metadata.wealth_display),{all:'cash','Chồng':'cash','Vợ':'cash','Chung':'cash'});
      assert.equal(await page.locator('.s').filter({hasText:'Đang hiện tiền mặt'}).count(),3);
      await page.reload();await page.waitForSelector('[data-a="t"][data-k="mt"]');
      await page.click('[data-a="t"][data-k="mt"]');
      assert.equal(await page.locator('.s').filter({hasText:'Đang hiện tiền mặt'}).count(),3);
      // Different people may independently use different display modes.
      await page.evaluate(()=>{USER.user_metadata.wealth_display={all:'cash','Chồng':'cash','Vợ':'total','Chung':'cash'};tab='mt';render()});
      assert.equal(await page.locator('.s').filter({hasText:'Đang hiện tiền mặt'}).count(),2);
      assert.equal(await page.locator('.s').filter({hasText:'Đang hiện tổng tài sản'}).count(),1);
    });
    await t.test('PIN enable requires matching four digits; errors remain visible; new session gates app',async()=>{
      await page.evaluate(()=>fPinSettings());
      await page.selectOption('[data-f="mode"]','on');
      await page.fill('[data-pin="new"]','123');await page.fill('[data-pin="confirm"]','123');
      await page.click('#ms');assert.match(await page.locator('#me').innerText(),/đúng 4/);
      await page.fill('[data-pin="new"]','0123');await page.fill('[data-pin="confirm"]','0124');
      await page.click('#ms');assert.match(await page.locator('#me').innerText(),/không khớp/);
      await page.fill('[data-pin="confirm"]','0123');await page.click('#ms');
      await page.waitForFunction(()=>TEST_STATE.enabled);
      await page.evaluate(()=>{TEST_STATE.unlocked=false;start()});
      await page.waitForSelector('[data-pin="unlock"]');
      assert.equal(await page.locator('#nav button').count(),0);
      assert.equal(await page.evaluate(()=>HID),null);
      await page.fill('[data-pin="unlock"]','9999');await page.click('[data-a="pinunlock"]');
      await page.waitForFunction(()=>document.querySelector('#pin-error').textContent.length>0);
      assert.match(await page.locator('#pin-error').innerText(),/không đúng/);
      await page.fill('[data-pin="unlock"]','0123');await page.press('[data-pin="unlock"]','Enter');
      await page.waitForSelector('[data-a="t"][data-k="dt"]');
      await page.evaluate(()=>fPinSettings());
      await page.selectOption('[data-f="mode"]','off');
      await page.fill('[data-pin="current"]','9999');await page.click('#ms');
      assert.match(await page.locator('#me').innerText(),/không đúng/);
      await page.fill('[data-pin="current"]','0123');await page.click('#ms');
      await page.waitForFunction(()=>!TEST_STATE.enabled);
    });
    await t.test('viewer sees history without restore controls; mobile modal fits viewport',async()=>{
      await page.evaluate(()=>{RO=true;TEST_STATE.role='viewer';document.body.classList.add('ro');tab='dt';render()});
      await page.setViewportSize({width:390,height:844});
      await page.click('[data-a="ihistory"]');await page.waitForSelector('.history-entry');
      assert.equal(await page.locator('[data-a="vrestore"]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:'/tmp/finance-history-mobile.png'});
      await page.click('#ms');
    });
    await t.test('stale save keeps changes pending and explains conflict',async()=>{
      await page.evaluate(()=>{RO=false;TEST_STATE.failSave=true;D.itx[0].qty=15;save()});
      await page.waitForFunction(()=>!SAVE_BUSY);
      assert.equal(await page.evaluate(()=>PENDING),true);
      assert.match(await page.locator('#net').innerText(),/Thiết bị khác/);
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
