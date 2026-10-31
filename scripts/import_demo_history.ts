// 示範帳號歷史：下單程式 conf 裡的合約紀錄（台選*.csv，每 2 分鐘一筆）→ 網站的每週存檔
// 用法：deno run --allow-read --allow-write --allow-net gen.ts <合約紀錄資料夾> <輸出資料夾，例 data/demo-history> [demo|mtk]（輸出資料夾給空字串 = 只驗算）
// 網站本身的存檔（data/sessions.json、data/series）從 2026-10-28 才有，這裡補更早的；同一盤以網站存檔為準
// 週三、週五時價：示範帳戶試算表「資料暫存區」每週一欄（欄名沒有日期，下方 BA_COLS / BB_COLS 是用合約紀錄比對出來的）；
//                 沒有的週用合約紀錄的時間價值，但紀錄只有當時交易的那一檔（週三夜盤~週五早盤是週五選、週五夜盤~下週三是週三選）
// VIX：期交所每月每日收盤檔（只公開近幾個月）；更早的月份從網路存檔取回，放在 data/vix-archive（2026 年 1、5、6 月找不到）
const [SRC = 'raw', OUT = '', ACCOUNT = 'demo'] = Deno.args;
const SITE = 'data';
const FROM_WEEK = '2025-12-31';      // 第一個含 2026 年交易日的週
const LAST_WEEK = '2026-10-21';      // 10-28 週起網站自己有完整紀錄
// demo：起始資產一律 100 萬，跟試算表「2026歷史績效」同一個算法（沒重設的週也是）
// mtk：真實帳戶，起始資產 = 週首資產；週三夜盤的出入金（前後兩筆都空手、跳 20 萬以上）不算損益，之後才起算；
//      5/20 08:45~17:28 帳戶總值讀到 1,000 萬上下（前後都是 2,000 萬以上），是壞資料，不用
const ACCOUNTS: Record<string, any> = {
  demo: { name: '示範帳號', fixedBase: 1000000, min: 300000, max: 3e6, drop: [] },
  mtk:  { name: '聯發哥', fixedBase: null, min: 5e6, max: 1e8, drop: [['2026-05-20T05:00:00Z', '2026-05-20T17:28:59Z']] },
  // 以下帳號資料不完整：kgi 是另一套程式（帳務資訊 + 下單理由回報）；main、gary 只有 8/12 週起的合約紀錄；mom 沒有帳戶總值，只有官方週績效
  // flows = 出入金 [出入金之後第一筆的時間, 金額]，不算損益；金額跟存提款欄、官方起始資產的差額核對過
  // kgi：成交單上的總市值持倉時比帳務資訊高 2~3%，只有空手時一致 → 成交單只用空手的；drop 是程式短暫連到別的帳戶（100 萬、300 萬、1,000 萬）
  kgi:  { name: '歐大_凱基', fixedBase: null, min: 2e5, max: 5e7, format: 'kgi', from: '2026-03-11', flatOrdersOnly: true,
          drop: [['2026-07-07T00:03:00Z', '2026-07-07T00:31:00Z'], ['2026-07-18T09:46:00Z', '2026-07-20T08:42:00Z'], ['2026-10-13T16:07:00Z', '2026-10-13T17:05:00Z']],
          flows: [['2026-05-04T11:29:00Z', -3800000], ['2026-05-04T11:41:00Z', -1700000], ['2026-05-04T15:03:00Z', -900000], ['2026-05-05T18:50:00Z', 1400000], ['2026-05-06T00:48:00Z', 1400000], ['2026-05-07T00:12:00Z', 1500000], ['2026-05-08T08:55:00Z', 1500000], ['2026-05-14T20:40:00Z', 1400000]],
          officialStart: { '2026-04-29': { from: 8, start: '5/06 00:48' } } },   // 試算表這週的起始資產是這筆入金之後的，更早的盤不算進官方累積
  // main 10/27：出入金金額沒有其他資料可對，用前後兩筆的資產差（gary 同時段幾乎沒動，差額可視為全是出入金）。
  // 試算表 10/21 週的起始資產沒有扣掉這兩筆的淨額，officialAdj 把它加回官方損益；fixWeeks 這週用這裡算的盤，不用網站存檔（網站存檔也沒扣）
  main: { name: '大帳號', fixedBase: null, min: 3e6, max: 5e7, drop: [], orders: true, from: '2026-08-12',
          flows: [['2026-09-11T15:49:00Z', -2800000], ['2026-09-18T08:48:00Z', 2600000], ['2026-10-27T08:48:00Z', -5593807], ['2026-10-27T20:14:00Z', 5362652]],
          officialAdj: { '2026-10-21': 5593807 - 5362652 }, fixWeeks: ['2026-10-21'] },
  gary: { name: 'gary-lan', fixedBase: null, min: 3e6, max: 5e7, drop: [], orders: true, from: '2026-08-12', flows: [['2026-08-14T16:06:00Z', -1000000], ['2026-10-08T15:00:00Z', -1000000]] },
  mom:  { name: '媽媽帳號', fixedBase: null, min: 5e5, max: 2e7, drop: [] }
};
const CFG = ACCOUNTS[ACCOUNT];
if (!CFG) throw new Error('不認識的帳號：' + ACCOUNT);
const NAME = CFG.name;
const FLOW_MIN = 200000;
const DEMO_SHEET = '1AsY4_MJipaMp_cNLpyeXTpFGnG0FD4vWJu-SDRdvtME', STASH_GID = '1161313889';
// 資料暫存區：欄 → 該合約格線的開始日（週三選：該週週三；週五選：前一個週五）
// 不用的欄：65、72、77 是下一欄的部分重複；19、71 跟合約紀錄差將近一倍，來源不明
const BA_COLS: Record<number, string> = { 3: '2026-02-25', 4: '2026-03-04', 5: '2026-03-11', 6: '2026-03-18', 7: '2026-03-25', 8: '2026-04-01', 9: '2026-04-08', 10: '2026-04-15', 11: '2026-04-29', 12: '2026-05-06', 13: '2026-05-13', 14: '2026-05-20', 15: '2026-05-27', 16: '2026-06-03', 17: '2026-06-10', 18: '2026-06-17', 20: '2026-07-01', 21: '2026-07-08', 22: '2026-07-15', 23: '2026-07-22', 24: '2026-07-29', 25: '2026-08-05', 26: '2026-08-12', 27: '2026-08-19', 28: '2026-08-26', 29: '2026-09-02', 30: '2026-09-09', 31: '2026-09-16', 32: '2026-09-23', 33: '2026-09-30', 34: '2026-10-07', 35: '2026-10-14', 36: '2026-10-21', 1: '2026-10-28' };
const BB_COLS: Record<number, string> = { 56: '2026-03-06', 57: '2026-03-13', 58: '2026-03-20', 59: '2026-03-27', 60: '2026-04-03', 61: '2026-04-10', 62: '2026-04-17', 63: '2026-04-24', 64: '2026-05-01', 66: '2026-05-15', 67: '2026-05-22', 68: '2026-05-29', 69: '2026-06-05', 70: '2026-06-12', 73: '2026-07-03', 74: '2026-07-10', 75: '2026-07-17', 76: '2026-07-24', 78: '2026-07-31', 79: '2026-08-07', 80: '2026-08-14', 81: '2026-08-21', 82: '2026-08-28', 83: '2026-09-04', 84: '2026-09-11', 85: '2026-09-18', 86: '2026-09-25', 87: '2026-10-02', 88: '2026-10-09', 89: '2026-10-16', 90: '2026-10-23' };
const VIX_MONTHS = ['202607', '202608', '202609', '202610'];

