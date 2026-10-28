// 歐大的投資報表：帳號頁走勢圖的「橡皮擦」
// 網頁上把不合理的點塗掉 / 還原時，送到這個網頁應用程式，記到試算表「塗掉紀錄」分頁；
// 所有人打開帳號頁都會讀這個分頁，塗掉的點就不畫。要有密碼才能寫入。
//
// 安裝（獨立的 Apps Script 專案，不放在試算表綁定的專案裡，避免跟原本的 doGet / doPost 撞名）：
//   1. script.google.com →「新專案」，把這整個檔案貼上，按儲存
//   2. 把 setErasePassword 裡的密碼改掉 → 執行 setErasePassword（第一次會要求授權）
//   3. 「部署」→「新增部署作業」→ 類型「網頁應用程式」，執行身分「我」、存取權「所有人」→ 部署
//   4. 把網頁應用程式網址填到網站 common.js 的 ERASE_API
//   5. 回試算表把「塗掉紀錄」分頁隱藏（右鍵分頁 →「隱藏工作表」），看試算表的人就看不到；網站照樣讀得到

const ERASE_SHEET_ID = '1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk';
const ERASE_TAB      = '塗掉紀錄';
const ERASE_HEADER   = ['記錄時間', '帳號', '線', '點時間', '動作'];
const ERASE_LINES    = ['fut', 'pts', 'rate', 'pnl', 'ba', 'bb', 'ratio', 'margin'];

function setErasePassword() {
  PropertiesService.getScriptProperties().setProperty('ERASE_KEY', 'PUT-PASSWORD-HERE');
  eraseSheet_();
}

function eraseSheet_() {
  const ss = SpreadsheetApp.openById(ERASE_SHEET_ID);
  let sh = ss.getSheetByName(ERASE_TAB);
  if (!sh) {
    sh = ss.insertSheet(ERASE_TAB, ss.getNumSheets());
    sh.getRange('A:E').setNumberFormat('@');
    sh.getRange(1, 1, 1, ERASE_HEADER.length).setValues([ERASE_HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return out_({ ok: true });
}

// body：{ key, check?, items: [{ account, line, t: 'yyyy/MM/dd HH:mm:ss', action: 'erase' | 'restore' }] }
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: '格式錯誤' }); }
  const key = PropertiesService.getScriptProperties().getProperty('ERASE_KEY');
  if (!key || body.key !== key) return out_({ ok: false, error: '密碼錯誤' });
  if (body.check) return out_({ ok: true });

  const items = (body.items || []).filter(it => it
    && typeof it.account === 'string' && it.account.length > 0 && it.account.length <= 40
    && ERASE_LINES.indexOf(it.line) !== -1
    && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(it.t)).slice(0, 3000);
  if (!items.length) return out_({ ok: true, n: 0 });

  const now = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss');
  const rows = items.map(it => [now, it.account, it.line, it.t, it.action === 'restore' ? '還原' : '塗掉']);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = eraseSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, ERASE_HEADER.length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return out_({ ok: true, n: rows.length });
}
