#!/usr/bin/env python3
"""本スプシをxlsxで1回だけダウンロードし、タブごとにCSVへ変換する(1回きりの実行用)。

事前: pip install openpyxl
使い方:
  python fetch_sheets_xlsx.py <スプシID> sheets
  (すでにxlsxを手元に保存済みなら) python fetch_sheets_xlsx.py --file book.xlsx sheets
スプシが「リンクを知っている全員が閲覧可」であること。
タブ名がそのまま <出力先>/<タブ名>.csv になる。
"""
import csv, datetime as dt, os, sys, urllib.request
import openpyxl

args = sys.argv[1:]
if args[0] == "--file":
    xlsx, out_dir = args[1], args[2]
else:
    sheet_id, out_dir = args
    xlsx = "book.xlsx"
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(xlsx, "wb") as f:
        f.write(r.read())
    print("downloaded", xlsx, os.path.getsize(xlsx), "bytes")
os.makedirs(out_dir, exist_ok=True)

def fmt_time(sec):  # 秒 -> m:ss.mmm
    ms = round(sec * 1000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f"{m}:{s:02d}.{ms:03d}"

def cell(v):
    if v is None: return ""
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%d") if v.time() == dt.time(0) else v.isoformat(sep=" ")
    if isinstance(v, dt.date): return v.strftime("%Y-%m-%d")
    if isinstance(v, dt.time):
        return fmt_time(v.hour * 3600 + v.minute * 60 + v.second + v.microsecond / 1e6)
    if isinstance(v, dt.timedelta): return fmt_time(v.total_seconds())
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return str(v).strip()

wb = openpyxl.load_workbook(xlsx, data_only=True)
for ws in wb.worksheets:
    name = ws.title.replace("/", "_")
    with open(os.path.join(out_dir, f"{name}.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        for row in ws.iter_rows(values_only=True):
            w.writerow([cell(v) for v in row])
    print("saved", name)
print(f"\n{len(wb.worksheets)} タブ → {out_dir}/")
