#!/usr/bin/env python3
"""本スプシの全タブをCSVとして保存する(1回きりの実行用・標準ライブラリのみ)。

使い方:
  python fetch_sheets.py <スプシID> tracks_rows.csv out_dir

スプシID は URL の https://docs.google.com/spreadsheets/d/<ここ>/edit の部分。
スプシが「リンクを知っている全員が閲覧可」であること(非公開だと取得できません)。
タブ名 = tracks.abbr なので、abbr を順に指定して1タブずつ取得し、
<out_dir>/<abbr>.csv に保存します。
"""
import csv, os, sys, time, urllib.parse, urllib.request, io

sheet_id, tracks_csv, out_dir = sys.argv[1:4]
os.makedirs(out_dir, exist_ok=True)
tracks = list(csv.DictReader(open(tracks_csv, encoding="utf-8-sig")))

def fetch(tab):
    qs = urllib.parse.urlencode({"tqx": "out:csv", "sheet": tab, "headers": 0})
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?{qs}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")

def title_of(text):
    # シート上部の最初の非空セル(コース名)
    for row in list(csv.reader(io.StringIO(text)))[:6]:
        for c in row:
            if c.strip():
                return c.strip()
    return ""

ok, bad = 0, []
for t in tracks:
    abbr, name = t["abbr"], t["name"]
    try:
        text = fetch(abbr)
    except Exception as e:
        bad.append((abbr, f"取得失敗: {e}")); continue
    # 存在しないタブ名だと Google は黙って先頭タブを返すことがあるので、
    # コース名とヘッダ行(Player/Time)で本物かを確認する
    title = title_of(text)
    if "Player" not in text or "Time" not in text:
        bad.append((abbr, "Player/Time 見出しが無い(タブが存在しない可能性)")); continue
    if title.lower() != name.lower():
        bad.append((abbr, f"コース名不一致: シート上='{title}' / tracks='{name}' → 保存はするので要確認"))
    with open(os.path.join(out_dir, f"{abbr}.csv"), "w", encoding="utf-8", newline="") as f:
        f.write(text)
    ok += 1
    print("saved", abbr)
    time.sleep(1)  # 負荷をかけない

print(f"\n保存 {ok} / {len(tracks)} タブ")
for a, m in bad:
    print("WARN", a, m)
