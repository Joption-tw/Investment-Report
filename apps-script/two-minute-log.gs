// 歐大的投資報表：每 2 分鐘把「績效表」上方總表（C2:P14）各帳號的數字記到「兩分鐘紀錄」分頁
// 「績效表」自己的快照只有每 10 分鐘一筆、約保留 16 小時；這裡每 2 分鐘記一筆、保留 7 天，
// GitHub Actions（scripts/record_sessions.py）每小時把它存到網站的 data/series/<週>.json，長期保存。
//
// 安裝（只要做一次）：
//   1. 打開投資報表試算表 → 上方選單「擴充功能」→「Apps Script」
//   2. 左邊「檔案」旁的 ＋ →「指令碼」，取名「兩分鐘紀錄」，把這整個檔案貼上，按儲存
//   3. 上方函式選單選 setup → 按「執行」→ 依畫面授權（用你自己的 Google 帳號）
//   4. 回到試算表，會多一個「兩分鐘紀錄」分頁，盤中每 2 分鐘多一組資料
// 停止：在 Apps Script 執行 stop

const SOURCE_SHEET = '績效表';
const SOURCE_RANGE = 'C2:P14';
const LOG_SHEET    = '兩分鐘紀錄';
const KEEP_DAYS    = 7;
const TZ           = 'Asia/Taipei';
const HEADER = ['記錄時間', '社群暱稱', '更新時間', '買權比值', '總Delta值', '時間價值', '獲利金額', '獲利率',
                '保證金餘額', '剩餘比率', '期貨指數', '資產', '起始資產', '總點數', '點數比'];

function setup() {
  stop();
  ScriptApp.newTrigger('logEvery2Min').timeBased().everyMinutes(1).create();
  logSheet_();
  logEvery2Min(true);
}

function stop() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'logEvery2Min')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange('A:O').setNumberFormat('@');          // 全部存成文字，原樣保留試算表顯示的數字
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sh.setFrozenRows(1);
  }
  return sh;
}

// 早盤 08:45~13:45（週一～五）、夜盤 15:00~隔日 05:00（週一～五開盤）
function inSession_(dow, m) {
  if (dow >= 1 && dow <= 5 && ((m >= 525 && m <= 825) || m >= 900)) return true;
  if (dow >= 2 && dow <= 6 && m <= 300) return true;
  return false;
}

// 觸發器每分鐘叫一次；距離上一筆滿 2 分鐘（110 秒）才記，避免觸發時間飄移時漏記或重複
function logEvery2Min(force) {
  const now = new Date();
  const [dow, hh, mm] = Utilities.formatDate(now, TZ, 'u,H,m').split(',').map(Number);
  const props = PropertiesService.getScriptProperties();
  const sh = logSheet_();

  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  if (hh === 6 && props.getProperty('trimmed') !== today) { trim_(sh); props.setProperty('trimmed', today); }

  if (force !== true) {
    if (!inSession_(dow, hh * 60 + mm)) return;
    if (now.getTime() - Number(props.getProperty('last') || 0) < 110e3) return;
  }

  const block = SpreadsheetApp.getActive().getSheetByName(SOURCE_SHEET).getRange(SOURCE_RANGE).getDisplayValues();
  const stamp = Utilities.formatDate(now, TZ, 'yyyy/MM/dd HH:mm:ss');
  const rows = [];
  for (const r of block.slice(2)) {                    // 第 1 列是時間、第 2 列是標題
    const name = String(r[0]).trim();
    if (!name) break;
    rows.push([stamp].concat(r));
    if (name.indexOf('歐大總績效') === 0) break;       // 「歐大總績效(參考)」：個人獲利 / 眾人獲利
  }
  if (!rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  props.setProperty('last', String(now.getTime()));
}

// 每天早上 6 點清掉 7 天前的紀錄（網站每小時就會存走，這裡只是緩衝）
function trim_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const cutoff = Utilities.formatDate(new Date(Date.now() - KEEP_DAYS * 864e5), TZ, 'yyyy/MM/dd HH:mm:ss');
  const times = sh.getRange(2, 1, n, 1).getDisplayValues();
  let k = 0;
  while (k < times.length && times[k][0] && times[k][0] < cutoff) k++;
  if (k > 0) sh.deleteRows(2, k);
}
