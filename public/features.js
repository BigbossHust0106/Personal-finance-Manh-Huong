/* Lịch sử đầu tư, tuỳ chọn tài sản và PIN. Cần supabase-update-0.3.0.sql. */
var FIN_REV = 0, SAVE_BUSY = false, HISTORY = null, PIN_ENABLED = false;
// Chỉ nhớ trong bộ nhớ của trang, không giữ qua reload/tab mới.
var PIN_UNLOCKED_USER = null;
var RECENT_HISTORIES = {};
var HISTORY_PREVIEW_LIMIT = 5;
function historyItems(key, title, items, row, heading) {
  RECENT_HISTORIES[key] = {hid:HID, title:title, items:items, row:row, heading:heading};
  return items.slice(0,HISTORY_PREVIEW_LIMIT).map(row).join('');
}
function historyMore(key) {
  var entry = RECENT_HISTORIES[key];
  return entry && entry.items.length > HISTORY_PREVIEW_LIMIT ? '<div class="history-actions"><button type="button" class="btn g" data-a="historyall" data-k="' + esc(key) + '">Xem tất cả (' + entry.items.length + ')</button></div>' : '';
}
function fAllHistory(key) {
  var entry = RECENT_HISTORIES[key];
  if (!entry || entry.hid !== HID) return;
  form(entry.title + ' · Tất cả', [{k:'allhistory',t:'html',h:function() {
    var rows = entry.items.map(entry.row).join('');
    return '<p class="history-note">' + entry.items.length + ' bản ghi theo bộ lọc của danh sách đang xem.</p>' +
      (entry.heading ? '<div class="tw"><table>' + entry.heading + rows + '</table></div>' : rows);
  }}],{},null,'','Đóng');
}
var UPDATE_SQL = 'Cần cập nhật database: chạy file supabase-update-0.3.0.sql trong Supabase › SQL Editor rồi tải lại trang.';

function featureError(r) {
  return needSql(r) || /column.*revision|investment_history/i.test(r.error && r.error.message || '')
    ? UPDATE_SQL : r.error && r.error.message || 'Không kết nối được. Hãy thử lại.';
}

/* Lưu tuần tự và kiểm tra revision để không ghi đè thay đổi từ thiết bị khác. */
function saveFinance() {
  if (RO || !HID) { if (HID) render(); return; }
  PENDING = true;
  render(); netLine();
  if (SAVE_BUSY) return;
  var hid = HID, payload = JSON.parse(JSON.stringify(D)), revision = FIN_REV;
  SAVE_BUSY = true;
  SB.from('finance_data').update({data: payload, updated_by: USER.id, client: CID})
    .eq('household_id', hid).eq('revision', revision).select('revision').single()
    .then(function(r) {
      SAVE_BUSY = false;
      if (HID !== hid) { if (PENDING) saveFinance(); return; }
      if (r.error || !r.data) {
        var msg = r.error && r.error.code === 'PGRST116'
          ? 'Thiết bị khác đã thay đổi dữ liệu. Hãy tải bản sao lưu các thay đổi của bạn rồi tải lại trang để đối chiếu.'
          : featureError(r);
        PENDING = true; netLine(msg); toast(msg, true); return;
      }
      FIN_REV = r.data.revision;
      if (JSON.stringify(D) !== JSON.stringify(payload)) return saveFinance();
      PENDING = false; netLine();
    }).catch(function(e) {
      SAVE_BUSY = false;
      if (HID === hid) { PENDING = true; netLine(e.message); }
    });
}

