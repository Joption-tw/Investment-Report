// 歐大的投資報表：「多空指標」接收程式
// 歐大電腦上的多空監控程式每分鐘送一筆：時間、盤別、多空指標（-100 ~ +100）、期貨價、反轉分數與反轉訊號，
// 記到試算表「多空紀錄」分頁；總表頁首的「多空指標」卡片和走勢圖從這個分頁讀。
// 只收計算後的多空指標，不收看盤軟體的原始盤面數字，那些只留在歐大自己電腦的紀錄檔。
//
// 安裝（獨立的 Apps Script 專案，跟橡皮擦一樣，不放在試算表綁定的專案裡，避免 doPost 撞名）：
//   1. script.google.com →「新專案」，專案名稱改成「多空指標接收」，把這整個檔案貼上，按儲存
//   2. 上方函式選單選 setBiasKey → 按「執行」→ 依畫面授權（用你自己的 Google 帳號）
//   3. 下方「執行記錄」會印出一組密碼：貼到監控程式資料夾 upload.json 的 key（兩邊要一模一樣；密碼不寫在程式碼裡）
//   4. 「部署」→「新增部署作業」→ 類型「網頁應用程式」，執行身分「我」、存取權「所有人」→ 部署
//   5. 把網頁應用程式網址貼到 upload.json 的 url，並把 enabled 改成 true，重新啟動監控程式
//   6. 回試算表，會多一個「多空紀錄」分頁（可以隱藏，網站照樣讀得到）

const BIAS_SHEET_ID  = '1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk';
const BIAS_TAB       = '多空紀錄';
const BIAS_HEADER    = ['記錄時間', '盤別', '多空指標', '期貨', '反轉分數', '反轉A', '反轉B'];   // 反轉：2026-11-15 加入
const BIAS_KEEP_DAYS = 14;                // 試算表只留 14 天；GitHub Actions 每小時存到 data/bias/<週>.json 長期保存
const BIAS_TZ        = 'Asia/Taipei';
const BIAS_SCAN_ROWS = 1000;              // 覆蓋同一分鐘時，往回比對最近幾筆（每分鐘一筆，約 16 小時）

// 第一次執行時自動產生密碼並印在執行記錄；之後再執行會印出同一組（要換密碼：先執行 resetBiasKey）
function setBiasKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('BIAS_KEY');
  if (!key) { key = Utilities.getUuid(); props.setProperty('BIAS_KEY', key); }
  biasSheet_();
  Logger.log('upload.json 的 key：' + key);
}

function resetBiasKey() {
  PropertiesService.getScriptProperties().deleteProperty('BIAS_KEY');
  setBiasKey();
}

function biasSheet_() {
  const ss = SpreadsheetApp.openById(BIAS_SHEET_ID);
  let sh = ss.getSheetByName(BIAS_TAB);
  if (!sh) {
    sh = ss.insertSheet(BIAS_TAB, ss.getNumSheets());
    sh.getRange('A:B').setNumberFormat('@');     // 時間存成文字，網站用 A >= '時間' 查詢
    sh.getRange(1, 1, 1, BIAS_HEADER.length).setValues([BIAS_HEADER]);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < BIAS_HEADER.length) {
    sh.getRange(1, 1, 1, BIAS_HEADER.length).setValues([BIAS_HEADER]);   // 舊的分頁補上反轉欄位標題
  }
  return sh;
}

function biasOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return biasOut_({ ok: true });
}

