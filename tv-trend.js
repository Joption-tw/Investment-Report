// 示範帳號第 3 頁：時間價值走勢（account.html?id=demo）
// 資料：示範帳戶試算表「資料收集」分頁（gid 710415505）A～I 欄，每 2 分鐘一列，一週 10 盤（列範圍同 common.js 的 DEMO_ROWS）
//   C 這期週三、F 前一期週三、G 前兩期週三、E 這期週五、H 前一期週五、I 前兩期週五；欄名（TX4、TXY…）每週會換，直接讀表頭
// 外觀照同學會監控中心的「時間價值走勢」：橫軸是結算前最後 10 盤、每盤一樣寬，上面按鈕只看某一盤，下面拉桿左右拖、拉兩邊縮放
// 橡皮擦：跟監控中心共用登入和「橡皮擦」權限，紀錄存在監控中心 Apps Script（demoTvErase:<週>），每個人開頁都會套用
//   按住在線上劃過去就擦；一筆只擦第一條碰到的線（同時碰到好幾條先挑這期的）；擦掉的點不畫，前後兩點連起來

const TVT_CSV = 'https://docs.google.com/spreadsheets/d/1AsY4_MJipaMp_cNLpyeXTpFGnG0FD4vWJu-SDRdvtME/export?format=csv&gid=710415505&range=A1:I2849';
const TVT_API = 'https://script.google.com/macros/s/AKfycbz7zFm3gVFAq_-y8pxc873AeK0jAWyyrPbUJ9PL3N4vdllJ55rKnOBlbSXAP5zM99tlpQ/exec';
const TVT_TOKEN = 'joption-monitor-token';   // 同網域（joption-tw.github.io）的示範頁共用
const TVT_INK = '#17142b';
// back：這期往前幾期；day 3 = 週三、5 = 週五
const TVT_LINES = [
    { id: 'C', col: 2, day: 3, back: 0, color: '#3a35c4', width: 3.2, dash: 'solid' },
    { id: 'F', col: 5, day: 3, back: 1, color: '#7d78d8', width: 2,   dash: [8, 4] },
    { id: 'G', col: 6, day: 3, back: 2, color: '#aaa6d6', width: 1.6, dash: [2, 4] },
    { id: 'E', col: 4, day: 5, back: 0, color: '#e09a00', width: 3.2, dash: 'solid' },
    { id: 'H', col: 7, day: 5, back: 1, color: '#e2b24e', width: 2,   dash: [8, 4] },
    { id: 'I', col: 8, day: 5, back: 2, color: '#ecd090', width: 1.6, dash: [2, 4] }
];
const TVT_BACK = ['這期', '前一期', '前兩期'];

const tvtStore = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }
};
const tvtApi = body => fetch(TVT_API, { method: 'POST', body: JSON.stringify(body) }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });

// 列 → 第幾盤、盤內位置：x = 盤 + 盤內第幾列 / 這盤列數（每盤一樣寬）
const tvtSlots = DEMO_ROWS.map(([a, b]) => [a - 2, b - 2]);   // 試算表列號 → 資料第幾列（0 起算）
const tvtX = i => { const s = tvtSlots.findIndex(([a, b]) => i >= a && i <= b); return s < 0 ? null : s + (i - tvtSlots[s][0]) / (tvtSlots[s][1] - tvtSlots[s][0] + 1); };

function tvtParse(text) {
    const rows = parseCSV(text);
    const head = rows[0] || [];
    const data = rows.slice(1, tvtSlots[9][1] + 2);
    const out = { head, n: data.length, wed: data.map(r => r[1] || ''), fri: data.map(r => r[3] || ''), x: data.map((r, i) => tvtX(i)) };
    TVT_LINES.forEach(l => { out[l.id] = data.map(r => { const v = toNum(r[l.col]); return v === null || !(v > 0) ? null : v; }); });
    return out;
}

