# 每盤績效存檔：把每一盤收盤時各帳號的獲利存到 data/sessions.json，網頁的「每盤績效表」從這裡讀
# 試算表「績效表」只保留最近約 16 小時、每 10 分鐘一筆的快照，所以每盤收完要趕快存下來，整週每一盤的勝敗才會留著。
#   - 盤別：早盤 08:45~13:45、夜盤 15:00~隔日 05:00；一週 10 盤，從週三夜盤開始到下週三早盤
#   - 每盤存「收盤前最後一筆快照」的獲利金額 / 起始資產（網頁再算每盤增減），另存開盤第一筆當備援
#   - 百點震幅、週三 / 週五時價（BA / BB）取自示範帳戶試算表（或 sample 的每週存檔）；VIX 取自 sample 的每日存檔
# 由 .github/workflows/record-sessions.yml 定時執行（只用 Python 標準函式庫，不需安裝套件）
import csv, io, json, os, re, urllib.request
from datetime import datetime, timedelta, timezone

SHEET_ID  = '1Ysw95KCFw-sHDUntrzsg7zCWPsiAyIIHJ1Yg69pKuKk'
GID       = '103299629'
DEMO_ID   = '1AsY4_MJipaMp_cNLpyeXTpFGnG0FD4vWJu-SDRdvtME'
DEMO_GID  = '1823639969'
SAMPLE    = 'https://joption-tw.github.io/sample/history/'
OUT       = 'data/sessions.json'
TPE       = timezone(timedelta(hours=8))

# 一週 10 盤：(距週三的天數, 盤別) → 第幾盤；示範帳戶試算表每盤的列範圍（同 demo-performance 的 rowRanges）
SLOTS      = [(0, 'N'), (1, 'D'), (1, 'N'), (2, 'D'), (2, 'N'), (5, 'D'), (5, 'N'), (6, 'D'), (6, 'N'), (7, 'D')]
DEMO_ROWS  = [(2, 419), (420, 569), (570, 989), (990, 1139), (1140, 1559), (1560, 1709), (1710, 2129), (2130, 2279), (2280, 2699), (2700, 2849)]


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


def num(v):
    m = re.match(r'\s*(-?[\d,]*\.?\d+)', v or '')
    return float(m.group(1).replace(',', '')) if m else None


def clean_name(name):
    return re.sub(r'\((主|副)\)$', '', name.strip())


def session_of(ts):
    """快照時間 → (盤的日期, 'D'/'N')；收盤後到下一盤開盤前的空檔不算"""
    m = ts.hour * 60 + ts.minute
    if 8 * 60 + 45 <= m <= 13 * 60 + 50: return ts.date(), 'D'
    if m >= 15 * 60:                     return ts.date(), 'N'
    if m <= 5 * 60 + 5:                  return ts.date() - timedelta(days=1), 'N'
    return None


def week_of(date, typ):
    """一週從週三夜盤開始：週三夜盤 = 本週第一盤，週三早盤 = 上週最後一盤"""
    if typ == 'N' and date.weekday() == 2: return date
    back = (date.weekday() - 2) % 7 or 7
    return date - timedelta(days=back)


def session_end(date, typ):
    if typ == 'D': return datetime(date.year, date.month, date.day, 13, 45, tzinfo=TPE)
    d = date + timedelta(days=1)
    return datetime(d.year, d.month, d.day, 5, 0, tzinfo=TPE)


