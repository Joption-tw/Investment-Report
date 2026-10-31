// 示範帳號歷史：下單程式 conf 裡的合約紀錄（台選*.csv，每 2 分鐘一筆）→ 網站的每週存檔
// 在 repo 根目錄執行：deno run --allow-read --allow-write scripts/import_demo_history.ts <合約紀錄資料夾> data/demo-history（不給輸出資料夾 = 只驗算）
// 網站本身的存檔（data/sessions.json、data/series）從 2026-10-28 才有，這裡補更早的；同一盤以網站存檔為準
const [SRC = 'raw', OUT = ''] = Deno.args;
const SITE = 'data';
const FROM_WEEK = '2025-12-31';      // 第一個含 2026 年交易日的週
const LAST_WEEK = '2026-10-21';      // 10-28 週起網站自己有完整紀錄
const NAME = '示範帳號';

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
    raw.push({ f: name, t, pts: num(c[7]), ratio: num(c[8]), tv: num(c[9]), asset: num(c[q]), fut: num(c[q + 1]), margin: num(c[q + 2]), fee: num(c[q + 3]), delta: num(c[q + 6]) });
  }
}
// 帳戶總值 0 / 期指 0 是剛啟動還沒讀到；其餘範圍外的是錯位或亂碼，都不要
const inRange = raw.filter(r => r.asset && r.asset > 300000 && r.asset < 3e6 && r.fut && r.fut > 10000 && r.fut < 200000);
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
for (const week of [...weeks.keys()].sort()) {
  if (week < FROM_WEEK || week > '2026-10-28') continue;
  const slotMap = weeks.get(week)!;
  const allRows = [...slotMap.values()].flat().sort((a, b) => a.t - b.t);
  const hasReset = allRows.some(r => r.asset === 1000000);
  const base = hasReset ? 1000000 : allRows[0].asset;
  const kept: any[] = [];
  for (let slot = 0; slot < 10; slot++) {
    const rows0 = slotMap.get(slot);
    if (!rows0) continue;
    const rows = resolveOverlap(rows0).sort((a, b) => a.t - b.t);
    // 期指幾乎不動 = 休市（連假程式還開著），這一盤不算
    const distinct = new Set(rows.map(r => r.fut)).size;
    if (distinct < 5) { closedSlots.push(`${week}#${slot}(${rows.length}筆/${distinct})`); continue; }
    const seen = new Set<number>();
    const uniq = rows.filter(r => { if (seen.has(r.t)) return false; seen.add(r.t); return true; });
    const last = uniq.at(-1), first = uniq[0];
    const date = addDays(week, SLOTS[slot][0]);
    weekSessions.push({
      id: `${date}${SLOTS[slot][1]}`, week, slot, date, type: SLOTS[slot][1],
      at: new Date(last.t).toISOString().slice(0, 19).replace('T', ' '), fut: last.fut,
      total: { pnl: Math.round(last.asset - base), personal: null, base, resetBase: week },
      accounts: [{ name: NAME, pnl: Math.round(last.asset - base), base }],
      open: { at: new Date(first.t).toISOString().slice(0, 19).replace('T', ' '), total: Math.round(first.asset - base), accounts: { [NAME]: Math.round(first.asset - base) } },
      market: { swing: swing100(uniq.map(r => r.fut)) }
    });
    uniq.forEach(r => kept.push({ ...r, base }));
  }
  weekSeries.set(week, kept);
  report.push(`${week} base ${base}${hasReset ? '' : '(未重設)'} 盤 ${weekSessions.filter(s => s.week === week).map(s => s.slot).join('')} 筆 ${kept.length}`);
}
console.log(report.join('\n'));
console.log('視為休市的盤：', closedSlots.join(' '));

// ---- 驗算：跟網站已有的盤對答案
const site = JSON.parse(await Deno.readTextFile(`${SITE}/sessions.json`)).sessions;
let okCnt = 0;
console.log('\n=== 每盤累積獲利 vs 網站 sessions.json');
for (const s of site) {
  const mine = weekSessions.find(x => x.week === s.week && x.slot === s.slot);
  const a = s.accounts.find((x: any) => x.name === NAME);
  const same = mine && a && Math.abs(mine.accounts[0].pnl - a.pnl) <= 300;
  if (same) okCnt++;
  console.log(`${s.id} 網站 pnl=${a?.pnl} base=${a?.base} swing=${s.market?.swing} at=${s.at} | 轉換 ${mine ? `pnl=${mine.accounts[0].pnl} base=${mine.accounts[0].base} swing=${mine.market.swing} at=${mine.at}` : '無'} ${same ? 'OK' : '<<差異'}`);
}
console.log(`符合 ${okCnt}/${site.length}`);

const siteSer = JSON.parse(await Deno.readTextFile(`${SITE}/series/2026-10-28.json`));
const A = siteSer.acc[NAME];
const mineW = new Map((weekSeries.get('2026-10-28') || []).map((r: any) => [r.t, r]));
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

if (OUT) {
  await Deno.mkdir(OUT, { recursive: true });
  const sessions = weekSessions.filter(s => s.week <= LAST_WEEK && !site.some((x: any) => x.week === s.week && x.slot === s.slot));
  await Deno.writeTextFile(`${OUT}/sessions.json`, JSON.stringify({ source: 'conf 合約紀錄（台選*.csv）', sessions }) + '\n');
  // 走勢：網站存檔已有的時段不重複（10-21 週的最後一盤）
  const siteFirst = new Map<string, number>();
  for await (const e of Deno.readDir(`${SITE}/series`)) {
    const d = JSON.parse(await Deno.readTextFile(`${SITE}/series/${e.name}`));
    siteFirst.set(d.week, Date.parse(d.t[0].replace(' ', 'T') + 'Z'));
  }
  let total = 0, files = 0;
  for (const [week, rows] of weekSeries) {
    if (week > LAST_WEEK || !rows.length) continue;
    const cut = siteFirst.get(week) ?? Infinity;
    const use = rows.filter((r: any) => r.t < cut);
    const pnl = (r: any) => Math.round(r.asset - r.base);
    const data = {
      week, t: use.map((r: any) => new Date(r.t).toISOString().slice(0, 19).replace('T', ' ')), fut: use.map((r: any) => +r.fut.toFixed(1)),
      acc: { [NAME]: {
        pnl: use.map(pnl), rate: use.map((r: any) => +(pnl(r) / r.base * 100).toFixed(2)), base: use.map((r: any) => r.base), asset: use.map((r: any) => Math.round(r.asset)),
        pts: use.map((r: any) => Math.round(r.pts ?? 0)), tv: use.map((r: any) => r.tv === null ? null : Math.round(r.tv)), ratio: use.map((r: any) => r.ratio),
        delta: use.map((r: any) => r.delta), margin: use.map((r: any) => r.margin === null ? null : Math.round(r.margin / r.asset * 100))
      } }
    };
    const txt = JSON.stringify(data) + '\n';
    await Deno.writeTextFile(`${OUT}/${week}.json`, txt);
    total += txt.length; files++;
  }
  console.log(`\n寫出 ${sessions.length} 盤、${files} 個週檔，共 ${(total / 1e6).toFixed(1)} MB`);
}
