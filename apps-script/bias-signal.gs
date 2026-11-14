// 歐大的投資報表：「多空指標」接收程式
// 歐大電腦上的多空監控程式每分鐘送一筆：時間、盤別、多空指標（-100 ~ +100）、期貨價，
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
const BIAS_HEADER    = ['記錄時間', '盤別', '多空指標', '期貨'];
const BIAS_KEEP_DAYS = 14;                // 試算表只留 14 天；GitHub Actions 每小時存到 data/bias/<週>.json 長期保存
const BIAS_TZ        = 'Asia/Taipei';

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
  }
  return sh;
}

function biasOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return biasOut_({ ok: true });
}

// body：{ key, rows: [{ t: 'yyyy/MM/dd HH:mm:ss', sess: '日盤' | '夜盤', v: -100~100, fut: 期貨價 }] }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return biasOut_({ ok: false, error: '格式錯誤' }); }
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('BIAS_KEY');
  if (!key || body.key !== key) return biasOut_({ ok: false, error: '密碼錯誤' });

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const last = props.getProperty('biasLast') || '';
    const rows = (body.rows || []).filter(r => r
        && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(r.t) && r.t > last
        && (r.sess === '日盤' || r.sess === '夜盤')
        && typeof r.v === 'number' && r.v >= -100 && r.v <= 100
        && typeof r.fut === 'number' && r.fut > 0 && r.fut < 1e6)
      .slice(0, 1000)
      .sort((a, b) => a.t < b.t ? -1 : 1)
      .map(r => [r.t, r.sess, Math.round(r.v), r.fut]);
    if (rows.length) {
      const sh = biasSheet_();
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, BIAS_HEADER.length).setValues(rows);
      props.setProperty('biasLast', rows[rows.length - 1][0]);
    }
    // 每天第一次寫入時清掉 14 天前的紀錄
    const today = Utilities.formatDate(new Date(), BIAS_TZ, 'yyyy-MM-dd');
    if (props.getProperty('biasTrimmed') !== today) { biasTrim_(biasSheet_()); props.setProperty('biasTrimmed', today); }
    return biasOut_({ ok: true, n: rows.length });
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
