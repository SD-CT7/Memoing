/**
 * CTGP-7 Leaderboard: Discord CDN リンク自動リフレッシュャー
 *
 * Supabaseの `times` テーブルにある期限切れ(または期限切れ間近)の
 * Discord CDN添付ファイルリンクを、Discordの公式「Refresh Attachment URLs」
 * エンドポイントを使ってまとめて更新し、Supabaseに書き戻す。
 * さらに、Apps ScriptのWeb App経由でスプレッドシート側のProof列も更新することで、
 * 「スプレッドシートに古いリンクが残ったままになり、再編集のたびに巻き戻る」問題を防ぐ。
 *
 * 定期実行(cron)される他、手動確認用にHTTPからも起動できる。
 *
 * 必要なシークレット(wrangler secret put で設定):
 *   - DISCORD_BOT_TOKEN         : 専用Botのトークン(このリフレッシュ専用に分けたBot)
 *   - SUPABASE_SERVICE_KEY      : SupabaseのService Role Key(書き込み権限が必要)
 *   - APPS_SCRIPT_WEBHOOK_SECRET: Apps Script側のWEBHOOK_SECRETと同じ値
 *
 * 必要な環境変数(wrangler.tomlの [vars] で設定。機密ではないので平文でOK):
 *   - SUPABASE_URL              : 例 https://xxxxx.supabase.co
 *   - APPS_SCRIPT_WEBHOOK_URL   : Apps ScriptをWeb Appとしてデプロイした際のURL
 *
 * APPS_SCRIPT_WEBHOOK_URL / APPS_SCRIPT_WEBHOOK_SECRET が未設定の場合、
 * スプレッドシート側の同期はスキップされ、Supabaseの更新のみ行われる(後方互換)。
 */

const DISCORD_REFRESH_ENDPOINT = 'https://discord.com/api/v10/attachments/refresh-urls';
const DISCORD_BATCH_SIZE = 50; // Discord側の1リクエストあたりの上限

export default {
  // cronトリガーから定期実行される
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRefresh(env));
  },

  // 手動実行・動作確認用
  // POST: 常に実行
  // GET: ?key=TRIGGER_KEY を付けてアクセスすればブラウザから実行可能(リンクを踏むだけでOK)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isAuthorizedGet =
      request.method === 'GET' &&
      env.TRIGGER_KEY &&
      url.searchParams.get('key') === env.TRIGGER_KEY;

    if (request.method === 'POST' || isAuthorizedGet) {
      try {
        const result = await runRefresh(env);
        return new Response(JSON.stringify(result, null, 2), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response(
      'CTGP-7 Discord link refresher.\nPOST、または ?key=TRIGGER_KEY 付きのGETで手動実行します。普段はcronで自動実行されます。',
      { status: 200 }
    );
  },
};

async function runRefresh(env) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, DISCORD_BOT_TOKEN } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DISCORD_BOT_TOKEN) {
    throw new Error('必要な環境変数/シークレットが不足しています(SUPABASE_URL / SUPABASE_SERVICE_KEY / DISCORD_BOT_TOKEN)');
  }

  const rows = await fetchDiscordRows(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(`Discord CDNリンクを含む行: ${rows.length}件`);

  if (rows.length === 0) {
    return { checked: 0, uniqueUrls: 0, refreshed: 0, failed: 0 };
  }

  // 同じURLを複数行が参照していることがあるので、URL単位でまとめる
  const urlToIds = new Map();
  const idToRowInfo = new Map(); // id -> { track_name, rank } (スプレッドシート側の更新に使う)
  for (const row of rows) {
    if (!row.video) continue;
    if (!urlToIds.has(row.video)) urlToIds.set(row.video, []);
    urlToIds.get(row.video).push(row.id);
    idToRowInfo.set(row.id, { track_name: row.track_name, rank: row.rank });
  }
  const uniqueUrls = [...urlToIds.keys()];

  let failedBatches = 0;
  const errorSamples = [];
  const pendingUpdates = []; // { id, video } をここに溜めて最後にまとめて書き込む

  for (let i = 0; i < uniqueUrls.length; i += DISCORD_BATCH_SIZE) {
    const batch = uniqueUrls.slice(i, i + DISCORD_BATCH_SIZE);
    let refreshedPairs;
    try {
      refreshedPairs = await refreshBatch(batch, DISCORD_BOT_TOKEN);
    } catch (err) {
      console.error(`バッチ ${i / DISCORD_BATCH_SIZE + 1} でエラー: ${err}`);
      failedBatches++;
      if (errorSamples.length < 5) errorSamples.push(String(err));
      continue;
    } finally {
      // 連続リクエストでレート制限を踏みにくくするため、バッチ間に少し間隔を空ける
      if (i + DISCORD_BATCH_SIZE < uniqueUrls.length) await sleep(500);
    }

    for (const { original, refreshed } of refreshedPairs) {
      if (!refreshed || refreshed === original) continue; // 変化なし
      const ids = urlToIds.get(original);
      if (!ids || ids.length === 0) continue;
      for (const id of ids) {
        pendingUpdates.push({ id, video: refreshed });
      }
    }
  }

  // ここまではSupabaseへ一切書き込んでいない。最後にまとめて1回のリクエストで書き込む
  let refreshedCount = 0;
  if (pendingUpdates.length > 0) {
    try {
      await bulkUpdateViaRpc(SUPABASE_URL, SUPABASE_SERVICE_KEY, pendingUpdates);
      refreshedCount = pendingUpdates.length;
    } catch (err) {
      console.error(`Supabase一括更新失敗: ${err}`);
      if (errorSamples.length < 5) errorSamples.push(String(err));
    }
  }

  // スプレッドシート側のProof列も同じ内容に更新する(ここをやらないと、
  // 次にそのトラックが編集されたタイミングで古いリンクにSupabaseが巻き戻ってしまう)
  let sheetSyncStatus = 'skipped';
  if (pendingUpdates.length > 0 && env.APPS_SCRIPT_WEBHOOK_URL && env.APPS_SCRIPT_WEBHOOK_SECRET) {
    const sheetUpdates = pendingUpdates
      .map((u) => {
        const info = idToRowInfo.get(u.id);
        if (!info) return null;
        return { trackName: info.track_name, rank: info.rank, newUrl: u.video };
      })
      .filter(Boolean);

    try {
      await notifyAppsScript(env.APPS_SCRIPT_WEBHOOK_URL, env.APPS_SCRIPT_WEBHOOK_SECRET, sheetUpdates);
      sheetSyncStatus = `ok (${sheetUpdates.length}件)`;
    } catch (err) {
      console.error(`スプレッドシート同期失敗: ${err}`);
      sheetSyncStatus = `failed: ${err}`;
      if (errorSamples.length < 5) errorSamples.push(String(err));
    }
  }

  const result = {
    checked: rows.length,
    uniqueUrls: uniqueUrls.length,
    refreshed: refreshedCount,
    failedBatches,
    sheetSyncStatus,
    errorSamples,
  };
  console.log('完了:', JSON.stringify(result));
  return result;
}