function wealthModes() { return prof().wealth_display || {}; }
function wealthOverallStat(total, cash) {
  var cashOnly = wealthModes().all === 'cash';
  return stat(cashOnly ? 'Tiền mặt hiện có' : 'Tổng tài sản', money(cashOnly ? cash : total),
    cashOnly ? 'Tiền mặt / ngân hàng, không gồm tài khoản đầu tư' : 'Tính đến hôm nay', cls(cashOnly ? cash : total));
}
function ownerWealthStat(member, o) {
  var cashOnly = wealthModes()[member] === 'cash', total = o.cash + o.ic + o.iv - o.debt;
  return stat(member === 'Chung' ? 'Tiền chung' : 'Tiền riêng của ' + member.toLowerCase(),
    money(cashOnly ? o.cash : total),
    (cashOnly ? 'Đang hiện tiền mặt · ' : 'Đang hiện tổng tài sản · ') + 'Tiền mặt ' + money(o.cash) +
    ' · Đầu tư ' + money(o.ic + o.iv) + (o.debt > 0 ? ' · Nợ margin ' + money(o.debt) : ''), cls(cashOnly ? o.cash : total));
}
function fWealthDisplay() {
  var modes = wealthModes(), keys = ['all'].concat(MEM.map(function(m) { return m[0]; }));
  var v = {}, options = [['total', 'Tổng tài sản (gồm đầu tư)'], ['cash', 'Tiền mặt / ngân hàng hiện có']];
  keys.forEach(function(k) { v[k] = modes[k] === 'cash' ? 'cash' : 'total'; });
  form('Hiển thị tài sản', keys.map(function(k) {
    return {k:k, l:k === 'all' ? 'Thẻ tổng tài sản' : 'Tiền của ' + k.toLowerCase(), t:'sel', o:options};
  }), v, async function(values) {
    var r = await SB.auth.updateUser({data:{wealth_display:values}});
    if (r.error) return r.error.message;
    USER = r.data.user; render(); toast('Đã lưu cách hiển thị tài sản');
  }, 'Áp dụng riêng cho tài khoản của bạn trên các thiết bị. Tiền mặt không gồm tiền trong tài khoản đầu tư. Tổng riêng từng người đã trừ nợ margin; tổng toàn bộ hiển thị tài sản trước khi trừ nợ.');
  FM.persist = false;
}

