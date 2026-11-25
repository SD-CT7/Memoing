#!/usr/bin/env python3
"""スプシCSV(タブごと)から times.date を補完する UPDATE SQL を生成する。

使い方:
  python fill_dates.py tracks_rows.csv out.sql シート1.csv シート2.csv ...
ファイル名は「_SSu.csv」「SSu.csv」のようにタブ名(=tracks.abbr)が分かる形にする。
(先頭の _ は無視。取れなければシート内のコース名(C3)で tracks.name と照合)
"""
import csv, re, sys, os
from collections import Counter

tracks_csv, out_sql, *sheets = sys.argv[1:]
tracks = list(csv.DictReader(open(tracks_csv, encoding="utf-8-sig")))
by_abbr = {t["abbr"]: t["key"] for t in tracks}
by_name = {t["name"]: t["key"] for t in tracks}

def q(s): return "'" + s.replace("'", "''") + "'"

rows, warn = [], []
for path in sheets:
    base = os.path.splitext(os.path.basename(path))[0].lstrip("_")
    data = list(csv.reader(open(path, encoding="utf-8-sig")))
    title = next((c.strip() for r in data[:5] for c in r if c.strip()), "")
    key = by_abbr.get(base) or by_name.get(title)
    if not key:
        warn.append(f"[{path}] コースを特定できません (tab='{base}', title='{title}')"); continue
    norm = lambda x: re.sub(r"\s+", "", x).lower()
    hdr = next((i for i, r in enumerate(data)
                if "player" in map(norm, r) and "time" in map(norm, r)), None)
    if hdr is None:
        warn.append(f"[{base}] Player/Time の見出し行が見つからない → タブごとスキップ"); continue
    h = data[hdr]; hn = [norm(x) for x in h]
    if "date" not in hn:
        warn.append(f"[{base}] Date 列が無い(見出し: {[x for x in h if x.strip()]}) → タブごとスキップ"); continue
    ci = {"Player": hn.index("player"), "Time": hn.index("time"), "Date": hn.index("date")}
    seen = Counter()
    for r in data[hdr + 1:]:
        r = r + [""] * (len(h) - len(r))
        player, time, date = (r[ci[k]].strip() for k in ("Player", "Time", "Date"))
        if not player or not time: continue
        if not date:
            warn.append(f"[{base}] {player} {time}: Dateなし → スキップ"); continue
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            warn.append(f"[{base}] {player} {time}: 日付形式が不正 '{date}' → スキップ"); continue
        seen[(player, time)] += 1
        rows.append((key, player, time, date))
    for (p, t), n in seen.items():
        if n > 1: warn.append(f"[{base}] {p} {t} がシート内で重複 ({n}件): 同一日付でなければ要確認")

with open(out_sql, "w", encoding="utf-8") as f:
    f.write("-- times.date をスプシから補完 (date が NULL / 空の行のみ更新)\nBEGIN;\n")
    f.write("UPDATE times AS t SET date = v.date::date\nFROM (VALUES\n")
    f.write(",\n".join(f"  ({q(k)}, {q(p)}, {q(tm)}, {q(d)})" for k, p, tm, d in rows))
    f.write("\n) AS v(track_name, player, time, date)\n")
    f.write("WHERE t.track_name = v.track_name AND t.player = v.player AND t.time = v.time\n")
    f.write("  AND t.date IS NULL;\n-- 件数を確認してから COMMIT\nCOMMIT;\n")
print(f"{len(rows)} 件 → {out_sql}")
for w in warn: print("WARN", w)
