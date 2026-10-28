// 歐大的投資報表：總表（index.html）與各帳號頁（account.html）共用的資料處理與元件（需先載入 React、htm）
// 改了這個檔，記得把 index.html、account.html 裡 common.js?v= 的版本號一起改掉（瀏覽器會快取這個檔 10 分鐘，新舊版混用會整頁空白）
const html = htm.bind(React.createElement);

// ===== 資料來源 =====
// 收完的盤：GitHub Actions（scripts/record_sessions.py）存到 data/sessions.json；各帳號走勢存到 data/series/<週>.json
// 即時：試算表「績效表」上方總表 + 下方每 10 分鐘的快照（約保留 16 小時）
// 百點震幅 / BA / BB / 期指：示範帳戶試算表（舊週讀 sample 的每週存檔）；VIX：demo-performance 的 /api/vix
const IR_SHEET     = '1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk';
const IR_GID       = '103299629';
const SESSIONS_URL = 'data/sessions.json';
const SERIES_URL   = w => `data/series/${w}.json`;
const LIVE_URL     = `https://docs.google.com/spreadsheets/d/${IR_SHEET}/export?format=csv&gid=${IR_GID}&range=C2:P14`;
const SNAPS_URL    = `https://docs.google.com/spreadsheets/d/${IR_SHEET}/export?format=csv&gid=${IR_GID}&range=C1:P2000`;
const DEMO_URL     = 'https://docs.google.com/spreadsheets/d/1AsY4_MJipaMp_cNLpyeXTpFGnG0FD4vWJu-SDRdvtME/export?format=csv&gid=1823639969';
const DEMO_HISTORY = w => `https://joption-tw.github.io/sample/history/${w}.csv`;
const VIX_URL      = 'https://demo-performance.vercel.app/api/vix';

// ===== 帳號網址：account.html?id=<代號>；home: false 的帳號頁不顯示「← 總表」=====
const ACCOUNTS = [
    { id: 'demo',       name: '示範帳號' },
    { id: 'kgi',        name: '歐大_凱基' },
    { id: 'main',       name: '大帳號' },
    { id: 'gary',       name: 'gary-lan' },
    { id: 'mtk',        name: '聯發哥', alias: ['連發哥'], home: false },
    { id: 'masterlink', name: '獨孤求敗_元富' },
    { id: 'richdad',    name: '富爸爸' },
    { id: 'rick',       name: 'Rick', home: false },
    { id: 'mom',        name: '媽媽帳號' }
];
const cleanName  = s => String(s || '').trim().replace(/\((主|副)\)$/, '');
const accountOf  = raw => { const n = cleanName(raw); return ACCOUNTS.find(a => a.name === n || (a.alias || []).includes(n)) || null; };
const accountUrl = a => `account.html?id=${a.id}`;

// CSV（支援引號內換行）
const parseCSV = (text) => {
    const rows = []; let row = [], cur = '', inQ = false;
    const endRow = () => { row.push(cur); if (row.length > 1 || row[0].trim() !== '') rows.push(row); row = []; cur = ''; };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
        else if (c === '"') inQ = true;
        else if (c === ',') { row.push(cur); cur = ''; }
        else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
        else cur += c;
    }
    if (cur !== '' || row.length) endRow();
    return rows;
};
const toNum = v => { const m = String(v === null || v === undefined ? '' : v).match(/-?[\d,]*\.?\d+/); return m ? parseFloat(m[0].replace(/,/g, '')) : null; };