function tradeSummary(t, asset) {
  return esc(lbl(TT, t.type)) + ' · ' + esc(vd(t.date)) + ' · ' + esc(t.owner || asset && asset.owner || tOw(t)) +
    ' · SL ' + fm.format(t.qty || 0) + ' · Giá / tiền ' + money(t.price) +
    ' · Phí ' + money(t.fee) + ' · Thuế ' + money(t.tax) +
    (t.note ? '<br>Ghi chú: ' + esc(t.note) : '');
}
function versionChanges(h) {
  var b = h.before_data || {}, a = h.after_data || {}, before = b.trades || [], after = a.trades || [], html = [];
  before.forEach(function(t) {
    var next = after.find(function(x) { return x.id === t.id; });
    if (!next || JSON.stringify(next) !== JSON.stringify(t)) {
      html.push('<div class="version-change"><b>' + (next ? 'Sửa giao dịch' : 'Xoá giao dịch') +
        '</b><div>Trước: ' + tradeSummary(t,b.asset) + '</div>' + (next ? '<div>Sau: ' + tradeSummary(next,a.asset) + '</div>' : '') + '</div>');
    }
  });
  after.forEach(function(t) {
    if (!before.some(function(x) { return x.id === t.id; })) html.push('<div class="version-change"><b>' +
      (h.action === 'baseline' ? 'Giao dịch có sẵn' : 'Thêm giao dịch') + '</b><div>' + tradeSummary(t,a.asset) + '</div></div>');
  });
  var ba = b.asset, aa = a.asset;
  if (JSON.stringify(ba && [ba.sym,ba.name,ba.type,ba.owner,ba.note]) !== JSON.stringify(aa && [aa.sym,aa.name,aa.type,aa.owner,aa.note])) {
    var label = function(x) { return x ? esc([x.sym,x.name,lbl(AT,x.type),x.owner || 'Chung',x.note].filter(Boolean).join(' · ')) : '(không có mã)'; };
    html.unshift('<div class="version-change"><b>Thông tin tài sản</b><div>Trước: ' + label(ba) + '</div><div>Sau: ' + label(aa) + '</div></div>');
  }
  return html.join('') || '<p>Phiên bản không có thay đổi giao dịch.</p>';
}
function historyMarkup(state) {
  return '<p class="history-note">Tất cả chủ sở hữu · toàn bộ thời gian. Mỗi lần sửa, xoá hoặc khôi phục đều được lưu riêng. Giá thị trường tự cập nhật không tạo phiên bản.</p>' +
    '<h3>Giao dịch hiện tại</h3>' + (state.trades.length ? historyItems('symbol-trades','Giao dịch của mã',desc(state.trades),function(t) {
      return '<div class="version-change">' + tradeSummary(t) + '</div>';
    }) + historyMore('symbol-trades') : '<p>Chưa có giao dịch.</p>') + '<h3>Nhật ký và phiên bản lưu trữ</h3>' +
    (state.rows.length ? state.rows.map(function(h) {
      return '<article class="history-entry"><b>' + esc(h.actor_name) + '</b>' + (h.actor_email ? ' <span class="history-note">(' + esc(h.actor_email) + ')</span>' : '') + ' · ' + dtm(h.occurred_at) +
        '<div class="history-note">' + (h.action === 'restore' ? 'Khôi phục từ phiên bản #' + h.restored_from : h.action === 'baseline' ? 'Mốc dữ liệu trước khi bật lịch sử' : 'Cập nhật đầu tư') +
        ' · #' + h.id + '</div><details><summary>Xem nội dung thay đổi</summary>' + versionChanges(h) + '</details>' +
        (!RO ? '<div class="history-actions">' + (h.before_data ? '<button type="button" class="chip" data-a="vrestore" data-i="' + h.id + '" data-k="before">Khôi phục trước thay đổi</button>' : '') +
        '<button type="button" class="chip" data-a="vrestore" data-i="' + h.id + '" data-k="after">Khôi phục phiên bản này</button></div>' : '') + '</article>';
    }).join('') : '<p>Chưa có nhật ký.</p>') +
    (state.more ? '<button type="button" class="btn g" data-a="vmore">Xem tất cả phiên bản</button>' : '') +
    '<p class="history-note">Giao dịch trước bản cập nhật chưa có thông tin người thực hiện. Khôi phục áp dụng toàn bộ giao dịch và thông tin của riêng mã này cho cả vợ, chồng và chung; giữ giá thị trường hiện tại, không thay đổi các mã khác.</p>';
}
async function fInvestmentHistory(assetId, more) {
  var hid = HID, state = more ? HISTORY : {hid:hid, assetId:assetId, rows:[], trades:D.itx.filter(function(t) { return t.asset === assetId; })};
  if (!state || state.hid !== hid) return;
  var batch = more ? 50 : HISTORY_PREVIEW_LIMIT + 1;
  do {
    var query = SB.from('investment_history').select('*').eq('household_id',hid).eq('asset_id',assetId).order('id',{ascending:false}).limit(batch);
    if (state.rows.length) query = query.lt('id',state.rows[state.rows.length-1].id);
    var r;
    try { r = await query; } catch(e) { return toast('Không tải được lịch sử: ' + e.message,true); }
    if (hid !== HID) return;
    if (r.error) return toast(featureError(r),true);
    state.rows = state.rows.concat(more ? r.data || [] : (r.data || []).slice(0,HISTORY_PREVIEW_LIMIT));
    state.more = more ? r.data.length === batch : r.data.length > HISTORY_PREVIEW_LIMIT;
  } while (more && state.more);
  HISTORY = state;
  var a = D.assets.find(function(x) { return x.id === assetId; });
  form((more ? 'Tất cả phiên bản · ' : 'Lịch sử · ') + (a ? a.sym : 'Mã đã xoá'), [{k:'history',t:'html',h:function() { return historyMarkup(state); }}], {}, null, '', 'Đóng');
}
async function fArchivedInvestments() {
  var hid = HID, r = await SB.rpc('archived_investments',{p_household:hid});
  if (HID !== hid) return;
  if (r.error) return toast(featureError(r),true);
  form('Lịch sử mã đã xoá', [{k:'archive',t:'html',h:function() {
    return r.data.length ? r.data.map(function(a) {
      return '<button type="button" class="btn g" data-a="ihistory" data-i="' + esc(a.asset_id) + '">' + esc(a.symbol) + ' · Lịch sử / khôi phục</button>';
    }).join(' ') : '<p>Chưa có mã đã xoá.</p>';
  }}],{},null,'','Đóng');
}
function fRestoreInvestment(id, side) {
  if (RO || !HISTORY || HISTORY.hid !== HID) return;
  if (PENDING || SAVE_BUSY) return toast('Hãy lưu xong thay đổi hiện tại trước khi khôi phục.',true);
  var state = HISTORY, h = state.rows.find(function(x) { return String(x.id) === String(id); });
  if (!h) return;
  var hid = HID, revision = FIN_REV, snap = side === 'before' ? h.before_data : h.after_data;
  if (!snap) return;
  form('Xác nhận khôi phục', [{k:'preview',t:'html',h:function() {
    return '<p>Khôi phục ' + (side === 'before' ? 'trước thay đổi' : 'sau thay đổi') + ' #' + h.id + ' của <b>' + esc(h.actor_name) + '</b> (' + dtm(h.occurred_at) + ').</p>' +
      '<p>Toàn bộ lịch sử giao dịch hiện tại của mã này sẽ được thay bằng ' + (snap.trades || []).length + ' giao dịch trong phiên bản đã chọn. Các mã khác được giữ nguyên. Thao tác này sẽ tạo phiên bản mới để có thể hoàn tác.</p>' +
      (snap.trades || []).map(function(t) { return '<div class="version-change">' + tradeSummary(t,snap.asset) + '</div>'; }).join('');
  }}], {}, async function() {
    if (HID !== hid || PENDING || SAVE_BUSY) return 'Dữ liệu đã thay đổi. Hãy mở lại lịch sử.';
    var r = await SB.rpc('restore_investment',{p_household:hid,p_history:id,p_side:side,p_revision:revision});
    if (r.error) return featureError(r);
    var fresh = await SB.from('finance_data').select('data,revision').eq('household_id',hid).single();
    if (fresh.error) return 'Đã khôi phục trên server. Hãy tải lại trang: ' + fresh.error.message;
    if (HID !== hid) return;
    load(JSON.stringify(fresh.data.data)); FIN_REV = fresh.data.revision; PENDING = false;
    render(); toast('Đã khôi phục và lưu một phiên bản mới');
  }, '', 'Khôi phục');
  FM.persist = false;
}