const num = (s: string) => { const v = parseFloat(String(s ?? '').replace(/,/g, '')); return isFinite(v) ? v : null; };
const addDays = (s: string, n: number) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const SLOTS: [number, string, string][] = [[0, 'N', '週三晚'], [1, 'D', '週四早'], [1, 'N', '週四晚'], [2, 'D', '週五早'], [2, 'N', '週五晚'], [5, 'D', '週一早'], [5, 'N', '週一晚'], [6, 'D', '週二早'], [6, 'N', '週二晚'], [7, 'D', '週三早']];

// 盤中時間（同網站 inSession）：早盤 08:45~13:45、夜盤 15:00~05:00；其他時間程式還在記，但不算
function slotOf(t: number) {
  const d = new Date(t), m = d.getUTCHours() * 60 + d.getUTCMinutes(), today = d.toISOString().slice(0, 10);
  let date: string, type: string;
  if (m >= 525 && m <= 825) { date = today; type = 'D'; }
  else if (m >= 900) { date = today; type = 'N'; }
  else if (m <= 300) { date = addDays(today, -1); type = 'N'; }
  else return null;
  const wd = new Date(date + 'T00:00:00Z').getUTCDay();
  const week = type === 'N' && wd === 3 ? date : addDays(date, -(((wd - 3 + 7) % 7) || 7));
  const off = Math.round((Date.parse(date) - Date.parse(week)) / 864e5);
  const slot = SLOTS.findIndex(s => s[0] === off && s[1] === type);
  return slot === -1 ? null : { week, slot, date, type };
}

// 百點震幅（同 common.js 的 swing100）
function swing100(prices: number[], threshold = 100) {
  const v = prices.filter(p => p !== null);
  if (v.length < 2) return 0;
  let total = 0, pivot = v[0], hi = v[0], lo = v[0], trend = 0;
  for (const p of v.slice(1)) {
    if (trend === 0) { if (p >= pivot + threshold) { trend = 1; hi = p; } else if (p <= pivot - threshold) { trend = -1; lo = p; } }
    else if (trend === 1) { if (p > hi) hi = p; else if (p <= hi - threshold) { total += hi - pivot; trend = -1; pivot = hi; lo = p; } }
    else { if (p < lo) lo = p; else if (p >= lo + threshold) { total += pivot - lo; trend = 1; pivot = lo; hi = p; } }
  }
  if (trend === 1 && hi > pivot + threshold) total += hi - pivot;
  else if (trend === -1 && lo < pivot - threshold) total += pivot - lo;
  return Math.round(total);
}

