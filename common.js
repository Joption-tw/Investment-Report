// 歐大的投資報表：總表（index.html）與各帳號頁（account.html）共用的資料處理與元件（需先載入 React、htm）
// 改了這個檔，記得把 index.html、account.html 裡 common.js?v= 的版本號一起改掉（瀏覽器會快取這個檔 10 分鐘，新舊版混用會整頁空白）
const html = htm.bind(React.createElement);

// ===== 可拖曳的浮動按鈕：位置只記在這台裝置；移動超過 8px 才算拖曳，沒超過就是一般點擊 =====
// 位置寫成一條 CSS 規則，按鈕還沒畫出來或被藏起來也不影響；螢幕轉向、網址列收合時重新算，永遠留在畫面內
const makeDraggable = (selector, key) => {
    const storeKey = `ir-drag:${key}`, rule = document.head.appendChild(document.createElement('style'));
    let pos = null;   // x、y：按鈕中心在可視範圍的比例；w、h：按鈕大小
    try { pos = JSON.parse(localStorage.getItem(storeKey)); } catch (e) {}
    const view = () => { const v = window.visualViewport; return v ? { l: v.offsetLeft, t: v.offsetTop, w: v.width, h: v.height } : { l: 0, t: 0, w: innerWidth, h: innerHeight }; };
    const place = () => {
        if (!pos) return;
        const v = view(), fit = (center, size, start, len) => Math.max(start + 4, Math.min(center - size / 2, start + len - size - 4));
        rule.textContent = `${selector} { left: ${fit(v.l + pos.x * v.w, pos.w, v.l, v.w)}px !important; top: ${fit(v.t + pos.y * v.h, pos.h, v.t, v.h)}px !important; right: auto !important; bottom: auto !important; }`;
    };
    place();
    addEventListener('resize', place);
    if (window.visualViewport) { visualViewport.addEventListener('resize', place); visualViewport.addEventListener('scroll', place); }
    document.addEventListener('pointerdown', e => {
        const el = e.button === 0 && e.target.closest(selector);
        if (!el) return;
        const box = el.getBoundingClientRect(), { clientX: startX, clientY: startY } = e;
        let moved = false;
        const onMove = ev => {
            if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 8) return;
            moved = true;
            const v = view();
            pos = { x: (box.left + box.width / 2 + ev.clientX - startX - v.l) / v.w, y: (box.top + box.height / 2 + ev.clientY - startY - v.t) / v.h, w: box.width, h: box.height };
            place();
        };
        const onEnd = () => {
            removeEventListener('pointermove', onMove); removeEventListener('pointerup', onEnd); removeEventListener('pointercancel', onEnd);
            if (!moved) return;
            try { localStorage.setItem(storeKey, JSON.stringify(pos)); } catch (e) {}
            // 放開時瀏覽器還會補一個 click，不能把它當成按按鈕
            const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
            document.addEventListener('click', swallow, { capture: true, once: true });
            setTimeout(() => document.removeEventListener('click', swallow, true), 300);
        };
        addEventListener('pointermove', onMove); addEventListener('pointerup', onEnd); addEventListener('pointercancel', onEnd);
    });
};

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