function pinInput(name, label) {
  return '<label class="fl">' + label + '<input data-pin="' + name + '" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="off" required></label>';
}
function pinValue(name) { var input = document.querySelector('[data-pin="' + name + '"]'); return input ? input.value : ''; }
function pinGate() {
  PIN_UNLOCKED_USER = null;
  if (CHN) { SB.removeChannel(CHN); CHN = null; }
  HID = null; D = blank(); HISTORY = null; PENDING = false;
  if (FM) closeF(); blankUI(); $('#acct').innerHTML = ''; $('#sync').textContent = '';
  $('#main').innerHTML = '<section class="card pin-card"><h2>Khoá bảo mật</h2><p>' + esc(USER.email) + '</p><p>Nhập PIN 4 số để mở dữ liệu của bạn.</p>' +
    pinInput('unlock','PIN 4 số') + '<p id="pin-error" role="alert" class="neg"></p><div class="mb"><button class="btn g" data-a="signout">Đăng xuất</button><button class="btn" data-a="pinunlock">Mở khoá</button></div><p class="history-note">Quên PIN: liên hệ quản trị viên Supabase để đặt lại. Không thể bỏ qua PIN bằng cách tải lại trang.</p></section>';
}
async function checkPinAccess() {
  var r = await SB.rpc('pin_status');
  if (r.error) { errUI(featureError(r)); return false; }
  PIN_ENABLED = !!r.data.enabled;
  if (!r.data.unlocked || PIN_ENABLED && PIN_UNLOCKED_USER !== USER.id) { pinGate(); return false; }
  return true;
}
async function fPinSettings() {
  var r = await SB.rpc('pin_status');
  if (r.error) return toast(featureError(r),true);
  PIN_ENABLED = !!r.data.enabled;
  if (PIN_ENABLED && !r.data.unlocked) return pinGate();
  form('Bảo mật PIN · tài khoản của tôi', [{k:'mode',l:'PIN khi đăng nhập',t:'sel',o:[['off','Tắt (mặc định)'],['on','Bật / đổi PIN']]},
    {k:'pins',t:'html',h:function(v) {
      return (PIN_ENABLED ? pinInput('current','PIN hiện tại (bắt buộc khi đổi hoặc tắt)') : '') +
        (v.mode === 'on' ? pinInput('new','PIN mới gồm 4 số') + pinInput('confirm','Nhập lại PIN mới') : '');
    }}], {mode:PIN_ENABLED ? 'on' : 'off'}, async function(v) {
    var current = pinValue('current'), next = v.mode === 'on' ? pinValue('new') : null;
    if (PIN_ENABLED && !/^\d{4}$/.test(current)) return 'Nhập PIN hiện tại gồm 4 số.';
    if (next !== null && !/^\d{4}$/.test(next)) return 'PIN mới phải gồm đúng 4 số.';
    if (next !== null && next !== pinValue('confirm')) return 'Hai lần nhập PIN mới không khớp.';
    var result = await SB.rpc('pin_configure',{p_current_pin:current,p_new_pin:next});
    if (result.error) return featureError(result);
    if (!result.data.ok) return result.data.error;
    PIN_ENABLED = next !== null;
    PIN_UNLOCKED_USER = PIN_ENABLED ? USER.id : null;
    toast(PIN_ENABLED ? 'Đã bật PIN cho tài khoản của bạn' : 'Đã tắt PIN cho tài khoản của bạn');
  }, 'PIN riêng cho từng tài khoản, được yêu cầu mỗi lần mở hoặc tải lại trang, kể cả khi vẫn còn đăng nhập. PIN được băm ở server. Nhập sai 5 lần sẽ tạm khoá 5 phút. Đây là khoá bổ sung, không phải xác thực hai yếu tố (2FA).');
  FM.persist = false;
}