# ── 讀「績效表」裡的所有快照：時間列 → 標題列 → 各帳號 … → 歐大總績效 ──
def read_snapshots():
    rows = list(csv.reader(io.StringIO(get(f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={GID}'))))
    snaps = []
    for i, r in enumerate(rows):
        if len(r) < 16 or not re.match(r'^\d{4}/\d{1,2}/\d{1,2} \d{1,2}:\d{2}:\d{2}$', r[2].strip()): continue
        if i + 1 >= len(rows) or rows[i + 1][2].strip() != '社群暱稱': continue
        ts = datetime.strptime(r[2].strip(), '%Y/%m/%d %H:%M:%S').replace(tzinfo=TPE)
        accounts, total = [], None
        for c in rows[i + 2:i + 32]:
            name = c[2].strip() if len(c) > 13 else ''
            if not name or name == '社群暱稱': break
            # 「歐大總績效(參考)」每筆快照都有：F 欄 = 個人獲利、H 欄 = 眾人獲利（各帳號獲利加總）
            if name.startswith('歐大總績效'):
                total = {'pnl': num(c[7]), 'personal': num(c[5]), 'base': sum(a['base'] or 0 for a in accounts)}
                break
            accounts.append({'name': clean_name(name), 'pnl': num(c[7]), 'base': num(c[13])})
        if total and total['pnl'] is not None and accounts:
            snaps.append({'ts': ts, 'fut': num(r[15]), 'total': total, 'accounts': accounts})
    return snaps


# ── 百點震幅 / BA / BB（同 demo-performance 的算法）──
def swing100(prices, threshold=100):
    valid = [p for p in prices if p is not None]
    if len(valid) < 2: return 0
    total, pivot, hi, lo, trend = 0, valid[0], valid[0], valid[0], 0
    for p in valid[1:]:
        if trend == 0:
            if p >= pivot + threshold:   trend, hi = 1, p
            elif p <= pivot - threshold: trend, lo = -1, p
        elif trend == 1:
            if p > hi: hi = p
            elif p <= hi - threshold: total += hi - pivot; trend, pivot, lo = -1, hi, p
        else:
            if p < lo: lo = p
            elif p >= lo + threshold: total += pivot - lo; trend, pivot, hi = 1, lo, p
    if trend == 1 and hi > pivot + threshold:    total += hi - pivot
    elif trend == -1 and lo < pivot - threshold: total += pivot - lo
    return round(total)


def last_chg(vals, ref=None):
    vals = [v for v in vals if v]
    if not vals: return None
    base = ref if ref else vals[0]
    chg = vals[-1] - base
    return {'last': vals[-1], 'chg': round(chg, 2), 'pct': round(chg / base * 100, 2) if base else 0, 'many': bool(ref) or len(vals) > 1}


def demo_week(week, cache={}):
    """示範帳戶該週的 2 分鐘資料：本週讀試算表，舊週讀 sample 的存檔"""
    if week in cache: return cache[week]
    rows = None
    for url in (f'https://docs.google.com/spreadsheets/d/{DEMO_ID}/export?format=csv&gid={DEMO_GID}', f'{SAMPLE}{week}.csv'):
        try:
            data = [c for c in csv.reader(io.StringIO(get(url)))][1:]
        except Exception as e:
            print('示範帳戶資料讀取失敗：', url, e); continue
        data = [c for c in data if len(c) >= 54]
        start = next((c[1] for c in data if c[8] and c[1]), '')
        if start.replace('/', '-').startswith(week):
            rows = data; break
    cache[week] = rows
    return rows


def in_session(label, typ):
    m = re.search(r'(\d{1,2}):(\d{2})', label or '')
    if not m: return False
    t = int(m.group(1)) * 60 + int(m.group(2))
    return 8 * 60 + 45 <= t <= 13 * 60 + 45 if typ == 'D' else (t >= 15 * 60 or t <= 5 * 60)


def vix_day(date):
    try:
        d = json.loads(get(f'{SAMPLE}vix/{date.strftime("%Y%m%d")}.json'))
    except Exception:
        return None
    vals = [v for t, v in d.get('ticks', []) if '084500' <= str(t).zfill(6) <= '134500']
    return last_chg(vals, (d.get('quote') or {}).get('ref'))


def market(s):
    date = datetime.strptime(s['date'], '%Y-%m-%d').date()
    out = dict(s.get('market') or {})
    rows = demo_week(s['week'])
    if rows:
        a, b = DEMO_ROWS[s['slot']]
        seg = [c for c in rows[a - 2:b - 1] if in_session(c[0], s['type'])]
        if any(num(c[22]) for c in seg):
            out['swing'] = swing100([num(c[22]) for c in seg])
            out['ba'] = last_chg([num(c[52]) for c in seg])
            out['bb'] = last_chg([num(c[53]) for c in seg])
    if s['type'] == 'D' and not out.get('vix'):
        out['vix'] = vix_day(date)
    return out


def main():
    now = datetime.now(TPE)
    try:
        with open(OUT, encoding='utf-8') as f: store = json.load(f)
    except FileNotFoundError:
        store = {'sessions': []}
    by_id = {s['id']: s for s in store['sessions']}

    # 每一盤：收盤前最後一筆（同時間有兩筆時取上面那筆＝較新）與開盤第一筆
    last, first = {}, {}
    for snap in read_snapshots():
        key = session_of(snap['ts'])
        if not key: continue
        if key not in last or snap['ts'] > last[key]['ts']:   last[key] = snap
        if key not in first or snap['ts'] <= first[key]['ts']: first[key] = snap

    for (date, typ), snap in last.items():
        if now < session_end(date, typ) + timedelta(minutes=5): continue   # 還沒收盤
        week = week_of(date, typ)
        slot = SLOTS.index(((date - week).days, typ)) if ((date - week).days, typ) in SLOTS else None
        if slot is None: continue
        sid = f'{date.isoformat()}{typ}'
        old = by_id.get(sid, {})
        at = snap['ts'].strftime('%Y-%m-%d %H:%M:%S')
        if old.get('at', '') > at: continue      # 已存的比較新（快照已被試算表捲掉時不會覆蓋）
        op = first[(date, typ)]
        by_id[sid] = {
            'id': sid, 'week': week.isoformat(), 'slot': slot, 'date': date.isoformat(), 'type': typ,
            'at': at, 'fut': snap['fut'], 'total': snap['total'], 'accounts': snap['accounts'],
            'open': {'at': op['ts'].strftime('%Y-%m-%d %H:%M:%S'), 'total': op['total']['pnl'],
                     'accounts': {a['name']: a['pnl'] for a in op['accounts']}},
            'market': old.get('market'),
        }
        print('存', sid, at, '眾人獲利', snap['total']['pnl'])

    # 行情欄位：近兩週還沒補齊的盤再試一次（VIX 存檔比收盤晚一點才有）
    for s in by_id.values():
        if (now.date() - datetime.strptime(s['date'], '%Y-%m-%d').date()).days > 14: continue
        m = s.get('market') or {}
        if 'swing' in m and (s['type'] == 'N' or m.get('vix')): continue
        s['market'] = market(s)

    sessions = sorted(by_id.values(), key=lambda s: (s['week'], s['slot']))
    if sessions == store['sessions']:
        print('無變動'); return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'updated': now.strftime('%Y-%m-%d %H:%M'), 'sessions': sessions}, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print(f'已寫入 {OUT}（{len(sessions)} 盤）')


if __name__ == '__main__':
    main()