// 單一帳號每盤的進出場（同 sample 的畫面）：進場 = 第一次有部位、出場 = 第一次回到 0（一直沒出場 = 持倉中）
// 進場百點震幅：每段持倉各算一次期指百點震幅再加總（空手時的震盪不算）；期指用未過濾的原始值，跟 sample 同算法
// 示範帳戶試算表的時間標籤比兩分鐘紀錄晚 2 分鐘（同一筆資料），算震幅時對齊
const FUT_LAG = 2 * 60e3;
const tradeStats = (week, points, futs) => {
    const out = {};
    SLOT_DEFS.forEach((_, i) => {
        const open = wallMs(slotOpen(week, i)), end = wallMs(slotEnd(week, i)) + 60e3;
        const pts = points.filter(p => p.t >= open && p.t <= end && p.pts !== null && p.pts !== undefined);
        if (!pts.length) return;
        const fut = futs.filter(f => f.t >= open && f.t <= end + FUT_LAG);
        const onGrid = t => t - t % 60e3 + FUT_LAG;
        const swingIn = (a, b) => swing100(fut.filter(f => f.t >= onGrid(a) && f.t <= onGrid(b)).map(f => f.fut));
        let entry = null, exit = null, seg = null, swing = 0;
        pts.forEach(p => {
            if (seg === null) { if (p.pts !== 0) { seg = p.t; if (entry === null) entry = p.t; } }
            else if (p.pts === 0) { swing += swingIn(seg, p.t); if (exit === null) exit = p.t; seg = null; }
        });
        if (seg !== null) swing += swingIn(seg, pts[pts.length - 1].t);
        out[i] = { entry, exit, holding: seg !== null, swing: entry !== null && fut.length ? swing : null };
    });
    return out;
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
        // VIX 只有日盤有：夜盤用同一天日盤的 VIX（舊存檔的夜盤沒存，從同一天的日盤找）
        if (!market.vix) { const day = sessions.find(s => s.date === date && s.market && s.market.vix); if (day) market.vix = day.market.vix; }
        if (!market.vix && liveVix && liveVix.date === date) market.vix = liveVix.vix;
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

// 已收盤、但 GitHub 排程還沒存進 sessions.json 的盤（排程常延誤好幾個小時）：直接從「兩分鐘紀錄」抓收盤前最後一筆補上
const fillMissing = async (sessions, week) => {
    const now = nowStr();
    const missing = SLOT_DEFS.map((_, i) => i).filter(i => slotEnd(week, i) <= now && !sessions.some(s => s.week === week && s.slot === i));
    if (!missing.length) return sessions;
    const cond = missing.map(i => { const end = wallMs(slotEnd(week, i)); return `(A >= '${stampOf(end - 10 * 60e3)}' and A <= '${stampOf(end + 60e3)}')`; }).join(' or ');
    const url = `https://docs.google.com/spreadsheets/d/${IR_SHEET}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent('兩分鐘紀錄')}&tq=${encodeURIComponent(`select * where ${cond}`)}`;
    const text = await fetch(`${url}&t=${Date.now()}`).then(r => r.ok ? r.text() : '').catch(() => '');
    const snaps = text ? parseLog(parseCSV(text)) : [];
    const filled = missing.map(i => {
        const s = snaps.find(x => x.week === week && x.slot === i);   // parseLog 新的在前 → 收盤前最後一筆
        return s ? { week, slot: i, at: stampOf(s.t), fut: s.fut, total: s.total, accounts: s.accounts, filled: true } : null;
    }).filter(Boolean);
    return filled.length ? [...sessions, ...filled].sort((a, b) => a.week < b.week ? -1 : a.week > b.week ? 1 : a.slot - b.slot) : sessions;
};

// 總表的「當盤獲利」：現在這一盤開盤前的累積獲利（基準），總表每 10 秒的累積獲利減掉它就是當盤
// 回傳 { label, pending?, acc: { 帳號: { pnl: 基準, base: 起始資產 } }, total }；算不出來時沒有 acc
const sessionBaseline = (sessions, live) => {
    const now = slotAt(tpeNow());
    const rows = buildWeek(now.week, sessions, live && live.week === now.week ? live : null, {}, null);
    const row = rows[now.slot], label = row.def.label;
    if (row.pending) return { label, pending: true };
    const fromState = (state, cur) => {
        const acc = {};
        state.accounts.forEach(a => { if (a.pnl !== null) acc[a.name] = { pnl: a.pnl - (cur ? cur[a.name] || 0 : 0), base: a.base }; });
        return acc;
    };
    if (row.state && row.acc) return { label, acc: fromState(row.state, row.acc), total: { pnl: row.state.total.pnl - row.pnl, base: row.state.total.base } };
    // 剛開盤、快照還沒進來：基準就是上一盤收盤
    const prev = now.slot > 0 ? rows.slice(0, now.slot).reverse().find(r => r.state) : null;
    if (!row.state && prev) return { label, acc: fromState(prev.state), total: { pnl: prev.state.total.pnl, base: prev.state.total.base } };
    return { label };
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

// 每盤績效表：日期 / 盤別 / (進場 / 出場) / 勝負 / 獲利金額 / (個人獲利) / 獲利率 / 累積獲利率 / (進場百點震幅) / 百點震幅 / BA / BB / VIX
// trades：單一帳號頁才有，tradeStats 算出來的每盤進出場
const SessionTable = ({ rows, showPersonal, trades, selected, onPick }) => {
    const s = summarize(rows);
    const latestIdx = s.lastRow ? s.lastRow.i : -1;
    const blanks = (showPersonal ? 8 : 7) + (trades ? 1 : 0);
    const clock = t => hhmm(t).replace(/^0(?=\d)/, '');
    return html`
        <div className="overflow-x-auto">
            <table className="w-full text-left">
                <thead>
                    <tr className="bg-slate-900 text-slate-300">
                        <th className=${TH}>日期</th><th className=${TH}>盤別</th>
                        ${trades && html`<th className=${TH}>進場時間點</th><th className=${TH}>出場時間點</th>`}
                        <th className=${TH}>勝負</th>
                        <th className=${TH}>獲利金額</th>${showPersonal && html`<th className=${TH}>個人獲利</th>`}<th className=${TH}>獲利率</th><th className=${TH}>累積獲利率</th>
                        ${trades && html`<th className=${TH}>進場百點震幅</th>`}
                        <th className=${TH}>${trades ? '整盤百點震幅' : '百點震幅'}</th><th className=${TH}>週三時價 (BA)</th><th className=${TH}>週五時價 (BB)</th><th className=${TH}>VIX</th>
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
                                ${trades && html`<td className=${TD + " text-center"}>—</td><td className=${TD + " text-center"}>—</td>`}
                                <td className=${TD + " text-center text-[11px]"}>${r.status}</td>
                                ${[...Array(blanks)].map((_, k) => html`<td key=${k} className=${TD + " text-right"}>—</td>`)}
                            </tr>`;
                        const res = r.pending ? null : resultOf(r.pnl);
                        const m = r.market;
                        const tr = (trades && trades[r.i]) || {};
                        const tag = r.live ? html`<span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-blue-600"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>進行中</span>`
                                  : r.i === latestIdx ? html`<span className="ml-1.5 text-[10px] font-bold text-blue-500">最新</span>` : null;
                        return html`
                            <tr key=${r.i} className=${(res ? RESULT[res].row : '') + sel + (pick ? ' cursor-pointer' : '')} onClick=${pick}>
                                <td className=${TD + " text-center text-slate-500"}>${mdLabel(r.date)}</td>
                                <td className=${TD + " text-slate-800 font-black"}>${slotName(r)}${tag}</td>
                                ${trades && html`
                                    <td className=${TD + " text-center text-indigo-600 font-bold"}>${tr.entry ? clock(tr.entry) : DASH}</td>
                                    <td className=${TD + " text-center text-slate-600 font-bold"}>${tr.exit ? clock(tr.exit) : tr.holding ? html`<span className="text-blue-500">持倉中</span>` : DASH}</td>`}
                                <td className=${TD + " text-center"}>${r.pending ? html`<span className="text-[11px] text-slate-400">結算中</span>`
                                    : res ? html`<span className=${"inline-flex items-center justify-center rounded-md font-black w-8 h-7 text-sm " + RESULT[res].badge}>${RESULT[res].text}</span>` : DASH}</td>
                                <td className=${TD + " text-right text-sm font-black " + toneOf(r.pnl)}>${r.pnl !== undefined ? sgnInt(r.pnl) : DASH}${r.approx ? html`<span className="text-[9px] text-slate-400 ml-0.5" title="前一盤未記錄，以本盤第一筆快照為基準">≈</span>` : null}</td>
                                ${showPersonal && html`<td className=${TD + " text-right " + toneOf(r.personal)}>${r.personal !== undefined && r.personal !== null ? sgnInt(r.personal) : DASH}</td>`}
                                <td className=${TD + " text-right text-sm font-black " + toneOf(r.rate)}>${r.rate !== undefined && r.rate !== null ? sgnPct(r.rate) : DASH}</td>
                                <td className=${TD + " text-right " + toneOf(r.cum)}>${r.cum !== undefined && r.cum !== null && !r.pending ? sgnPct(r.cum) : DASH}</td>
                                ${trades && html`<td className=${TD + " text-right text-indigo-600 font-bold"}>${tr.swing !== undefined && tr.swing !== null ? fmtInt(tr.swing) : DASH}</td>`}
                                <td className=${TD + " text-right text-slate-800"}>${m.swing !== undefined ? fmtInt(m.swing) : DASH}</td>
                                <td className=${TD + " text-right leading-tight"}>${valCell(m.ba, 'text-red-600')}</td>
                                <td className=${TD + " text-right leading-tight"}>${valCell(m.bb, 'text-green-600')}</td>
                                <td className=${TD + " text-right leading-tight"}>${valCell(m.vix, 'text-amber-600', 2)}</td>
                            </tr>`;
                    })}
                </tbody>
                ${s.lastRow && html`
                    <tfoot>
                        <tr className="bg-slate-50 font-black">
                            <td className=${TD + " text-slate-800"} colSpan=${trades ? 4 : 2}>本週合計</td>
                            <td className=${TD + " text-center text-slate-600 whitespace-nowrap"}><span className="text-red-600">勝 ${s.win}</span> · <span className="text-emerald-600">敗 ${s.lose}</span></td>
                            <td className=${TD + " text-right text-sm " + toneOf(s.lastRow.state.total.pnl)}>${sgnInt(s.lastRow.state.total.pnl)}</td>
                            ${showPersonal && html`<td className=${TD + " text-right " + toneOf(s.lastRow.state.total.personal)}>${s.lastRow.state.total.personal !== null ? sgnInt(s.lastRow.state.total.personal) : '—'}</td>`}
                            <td className=${TD}></td>
                            <td className=${TD + " text-right text-sm " + toneOf(s.cum)}>${s.cum !== null ? sgnPct(s.cum) : '—'}</td>
                            <td className=${TD + " text-center text-slate-600"} colSpan=${trades ? 5 : 4}>已開 ${s.opened.length} 盤</td>
                        </tr>
                    </tfoot>`}
            </table>
        </div>`;
};