document.addEventListener('click', async function(e) {
  var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  var action = b.dataset.a;
  try {
    if (action === 'historyall') fAllHistory(b.dataset.k);
    else if (action === 'ihistory' || action === 'tsf') { e.preventDefault(); await fInvestmentHistory(b.dataset.i); }
    else if (action === 'iarchive') await fArchivedInvestments();
    else if (action === 'vmore' && HISTORY) { b.disabled = true; await fInvestmentHistory(HISTORY.assetId,true); }
    else if (action === 'vrestore') fRestoreInvestment(b.dataset.i,b.dataset.k);
    else if (action === 'wealthdisplay') fWealthDisplay();
    else if (action === 'pinsettings') { var menu = $('#accm'); if (menu) menu.hidden = true; await fPinSettings(); }
    else if (action === 'pinunlock') {
      var pin = pinValue('unlock');
      if (!/^\d{4}$/.test(pin)) { $('#pin-error').textContent = 'Nhập đúng 4 chữ số.'; return; }
      b.disabled = true;
      var r = await SB.rpc('pin_unlock',{p_pin:pin});
      if (r.error || !r.data.ok) { $('#pin-error').textContent = r.error ? featureError(r) : r.data.error; return; }
      PIN_UNLOCKED_USER = USER.id;
      await start();
    }
  } catch(err) { toast(err.message || 'Không kết nối được. Hãy thử lại.',true); }
  finally { b.disabled = false; }
});
// Back/Forward có thể khôi phục cả bộ nhớ của trang từ bfcache.
window.addEventListener('pageshow', function(e) {
  if (e.persisted && SB) { PIN_UNLOCKED_USER = null; start(); }
});
document.addEventListener('keydown',function(e) {
  if (e.key === 'Enter' && e.target.matches('[data-pin="unlock"]')) {
    e.preventDefault(); var b = document.querySelector('[data-a="pinunlock"]'); if (b) b.click();
  }
});