// ===== 盤別：一週 10 盤，週三夜盤開始到下週三早盤；早盤 08:45~13:45、夜盤 15:00~隔日 05:00 =====
const SLOT_DEFS = [
    { label: '週三晚', short: '三晚', off: 0, type: 'N' }, { label: '週四早', short: '四早', off: 1, type: 'D' },
    { label: '週四晚', short: '四晚', off: 1, type: 'N' }, { label: '週五早', short: '五早', off: 2, type: 'D' },
    { label: '週五晚', short: '五晚', off: 2, type: 'N' }, { label: '週一早', short: '一早', off: 5, type: 'D' },
    { label: '週一晚', short: '一晚', off: 5, type: 'N' }, { label: '週二早', short: '二早', off: 6, type: 'D' },
    { label: '週二晚', short: '二晚', off: 6, type: 'N' }, { label: '週三早', short: '三早', off: 7, type: 'D' }
];
// 示範帳戶試算表每盤的列範圍（同 demo-performance）
const DEMO_ROWS = [[2, 419], [420, 569], [570, 989], [990, 1139], [1140, 1559], [1560, 1709], [1710, 2129], [2130, 2279], [2280, 2699], [2700, 2849]];

// 時間一律用台灣時間：Date 的 UTC 欄位 = 台灣時間（毫秒值也是這個「台灣牆上時間」）
const tpeNow  = () => new Date(Date.now() + 8 * 3600e3);
const ymd     = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const mdLabel = s => `${+s.slice(5, 7)}/${s.slice(8, 10)}`;
const wallMs  = s => { const m = String(s).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null; };
const hhmm    = ms => new Date(ms).toISOString().slice(11, 16);
const mdhm    = ms => { const d = new Date(ms); return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')} ${hhmm(ms)}`; };
const weekOf  = (date, type) => {
    const wd = new Date(date + 'T00:00:00Z').getUTCDay();
    if (type === 'N' && wd === 3) return date;
    return addDays(date, -(((wd - 3 + 7) % 7) || 7));
};
// 某個時間點屬於哪一盤（收盤後到下一盤前的空檔算剛收的那盤；週末算週五夜盤）
const slotAt = (t) => {
    const m = t.getUTCHours() * 60 + t.getUTCMinutes(), today = ymd(t);
    const date = m < 8 * 60 + 45 ? addDays(today, -1) : today;
    const type = m < 8 * 60 + 45 || m >= 15 * 60 ? 'N' : 'D';
    const week = weekOf(date, type);
    const off = Math.round((new Date(date) - new Date(week)) / 864e5);
    const slot = SLOT_DEFS.findIndex(s => s.off === off && s.type === type);
    return { week, slot: slot === -1 ? 4 : slot };
};
const slotDate = (week, i) => addDays(week, SLOT_DEFS[i].off);
const slotEnd  = (week, i) => SLOT_DEFS[i].type === 'D' ? `${slotDate(week, i)} 13:45` : `${addDays(slotDate(week, i), 1)} 05:00`;
const slotOpen = (week, i) => `${slotDate(week, i)} ${SLOT_DEFS[i].type === 'D' ? '08:45' : '15:00'}`;
const nowStr   = () => tpeNow().toISOString().slice(0, 16).replace('T', ' ');

// 「績效表」快照（範圍從 C 欄起算）：時間列 → 標題列 → 各帳號 → 歐大總績效(參考)；新的在前
const parseSnapshots = (rows) => {
    const snaps = [];
    rows.forEach((r, i) => {
        const t = /^\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}$/.test((r[0] || '').trim()) ? wallMs(r[0]) : null;
        if (t === null || !rows[i + 1] || (rows[i + 1][0] || '').trim() !== '社群暱稱') return;
        const accounts = []; let total = null;
        for (const c of rows.slice(i + 2, i + 32)) {
            const name = (c[0] || '').trim();
            if (!name || name === '社群暱稱') break;
            if (name.startsWith('歐大總績效')) {
                total = { pnl: toNum(c[5]), personal: toNum(c[3]), base: accounts.reduce((s, a) => s + (a.base || 0), 0) };
                break;
            }
            accounts.push({ name: cleanName(name), pnl: toNum(c[5]), base: toNum(c[11]), ratio: toNum(c[2]), delta: toNum(c[3]), tv: toNum(c[4]),
                            rate: toNum(c[6]), margin: toNum(c[8]), asset: toNum(c[10]), pts: toNum(c[12]) });
        }
        if (total && total.pnl !== null && accounts.length) snaps.push({ t, fut: toNum(r[13]), total, accounts, ...slotAt(new Date(t)) });
    });
    return snaps;
};

