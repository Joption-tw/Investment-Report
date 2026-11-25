// 總表頁「多空下單機成交」：放在「個別帳號績效」按鈕下面（index.html）
// 電腦：放在第 1 頁「個別帳號績效」按鈕下面（where="main"）；手機：自己一頁（where="page"，橫向第 4 頁、直向排在最下面）
// 資料：試算表「下單機現況」（每台最新一張總表）、「下單機每盤」（每盤損益，最近 30 盤）、「下單機成交」（一筆一列）、「下單機總表」（每 20 分鐘一張）
//   由歐大電腦上的多空下單機送到 apps-script/bias-signal.gs（action: trader_report）；下單機要勾「成交上報網頁」
// 網頁每 20 秒讀一次；下單機有成交或總表 / 損益有變就送（最快 20 秒一次），另外每 20 分鐘存一張總表（「每 20 分鐘合計」）

const TR_SHEET = '1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk';
const TR_GVIZ = (tab, tq) => `https://docs.google.com/spreadsheets/d/${TR_SHEET}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`
                           + (tq ? `&tq=${encodeURIComponent(tq)}` : '') + `&t=${Date.now()}`;
const TR_REFRESH = 20000;
// 一鍵平倉：Apps Script「多空指標接收」另一個部署（存取權「只有我自己」= 只有擁有者的 Google 帳號開得了）
const TR_CMD_URL = 'https://script.google.com/macros/s/AKfycbzPFecPYeQvcW-vkbfMvkPIisK4RC27DgDBoNJjAkElkvBl7Io2w-2FR45t7p2K2KO-5g/exec';
const trGet = async (tab, tq, head) => {
    const r = await fetch(TR_GVIZ(tab, tq));
    if (!r.ok) return [];
    const rows = parseCSV(await r.text());
    // 分頁還沒建立時 gviz 會回別的分頁：表頭對不上就當沒資料
    if (!rows.length || head.some((h, i) => rows[0][i] !== h)) return [];
    return rows.slice(1).filter(x => x[0]);
};
const trSess = s => { const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})_(.+)$/); return m ? `${m[2]}/${m[3]} ${m[4]}` : s; };
const trSessKey = s => String(s).slice(0, 8) + (String(s).endsWith('夜盤') ? '2' : '1');   // 同一天夜盤排在日盤後面
const trNum = v => { const n = toNum(v); return n === null ? null : n; };
const trMoney = v => v === null ? '' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString()}`;
const trTone = v => v > 0 ? 'text-red-600' : v < 0 ? 'text-emerald-600' : 'text-slate-500';
const trAgo = t => {
    const ms = wallMs(t);
    if (ms === null) return '';
    const min = Math.floor((tpeNow().getTime() - ms) / 60000);
    return min < 1 ? '剛剛' : min < 60 ? `${min} 分鐘前` : `${Math.floor(min / 60)} 小時 ${min % 60} 分前`;
};

const TR_PHONE = Math.min(screen.width, screen.height) < 600;     // 跟 index.html 判斷手機的方法一樣

const TraderReport = ({ where }) => {
    const active = (where === 'page') === TR_PHONE;
    const [now, setNow] = React.useState([]);       // 下單機現況
    const [perf, setPerf] = React.useState([]);     // 每盤損益
    const [cmds, setCmds] = React.useState([]);     // 網頁一鍵平倉指令（最近幾筆）
    const [fills, setFills] = React.useState([]);   // 這一盤成交
    const [hist, setHist] = React.useState([]);     // 這一盤每 20 分鐘的合計
    const [loaded, setLoaded] = React.useState(false);
    const [flt, setFlt] = React.useState(() => { try { return localStorage.getItem('tr-filter') || 'all'; } catch (e) { return 'all'; } });
    const [showAll, setShowAll] = React.useState(false);
    const pick = v => { setFlt(v); try { localStorage.setItem('tr-filter', v); } catch (e) {} };

    React.useEffect(() => {
        if (!active) return;
        let dead = false;
        const load = async () => {
            if (document.hidden) return;
            try {
                const cur = await trGet('下單機現況', 'select *', ['時間', '電腦', '盤別', '模式', '策略']);
                const sess = cur.map(r => r[2]).sort().pop();
                const [f, h, p, c] = sess ? await Promise.all([
                    trGet('下單機成交', `select * where C = '${sess}' order by A desc limit 500`, ['時間', '電腦', '盤別', '模式', '策略']),
                    trGet('下單機總表', `select A,B,D,M where C = '${sess}' and E = '合計' order by A`, ['時間', '電腦', '模式']),
                    trGet('下單機每盤', 'select *', ['時間', '電腦', '盤別', '模式', '成交筆數']),
                    trGet('下單機指令', 'select A,B,C,D,F,G,H order by A desc limit 20', ['時間', '電腦', '指令'])
                ]) : [[], [], [], []];
                if (dead) return;
                setNow(cur.filter(r => r[2] === sess)); setFills(f); setHist(h); setPerf(p); setCmds(c); setLoaded(true);
            } catch (e) { if (!dead) setLoaded(true); }
        };
        load();
        const id = setInterval(load, TR_REFRESH);
        const vis = () => { if (!document.hidden) load(); };
        document.addEventListener('visibilitychange', vis);
        return () => { dead = true; clearInterval(id); document.removeEventListener('visibilitychange', vis); };
    }, []);

    if (!active) return null;
    if (!loaded || !now.length) {                   // 還沒有任何一台下單機上報：寫一句告訴大家要怎麼開
        return html`<section id=${where === 'page' ? 'page-trader' : 'trader-report'} className="my-3 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-900 text-sm font-black text-yellow-400">多空下單機成交</div>
            <div className="p-5 text-center text-xs font-bold text-slate-400">${loaded
                ? '還沒有下單機上報：那台下單機更新到 v1.56 以後，勾上面的「成交上報網頁」，有成交或賺賠有變，約 20 秒內就會出現在這裡'
                : '讀取多空下單機成交中…'}</div></section>`;
    }
    const ok = m => flt === 'all' || (flt === 'live') === (m === '實單');
    const pcs = [...new Set(now.map(r => r[1]))];
    const TH = 'px-2 py-1.5 text-[11px] font-black text-center whitespace-nowrap';
    const TD = 'px-2 py-1 text-xs text-center whitespace-nowrap';
    const modeBg = (m, sum) => m === '實單' ? (sum ? 'bg-red-100' : 'bg-red-50') : (sum ? 'bg-blue-100' : 'bg-blue-50');
    const btn = (v, label) => html`<button key=${v} onClick=${() => pick(v)}
        className=${'px-2.5 py-1 rounded-md text-[11px] font-black border ' + (flt === v ? 'bg-yellow-400 text-slate-900 border-yellow-400' : 'bg-white text-slate-600 border-slate-300')}>${label}</button>`;
    const fillRows = fills.filter(r => ok(r[3]));
    const shown = showAll ? fillRows : fillRows.slice(0, 30);

    return html`
        <section id=${where === 'page' ? 'page-trader' : 'trader-report'} className="my-3 bg-white rounded-xl shadow border border-slate-200 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-900 text-white">
                <span className="text-sm font-black text-yellow-400">多空下單機成交</span>
                <span className="text-[11px] text-slate-300">${trSess(now[0][2])}・有成交或賺賠有變，最快 20 秒更新</span>
                <span className="ml-auto flex gap-1">${btn('all', '全部')}${btn('live', '只看實單')}${btn('sim', '只看模擬')}</span>
            </div>
            ${pcs.map(pc => {
                const rows = now.filter(r => r[1] === pc && ok(r[3]));
                const at = now.find(r => r[1] === pc)[0];
                const h = hist.filter(r => r[1] === pc && ok(r[2]));
                const times = [...new Set(h.map(r => r[0]))];
                const modes = ['實單', '模擬'].filter(m => h.some(r => r[2] === m));
                const pf = perf.filter(r => r[1] === pc && ok(r[3]));
                const pfModes = ['實單', '模擬'].filter(m => pf.some(r => r[3] === m));
                const pfSess = [...new Set(pf.map(r => r[2]))].sort((a, b) => trSessKey(b) < trSessKey(a) ? -1 : 1);
                return html`
                <div key=${pc} className="px-2 sm:px-3 py-2 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-[11px] font-bold text-slate-500">${pc}・總表更新 ${at.slice(11)}（${trAgo(at)}）</span>
                        <a href=${`${TR_CMD_URL}?page=flatten&pc=${encodeURIComponent(pc)}`} target="_blank" rel="noopener"
                           className="ml-auto px-3 py-1 rounded-md bg-red-600 text-white text-xs font-black shadow hover:bg-red-700">⚡ 一鍵平倉（限本人 Google 帳號）</a>
                    </div>
                    ${(() => {
                        const c = cmds.find(r => r[1] === pc);
                        if (!c) return null;
                        const waitMin = (tpeNow().getTime() - (wallMs(c[0]) || 0)) / 60000;
                        const st = c[4] === '已執行' ? html`<span className="text-emerald-700">下單機 ${String(c[5]).slice(11)} 已照做：${c[6]}</span>`
                                 : waitMin > 2 ? html`<span className="text-red-600">下單機沒有回應（可能沒開、或沒勾「允許網頁平倉」）</span>`
                                 : html`<span className="text-amber-600">等下單機照做中…</span>`;
                        return html`<div className="text-[11px] font-bold text-slate-500 mb-1">上次網頁一鍵平倉：${String(c[0]).slice(5)}・${st}</div>`;
                    })()}
                    ${pfModes.map(m => {
                        const cur = pf.find(r => r[3] === m && r[2] === now[0][2]);
                        const all = pf.filter(r => r[3] === m);
                        const sum = i => all.reduce((a, r) => a + (trNum(r[i]) || 0), 0);
                        const v = i => cur ? (trNum(cur[i]) || 0) : 0;
                        const cell = (label, txt, tone, big) => html`<div key=${label} className=${'px-3 py-1 ' + (big ? '' : 'border-l border-slate-200')}>
                            <div className="text-[10px] font-bold text-slate-500">${label}</div>
                            <div className=${(big ? 'text-2xl ' : 'text-base ') + 'font-black ' + tone}>${txt}</div></div>`;
                        return html`<div key=${m} className=${'rounded-lg mb-2 px-1 py-1.5 ' + modeBg(m, false)}>
                            <div className="text-[11px] font-black text-slate-700 px-3">本盤 ${trSess(now[0][2])}・${m}</div>
                            <div className="flex flex-wrap items-end">
                                ${cell('淨合計(元)', trMoney(v(8)), trTone(v(8)), true)}
                                ${cell('已實現', trMoney(v(5)), trTone(v(5)))}
                                ${cell('未實現', trMoney(v(7)), trTone(v(7)))}
                                ${cell('手續費＋稅', Math.round(v(6)).toLocaleString(), 'text-slate-700')}
                                ${cell('成交筆數', v(4), 'text-slate-700')}
                            </div>
                            <div className="text-[10px] font-bold text-slate-500 px-3">最近 ${all.length} 盤累計：淨合計 <span className=${trTone(sum(8))}>${trMoney(sum(8))}</span>・已實現 ${trMoney(sum(5))}・手續費＋稅 ${Math.round(sum(6)).toLocaleString()}・成交 ${sum(4)} 筆</div>
                        </div>`;
                    })}
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead><tr className="bg-slate-800 text-slate-200">
                                ${['模式', '策略', '出場趟數', '贏 / 輸', '已實現點', '已實現(元)', '持倉', '未實現(元)', '合計(元)'].map(x => html`<th key=${x} className=${TH}>${x}</th>`)}
                            </tr></thead>
                            <tbody>
                                ${rows.length ? rows.map((r, i) => {
                                    const sum = r[4] === '合計';
                                    const net = trNum(r[9]), un = trNum(r[11]), tot = trNum(r[12]);
                                    return html`<tr key=${i} className=${modeBg(r[3], sum) + (sum ? ' font-black' : '')}>
                                        <td className=${TD}>${r[3]}</td>
                                        <td className=${TD + ' text-left'}>${r[4]}</td>
                                        <td className=${TD}>${r[5]}</td>
                                        <td className=${TD}>${r[5] !== '' && r[5] !== '0' ? html`<span className="text-red-600">${r[6]}</span> / <span className="text-emerald-600">${r[7]}</span>` : ''}</td>
                                        <td className=${TD + ' text-right ' + trTone(trNum(r[8]))}>${r[8] && r[8] !== '0' ? trMoney(trNum(r[8])) : ''}</td>
                                        <td className=${TD + ' text-right ' + trTone(net)}>${trMoney(net)}</td>
                                        <td className=${TD + ' text-left text-slate-600'}>${r[10]}</td>
                                        <td className=${TD + ' text-right ' + trTone(un)}>${r[10] ? (un === null ? '沒報價' : trMoney(un)) : ''}</td>
                                        <td className=${TD + ' text-right font-black ' + trTone(tot)}>${trMoney(tot)}</td>
                                    </tr>`;
                                }) : html`<tr><td colSpan="9" className=${TD + ' text-slate-400'}>這一盤還沒有${flt === 'live' ? '實單' : flt === 'sim' ? '模擬' : ''}成交</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                    ${times.length > 0 && html`
                    <div className="mt-2 overflow-x-auto">
                        <div className="text-[11px] font-bold text-slate-500 mb-0.5">每 20 分鐘合計（元，含未實現）</div>
                        <table className="text-xs">
                            <tbody>
                                <tr className="bg-slate-100"><td className=${TD + ' font-black'}>時間</td>${times.map(t => html`<td key=${t} className=${TD + ' font-bold text-slate-600'}>${t.slice(11, 16)}</td>`)}</tr>
                                ${modes.map(m => html`<tr key=${m} className=${modeBg(m, false)}>
                                    <td className=${TD + ' font-black'}>${m}</td>
                                    ${times.map(t => { const x = h.find(r => r[0] === t && r[2] === m); const v = x ? trNum(x[3]) : null;
                                        return html`<td key=${t} className=${TD + ' text-right ' + trTone(v)}>${v === null ? '' : trMoney(v)}</td>`; })}
                                </tr>`)}
                            </tbody>
                        </table>
                    </div>`}
                    ${pfSess.length > 0 && html`
                    <div className="mt-2 overflow-x-auto">
                        <div className="text-[11px] font-bold text-slate-500 mb-0.5">每盤損益（最近 ${pfSess.length} 盤）</div>
                        <table className="w-full">
                            <thead><tr className="bg-slate-800 text-slate-200">
                                ${['盤別', '模式', '成交筆數', '已實現', '手續費＋稅', '未實現', '淨合計'].map(x => html`<th key=${x} className=${TH}>${x}</th>`)}
                            </tr></thead>
                            <tbody>
                                ${pfSess.flatMap(se => pfModes.map(m => pf.find(r => r[2] === se && r[3] === m)).filter(Boolean)).map(r => {
                                    const net = trNum(r[8]);
                                    return html`<tr key=${r[2] + r[3]} className=${modeBg(r[3], false) + ' border-b border-white'}>
                                        <td className=${TD}>${trSess(r[2])}</td><td className=${TD}>${r[3]}</td><td className=${TD}>${r[4]}</td>
                                        <td className=${TD + ' text-right ' + trTone(trNum(r[5]))}>${trMoney(trNum(r[5]))}</td>
                                        <td className=${TD + ' text-right'}>${trMoney(-(trNum(r[6]) || 0))}</td>
                                        <td className=${TD + ' text-right ' + trTone(trNum(r[7]))}>${trMoney(trNum(r[7]))}</td>
                                        <td className=${TD + ' text-right font-black ' + trTone(net)}>${trMoney(net)}</td>
                                    </tr>`;
                                })}
                            </tbody>
                        </table>
                    </div>`}
                </div>`;
            })}
            <div className="px-2 sm:px-3 py-2">
                <div className="text-[11px] font-bold text-slate-500 mb-1">這一盤成交（新的在上面，共 ${fillRows.length} 筆）</div>
                ${fillRows.length ? html`
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead><tr className="bg-slate-800 text-slate-200">
                            ${['時間', ...(pcs.length > 1 ? ['電腦'] : []), '模式', '策略', '動作', '商品', '買賣', '口數', '價格', '這筆損益(元)'].map(x => html`<th key=${x} className=${TH}>${x}</th>`)}
                        </tr></thead>
                        <tbody>
                            ${shown.map(r => {
                                const net = trNum(r[12]);
                                return html`<tr key=${r[13]} className=${modeBg(r[3], false) + ' border-b border-white'}>
                                    <td className=${TD}>${r[0].slice(11)}</td>
                                    ${pcs.length > 1 && html`<td className=${TD}>${r[1]}</td>`}
                                    <td className=${TD}>${r[3]}</td>
                                    <td className=${TD + ' text-left'}>${r[4]}</td>
                                    <td className=${TD + ' text-left'}>${r[5]}</td>
                                    <td className=${TD}>${r[6]}${r[6] !== '小台' ? ' ' + r[7] : ''}</td>
                                    <td className=${TD + ' font-black ' + (r[8] === '買' ? 'text-red-600' : 'text-emerald-600')}>${r[8]}</td>
                                    <td className=${TD}>${r[9]}</td>
                                    <td className=${TD + ' text-right'}>${r[10]}</td>
                                    <td className=${TD + ' text-right font-black ' + trTone(net)}>${net === null ? '' : trMoney(net)}</td>
                                </tr>`;
                            })}
                        </tbody>
                    </table>
                </div>
                ${fillRows.length > 30 && html`<button onClick=${() => setShowAll(!showAll)} className="mt-1 text-[11px] font-bold text-blue-700 underline">${showAll ? '只看最新 30 筆' : `看全部 ${fillRows.length} 筆`}</button>`}`
                : html`<div className="text-xs text-slate-400">這一盤還沒有成交</div>`}
            </div>
        </section>`;
};