// body：{ key, rows: [{ t: 'yyyy/MM/dd HH:mm:ss', sess: '日盤' | '夜盤', v: -100~100, fut: 期貨價,
//                      rs: 反轉分數 -100~100（可省略）, sa / sb: A / B 版反轉訊號 +1 反彈 / -1 拉回 / 0（可省略）}] }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return biasOut_({ ok: false, error: '格式錯誤' }); }
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('BIAS_KEY');
  if (!key || body.key !== key) return biasOut_({ ok: false, error: '密碼錯誤' });

  // 多空下單機共用參數（2026-11-21 加入）：任一台按「存檔」上傳，其他台按「更新參數」或開程式時下載
  //   { key, action: 'set_settings', at: '2026-11-21 15:19:57', from: 電腦名稱, ver: 版本, settings: {…} }
  //   { key, action: 'get_settings' } → { ok, doc: { at, from, ver, settings } | null }
  if (body.action === 'set_settings') {
    if (!body.settings || typeof body.settings !== 'object' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(body.at || '')) {
      return biasOut_({ ok: false, error: '參數格式錯誤' });
    }
    const doc = JSON.stringify({ at: body.at, from: String(body.from || '').slice(0, 40), ver: String(body.ver || '').slice(0, 10),
                                 settings: body.settings });
    if (doc.length > 8500) return biasOut_({ ok: false, error: '參數太大' });
    const lk = LockService.getScriptLock();
    lk.waitLock(15000);
    try { props.setProperty('TRADER_SETTINGS', doc); } finally { lk.releaseLock(); }
    return biasOut_({ ok: true, at: body.at });
  }
  if (body.action === 'get_settings') {
    const doc = props.getProperty('TRADER_SETTINGS');
    return biasOut_({ ok: true, doc: doc ? JSON.parse(doc) : null });
  }
  if (body.action === 'trader_report') {
    try { return traderReport_(body, props); } catch (err) { return biasOut_({ ok: false, error: String(err && err.message || err).slice(0, 200) }); }
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rows = (body.rows || []).filter(r => r
        && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(r.t)
        && (r.sess === '日盤' || r.sess === '夜盤')
        && typeof r.v === 'number' && r.v >= -100 && r.v <= 100
        && typeof r.fut === 'number' && r.fut > 0 && r.fut < 1e6)
      .slice(0, 1000)
      .sort((a, b) => a.t < b.t ? -1 : 1)
      .map(r => [r.t, r.sess, Math.round(r.v), r.fut,
                 typeof r.rs === 'number' && r.rs >= -100 && r.rs <= 100 ? Math.round(r.rs) : '',
                 r.sa === 1 || r.sa === -1 ? r.sa : 0, r.sb === 1 || r.sb === -1 ? r.sb : 0]);
    let added = 0, replaced = 0;
    if (rows.length) {
      // 同一分鐘只留一筆：兩台電腦都上傳、或斷線補送時，同一分鐘的舊資料直接覆蓋（以最近約 16 小時的紀錄比對）
      const sh = biasSheet_();
      const lastRow = sh.getLastRow();
      const from = Math.max(2, lastRow - BIAS_SCAN_ROWS + 1);
      const byMinute = new Map();
      if (lastRow >= from) {
        sh.getRange(from, 1, lastRow - from + 1, 1).getDisplayValues()
          .forEach((v, i) => { if (v[0]) byMinute.set(v[0].slice(0, 16), from + i); });
      }
      const append = [];
      rows.forEach(r => {
        const m = r[0].slice(0, 16), at = byMinute.get(m);
        if (typeof at === 'number') { sh.getRange(at, 1, 1, BIAS_HEADER.length).setValues([r]); replaced++; }
        else if (typeof at === 'object') { at.splice(0, r.length, ...r); replaced++; }   // 同一批裡同一分鐘：留最後一筆
        else { append.push(r); byMinute.set(m, r); }
      });
      if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, BIAS_HEADER.length).setValues(append);
      added = append.length;
    }
    // 每天第一次寫入時清掉 14 天前的紀錄
    const today = Utilities.formatDate(new Date(), BIAS_TZ, 'yyyy-MM-dd');
    if (props.getProperty('biasTrimmed') !== today) { biasTrim_(biasSheet_()); props.setProperty('biasTrimmed', today); }
    return biasOut_({ ok: true, n: added + replaced, added, replaced });
  } finally {
    lock.releaseLock();
  }
}

function biasTrim_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const cutoff = Utilities.formatDate(new Date(Date.now() - BIAS_KEEP_DAYS * 864e5), BIAS_TZ, 'yyyy/MM/dd HH:mm:ss');
  const times = sh.getRange(2, 1, n, 1).getDisplayValues();
  let k = 0;
  while (k < times.length && times[k][0] && times[k][0] < cutoff) k++;
  if (k > 0) sh.deleteRows(2, k);
}

// ===== 多空下單機成交上報（2026-11-26 加入，下單機 web_report.py）=====
// { key, action: 'trader_report', pc: 電腦名稱, ver, at: 'yyyy/MM/dd HH:mm:ss', sess: '20261126_日盤',
//   fills: [{ k, t, sess, mode: 實單|模擬, strat, act, prod, sym, side: 買|賣, qty, price, pts, net }],
//   snap: [{ mode, strat, n, win, loss, pts, net, hold, unreal, total }], snap20: 每 20 分鐘那一張才是 true,
//   perf: [{ sess, mode, trades, realized, cost, unreal, net, t }]（每盤損益，最近 30 盤，跟下單機「庫存 / 績效」頁同一份） }
// 分頁：「下單機成交」一筆一列（序號去重複）、「下單機總表」每 20 分鐘存一張（這兩頁只留 14 天）；
//       「下單機現況」「下單機每盤」每台只留最新的。
const TR_FILL_TAB = '下單機成交', TR_NOW_TAB = '下單機現況', TR_SNAP_TAB = '下單機總表', TR_PERF_TAB = '下單機每盤';
const TR_PERF_HEAD = ['時間', '電腦', '盤別', '模式', '成交筆數', '已實現元', '手續費稅元', '未實現元', '淨合計元', '最後更新'];
const TR_FILL_HEAD = ['時間', '電腦', '盤別', '模式', '策略', '動作', '商品', '代碼', '買賣', '口數', '價格', '損益點', '損益元', '序號'];
const TR_SNAP_HEAD = ['時間', '電腦', '盤別', '模式', '策略', '出場趟數', '贏', '輸', '已實現點', '已實現元', '持倉', '未實現元', '合計元'];
const TR_FILL_TEXT = ['A:D', 'H:H', 'N:N'];
const TR_TIME = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/;
const TR_SESS = /^\d{8}_(日盤|夜盤)$/;