// 這份資料是哪一週（週三夜盤開盤那天）：跟網站其他地方一樣用 slotAt；週三收盤後試算表還沒換週（這期週三最後一盤還有值）就算上一週
function tvtWeek(d) {
    const now = tpeNow(), cur = slotAt(now).week;
    if (!d) return cur;
    const lastSlot = tvtSlots[9];
    const oldFull = d.C.slice(lastSlot[0], lastSlot[1] + 1).some(v => v !== null);
    const startedAgo = (now - new Date(slotOpen(cur, 0).replace(' ', 'T') + 'Z')) / 60000;
    return oldFull && startedAgo >= 0 && startedAgo < 600 ? addDays(cur, -7) : cur;
}

const tvtLabel = (l, week) => {
    const date = addDays(week, (l.day === 3 ? 7 : 9) - 7 * l.back);
    return `${mdLabel(date)}週${l.day === 3 ? '三' : '五'}`;
};

const TvTrend = () => {
    const { useState, useEffect, useRef } = React;
    const box = useRef(null), chartRef = useRef(null), zoomSlot = useRef(null);
    const [data, setData] = useState(null);
    const [failed, setFailed] = useState(false);
    const [updated, setUpdated] = useState(null);
    const [slot, setSlot] = useState('all');
    const [hide, setHide] = useState(() => new Set((tvtStore.get('tvt-hide') || '').split(',').filter(Boolean)));
    const [list, setList] = useState([]);          // 伺服器上的擦除紀錄
    const [pending, setPending] = useState([]);    // 已劃過、還在送出的
    const [canErase, setCanErase] = useState(false);
    const [eraser, setEraser] = useState(false);
    const [login, setLogin] = useState(false);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const live = useRef({});

    const week = tvtWeek(data);
    const load = async () => {
        try {
            const r = await fetch(`${TVT_CSV}&t=${Date.now()}`);
            if (!r.ok) throw new Error(r.status);
            setData(tvtParse(await r.text()));
            setFailed(false);
            setUpdated(new Date());
        } catch (e) { setFailed(true); }
    };
    const loadErased = async w => {
        const token = tvtStore.get(TVT_TOKEN);
        try {
            const r = await tvtApi({ action: 'demoErased', kind: 'tv', week: w, token: token || undefined });
            if (r && r.ok) { setList(r.list || []); setCanErase(!!r.canErase); if (r.auth) tvtStore.set(TVT_TOKEN, ''); }
            return r;
        } catch (e) { return null; }
    };
    useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, []);
    useEffect(() => { loadErased(week); }, [week]);

    // 擦掉的點 → 每條線一組列號
    const marks = {};
    [...list, ...pending].forEach(it => { const set = marks[it.s] = marks[it.s] || new Set(); (it.r || []).forEach(([a, b]) => { for (let i = a; i <= b; i++) set.add(i); }); });
    const valueOf = (id, i) => data && !(marks[id] && marks[id].has(i)) ? data[id][i] : null;
    const shown = TVT_LINES.filter(l => !hide.has(l.id));
    const lastIdx = id => { if (!data) return -1; for (let i = data.n - 1; i >= 0; i--) if (valueOf(id, i) !== null) return i; return -1; };
    const nowC = lastIdx('C'), nowE = lastIdx('E');
    const slotOfIdx = i => i < 0 ? -1 : tvtSlots.findIndex(([a, b]) => i >= a && i <= b);
    const dotC = slotOfIdx(nowC), dotE = slotOfIdx(nowE);

    const toggleLine = id => setHide(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); tvtStore.set('tvt-hide', [...s].join(',')); return s; });

    // ===== 畫圖 =====
    useEffect(() => {
        if (!box.current || !data) return;
        let chart = chartRef.current;
        if (!chart) {
            chart = chartRef.current = echarts.init(box.current);
            const ro = new ResizeObserver(() => chart.resize());
            ro.observe(box.current);
            bindErase(chart);
        }
        const series = shown.map(l => {
            const pts = [];
            for (let i = 0; i < data.n; i++) { const v = valueOf(l.id, i); if (v !== null && data.x[i] !== null) pts.push([data.x[i], v, i]); }
            const isNow = l.back === 0, last = pts[pts.length - 1];
            return {
                id: l.id, name: `${tvtLabel(l, week)}（${data.head[l.col] || l.id}）`, type: 'line', data: pts, showSymbol: false, connectNulls: true,
                z: isNow ? 5 : 3 - l.back, lineStyle: { color: l.color, width: l.width, type: l.dash, cap: 'round' }, itemStyle: { color: l.color },
                emphasis: { disabled: true }, animation: false,
                endLabel: isNow && last ? { show: true, formatter: () => `${tvtLabel(l, week)} ${Math.round(last[1]).toLocaleString()}`, color: l.color, fontWeight: 800, fontSize: 13, distance: 6 } : undefined,
                markLine: isNow && last ? { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: l.color, type: [4, 4], width: 1.2 }, data: [{ xAxis: last[0] }] } : undefined
            };
        });
        // 盤與盤的分隔線
        series.push({ id: 'sep', type: 'line', data: [], silent: true, markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#e7dfd0', type: 'solid', width: 1 }, data: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(x => ({ xAxis: x })) } });
        // 只有換盤別按鈕時才設定縮放範圍，擦點、更新資料時保持使用者拖好的範圍
        const zoom = zoomSlot.current === slot ? {} : slot === 'all' ? { startValue: 0, endValue: 10 } : { startValue: slot, endValue: slot + 1 };
        zoomSlot.current = slot;
        chart.setOption({
            animation: false,
            grid: { left: 62, right: 118, top: 18, bottom: 64 },
            xAxis: { type: 'value', min: 0, max: 10, interval: 0.5, axisLine: { lineStyle: { color: TVT_INK } }, axisTick: { show: false }, splitLine: { show: false },
                     axisLabel: { color: TVT_INK, fontWeight: 700, fontSize: 12, formatter: v => Number.isInteger(v) ? '' : `剩 ${10 - Math.floor(v)} 盤` } },
            yAxis: { type: 'value', min: 0, axisLabel: { color: '#5c5870', formatter: v => v.toLocaleString() }, splitLine: { lineStyle: { color: '#f0ebe0' } } },
            tooltip: {
                show: !live.current.eraser, trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: TVT_INK, type: 'dashed' } },
                backgroundColor: '#fff', borderColor: TVT_INK, borderWidth: 2, textStyle: { color: TVT_INK, fontSize: 13 },
                formatter: ps => {
                    const ok = ps.filter(p => p.seriesId !== 'sep' && p.data);
                    if (!ok.length) return '';
                    const i = ok[0].data[2], s = slotOfIdx(i);
                    let h = `<b>剩 ${10 - s} 盤</b>　<span style="color:#5c5870">週三合約 ${data.wed[i]}／週五合約 ${data.fri[i]}</span>`;
                    ok.forEach(p => { h += `<br>${p.marker}${p.seriesName}　<b>${Math.round(p.data[1]).toLocaleString()}</b>`; });
                    return h;
                }
            },
            dataZoom: [
                { type: 'inside', xAxisIndex: 0, filterMode: 'none', ...zoom, disabled: !!live.current.eraser, zoomOnMouseWheel: true, moveOnMouseMove: true },
                { type: 'slider', xAxisIndex: 0, filterMode: 'none', ...zoom, height: 16, bottom: 10, showDetail: false, brushSelect: false,
                  borderColor: TVT_INK, backgroundColor: '#fffcf5', fillerColor: 'rgba(58,53,196,.12)', dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
                  selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
                  handleStyle: { color: '#3a35c4', borderColor: '#3a35c4' }, moveHandleStyle: { color: '#3a35c4' }, handleSize: '120%' }
            ],
            series
        }, { replaceMerge: ['series'] });
    }, [data, list, pending, hide, slot, eraser, week]);
    useEffect(() => () => { if (chartRef.current) { chartRef.current.dispose(); chartRef.current = null; } }, []);

    // ===== 橡皮擦：按住劃過去 =====
    live.current = { ...live.current, eraser, data, shown, valueOf, week, list };
    function bindErase(chart) {
        const zr = chart.getZr();
        let stroke = null, lastPx = null, raf = 0;
        const hitAt = (px, py, only) => {
            const L = live.current, d = L.data;
            const lo = chart.convertFromPixel({ gridIndex: 0 }, [px - 6, py])[0], hi = chart.convertFromPixel({ gridIndex: 0 }, [px + 6, py])[0];
            let best = null;
            L.shown.forEach(l => {
                if (only && l.id !== only) return;
                const rows = [];
                let near = Infinity;
                for (let i = 0; i < d.n; i++) {
                    const x = d.x[i];
                    if (x === null || x < lo || x > hi) continue;
                    const v = L.valueOf(l.id, i);
                    if (v === null) continue;
                    const dist = Math.abs(chart.convertToPixel({ gridIndex: 0 }, [x, v])[1] - py);
                    if (dist > 10) continue;
                    rows.push(i);
                    near = Math.min(near, dist);
                }
                if (!rows.length) return;
                const score = (l.back === 0 ? 0 : 1000) + near;   // 先挑這期的，再挑最近的
                if (!best || score < best.score) best = { id: l.id, score, rows };
            });
            return best;
        };
        const paint = (px, py) => {
            const steps = lastPx ? Math.max(1, Math.ceil(Math.hypot(px - lastPx[0], py - lastPx[1]) / 4)) : 1;
            for (let k = 1; k <= steps; k++) {
                const x = lastPx ? lastPx[0] + (px - lastPx[0]) * k / steps : px, y = lastPx ? lastPx[1] + (py - lastPx[1]) * k / steps : py;
                const hit = hitAt(x, y, stroke.s);
                if (!hit) continue;
                if (!stroke.s) stroke.s = hit.id;
                hit.rows.forEach(i => stroke.rows.add(i));
            }
            lastPx = [px, py];
            if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (stroke && stroke.s) setPending([{ s: stroke.s, r: tvtRanges(stroke.rows), local: true }]); });
        };
        zr.on('mousedown', e => { if (!live.current.eraser) return; stroke = { s: null, rows: new Set() }; lastPx = null; paint(e.offsetX, e.offsetY); });
        zr.on('mousemove', e => { if (stroke) paint(e.offsetX, e.offsetY); });
        const end = () => {
            if (!stroke) return;
            const s = stroke; stroke = null; lastPx = null;
            if (!s.s || !s.rows.size) { setPending([]); return; }
            commit(s.s, tvtRanges(s.rows));
        };
        zr.on('mouseup', end);
        zr.on('globalout', end);
    }
    async function commit(s, r) {
        const L = live.current;
        setPending([{ s, r }]);
        setBusy(true); setMsg('');
        try {
            const res = await tvtApi({ action: 'demoErase', kind: 'tv', token: tvtStore.get(TVT_TOKEN), week: L.week, s, r });
            if (res.ok) { setList(res.list || []); setMsg(`已擦掉 ${r.reduce((n, [a, b]) => n + b - a + 1, 0)} 個點`); }
            else setMsg(failText(res));
        } catch (e) { setMsg('連不上，沒有存到，稍後再試'); }
        setPending([]); setBusy(false);
    }
    const failText = r => { if (r.auth) { setCanErase(false); setEraser(false); tvtStore.set(TVT_TOKEN, ''); } return r.auth ? '登入過期，請重新登入' : r.full ? '這週擦太多次，存不下了' : r.busy ? '伺服器忙，稍後再擦一次' : '沒有存到'; };
    const undo = async () => {
        if (busy || !list.length) return;
        setBusy(true); setMsg('');
        try {
            const res = await tvtApi({ action: 'demoUnerase', kind: 'tv', token: tvtStore.get(TVT_TOKEN), week });
            if (res.ok) { setList(res.list || []); setMsg('已復原上一步'); } else setMsg(failText(res));
        } catch (e) { setMsg('連不上，稍後再試'); }
        setBusy(false);
    };
    const toggleEraser = () => {
        if (eraser) { setEraser(false); setMsg(''); return; }
        if (!canErase) { setLogin(v => !v); setMsg(''); return; }
        setEraser(true); setMsg('');
    };
    const submitLogin = async e => {
        e.preventDefault();
        const v = email.trim();
        if (!v || busy) return;
        setBusy(true); setMsg('確認中…');
        try {
            const r = await tvtApi({ action: 'login', email: v });
            if (!r.ok) { setMsg(r.pending ? '這個 E-mail 還沒開通' : (r.msg || '登入失敗')); setBusy(false); return; }
            tvtStore.set(TVT_TOKEN, r.token);
            const er = await loadErased(week);
            if (er && er.canErase) { setLogin(false); setEmail(''); setEraser(true); setMsg(''); }
            else setMsg('這個 E-mail 沒有橡皮擦權限');
        } catch (x) { setMsg('連不上，稍後再試'); }
        setBusy(false);
    };
    useEffect(() => { if (chartRef.current) chartRef.current.getZr().setCursorStyle(eraser ? 'crosshair' : 'default'); box.current && box.current.classList.toggle('erasing', eraser); }, [eraser]);

    const slotBtn = (v, text, title) => html`<button key=${v} type="button" title=${title || ''} aria-pressed=${slot === v} onClick=${() => setSlot(v)}>${text}${v === dotC ? html`<i className="nd" style=${{ background: '#3a35c4' }}></i>` : null}${v === dotE ? html`<i className="nd" style=${{ background: '#e09a00' }}></i>` : null}</button>`;

    return html`
        <div className="tvt-head">
            <div>
                <h2 className="tvt-title">時間價值走勢</h2>
                <p className="tvt-sub">橫軸是結算前最後 10 盤：上面的按鈕可以只看某一盤，下面的拉桿可以左右拖、拉兩邊縮放。實線是這期，虛線是前一期，點線是前兩期。</p>
            </div>
            <button type="button" className=${'tvt-btn' + (eraser ? ' on' : '')} onClick=${toggleEraser}>${eraser ? '結束橡皮擦' : '橡皮擦'}</button>
        </div>
        ${login && !eraser && html`
            <form className="tvt-login" onSubmit=${submitLogin}>
                <span>橡皮擦要用監控中心開通、有橡皮擦權限的 E-mail 登入</span>
                <input type="email" autoFocus value=${email} onInput=${e => setEmail(e.target.value)} placeholder="E-mail" />
                <button type="submit" className="tvt-btn" disabled=${busy}>登入</button>
                ${msg && html`<b>${msg}</b>`}
            </form>`}
        ${eraser && html`
            <div className="tvt-erase">
                <span>按住在線上劃過去就擦掉；一次只擦第一條碰到的線</span>
                <button type="button" className="tvt-btn" disabled=${busy || !list.length} onClick=${undo}>復原上一步</button>
                ${busy ? html`<b>存檔中…</b>` : msg && html`<b>${msg}</b>`}
            </div>`}
        <div className="tvt-card">
            <div className="tvt-bar">
                <div className="tvt-seg">
                    ${slotBtn('all', '全部')}
                    ${SLOT_DEFS.map((d, i) => slotBtn(i, `剩 ${10 - i} 盤`, `週三合約的${d.label}`))}
                </div>
            </div>
            <div className="tvt-chips">
                ${TVT_LINES.map(l => html`
                    <button key=${l.id} type="button" className=${'tvt-lg' + (hide.has(l.id) ? ' off' : '')} onClick=${() => toggleLine(l.id)} style=${{ '--c': l.color }}>
                        <i className=${l.back === 1 ? 'dash' : l.back === 2 ? 'dot' : ''}></i>${tvtLabel(l, week)}<small>${(data && data.head[l.col]) || ''} · ${TVT_BACK[l.back]}</small>
                    </button>`)}
            </div>
            ${!data && html`<div className="tvt-empty">${failed ? '讀不到試算表，稍後會自動再試' : '資料讀取中…'}</div>`}
            <div ref=${box} className="tvt-chart" style=${{ display: data ? '' : 'none' }}></div>
        </div>
        <p className="tvt-note">資料來源：示範帳戶試算表，每 2 分鐘一筆，每 2 分鐘自動更新${updated ? `（最後讀取 ${updated.toLocaleTimeString()}）` : ''}。${list.length ? `這週有 ${list.length} 筆擦掉的紀錄，擦掉的點不畫、前後兩點連起來。` : ''}</p>`;
};

// 列號集合 → 連續區段 [[起, 迄], ...]
function tvtRanges(set) {
    const a = [...set].sort((x, y) => x - y), out = [];
    a.forEach(i => { const last = out[out.length - 1]; if (last && i === last[1] + 1) last[1] = i; else out.push([i, i]); });
    return out.slice(0, 300);
}
