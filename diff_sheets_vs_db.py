#!/usr/bin/env python3
"""スプシとDB(times)の食い違いを一覧にする(読み取り専用・DBは変更しない)。

使い方:
  python diff_sheets_vs_db.py tracks_rows.csv times_full.csv diff_report.csv sheets/*.csv
times_full.csv は times テーブルの全件エクスポート(列: track_name,rank,player,time,date 他)。

出力 diff_report.csv の status:
  OK            track+player+time が一致(日付補完の対象)
  NAME_DIFF     タイム一致・選手名が大小文字/記号だけ違う(表記ゆれ)
  RANK_DIFF_ONLY 選手・タイムは一致するが順位が違う(日付補完には影響なし)
  EDITED        同じ順位で player か time が違う → スプシだけ直された可能性大
  ONLY_SHEET    スプシにあるがDBに該当なし(追加漏れ/選手名の表記ゆれ)
  ONLY_DB       DBにあるがスプシに無い(スプシ側で削除/更新された可能性)
"""
import csv, os, re, sys

tracks_csv, times_csv, out_csv, *sheets = sys.argv[1:]
tracks = list(csv.DictReader(open(tracks_csv, encoding="utf-8-sig")))
by_abbr = {t["abbr"]: t["key"] for t in tracks}
by_name = {t["name"]: t["key"] for t in tracks}
norm = lambda x: re.sub(r"\s+", "", x).lower()

db = {}
for r in csv.DictReader(open(times_csv, encoding="utf-8-sig")):
    if r["track_name"]:
        db.setdefault(r["track_name"], []).append(r)

report, tabs, skipped = [], 0, []
for path in sheets:
    base = os.path.splitext(os.path.basename(path))[0].lstrip("_")
    data = list(csv.reader(open(path, encoding="utf-8-sig")))
    title = next((c.strip() for r in data[:5] for c in r if c.strip()), "")
    key = by_abbr.get(base)  # タブ名=tracks.abbr のみ採用(コース名での推測はしない)
    hdr = next((i for i, r in enumerate(data)
                if "player" in map(norm, r) and "time" in map(norm, r)), None)
    if not key:
        skipped.append(base); continue
    if hdr is None: continue
    tabs += 1
    hn = [norm(x) for x in data[hdr]]
    col = lambda n: hn.index(n) if n in hn else None
    cr, cp, ct, cd = col("rank"), col("player"), col("time"), col("date")
    sheet_rows = []
    for r in data[hdr + 1:]:
        g = lambda c: r[c].strip() if c is not None and c < len(r) else ""
        if g(cp) and g(ct):
            sheet_rows.append(dict(rank=g(cr), player=g(cp), time=g(ct), date=g(cd)))
    dbrows = db.get(key, [])
    used = set()
    def add(status, s=None, d=None):
        report.append(dict(status=status, track=key, tab=base,
            sheet_rank=s and s["rank"], sheet_player=s and s["player"], sheet_time=s and s["time"],
            sheet_date=s and s["date"], db_rank=d and d["rank"], db_player=d and d["player"],
            db_time=d and d["time"], db_id=d and d["id"]))
    left = []
    for s in sheet_rows:  # 1) 完全一致
        i = next((i for i, d in enumerate(dbrows) if i not in used
                  and d["player"] == s["player"] and d["time"] == s["time"]), None)
        if i is None: left.append(s); continue
        used.add(i); add("OK" if dbrows[i]["rank"] == s["rank"] else "RANK_DIFF_ONLY", s, dbrows[i])
    nn = lambda x: re.sub(r"[^0-9a-z]", "", x.lower())
    left1 = []
    for s in left:  # 1b) タイム一致+選手名が大小文字/記号だけ違う → 表記ゆれ
        i = next((i for i, d in enumerate(dbrows) if i not in used
                  and d["time"] == s["time"] and nn(d["player"]) == nn(s["player"])), None)
        if i is None: left1.append(s); continue
        used.add(i); add("NAME_DIFF", s, dbrows[i])
    left = left1
    left2 = []
    for s in left:  # 2) 同順位で中身が違う → 編集された疑い
        i = next((i for i, d in enumerate(dbrows) if i not in used and d["rank"] == s["rank"]), None)
        if i is None: left2.append(s); continue
        used.add(i); add("EDITED", s, dbrows[i])
    for s in left2: add("ONLY_SHEET", s)
    for i, d in enumerate(dbrows):
        if i not in used: add("ONLY_DB", None, d)

cols = ["status","track","tab","sheet_rank","sheet_player","sheet_time","sheet_date",
        "db_rank","db_player","db_time","db_id"]
with open(out_csv, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
    for r in sorted(report, key=lambda r: (r["status"] == "OK", r["track"])):
        w.writerow({c: ("" if r[c] is None else r[c]) for c in cols})
from collections import Counter
print(f"{tabs} タブを比較 / tracks.abbr に無いためスキップ: {len(skipped)} タブ")
for b in skipped: print("  skip:", b)
print(); [print(f"  {k}: {v}") for k, v in sorted(Counter(r['status'] for r in report).items())]