function trSheet_(name, head, textCols) {
  const ss = SpreadsheetApp.openById(BIAS_SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, ss.getNumSheets());
  // 每次都確認：時間、電腦、盤別、模式（成交頁加代碼、序號）是文字（不然試算表會把時間自動變成日期），第一列是標題
  (textCols || ['A:D']).forEach(a => sh.getRange(a).setNumberFormat('@'));
  if (sh.getRange(1, 1).getDisplayValue() !== head[0]) {
    if (sh.getLastRow() > 0) sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 整頁讀出來、去掉這台的舊列、加上這台最新的、整頁寫回（其他台的不動）
function trReplace_(tab, head, pc, mine) {
  const sh = trSheet_(tab, head);
  const W = head.length, last = sh.getLastRow();
  const keep = last > 1 ? sh.getRange(2, 1, last - 1, W).getValues().filter(r => r[0] !== '' && String(r[1]) !== pc) : [];
  const all = keep.concat(mine);
  if (last > 1) sh.getRange(2, 1, last - 1, W).clearContent();
  sh.getRange(2, 1, all.length, W).setValues(all);
}

function traderReport_(body, props) {
  const txt = (v, n) => String(v === null || v === undefined ? '' : v).slice(0, n);
  const num = v => typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e9 ? v : '';
  const pc = txt(body.pc, 40);
  if (!pc || !TR_TIME.test(body.at || '') || !TR_SESS.test(body.sess || '')) return biasOut_({ ok: false, error: '格式錯誤' });
  const mode = m => m === '實單' || m === '模擬' ? m : '';
  const fills = (Array.isArray(body.fills) ? body.fills : []).slice(0, 500)
    .filter(f => f && TR_TIME.test(f.t) && TR_SESS.test(f.sess) && mode(f.mode) && (f.side === '買' || f.side === '賣')
                 && typeof f.qty === 'number' && f.qty > 0 && typeof f.price === 'number' && f.k)
    .map(f => [f.t, pc, f.sess, f.mode, txt(f.strat, 30), txt(f.act, 30), txt(f.prod, 10), txt(f.sym, 20), f.side, f.qty, f.price,
               num(f.pts), num(f.net), pc + '|' + txt(f.k, 80)]);
  const snap = (Array.isArray(body.snap) ? body.snap : []).slice(0, 60).filter(r => r && mode(r.mode))
    .map(r => [body.at, pc, body.sess, r.mode, txt(r.strat, 30), num(r.n), num(r.win), num(r.loss), num(r.pts), num(r.net),
               txt(r.hold, 200), num(r.unreal), num(r.total)]);
  const perf = (Array.isArray(body.perf) ? body.perf : []).slice(0, 80).filter(r => r && mode(r.mode) && TR_SESS.test(r.sess))
    .map(r => [body.at, pc, r.sess, r.mode, num(r.trades), num(r.realized), num(r.cost), num(r.unreal), num(r.net), txt(r.t, 20)]);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let added = 0;
    if (fills.length) {
      const sh = trSheet_(TR_FILL_TAB, TR_FILL_HEAD, TR_FILL_TEXT);
      const last = sh.getLastRow(), from = Math.max(2, last - 3000 + 1);
      const have = new Set(last >= from ? sh.getRange(from, 14, last - from + 1, 1).getDisplayValues().map(v => v[0]) : []);
      const add = fills.filter(f => !have.has(f[13]) && (have.add(f[13]), true)).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, TR_FILL_HEAD.length).setValues(add);
      added = add.length;
    }
    trReplace_(TR_NOW_TAB, TR_SNAP_HEAD, pc, snap.length ? snap : [[body.at, pc, body.sess, '模擬', '（還沒有成交）', '', '', '', '', '', '', '', '']]);
    if (perf.length) trReplace_(TR_PERF_TAB, TR_PERF_HEAD, pc, perf);
    if (body.snap20 && snap.length) {
      const sh = trSheet_(TR_SNAP_TAB, TR_SNAP_HEAD);
      sh.getRange(sh.getLastRow() + 1, 1, snap.length, TR_SNAP_HEAD.length).setValues(snap);
    }
    const today = Utilities.formatDate(new Date(), BIAS_TZ, 'yyyy-MM-dd');
    if (props.getProperty('trTrimmed') !== today) {
      biasTrim_(trSheet_(TR_FILL_TAB, TR_FILL_HEAD, TR_FILL_TEXT));
      biasTrim_(trSheet_(TR_SNAP_TAB, TR_SNAP_HEAD));
      props.setProperty('trTrimmed', today);
    }
    return biasOut_({ ok: true, added, tr: 1 });   // tr：下單機用來確認接收程式是新版（舊版會走多空紀錄那條、也回 ok）
  } finally {
    lock.releaseLock();
  }
}