// Supabaseから video列にdiscordの文字列を含む行を取得(id, videoのみ)
async function fetchDiscordRows(supabaseUrl, serviceKey) {
  const url = `${supabaseUrl}/rest/v1/times?select=id,video,track_name,rank&video=ilike.*discord*`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase取得失敗: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Discordの Refresh Attachment URLs エンドポイントを叩く(1回最大50件)
// 429(レート制限)を受けたら Retry-After 分待って自動リトライする
async function refreshBatch(urls, botToken, retriesLeft = 3) {
  const res = await fetch(DISCORD_REFRESH_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ attachment_urls: urls }),
  });

  if (res.status === 429) {
    if (retriesLeft <= 0) {
      throw new Error(`Discord APIレート制限: リトライ上限に達しました`);
    }
    const retryAfterHeader = res.headers.get('Retry-After') || res.headers.get('retry-after');
    // ヘッダが無い場合のフォールバックとして少し長めに待つ
    const waitMs = retryAfterHeader ? Math.ceil(parseFloat(retryAfterHeader) * 1000) + 200 : 3000;
    console.log(`429を受信。${waitMs}ms待ってリトライします(残り${retriesLeft}回)`);
    await sleep(waitMs);
    return refreshBatch(urls, botToken, retriesLeft - 1);
  }

  if (!res.ok) {
    throw new Error(`Discord API失敗: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.refreshed_urls || [];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 同じURLを持つ行をまとめて更新(id IN (...))
// Apps ScriptのWeb App(doPost)を呼び出し、スプレッドシートのProof列も更新してもらう
async function notifyAppsScript(webhookUrl, secret, updates) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, updates }),
    redirect: 'follow', // Apps ScriptのWeb Appはリダイレクトすることがあるため
  });
  if (!res.ok) {
    throw new Error(`Apps Script Webhook失敗: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// { id, video } の配列をまとめて1回のリクエストで書き込む
// idがGENERATED ALWAYS(自動採番)の場合、PostgRESTの通常のupsert(INSERT ON CONFLICT)は
// idを明示指定できず失敗するため、Supabase側に用意したRPC関数(本物のUPDATE文)を呼び出す。
// ※事前に supabase_setup.sql をSupabaseのSQL Editorで1回実行しておく必要があります。
async function bulkUpdateViaRpc(supabaseUrl, serviceKey, updates) {
  const url = `${supabaseUrl}/rest/v1/rpc/bulk_update_video_urls`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ updates }), // [{ id, video }, { id, video }, ...]
  });
  if (!res.ok) {
    throw new Error(`Supabase一括更新失敗: ${res.status} ${await res.text()}`);
  }
}