const parseCSV = (text: string) => { const rows: string[][] = []; let row: string[] = [], cur = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };
// 時價變動（同 common.js 的 lastChg）
const lastChg = (vals: (number | null)[], d = 0) => {
  const v = vals.filter(x => x) as number[];
  if (!v.length) return null;
  const chg = v.at(-1)! - v[0];
  return { last: +v.at(-1)!.toFixed(d), chg: +chg.toFixed(d), pct: +(v[0] ? chg / v[0] * 100 : 0).toFixed(2), many: v.length > 1 };
};

// ---- 資料暫存區 → 絕對時間（牆上時間 ms）對應時價
const stash = parseCSV(await (await fetch(`https://docs.google.com/spreadsheets/d/${DEMO_SHEET}/export?format=csv&gid=${STASH_GID}`)).text());
const WD: Record<string, number> = { 日: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const gridOf = (labelCol: number) => { let day = 0, prev: number | null = null; return stash.slice(1).map(r => { const m = String(r[labelCol] || '').match(/^([一二三四五六日])\s*(\d{1,2}):(\d{2})/); if (!m) return null; const wd = WD[m[1]]; if (prev !== null && wd !== prev) day += (wd - prev + 7) % 7; prev = wd; return day * 1440 + +m[2] * 60 + +m[3]; }); };
const toMap = (cols: Record<number, string>, grid: (number | null)[]) => {
  const out = new Map<number, number>();
  for (const [col, start] of Object.entries(cols)) {
    const base = Date.parse(start + 'T00:00:00Z');
    stash.slice(1).forEach((r, i) => { const v = num(r[+col]), o = grid[i]; if (v !== null && v > 0 && o !== null) out.set(base + o * 60000, v); });
  }
  return out;
};
const sheetBA = toMap(BA_COLS, gridOf(0)), sheetBB = toMap(BB_COLS, gridOf(53));
// 試算表的時間標籤比實際晚 2 分鐘（同 common.js 的 FUT_LAG）；每筆紀錄找最接近的一格
const fromSheet = (m: Map<number, number>, t: number) => { for (const d of [2, 1, 3, 4, 0]) { const v = m.get(t + d * 60000); if (v !== undefined) return v; } return null; };

// ---- 期交所每日收盤
const vixDaily = new Map<string, { last: number; chg: number; pct: number; many: boolean }>();
{
  let prev: number | null = null, prevDate = '';
  const texts: string[] = [];
  for (const e of [...Deno.readDirSync(`${SITE}/vix-archive`)].map(x => x.name).sort()) texts.push(new TextDecoder('big5').decode(Deno.readFileSync(`${SITE}/vix-archive/${e}`)));
  for (const ym of VIX_MONTHS) {
    const res = await fetch(`https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data/${ym}new.txt`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    texts.push(new TextDecoder('big5').decode(await res.arrayBuffer()));
  }
  for (const txt of texts) {
    for (const l of txt.split(/\r?\n/)) {
      const c = l.trim().split(/\s+/);
      if (!/^\d{8}$/.test(c[0] || '') || !isFinite(+c[2])) continue;
      const v = +c[2], date = `${c[0].slice(0, 4)}-${c[0].slice(4, 6)}-${c[0].slice(6, 8)}`;
      // 跟上一筆隔太久（中間的月份沒資料）就不算漲跌；春節最長約 12 天
      const near = prev !== null && (Date.parse(date) - Date.parse(prevDate)) / 864e5 <= 14;
      vixDaily.set(date, near ? { last: v, chg: +(v - prev!).toFixed(2), pct: +((v - prev!) / prev! * 100).toFixed(2), many: true } : { last: v, chg: 0, pct: 0, many: false });
      prev = v; prevDate = date;
    }
  }
  const ds = [...vixDaily.keys()].sort();
  console.log(`VIX 每日收盤 ${ds.length} 天：${ds[0]} ~ ${ds.at(-1)}`);
}

// ---- 讀檔：「價平和:1,067.00」的千分位逗號沒加引號，後面的欄位會多一格；有些列還多一個逗號（見下方統計）
const raw: any[] = [];
const names: string[] = [];
for await (const e of Deno.readDir(SRC)) if (e.isFile && /^台選.*(2026|122025)\.csv$/.test(e.name)) names.push(e.name);
let badRows = 0;
for (const name of names.sort()) {
  const lines = new TextDecoder().decode(await Deno.readFile(`${SRC}/${name}`)).replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  for (const l of lines.slice(1)) {
    const c = l.split(',');
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(c[0]) || !/^\d{1,2}:\d{2}$/.test(c[1])) { badRows++; continue; }
    const q = c[10].startsWith('價平和:') && /^\d{3}(\.\d+)?$/.test(c[11]) ? 12 : 11;   // 結算日這格是 0，不是 價平和:
    const t = Date.parse(`${c[0].replace(/\//g, '-')}T${c[1].padStart(5, '0')}:00Z`);
    raw.push({ f: name, kind: name.startsWith('台選週五') ? 'F' : 'W', t, pts: num(c[7]), ratio: num(c[8]), tv: num(c[9]), asset: num(c[q]), fut: num(c[q + 1]), margin: num(c[q + 2]), fee: num(c[q + 3]), delta: num(c[q + 6]) });
  }
}
// 沒有每 2 分鐘紀錄的盤，用成交單上的帳戶總值：每 2 分鐘留最後一筆（單子很密，全留檔案太大）
const decode = (b: Uint8Array) => { const u = new TextDecoder().decode(b); return u.includes('\uFFFD') ? new TextDecoder('big5').decode(b) : u; };
const minuteOf = (d: string, tm: string) => { const m = tm.match(/(\d{1,2}):(\d{2})/); return m ? Date.parse(`${d.replace(/'/g, '').replaceAll('/', '-')}T${m[1].padStart(2, '0')}:${m[2]}:00Z`) : NaN; };
const orderRows = new Map<number, any>();
const addOrder = (t: number, r: any) => { if (isFinite(t)) orderRows.set(t - t % 120000, { ...r, t: t - t % 120000, src: 'order' }); };
const sourceFiles = [...Deno.readDirSync(SRC)].map(e => e.name).sort();
if (CFG.format === 'kgi') {
  for (const name of sourceFiles.filter(n => n.startsWith('帳務資訊'))) for (const l of decode(Deno.readFileSync(`${SRC}/${name}`)).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1)) {
    const c = l.split(','); if (!/^\d{4}\//.test(c[0] || '')) continue;
    raw.push({ f: name, kind: 'W', t: minuteOf(c[0], c[1]), pts: num(c[5]), ratio: num(c[6]), tv: num(c[10]), asset: num(c[11]), fut: num(c[13]), margin: num(c[12]), fee: num(c[14]), delta: num(c[9]) });
  }
  for (const name of sourceFiles.filter(n => n.startsWith('下單理由'))) for (const l of decode(Deno.readFileSync(`${SRC}/${name}`)).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1)) {
    const c = l.split(','); if (!/^\d{4}\//.test(c[0] || '')) continue;
    addOrder(minuteOf(c[0], c[1]), { f: name, kind: /_TX[UVXYZ]-/.test(name) ? 'F' : 'W', pts: null, ratio: null, tv: null, asset: num(c[6]), fut: num(c[9]), margin: num(c[7]), fee: num(c[8]), delta: null });
  }
}
if (CFG.orders) for (const name of sourceFiles.filter(n => /^OrderRecord(台選|tx).*2026\.csv$/.test(n))) for (const l of decode(Deno.readFileSync(`${SRC}/${name}`)).replace(/^\uFEFF/, '').split(/\r?\n/).slice(1)) {
  const c = l.split(','); if (!/^\d{4}\//.test(c[0] || '')) continue;
  addOrder(minuteOf(c[0], c[1]), { f: name, kind: name.includes('週五') ? 'F' : 'W', pts: null, ratio: null, tv: null, asset: num(c[6]), fut: null, margin: num(c[7]), fee: num(c[8]), delta: null });
}
raw.push(...orderRows.values());
// 帳戶總值 0 / 期指 0 是剛啟動還沒讀到；其餘範圍外的是錯位或亂碼，都不要
const dropped = CFG.drop.map(([a, b]: string[]) => [Date.parse(a), Date.parse(b)]);
const fromT = CFG.from ? Date.parse(CFG.from + 'T00:00:00Z') : -Infinity;
const inRange = raw.filter(r => isFinite(r.t) && r.t >= fromT && !(CFG.flatOrdersOnly && r.src === 'order' && !(r.margin >= r.asset * .995)) && r.asset && r.asset > CFG.min && r.asset < CFG.max && (r.src === 'order' || (r.fut && r.fut > 10000 && r.fut < 200000)) && !dropped.some(([a, b]: number[]) => r.t >= a && r.t <= b));
inRange.forEach(r => { if (r.fut !== null && !(r.fut > 10000 && r.fut < 200000)) r.fut = null; });
console.log(`讀入 ${raw.length} 列（壞列 ${badRows}），可用 ${inRange.length}`);

// ---- 依週、依盤分組；同一盤兩個檔同時在記（換約前後程式重開）：重疊的時段只留筆數多的檔
const weeks = new Map<string, Map<number, any[]>>();
inRange.forEach(r => {
  const s = slotOf(r.t);
  if (!s) return;
  r.s = s;
  if (!weeks.has(s.week)) weeks.set(s.week, new Map());
  const w = weeks.get(s.week)!;
  if (!w.has(s.slot)) w.set(s.slot, []);
  w.get(s.slot)!.push(r);
});
function resolveOverlap(rows: any[]) {
  const byFile = new Map<string, any[]>();
  rows.forEach(r => { if (!byFile.has(r.f)) byFile.set(r.f, []); byFile.get(r.f)!.push(r); });
  if (byFile.size < 2) return rows;
  const fs = [...byFile.entries()].map(([f, a]) => ({ f, a: a.sort((x, y) => x.t - y.t) })).sort((x, y) => x.a[0].t - y.a[0].t);
  const drop = new Set<any>();
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) {
    const from = Math.max(fs[i].a[0].t, fs[j].a[0].t), to = Math.min(fs[i].a.at(-1).t, fs[j].a.at(-1).t);
    if (from > to) continue;
    const A = fs[i].a.filter(r => r.t >= from && r.t <= to), B = fs[j].a.filter(r => r.t >= from && r.t <= to);
    (A.length >= B.length ? B : A).forEach(r => drop.add(r));
  }
  return rows.filter(r => !drop.has(r));
}

// ---- 每週：起始資產 = 週三夜盤重設後的 1,000,000；那週沒重設就用該週第一筆（照常接著算）
const weekSessions: any[] = [], weekSeries = new Map<string, any[]>(), report: string[] = [], closedSlots: string[] = [];
const srcCount = { sheetBA: 0, logBA: 0, sheetBB: 0, logBB: 0 };
const flows: string[] = [];
const weekAll = new Map<string, any[]>();
const siteEarly = JSON.parse(await Deno.readTextFile(`${SITE}/sessions.json`)).sessions;
for (const week of [...weeks.keys()].sort()) {
  if (week < FROM_WEEK || week > '2026-10-28') continue;
  const slotMap = weeks.get(week)!;
  const allRows = [...slotMap.values()].flat().sort((a, b) => a.t - b.t);
  // 網站存檔已有這一週：起始資產跟它一致；否則固定值，或週首資產（週三夜盤開始交易前有出入金就從出入金之後算）
  const siteOfWeek = siteEarly.find((s: any) => s.week === week && s.accounts.some((a: any) => a.name === NAME));
  let flowAt = -Infinity;
  const slot0 = (slotMap.get(0) || []).slice().sort((a, b) => a.t - b.t);
  for (let i = 1; i < slot0.length; i++) if (!slot0[i].pts && !slot0[i - 1].pts && Math.abs(slot0[i].asset - slot0[i - 1].asset) >= FLOW_MIN) { flowAt = slot0[i].t; flows.push(`${new Date(slot0[i].t).toISOString().slice(5, 16).replace('T', ' ')} ${Math.round(slot0[i].asset - slot0[i - 1].asset)}`); }
  weekAll.set(week, allRows);
  const midFlows: { t: number; d: number }[] = [];
  if (!CFG.fixedBase && !CFG.flows) {
    const logRows = allRows.filter(r => r.src !== 'order' && r.t >= flowAt);
    for (let i = 1; i < logRows.length; i++) { const a = logRows[i - 1], b = logRows[i]; if (b.t > flowAt && b.s.slot > 0 && a.pts === 0 && b.pts === 0 && Math.abs(b.asset - a.asset) >= FLOW_MIN) { midFlows.push({ t: b.t, d: b.asset - a.asset }); flows.push(`${new Date(b.t).toISOString().slice(5, 16).replace('T', ' ')} ${Math.round(b.asset - a.asset)}（週中）`); } }
  }
  for (const [at, d] of CFG.flows || []) {
    const t = Date.parse(at);
    if (slotOf(t)?.week === week) { midFlows.push({ t, d }); flows.push(`${at.slice(5, 16).replace('T', ' ')} ${d}`); }
  }
  const adjOf = (t: number) => midFlows.filter(f => f.t <= t).reduce((x, f) => x + f.d, 0);
  const startRow = allRows.find(r => r.t >= flowAt)!;
  const hasReset = CFG.fixedBase ? allRows.some(r => r.asset === CFG.fixedBase) : true;
  const base = CFG.fixedBase ?? siteOfWeek?.accounts.find((a: any) => a.name === NAME).base ?? startRow.asset - adjOf(startRow.t);
  const kept: any[] = [];
  for (let slot = 0; slot < 10; slot++) {
    const rows0 = slotMap.get(slot);
    if (!rows0) continue;
    // 有每 2 分鐘紀錄就用紀錄（收盤前最後一段補上成交單）；沒有就用成交單
    const logs0 = resolveOverlap(rows0.filter(r => r.src !== 'order')), orders0 = rows0.filter(r => r.src === 'order');
    const lastLog = logs0.length >= 20 ? Math.max(...logs0.map(r => r.t)) : -Infinity;
    const rows = [...logs0, ...orders0.filter(r => r.t > lastLog + 180000)].sort((a, b) => a.t - b.t);
    // 期指幾乎不動 = 休市（連假程式還開著），這一盤不算
    const distinct = new Set(logs0.map(r => r.fut)).size;
    if (!orders0.length && distinct < 5) { closedSlots.push(`${week}#${slot}(${rows.length}筆/${distinct})`); continue; }
    const seen = new Set<number>();
    const uniq = rows.filter(r => { if (seen.has(r.t)) return false; seen.add(r.t); return true; });
    // 週三、週五時價：試算表優先；沒有的用合約紀錄（報價卡住的時段不算，再用中位數濾掉跳點）
    for (let i = 0, j; i < uniq.length; i = j) {
      for (j = i + 1; j < uniq.length && uniq[j].fut === uniq[i].fut; j++);
      if (j - i >= 5) for (let k = i; k < j; k++) uniq[k].frozen = true;
    }
    const clean = (kind: string) => uniq.map((r, i) => { const v = uniq.slice(Math.max(0, i - 4), i + 5).filter(x => !x.frozen && x.tv && x.kind === kind).map(x => x.tv).sort((a, b) => a - b); return r.frozen || r.kind !== kind || !v.length ? null : v[v.length >> 1]; });
    const logBA = clean('W'), logBB = clean('F');
    // 試算表整段不動（機器沒更新，例：10/23~10/26 一直 39,090）= 沒資料；單筆跳點（例：收盤前 30,110 跳 35,452）用前後 2 筆的中位數濾掉
    const sheetSeries = (m: Map<number, number>) => {
      const v = uniq.map(r => fromSheet(m, r.t));
      for (let i = 0, j; i < v.length; i = j) {
        for (j = i + 1; j < v.length && v[j] === v[i]; j++);
        if (v[i] !== null && j - i >= 10) for (let k = i; k < j; k++) v[k] = null;
      }
      return v;
    };
    const smooth = (v: (number | null)[]) => v.map((x, i) => { if (x === null) return null; const w = v.slice(Math.max(0, i - 2), i + 3).filter(y => y !== null).sort((a: any, b: any) => a - b) as number[]; return w[w.length >> 1]; });
    const sBA = sheetSeries(sheetBA), sBB = sheetSeries(sheetBB);
    const ba = smooth(sBA.map((x, i) => x ?? logBA[i])), bb = smooth(sBB.map((x, i) => x ?? logBB[i]));
    uniq.forEach((r, i) => {
      r.ba = ba[i]; r.bb = bb[i];
      if (sBA[i] !== null) srcCount.sheetBA++; else if (logBA[i] !== null) srcCount.logBA++;
      if (sBB[i] !== null) srcCount.sheetBB++; else if (logBB[i] !== null) srcCount.logBB++;
    });
    const last = uniq.at(-1), first = uniq[0];
    const date = addDays(week, SLOTS[slot][0]);
    weekSessions.push({
      id: `${date}${SLOTS[slot][1]}`, week, slot, date, type: SLOTS[slot][1],
      at: new Date(last.t).toISOString().slice(0, 19).replace('T', ' '), fut: last.fut,
      total: { pnl: Math.round(last.asset - adjOf(last.t) - base), personal: null, base, resetBase: week },
      accounts: [{ name: NAME, pnl: Math.round(last.asset - adjOf(last.t) - base), base }],
      open: { at: new Date(first.t).toISOString().slice(0, 19).replace('T', ' '), total: Math.round(first.asset - adjOf(first.t) - base), accounts: { [NAME]: Math.round(first.asset - adjOf(first.t) - base) } },
      market: { swing: swing100(uniq.map(r => r.fut)), ba: lastChg(uniq.map(r => r.ba)), bb: lastChg(uniq.map(r => r.bb)), ...(SLOTS[slot][1] === 'D' && vixDaily.has(date) ? { vix: vixDaily.get(date) } : {}) }
    });
    uniq.forEach(r => kept.push({ ...r, base, noPnl: r.t < flowAt, adj: adjOf(r.t) }));
  }
  weekSeries.set(week, kept);
  report.push(`${week} ${hasReset ? '' : '(未重設) '}盤 ${weekSessions.filter(s => s.week === week).map(s => s.slot).join('')} 筆 ${kept.length}`);
}
console.log(report.join('\n'));
console.log('視為休市的盤：', closedSlots.join(' '));

const lastPnl = (w: string) => { const own = (CFG.fixWeeks || []).includes(w) ? null : siteEarly.filter((s: any) => s.week === w && s.accounts.some((a: any) => a.name === NAME)).sort((a: any, b: any) => a.slot - b.slot).at(-1); const s = weekSessions.filter(x => x.week === w).sort((a, b) => a.slot - b.slot).at(-1); const x = own && (!s || own.slot >= s.slot) ? own : s; if (!x) return null; const a = x.accounts.find((y: any) => y.name === NAME); return a.pnl / a.base * 100; };
console.log('出入金', flows.join('；') || '無');
{ let pw = '', pv = 0; const big: string[] = []; for (const s of weekSessions) { const a = s.accounts[0]; if (s.week !== pw) { pw = s.week; pv = 0; } const d = a.pnl - pv; pv = a.pnl; if (Math.abs(d) / a.base >= .035) big.push(`${s.id} ${d}（${(d / a.base * 100).toFixed(1)}%）`); } console.log('單盤跳動 ≥3.5%：', big.join('；') || '無'); }
console.log('時價來源（筆）', JSON.stringify(srcCount));
const weekCover = [...new Set(weekSessions.map(s => s.week))].map(w => { const ss = weekSessions.filter(s => s.week === w); return `${w.slice(5)} BA${ss.filter(s => s.market.ba).length}/BB${ss.filter(s => s.market.bb).length}/V${ss.filter(s => s.market.vix).length}/盤${ss.length}`; });
console.log(weekCover.join('  '));
// ---- 驗算：跟網站已有的盤對答案
const site = JSON.parse(await Deno.readTextFile(`${SITE}/sessions.json`)).sessions;
let okCnt = 0;
console.log('\n=== 每盤累積獲利 vs 網站 sessions.json');
for (const s of site) {
  const mine = weekSessions.find(x => x.week === s.week && x.slot === s.slot);
  const a = s.accounts.find((x: any) => x.name === NAME);
  const same = mine && a && Math.abs(mine.accounts[0].pnl - a.pnl) <= 300;
  if (same) okCnt++;
  console.log(`   BA 網站 ${s.market?.ba?.last ?? '-'} 轉換 ${mine?.market.ba?.last ?? '-'} | BB 網站 ${s.market?.bb?.last ?? '-'} 轉換 ${mine?.market.bb?.last ?? '-'} | VIX 網站 ${s.market?.vix?.last ?? '-'}/${s.market?.vix?.chg ?? '-'} 轉換 ${mine?.market.vix?.last ?? '-'}/${mine?.market.vix?.chg ?? '-'}`);
  console.log(`${s.id} 網站 pnl=${a?.pnl} base=${a?.base} swing=${s.market?.swing} at=${s.at} | 轉換 ${mine ? `pnl=${mine.accounts[0].pnl} base=${mine.accounts[0].base} swing=${mine.market.swing} at=${mine.at}` : '無'} ${same ? 'OK' : '<<差異'}`);
}
console.log(`符合 ${okCnt}/${site.length}`);

const siteSer = JSON.parse(await Deno.readTextFile(`${SITE}/series/2026-10-28.json`));
const A = siteSer.acc[NAME];
const mineW = new Map((weekSeries.get('2026-10-28') || []).filter((r: any) => r.src !== 'order').map((r: any) => [r.t, r]));
const cmp: any = { asset: [], pts: [], fut: [], tv: [], ratio: [], margin: [], delta: [] };
siteSer.t.forEach((ts: string, i: number) => {
  const t0 = Date.parse(ts.slice(0, 16).replace(' ', 'T') + ':00Z');
  const r: any = mineW.get(t0) || mineW.get(t0 - 60000);
  if (!r) return;
  cmp.asset.push(r.asset - A.asset[i]); cmp.pts.push(r.pts - A.pts[i]); cmp.fut.push(r.fut - siteSer.fut[i]); cmp.tv.push(r.tv - A.tv[i]);
  cmp.ratio.push(r.ratio - A.ratio[i]); cmp.margin.push(Math.round(r.margin / r.asset * 100) - A.margin[i]); if (r.delta !== null && A.delta[i] !== null) cmp.delta.push(r.delta - A.delta[i]);
});
const pct = (a: number[], q: number) => { const s = a.map(Math.abs).sort((x, y) => x - y); return s[Math.floor(s.length * q)]; };
console.log('\n=== 2 分鐘走勢 vs 網站 series（差的絕對值 中位數 / 90% / 最大）');
for (const k of Object.keys(cmp)) console.log(`${k.padEnd(7)} n=${cmp[k].length} ${pct(cmp[k], .5)?.toFixed(2)} / ${pct(cmp[k], .9)?.toFixed(2)} / ${Math.max(...cmp[k].map(Math.abs)).toFixed(2)}`);

// ---- 全部週次的結果（給人看合不合理）
console.log('\n=== 各週結果');
for (const week of [...new Set(weekSessions.map(s => s.week))]) {
  const ss = weekSessions.filter(s => s.week === week);
  let prev = 0;
  const per = ss.map(s => { const d = s.accounts[0].pnl - prev; prev = s.accounts[0].pnl; return `${SLOTS[s.slot][2].slice(1)}${d > 0 ? '+' : ''}${d}`; });
  console.log(`${week} 累積 ${ss.at(-1).accounts[0].pnl}  ${per.join(' ')}`);
}

// ---- 官方週績效：投資報表試算表「歷史紀錄」分頁（每週三 13:44 的快照）。7/1 週以前的起始資產多半是週五 15:00 的資產，
//      from = 官方從第幾盤起算（比這更早的盤不算進官方累積），用「起始資產在當週紀錄裡第一次出現的時間」找
const official: Record<string, any> = {};
if (!CFG.fixedBase) {
  const R = parseCSV(await (await fetch('https://docs.google.com/spreadsheets/d/1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk/export?format=csv&gid=173635889')).text());
  let cur: string | null = null;
  for (const r of R) {
    const st = r.slice(0, 6).find(x => /^\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}/.test((x || '').trim()));
    if (st) cur = st.trim();
    if ((r[2] || '').trim().replace(/\((主|副)\)$/, '').replace(/^連發哥$/, '聯發哥') !== NAME || !cur) continue;
    const m = cur.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/)!;
    const week = addDays(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, -7);
    const asset = num(r[12]), pnlCell = num(r[7]);
    if (asset === null || num(r[13]) === null || week < FROM_WEEK) continue;
    const base = pnlCell !== null ? asset - pnlCell : num(r[13])!;   // 有幾週的起始資產格被蓋掉，但獲利金額還在
    const pnl = asset - base + (CFG.officialAdj?.[week] || 0), rate = +(pnl / base * 100).toFixed(2);
    const rows = weekAll.get(week) || [];
    const hit = rows.reduce((b: any, x: any) => Math.abs(x.asset - base) < Math.abs((b?.asset ?? 1e15) - base) ? x : b, null);
    const near = hit && Math.abs(hit.asset - base) <= 300;
    const first = rows.find((x: any) => near && x.asset === hit.asset) || hit;
    const late = near && first.s.slot > 0;
    const mine = lastPnl(week);
    const same = mine !== null && Math.abs(mine - rate) < .02;   // 跟推算相同就不用標起算時間
    official[week] = { base, asset, pnl, rate, from: late && !same ? first.s.slot : 0,
      start: late && !same ? new Date(first.t).toISOString().slice(5, 16).replace('T', ' ').replace(/^0/, '').replace('-', '/') : null, same, ...(CFG.officialStart?.[week] || {}) };
  }
  console.log(`官方週績效 ${Object.keys(official).length} 週，和推算相同 ${Object.values(official).filter((o: any) => o.same).length} 週`);
}