// 「兩分鐘紀錄」分頁（apps-script/two-minute-log.gs）：記錄時間 + 績效表 C~P 欄；只抓最近幾小時（更早的在 data/series）
const LOG_URL = since => `https://docs.google.com/spreadsheets/d/${IR_SHEET}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent('兩分鐘紀錄')}`
                       + `&tq=${encodeURIComponent(`select * where A >= '${since}'`)}`;
const parseLog = (rows) => {
    if (!rows.length || rows[0][0] !== '記錄時間' || rows[0][1] !== '社群暱稱') return [];   // 還沒安裝紀錄程式
    const groups = new Map();
    rows.slice(1).forEach(r => { if (r.length >= 15 && wallMs(r[0]) !== null) { if (!groups.has(r[0])) groups.set(r[0], []); groups.get(r[0]).push(r); } });
    const snaps = [];
    groups.forEach((group, stamp) => {
        const accounts = []; let total = null;
        for (const r of group) {
            const name = r[1].trim();
            if (name.startsWith('歐大總績效')) { total = { pnl: toNum(r[6]), personal: toNum(r[4]), base: accounts.reduce((s, a) => s + (a.base || 0), 0) }; break; }
            accounts.push({ name: cleanName(name), pnl: toNum(r[6]), base: toNum(r[12]), ratio: toNum(r[3]), delta: toNum(r[4]), tv: toNum(r[5]),
                            rate: toNum(r[7]), margin: toNum(r[9]), asset: toNum(r[11]), pts: toNum(r[13]) });
        }
        const t = wallMs(stamp);
        if (total && total.pnl !== null && accounts.length) snaps.push({ t, fut: toNum(group[0][10]), total, accounts, ...slotAt(new Date(t)) });
    });
    return snaps.sort((a, b) => b.t - a.t);
};

// ===== 橡皮擦：塗掉的點記在試算表「塗掉紀錄」分頁（apps-script/eraser.gs 網頁應用程式寫入，要密碼）=====
// 期指 / 週三、週五時價是市場資料，帳號記成「*」，所有帳號頁一起不畫
const ERASE_API     = 'https://script.google.com/macros/s/AKfycbzPpkcKFet7joAB7OMFFgV18PisYB9hPgciV2AxUBroTlnafj0_N5Pamglcj84PA6Tbkg/exec';
const ERASE_LOG_URL = `https://docs.google.com/spreadsheets/d/${IR_SHEET}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent('塗掉紀錄')}`;
const stampOf  = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/');
const eraseKey = (account, line, t) => `${account}|${line}|${t}`;
const parseErasures = (rows) => {
    const out = new Set();
    if (!rows.length || rows[0][0] !== '記錄時間' || rows[0][1] !== '帳號') return out;
    rows.slice(1).forEach(r => {                 // 照記錄順序：最後一筆是「塗掉」就不畫，「還原」就照畫
        const k = eraseKey(r[1], r[2], r[3]);
        if (r[4] === '還原') out.delete(k); else if (r[4] === '塗掉') out.add(k);
    });
    return out;
};

// 自動過濾跳點（同 demo-performance）：某一點跟前後兩點的平均差太多，就用平均取代；每一盤分開算，不跨盤
const despike = (pts, keys) => {
    const out = pts.map(p => ({ ...p }));
    keys.forEach(key => {
        for (let i = 1; i < out.length - 1; i++) {
            const a = out[i - 1], b = out[i], c = out[i + 1];
            if (a[key] == null || b[key] == null || c[key] == null) continue;
            if (b.t - a.t > 10 * 60e3 || c.t - b.t > 10 * 60e3) continue;
            const avg = (a[key] + c[key]) / 2, th = Math.abs(avg) < 50 ? 0.3 : Math.abs(avg) * 0.005;
            if (Math.abs(b[key] - avg) > th) b[key] = avg;
        }
    });
    return out;
};

