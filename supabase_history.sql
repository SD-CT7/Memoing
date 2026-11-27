-- ============================================================
-- History機能用 Supabase 設定 (SQL Editor で実行)
-- version: 0 = 現行 / 1以上 = 過去(数字が大きいほど古い)
-- ============================================================

-- 1) version カラムを「必ず入る・既定は0」にしておく
--    (Bot や手入力で version を指定し忘れても現行扱いになる)
alter table public.times alter column version set default 0;
update public.times set version = 0 where version is null;
alter table public.times alter column version set not null;

-- 2) 速度用インデックス
create index if not exists times_cat_track_ver_idx
  on public.times (category, track_name, version);

-- 3) 過去バージョンがあるコースの一覧ビュー (サイトがこれを見て History ボタンを出す)
create or replace view public.track_versions as
select distinct track_name, version
from public.times
where category = 'General' and version > 0;

grant select on public.track_versions to anon, authenticated;

-- ============================================================
-- コースがアップデートされた時の手順 (例: concord_town)
-- ============================================================
-- begin;
--   -- 今の記録を1つ古くする (0→1, 1→2, ...)
--   update public.times
--      set version = version + 1
--    where category = 'General' and track_name = 'concord_town';
--   -- そのあと新しい記録を version = 0 で insert / 取り込み
-- commit;

-- ============================================================
-- 確認事項
-- ============================================================
-- * times に unique 制約がある場合 (例: track_name+rank, track_name+player) は
--   version を含める必要があります。含めないと過去記録と衝突して insert/upsert が失敗します。
--     \d public.times   -- 制約・インデックスを確認
-- * flap/mission/shroomless のビューが times を参照している場合は、
--   ビュー側にも where version = 0 を足してください (足さないと過去記録が混ざります)。