if (OUT) {
  await Deno.mkdir(OUT, { recursive: true });
  const fixed = (s: any) => (CFG.fixWeeks || []).includes(s.week);
  const onSite = (s: any) => site.some((x: any) => x.week === s.week && x.slot === s.slot);
  const sessions = weekSessions.filter(s => s.week <= LAST_WEEK && (fixed(s) || !onSite(s))).map(s => fixed(s) && onSite(s) ? { ...s, fix: true } : s);   // fix = 蓋過網站存檔的同一盤
  await Deno.writeTextFile(`${OUT}/sessions.json`, JSON.stringify({ source: '下單程式的紀錄', name: NAME, sessions, ...(CFG.fixedBase ? {} : { official }) }) + '\n');
  // 走勢：網站存檔已有的時段不重複（10-21 週的最後一盤）
  const siteFirst = new Map<string, number>();
  for await (const e of Deno.readDir(`${SITE}/series`)) {
    const d = JSON.parse(await Deno.readTextFile(`${SITE}/series/${e.name}`));
    siteFirst.set(d.week, Date.parse(d.t[0].replace(' ', 'T') + 'Z'));
  }
  let total = 0, files = 0;
  for (const [week, rows] of weekSeries) {
    if (week > LAST_WEEK || !rows.length) continue;
    const fix = (CFG.fixWeeks || []).includes(week);
    const cut = fix ? Infinity : siteFirst.get(week) ?? Infinity;
    const use = rows.filter((r: any) => r.t < cut);
    const pnl = (r: any) => r.noPnl ? null : Math.round(r.asset - (r.adj || 0) - r.base);
    const data = {
      ...(fix ? { fix } : {}), week, t: use.map((r: any) => new Date(r.t).toISOString().slice(0, 19).replace('T', ' ')), fut: use.map((r: any) => r.fut === null ? null : +r.fut.toFixed(1)),
      ba: use.map((r: any) => r.ba === null ? null : Math.round(r.ba)), bb: use.map((r: any) => r.bb === null ? null : Math.round(r.bb)),
      acc: { [NAME]: {
        pnl: use.map(pnl), rate: use.map((r: any) => r.noPnl ? null : +(pnl(r)! / r.base * 100).toFixed(2)), base: use.map((r: any) => r.base), asset: use.map((r: any) => Math.round(r.asset)),
        pts: use.map((r: any) => r.pts === null ? null : Math.round(r.pts)), tv: use.map((r: any) => r.tv === null ? null : Math.round(r.tv)), ratio: use.map((r: any) => r.ratio),
        delta: use.map((r: any) => r.delta), margin: use.map((r: any) => r.margin === null ? null : Math.min(100, Math.round(r.margin / r.asset * 100)))
      } }
    };
    const txt = JSON.stringify(data) + '\n';
    await Deno.writeTextFile(`${OUT}/${week}.json`, txt);
    total += txt.length; files++;
  }
  console.log(`\n寫出 ${sessions.length} 盤、${files} 個週檔，共 ${(total / 1e6).toFixed(1)} MB`);
}