// 畫線前平滑（同 sample 網站）：每一點跟前後兩點取平均；[時間, 值] 陣列，不跨盤
const smooth3 = pairs => pairs.map(([t, v], i) => {
    if (v == null) return [t, v];
    let sum = v, n = 1;
    [pairs[i - 1], pairs[i + 1]].forEach(q => { if (q && q[1] != null && Math.abs(q[0] - t) <= 10 * 60e3) { sum += q[1]; n++; } });
    return [t, +(sum / n).toFixed(4)];
});

// 百點震幅（同 demo-performance）
const swing100 = (prices, threshold = 100) => {
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
};
const lastChg = (vals, ref) => {
    const v = vals.filter(x => x);
    if (!v.length) return null;
    const base = ref || v[0], chg = v[v.length - 1] - base;
    return { last: v[v.length - 1], chg, pct: base ? chg / base * 100 : 0, many: !!ref || v.length > 1 };
};
const inSession = (label, type) => {
    const m = (label || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return false;
    const t = +m[1] * 60 + +m[2];
    return type === 'D' ? t >= 525 && t <= 825 : t >= 900 || t <= 300;
};
// 示範帳戶試算表 → 該週每盤的百點震幅 / BA / BB，以及每 2 分鐘的期指 / BA / BB 走勢
const parseDemo = (rows, week) => {
    const data = rows.slice(1).filter(c => c.length >= 54);
    const start = (data.find(c => c[8] && c[1]) || [])[1] || '';
    if (!start.replace(/\//g, '-').startsWith(week)) return null;
    const market = {}, series = [];
    DEMO_ROWS.forEach(([a, b], i) => {
        const type = SLOT_DEFS[i].type;
        const seg = data.slice(a - 2, b - 1).filter(c => inSession(c[0], type) && toNum(c[22]));
        if (!seg.length) return;
        seg.forEach(c => {
            const m = c[0].match(/(\d{1,2}):(\d{2})/);
            const date = type === 'N' && +m[1] < 15 ? addDays(slotDate(week, i), 1) : slotDate(week, i);
            series.push({ t: wallMs(`${date} ${m[1]}:${m[2]}`), fut: toNum(c[22]), ba: toNum(c[52]) || null, bb: toNum(c[53]) || null });
        });
        market[i] = { swing: swing100(seg.map(c => toNum(c[22]))), ba: lastChg(seg.map(c => toNum(c[52]))), bb: lastChg(seg.map(c => toNum(c[53]))) };
    });
    return { market, series };
};
const parseVix = (v) => {
    if (!v || !v.tradeDay || !v.ticks) return null;
    const td = v.tradeDay;
    const vals = v.ticks.filter(([t]) => String(t).padStart(6, '0') <= '134500').map(([, x]) => x);
    return { date: `${td.slice(0, 4)}-${td.slice(4, 6)}-${td.slice(6, 8)}`, vix: lastChg(vals, v.quote && v.quote.ref) };
};

// 只看某一個帳號：把該帳號當成「合計」（週三夜盤歸零的判斷仍用全部帳號的起始資產）
const accountView = (s, name) => {
    const a = s.accounts.find(x => x.name === name);
    if (!a) return null;
    return { ...s, total: { pnl: a.pnl, personal: null, base: a.base, resetBase: s.total.resetBase !== undefined ? s.total.resetBase : s.total.base }, accounts: [a],
             open: s.open && s.open.accounts[name] !== undefined ? { ...s.open, total: s.open.accounts[name] } : undefined };
};

// ===== 一週 10 盤：每盤的勝敗、獲利、累積 =====
// 每盤獲利 = 本盤收盤的本週累積獲利 − 上一盤收盤的本週累積獲利（週三夜盤是一週第一盤，起始資產重設後從 0 起算）
const buildWeek = (week, sessions, live, liveMarket, liveVix) => {
    const resetBase = s => s.total.resetBase !== undefined ? s.total.resetBase : s.total.base;
    const recorded = {};
    sessions.filter(s => s.week === week).forEach(s => { recorded[s.slot] = s; });
    const prevWeekLast = sessions.filter(s => s.week < week).slice(-1)[0] || null;
    const now = nowStr();
    let prev = null;
    return SLOT_DEFS.map((def, i) => {
        const date = slotDate(week, i);
        const state = recorded[i] || (live && live.week === week && live.slot === i ? live : null);
        const market = { ...(liveMarket[i] || {}), ...((recorded[i] && recorded[i].market) || {}) };
        if (def.type === 'D' && !market.vix && liveVix && liveVix.date === date) market.vix = liveVix.vix;
        if (!state) {
            const status = now < slotOpen(week, i) ? '尚未開盤' : now < slotEnd(week, i) ? '等待資料' : '無紀錄';
            return { i, def, date, status, market };
        }
        const row = { i, def, date, state, market, live: !!state.live };
        let basePnl = null, basePersonal = null, baseAcc = {};
        if (i === 0) {
            if (prevWeekLast && resetBase(state) === resetBase(prevWeekLast)) { row.pending = true; prev = state; return row; }
            basePnl = 0; basePersonal = 0;
        } else if (prev) {
            basePnl = prev.total.pnl; basePersonal = prev.total.personal;
            prev.accounts.forEach(a => { baseAcc[a.name] = a.pnl; });
        } else if (state.open && state.open.total !== null) {   // 前面幾盤沒存到（例：剛開始記錄）→ 以本盤開盤第一筆為基準
            basePnl = state.open.total; baseAcc = state.open.accounts; row.approx = true;
        }
        if (basePnl !== null) {
            row.pnl = state.total.pnl - basePnl;
            row.personal = basePersonal !== null && state.total.personal !== null ? state.total.personal - basePersonal : null;
            row.rate = state.total.base ? row.pnl / state.total.base * 100 : null;
            row.acc = {};
            state.accounts.forEach(a => { if (a.pnl !== null) row.acc[a.name] = a.pnl - (baseAcc[a.name] || 0); });
        }
        row.cum = state.total.base ? state.total.pnl / state.total.base * 100 : null;
        prev = state;
        return row;
    });
};
const summarize = (rows) => {
    const opened = rows.filter(r => r.state && !r.pending);
    const lastRow = opened[opened.length - 1] || null;
    return {
        opened, lastRow,
        win:  opened.filter(r => resultOf(r.pnl) === 'win').length,
        lose: opened.filter(r => resultOf(r.pnl) === 'lose').length,
        cum:  lastRow ? lastRow.cum : null
    };
};

// ===== 顯示 =====
const fmtInt = v => Math.round(v).toLocaleString();
const sgnInt = v => `${v > 0 ? '+' : ''}${fmtInt(v)}`;
const sgnPct = v => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const toneOf = v => v > 0 ? 'text-red-600' : v < 0 ? 'text-emerald-600' : 'text-slate-500';
const resultOf = v => v === undefined || v === null ? null : v > 0 ? 'win' : v < 0 ? 'lose' : 'flat';
const RESULT = {
    win:  { text: '勝', badge: 'bg-red-600 text-white',     row: 'bg-red-50/70',     cell: 'bg-red-50 text-red-600' },
    lose: { text: '敗', badge: 'bg-emerald-600 text-white', row: 'bg-emerald-50/70', cell: 'bg-emerald-50 text-emerald-700' },
    flat: { text: '平', badge: 'bg-slate-400 text-white',   row: '',                 cell: 'text-slate-500' }
};
const weekSummary = (rows, s) => s.opened.length
    ? `${mdLabel(rows[0].date)} ~ ${mdLabel(rows[9].date)} · 已開 ${s.opened.length} 盤 · 勝 ${s.win} 盤、敗 ${s.lose} 盤 · 累積 ${s.cum !== null ? sgnPct(s.cum) : '—'}`
    : `${mdLabel(rows[0].date)} ~ ${mdLabel(rows[9].date)} · 本週尚無資料`;

const DASH = html`<span className="text-slate-300">—</span>`;
const TH = "px-2 py-2.5 text-[11px] font-black tracking-wider text-center border-slate-800 whitespace-nowrap";
const TD = "px-2 py-2 text-xs font-bold font-mono-data whitespace-nowrap";
const valCell = (r, color, d = 0) => r ? html`
    <div className=${"font-black " + color}>${r.last.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}</div>
    ${r.many && html`<div className=${"text-[10px] " + (r.chg >= 0 ? 'text-red-500' : 'text-emerald-500')}>${r.chg > 0 ? '+' : ''}${r.chg.toFixed(d)} (${sgnPct(r.pct)})</div>`}` : DASH;
const slotName = (r) => html`<span className=${"inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle " + (r.def.type === 'N' ? 'bg-slate-700' : 'bg-orange-400')}></span>${r.def.label}`;

// 10 格勝敗條；onPick 有給時可點選
const WinStrip = ({ rows, selected, onPick }) => html`
    <div className="flex gap-1 sm:gap-1.5 px-2 sm:px-4 py-3 border-b border-slate-100 overflow-x-auto">
        ${rows.map(r => {
            const res = r.pending ? null : resultOf(r.pnl);
            const ring = selected === r.i ? ' ring-2 ring-offset-1 ring-orange-500' : r.live ? ' ring-2 ring-offset-1 ring-blue-500' : '';
            return html`
                <div key=${r.i} onClick=${onPick ? () => onPick(r.i) : undefined} className=${"flex-1 min-w-[28px] flex flex-col items-center gap-1" + (onPick ? ' cursor-pointer' : '')}>
                    <span className=${"text-[10px] font-black " + (r.def.type === 'N' ? 'text-slate-600' : 'text-orange-500')}>${r.def.short}</span>
                    <div className=${"w-full h-9 rounded-md flex items-center justify-center text-sm font-black " + (res ? RESULT[res].badge : 'bg-slate-100 text-slate-300') + ring}>
                        ${res ? RESULT[res].text : (r.state ? '…' : '·')}
                    </div>
                    <span className=${"text-[9px] font-bold font-mono-data " + (r.pnl !== undefined ? toneOf(r.pnl) : 'text-slate-300')}>${r.rate !== undefined && r.rate !== null ? sgnPct(r.rate) : mdLabel(r.date)}</span>
                </div>`;
        })}
    </div>`;

// 每盤績效表：日期 / 盤別 / 勝負 / 百點震幅 / BA / BB / VIX / 獲利金額 / (個人獲利) / 獲利率 / 累積獲利率
const SessionTable = ({ rows, showPersonal, selected, onPick }) => {
    const s = summarize(rows);
    const latestIdx = s.lastRow ? s.lastRow.i : -1;
    const blanks = showPersonal ? 8 : 7;
    return html`
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="bg-slate-900 text-slate-300">
                        <th className=${TH}>日期</th><th className=${TH}>盤別</th><th className=${TH}>勝負</th>
                        <th className=${TH}>百點震幅</th><th className=${TH}>週三時價 (BA)</th><th className=${TH}>週五時價 (BB)</th><th className=${TH}>VIX</th>
                        <th className=${TH}>獲利金額</th>${showPersonal && html`<th className=${TH}>個人獲利</th>`}<th className=${TH}>獲利率</th><th className=${TH}>累積獲利率</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => {
                        const pick = onPick ? () => onPick(r.i) : undefined;
                        const sel = selected === r.i ? ' outline outline-2 -outline-offset-2 outline-orange-400' : '';
                        if (!r.state) return html`
                            <tr key=${r.i} className=${"text-slate-300" + sel + (pick ? ' cursor-pointer' : '')} onClick=${pick}>
                                <td className=${TD + " text-center"}>${mdLabel(r.date)}</td>
                                <td className=${TD}>${slotName(r)}</td>
                                <td className=${TD + " text-center text-[11px]"}>${r.status}</td>
                                ${[...Array(blanks)].map((_, k) => html`<td key=${k} className=${TD + " text-right"}>—</td>`)}
                            </tr>`;
                        const res = r.pending ? null : resultOf(r.pnl);
                        const m = r.market;
                        const tag = r.live ? html`<span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-blue-600"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>進行中</span>`
                                  : r.i === latestIdx ? html`<span className="ml-1.5 text-[10px] font-bold text-blue-500">最新</span>` : null;
                        return html`
                            <tr key=${r.i} className=${(res ? RESULT[res].row : '') + sel + (pick ? ' cursor-pointer' : '')} onClick=${pick}>
                                <td className=${TD + " text-center text-slate-500"}>${mdLabel(r.date)}</td>
                                <td className=${TD + " text-slate-800 font-black"}>${slotName(r)}${tag}</td>
                                <td className=${TD + " text-center"}>${r.pending ? html`<span className="text-[11px] text-slate-400">結算中</span>`
                                    : res ? html`<span className=${"inline-flex items-center justify-center rounded-md font-black w-8 h-7 text-sm " + RESULT[res].badge}>${RESULT[res].text}</span>` : DASH}</td>
                                <td className=${TD + " text-right text-slate-800"}>${m.swing !== undefined ? fmtInt(m.swing) : DASH}</td>
                                <td className=${TD + " text-right leading-tight"}>${valCell(m.ba, 'text-red-600')}</td>
                                <td className=${TD + " text-right leading-tight"}>${valCell(m.bb, 'text-green-600')}</td>
                                <td className=${TD + " text-right leading-tight"}>${r.def.type === 'D' ? valCell(m.vix, 'text-amber-600', 2) : DASH}</td>
                                <td className=${TD + " text-right text-sm font-black " + toneOf(r.pnl)}>${r.pnl !== undefined ? sgnInt(r.pnl) : DASH}${r.approx ? html`<span className="text-[9px] text-slate-400 ml-0.5" title="前一盤未記錄，以本盤第一筆快照為基準">≈</span>` : null}</td>
                                ${showPersonal && html`<td className=${TD + " text-right " + toneOf(r.personal)}>${r.personal !== undefined && r.personal !== null ? sgnInt(r.personal) : DASH}</td>`}
                                <td className=${TD + " text-right text-sm font-black " + toneOf(r.rate)}>${r.rate !== undefined && r.rate !== null ? sgnPct(r.rate) : DASH}</td>
                                <td className=${TD + " text-right " + toneOf(r.cum)}>${r.cum !== undefined && r.cum !== null && !r.pending ? sgnPct(r.cum) : DASH}</td>
                            </tr>`;
                    })}
                </tbody>
                ${s.lastRow && html`
                    <tfoot>
                        <tr className="bg-slate-50 font-black">
                            <td className=${TD + " text-slate-800"} colSpan="2">本週合計</td>
                            <td className=${TD + " text-center text-slate-600"} colSpan="5">已開 ${s.opened.length} 盤 · <span className="text-red-600">勝 ${s.win}</span> · <span className="text-emerald-600">敗 ${s.lose}</span></td>
                            <td className=${TD + " text-right text-sm " + toneOf(s.lastRow.state.total.pnl)}>${sgnInt(s.lastRow.state.total.pnl)}</td>
                            ${showPersonal && html`<td className=${TD + " text-right " + toneOf(s.lastRow.state.total.personal)}>${s.lastRow.state.total.personal !== null ? sgnInt(s.lastRow.state.total.personal) : '—'}</td>`}
                            <td className=${TD}></td>
                            <td className=${TD + " text-right text-sm " + toneOf(s.cum)}>${s.cum !== null ? sgnPct(s.cum) : '—'}</td>
                        </tr>
                    </tfoot>`}
            </table>
        </div>`;
};
