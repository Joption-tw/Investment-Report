// 總表用的歷史週次彙整：把各帳號補回的資料（data/<帳號>-history，見 import_demo_history.ts）合成 data/history-index.json
// 在 repo 根目錄執行：deno run --allow-read --allow-write --allow-net scripts/build_history_index.ts
// 補了新帳號：在 HISTORY_DIRS 加一行、重跑即可。個人獲利的比例每次從試算表「績效表」H15 的公式讀，不寫在 repo 裡
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';

const HISTORY_DIRS = ['data/demo-history', 'data/mtk-history'];
const IR_SHEET = '1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk', IR_GID = '103299629';
const cleanName = (s: string) => String(s || '').trim().replace(/\((主|副)\)$/, '').replace(/^連發哥$/, '聯發哥');

// ---- 個人獲利比例：績效表 H15，格式是 H4+0.5*H5+H6*0.5 這種加總；第 n 列對應 C 欄的帳號名稱
const zip = unzipSync(new Uint8Array(await (await fetch(`https://docs.google.com/spreadsheets/d/${IR_SHEET}/export?format=xlsx`)).arrayBuffer()));
const workbook = strFromU8(zip['xl/workbook.xml']), rels = strFromU8(zip['xl/_rels/workbook.xml.rels']);
const rid = workbook.match(/<sheet [^>]*name="績效表"[^>]*r:id="(rId\d+)"/)![1];
const relTag = rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*>`))![0];
const sheetXml = strFromU8(zip['xl/' + relTag.match(/Target="([^"]+)"/)![1]]);
const formula = sheetXml.match(/<c r="H15"[^>]*>\s*<f[^>]*>([^<]+)<\/f>/)![1].replace(/\s/g, '');
const names = (await (await fetch(`https://docs.google.com/spreadsheets/d/${IR_SHEET}/export?format=csv&gid=${IR_GID}&range=C4:C12`)).text()).split(/\r?\n/).map(s => cleanName(s.replace(/^"|"$/g, '')));
const weight: Record<string, number> = {};
for (const term of formula.split('+')) {
  const m = term.match(/^H(\d+)$/) || term.match(/^[\d.]+\*H(\d+)$/) || term.match(/^H(\d+)\*[\d.]+$/);
  if (!m) throw new Error(`H15 公式看不懂：${term}`);
  const w = term.match(/(^|\*)(\d*\.?\d+)(\*|$)/);
  weight[names[+m[1] - 4]] = w && !/^H/.test(w[2]) ? +w[2] : 1;
}
console.log(`H15 涵蓋 ${Object.keys(weight).length} 個帳號`);

// ---- 讀各帳號的盤
const own = JSON.parse(await Deno.readTextFile('data/sessions.json')).sessions;
const perAccount: { name: string; sessions: any[]; official: Record<string, any> }[] = [];
for (const dir of HISTORY_DIRS) {
  const d = JSON.parse(await Deno.readTextFile(`${dir}/sessions.json`));
  const name = d.sessions[0].accounts[0].name;
  if (!(name in weight)) throw new Error(`H15 找不到帳號：${name}`);
  // 同一週網站存檔已有的盤，也要算進來（例：10-21 週最後一盤）
  const weeks = new Set(d.sessions.map((s: any) => s.week));
  const fromSite = own.filter((s: any) => weeks.has(s.week) && s.accounts.some((a: any) => a.name === name))
    .map((s: any) => ({ ...s, accounts: s.accounts.filter((a: any) => a.name === name) }));
  const has = new Set(fromSite.map((s: any) => `${s.week}#${s.slot}`));
  perAccount.push({ name, sessions: [...d.sessions.filter((s: any) => !has.has(`${s.week}#${s.slot}`)), ...fromSite], official: d.official || {} });
}

// ---- 合併：每週每盤一筆；某帳號這盤沒資料就沿用它上一盤的累積
const key = (s: any) => `${s.week}#${s.slot}`;
const all = new Map<string, any[]>();
perAccount.forEach(p => p.sessions.forEach(s => { if (!all.has(key(s))) all.set(key(s), []); all.get(key(s))!.push({ acc: p.name, s }); }));
const ordered = [...all.keys()].sort((a, b) => { const [wa, sa] = a.split('#'), [wb, sb] = b.split('#'); return wa < wb ? -1 : wa > wb ? 1 : +sa - +sb; });
const sessions: any[] = [];
const carry = new Map<string, { pnl: number; base: number }>();
let curWeek = '';
for (const k of ordered) {
  const [week] = k.split('#');
  if (week !== curWeek) { carry.clear(); curWeek = week; }
  const items = all.get(k)!;
  items.forEach(({ acc, s }) => { const a = s.accounts.find((x: any) => x.name === acc); carry.set(acc, { pnl: a.pnl, base: a.base }); });
  const accounts = [...carry.entries()].map(([name, v]) => ({ name, pnl: v.pnl, base: v.base }));
  const first = items[0].s;
  const market = items.map(({ s }) => s.market).find((m: any) => m && (m.ba || m.bb || m.vix)) || first.market;
  const openAcc: Record<string, number> = {};
  items.forEach(({ acc, s }) => { if (s.open) openAcc[acc] = s.open.accounts ? s.open.accounts[acc] : s.open.total; });
  sessions.push({
    id: first.id, week, slot: first.slot, date: first.date, type: first.type, at: first.at,
    total: { pnl: accounts.reduce((x, a) => x + a.pnl, 0), personal: Math.round(accounts.reduce((x, a) => x + a.pnl * weight[a.name], 0)), base: accounts.reduce((x, a) => x + a.base, 0), resetBase: week },
    accounts, open: { at: first.at, total: Object.values(openAcc).reduce((x, v) => x + (v || 0), 0), accounts: openAcc }, market
  });
}

// ---- 週累積：有官方數字的帳號以官方為主（聯發哥 7/1 週以前官方從週五起算，跟每盤加總不同）
const official: Record<string, any> = {};
for (const week of new Set(sessions.map(s => s.week))) {
  const last = sessions.filter(s => s.week === week).at(-1);
  const offs = perAccount.map(p => ({ name: p.name, o: p.official[week] })).filter(x => x.o && !x.o.same);
  if (!offs.length) continue;
  const acc: Record<string, number> = {}; let total = 0, personal = 0, base = 0;
  for (const a of last.accounts) {
    const o = offs.find(x => x.name === a.name)?.o;
    const pnl = o ? o.pnl : a.pnl;
    if (o) acc[a.name] = o.pnl;
    total += pnl; personal += pnl * weight[a.name]; base += o ? o.base : a.base;
  }
  official[week] = { acc, total: Math.round(total), personal: Math.round(personal), rate: +(total / base * 100).toFixed(2), start: offs[0].o.start };
}

const out = { accounts: perAccount.map(p => p.name), sessions, official };
await Deno.writeTextFile('data/history-index.json', JSON.stringify(out) + '\n');
const check = sessions.filter(s => s.week === '2026-08-12').at(-1);
console.log(`寫出 ${sessions.length} 盤、${new Set(sessions.map(s => s.week)).size} 週、官方不同 ${Object.keys(official).length} 週，${(JSON.stringify(out).length / 1e3).toFixed(0)} KB；帳號 ${out.accounts.join('、')}；8/12 週 眾人 ${check.total.pnl} 個人 ${check.total.personal}`);
