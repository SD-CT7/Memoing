// ==========================================
// ctgp7-discord-bot — フル実装
// /rsubmit: 返信元メッセージから 3lap shroom の記録を自動提出
// ==========================================
//
// 🔑 必要なSecrets（Settings → Variables and Secrets）:
//   DISCORD_PUBLIC_KEY      Developer PortalのPublic Key
//   DISCORD_APPLICATION_ID  Developer PortalのApplication ID
//   DISCORD_BOT_TOKEN       Botトークン
//   GAS_URL                 GAS WebアプリのURL (.../exec)
//   GAS_SHARED_SECRET       GAS側 WORKER_SHARED_SECRET と同じ文字列
//
// 🔧 必要な環境変数（コース辞書を Supabase の tracks テーブルから読むため）:
//   SUPABASE_URL            例: https://xxxx.supabase.co
//   SUPABASE_ANON_KEY       公開(anon)キー。tracks は誰でも読める設定です

// ==========================================
// 🏁 コース辞書（Supabase の tracks テーブル）
// ==========================================
// Worker は呼び出しごとに状態が消えることがあるので、メモリに5分だけキャッシュする。
// 取得に失敗しても、古いキャッシュが残っていればそれを使う。
let tracksCache = null; // { at, list, searchList, byLower }
const TRACKS_TTL_MS = 5 * 60 * 1000;

async function loadTracks(env) {
  if (tracksCache && Date.now() - tracksCache.at < TRACKS_TTL_MS) return tracksCache;
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/tracks?select=key,abbr,name,aliases&active=eq.true&order=sort_no.asc&limit=1000`,
      { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) throw new Error(`tracks fetch failed: HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) throw new Error("tracks is empty");

    // 略称・正式名・別名の全てからヒットさせる（長い文字列から先にマッチさせて誤検出を防ぐ）
    const searchList = list
      .flatMap((t) => [
        { keyword: t.name, abbr: t.abbr },
        { keyword: t.abbr, abbr: t.abbr },
        ...(t.aliases || []).map((a) => ({ keyword: a, abbr: t.abbr })),
      ])
      .sort((a, b) => b.keyword.length - a.keyword.length);

    // 手入力(正式名/略称/別名)の検証用
    const byLower = new Map();
    for (const t of list) {
      byLower.set(t.abbr.toLowerCase(), t);
      byLower.set(t.name.toLowerCase(), t);
      for (const a of t.aliases || []) byLower.set(String(a).toLowerCase(), t);
    }
    tracksCache = { at: Date.now(), list, searchList, byLower };
  } catch (e) {
    console.error("loadTracks error:", e);
    if (!tracksCache) throw e;
    tracksCache.at = Date.now() - TRACKS_TTL_MS + 30 * 1000; // 古い辞書で続行し、30秒後に再試行
  }
  return tracksCache;
}

// ==========================================
// 🔏 署名検証
// ==========================================
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function verifyDiscordRequest(request, publicKeyHex) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  const body = await request.clone().text();

  if (!signature || !timestamp) return { valid: false, body };

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "NODE-ED25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body)
    );
    return { valid, body };
  } catch (err) {
    console.error("署名検証エラー: " + err.message);
    return { valid: false, body };
  }
}

// ==========================================
// 🔍 タイム検出 mm:ss.SSS または ss.SSS
// ==========================================
function extractTime(text) {
  if (!text) return null;
  // mm:ss.SSS 形式
  const match1 = text.match(/\b(\d{1,2}):([0-5]\d)\.(\d{3})\b/);
  if (match1) return match1[0];
  // ss.SSS 形式（例: 12.345）
  const match2 = text.match(/\b(\d{1,2})\.(\d{3})\b/);
  return match2 ? match2[0] : null;
}

// ==========================================
// 🔍 コース検出（メッセージ本文 → 失敗時はYouTubeタイトル）
// ==========================================
function extractTrack(text, searchList) {
  if (!text) return null;
  for (const { keyword, abbr } of searchList) {
    // 単語境界を意識した緩めの検索（大文字小文字区別なし）
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i");
    if (re.test(text)) return abbr;
  }
  return null;
}

// ==========================================
// 🔗 メッセージ内のURL抽出
// ==========================================
function extractUrl(text) {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ==========================================
// 📺 YouTube oEmbedからタイトル取得（APIキー不要）
// ==========================================
async function getYouTubeTitle(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (!res.ok) return null;
    const data = await res.json();
    return data.title || null;
  } catch {
    return null;
  }
}

// ==========================================
// 💬 直近メッセージ履歴から対象メッセージを取得
//    通常: コマンド実行者(=対象プレイヤー)自身の投稿 かつ URLを含む
//    as使用時: 送信者を問わず、直近5件で一番新しいURL付きメッセージ
//    直近5件の中で一番新しいものを採用
// ==========================================
async function fetchRecentTargetMessage(channelId, userId, botToken, ignoreAuthor = false) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages?limit=5`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );
  if (!res.ok) return null;

  const messages = await res.json(); // 新しい順に並んでいる
  for (const msg of messages) {
    const authorMatches = ignoreAuthor || msg.author?.id === userId;
    if (authorMatches && extractUrl(msg.content)) {
      return msg; // 一番新しい該当メッセージ
    }
  }
  return null;
}

// ==========================================
// 🛡️ スタッフ確認（GAS経由）
// ==========================================
async function verifyStaff(discordId, env) {
  const res = await fetch(env.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "discordVerifyStaff",
      secret: env.GAS_SHARED_SECRET,
      discordId,
    }),
  });
  if (!res.ok) return { success: false, message: "GAS request failed" };
  return await res.json();
}

// ==========================================
// 🧑 Discord ID → Player_Name (GAS経由)
// ==========================================
async function lookupPlayerName(discordId, env) {
  const res = await fetch(env.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "discordLookup",
      secret: env.GAS_SHARED_SECRET,
      discordId,
    }),
  });
  if (!res.ok) return { success: false, message: "GAS request failed" };
  return await res.json();
}

// ==========================================
// 📨 Discordへ返信（Interaction応答）
// ==========================================
function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
  });
}

function embedResponse(embed) {
  return jsonResponse({ type: 4, data: { embeds: [embed] } });
}

function errorEmbed(description) {
  return {
    color: 0xed4245, // 赤
    title: "❌ Submission Failed",
    description,
  };
}

// ==========================================
// 📝 GASへ記録を提出（Submissionsシートに書き込んでもらう）
// ==========================================
async function submitRecordToGAS(discordId, track, time, proof, env, autoApprove = false, category = "3lap shroom") {
  const res = await fetch(env.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "discordSubmit",
      secret: env.GAS_SHARED_SECRET,
      discordId,
      track,
      category,
      time,
      proof,
      autoApprove,
    }),
  });
  if (!res.ok) return { success: false, message: "GAS submit request failed" };
  return await res.json();
}

// ==========================================
// 🔗 メッセージリンクからIDを抽出して取得
// ==========================================
function parseMessageLink(link) {
  // https://discord.com/channels/{guild}/{channel}/{message}
  const match = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

async function fetchMessageById(channelId, messageId, botToken) {
  const res = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );
  if (!res.ok) return null;
  return await res.json();
}

// Botが送ったRecord Submitted Embedからフィールドを抽出
function parseSubmissionEmbed(message) {
  const embed = message.embeds?.[0];
  if (!embed || embed.title !== "✅ Record Submitted") return null;

  const fields = {};
  for (const f of embed.fields || []) {
    fields[f.name] = f.value;
  }
  return {
    player: fields["Player"],
    track: fields["Track"],
    time: fields["Time"],
    rank: fields["Rank"] || null,
    category: fields["Category"] || "3lap shroom",
    proof: fields["Proof"],
  };
}

// ==========================================
// ✅ GASへ承認をリクエスト
// ==========================================
async function approveRecordOnGAS(discordId, player, track, time, proof, env) {
  const res = await fetch(env.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "discordApprove",
      secret: env.GAS_SHARED_SECRET,
      discordId,
      player,
      track,
      time,
      proof,
    }),
  });
  if (!res.ok) return { success: false, message: "GAS approve request failed" };
  return await res.json();
}

// ==========================================
// 🏆 ランキングマイルストーン設定
// ==========================================
const ROLE_IDS = {
  "WR Holder": "773829394296340501",
  "Top 5":     "1309501077540049128",
  "Top 10":    "1309501178941280266",
  "Top 20":    "1309501801384640653",
  "Top 30":    "1309501853678964757",
  "Top 40":    "1309502067571953734",
  "Top 50":    "1309502107199737856",
  "Top 50+":   "1309502302192664637",
};

// ランク → ロール名のマッピング
function getRoleName(rank) {
  if (rank === 1)        return "Top 5";   // Top 5ロールが最高位（1stロールなし）
  if (rank <= 5)         return "Top 5";
  if (rank <= 10)        return "Top 10";
  if (rank <= 20)        return "Top 20";
  if (rank <= 30)        return "Top 30";
  if (rank <= 40)        return "Top 40";
  if (rank <= 50)        return "Top 50";
  return "Top 50+";
}

// マイルストーン → アナウンスメッセージ
function getMilestoneMessage(milestone, playerMention) {
  switch (milestone) {
    case "new":
      return `Welcome to leaderboard ${playerMention}!\nYou have entered the leaderboard just now!\nKeep it up!`;
    case 50:
      return `Nice work ${playerMention}!\nYou have reached the Top 50 on the leaderboard!`;
    case 40:
      return `Nice work, ${playerMention}!\nYou've climbed into the Top 40!`;
    case 30:
      return `Great work, ${playerMention}!\nYou've climbed to the Top 30!`;
    case 20:
      return `Well done, ${playerMention}!\nYou've made the Top 20!`;
    case 10:
      return `Great job, ${playerMention}!\nYou're now in the Top 10!`;
    case 5:
      return `Congratulations, ${playerMention}!\nYou broke into the Top 5!`;
    case 1:
      return `Congratulations, ${playerMention}!\nYou're now 1st place. Absolutely insane!`;
    default:
      return null;
  }
}

// BKTアナウンスメッセージ
function getBKTMessage(playerMention) {
  return `Congratulations, ${playerMention}!!\nYou got a wonderful BKT!!\nKeep your Best!`;
}

// Discord_Dictionary から PlayerName → Discord ID の逆引き辞書を作る（GAS経由）
async function getPlayerToDiscordIdMap(env) {
  const res = await fetch(env.GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "discordGetAllPlayers",
      secret: env.GAS_SHARED_SECRET,
    }),
  });
  if (!res.ok) return {};
  const data = await res.json();
  return data.players || {};
}

// ロールを付与
async function addRole(guildId, userId, roleId, botToken) {
  await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    { method: "PUT", headers: { Authorization: `Bot ${botToken}` } }
  );
}

// ロールを削除
async function removeRole(guildId, userId, roleId, botToken) {
  await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    { method: "DELETE", headers: { Authorization: `Bot ${botToken}` } }
  );
}

// メンバーの現在のロールを取得
async function getMemberRoles(guildId, userId, botToken) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.roles || [];
}

// ランキングロールを整理（古いロールを削除して新しいロールを付与）
async function updateRankingRole(guildId, userId, newRoleName, botToken) {
  const rankRoleNames = ["Top 5", "Top 10", "Top 20", "Top 30", "Top 40", "Top 50", "Top 50+"];
  const currentRoles = await getMemberRoles(guildId, userId, botToken);

  // 古いランキングロールを削除
  for (const roleName of rankRoleNames) {
    const roleId = ROLE_IDS[roleName];
    if (roleId && currentRoles.includes(roleId) && roleName !== newRoleName) {
      await removeRole(guildId, userId, roleId, botToken);
    }
  }

  // 新しいロールを付与
  if (newRoleName && ROLE_IDS[newRoleName]) {
    await addRole(guildId, userId, ROLE_IDS[newRoleName], botToken);
  }
}

// アナウンスチャンネルにメッセージ送信
async function sendAnnouncement(channelId, content, botToken) {
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
}

// ==========================================
// 🏆 マイルストームチェックをGASトリガーにスケジュール
// ==========================================
async function checkAndAnnounceRankingMilestones(env, approvedSubmissions) {
  try {
    // GAS側に「1分後にマイルストームチェックを実行して」と投げるだけ
    await fetch(env.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "scheduleMilestoneCheck",
        secret: env.GAS_SHARED_SECRET,
        submissions: (approvedSubmissions || []).filter(s => s.category === "3lap shroom"),
      }),
    });
  } catch (e) {
    console.error("checkAndAnnounceRankingMilestones error:", e.message);
  }
}

// ==========================================
// 🔧 /setup-roles エンドポイント（グループ別・Worker側で処理）
// ==========================================
const GROUP_RANGES = {
  "top5":  { min: 1,  max: 5 },
  "top10": { min: 6,  max: 10 },
  "top20": { min: 11, max: 20 },
  "top30": { min: 21, max: 30 },
  "top40": { min: 31, max: 40 },
  "top50": { min: 41, max: 50 },
  "top51": { min: 51, max: Infinity },
};

async function handleSetupRoles(env, group) {
  const range = GROUP_RANGES[group];
  if (!range) {
    return new Response(
      `❌ Invalid group: ${group}\nUse: top5 / top10 / top20 / top30 / top40 / top50 / top51`,
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  try {
    // ① CalcシートのスナップショットをGAS_RANKING_URLから取得
    const snapshotRes = await fetch(env.GAS_RANKING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getSnapshot" }),
    });
    const snapshotData = await snapshotRes.json();
    const snapshot = snapshotData.snapshot || {};

    // ② PlayerName → Discord ID の逆引き辞書を取得
    const playerToDiscordId = await getPlayerToDiscordIdMap(env);
    const guildId = env.DISCORD_GUILD_ID;

    let processed = 0;
    let skipped = 0;
    const log = [];

    for (const [playerName, rank] of Object.entries(snapshot)) {
      // ランク範囲フィルター
      if (rank < range.min || rank > range.max) continue;

      const discordId = playerToDiscordId[playerName];
      if (!discordId) { skipped++; log.push(`⏭ ${playerName} (no Discord ID)`); continue; }

      // ロール更新
      const newRoleName = getRoleName(rank);
      await updateRankingRole(guildId, discordId, newRoleName, env.DISCORD_BOT_TOKEN);

      // アナウンスメッセージ送信
      const milestone = rank <= 5 ? 5 : rank <= 10 ? 10 : rank <= 20 ? 20 :
                        rank <= 30 ? 30 : rank <= 40 ? 40 : rank <= 50 ? 50 : "new";
      const msg = getMilestoneMessage(milestone, `<@${discordId}>`);
      if (msg) await sendAnnouncement(env.ANNOUNCE_CHANNEL_ID, msg, env.DISCORD_BOT_TOKEN);

      log.push(`✅ ${playerName} → ${newRoleName} (rank ${rank})`);
      processed++;
    }

    return new Response(
      `✅ Setup complete! [${group}]\nProcessed: ${processed}\nSkipped: ${skipped}\n\n${log.join("\n")}`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  } catch (e) {
    return new Response(`❌ Error: ${e.message}`, { status: 500 });
  }
}

// ==========================================
// 🗑️ /removeerror 本体ロジック
// ==========================================
async function handleRemoveError(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;

  // スタッフ確認
  const staffCheck = await verifyStaff(userId, env);
  if (!staffCheck.success) return;

  const opts = {};
  for (const opt of interaction.data.options || []) {
    opts[opt.name] = opt.value;
  }

  const parsed = parseMessageLink(opts.message_link);
  if (!parsed) return;

  // メッセージを取得してBot自身のメッセージか確認
  const message = await fetchMessageById(parsed.channelId, parsed.messageId, env.DISCORD_BOT_TOKEN);
  if (!message) return;

  // Bot自身のメッセージでなければ削除しない
  const botUser = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  }).then((r) => r.json());

  if (message.author?.id !== botUser.id) return;

  // 削除実行
  await fetch(
    `https://discord.com/api/v10/channels/${parsed.channelId}/messages/${parsed.messageId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    }
  );
}

// フランス時間（Europe/Paris）でYYYY-MM-DD形式の日付を返す
function getParisDate() {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()).split("/").reverse().join("-"); // DD/MM/YYYY → YYYY-MM-DD
}

// 承認ログをチャンネルに投稿
async function postApprovalLog(submission, env) {
  const date = getParisDate();
  const category = submission.category || "3lap shroom";
  const isDefault = category === "3lap shroom";

  // フォーマット: [Track] ([Category]) [Time] [Player] [Date] [Proof]
  const line = isDefault
    ? `${submission.track} ${submission.time} ${submission.player} ${date} ${submission.proof}`
    : `${submission.track} ${category} ${submission.time} ${submission.player} ${date} ${submission.proof}`;

  await fetch(`https://discord.com/api/v10/channels/${env.LOG_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: line }),
  });
}

// ==========================================
// 🚀 /approve 1件分の処理
//    成功: { ok: true, summaryLine, channelId, messageId, updatedEmbed }
//    失敗: { ok: false, summaryLine }
// ==========================================
async function approveOneLink(link, userId, env) {
  const parsed = link ? parseMessageLink(link) : null;
  if (!parsed) {
    return { ok: false, summaryLine: `❌ Invalid message link: ${link}` };
  }

  const message = await fetchMessageById(parsed.channelId, parsed.messageId, env.DISCORD_BOT_TOKEN);
  if (!message) {
    return { ok: false, summaryLine: `❌ Could not find message for: ${link}` };
  }

  const submission = parseSubmissionEmbed(message);
  if (!submission) {
    return { ok: false, summaryLine: `❌ Not a valid Record Submitted Embed: ${link}` };
  }

  const result = await approveRecordOnGAS(
    userId,
    submission.player,
    submission.track,
    submission.time,
    submission.proof,
    env
  );

  if (!result.success) {
    return { ok: false, summaryLine: `❌ ${submission.player} (${submission.track}): ${result.message}` };
  }

  const updatedEmbed = {
    color: 0x57f287, // 緑
    title: "✅ Record Approved",
    fields: [
      { name: "Player", value: submission.player, inline: true },
      { name: "Track", value: submission.track, inline: true },
      { name: "Time", value: submission.time, inline: true },
      ...(submission.rank ? [{ name: "Rank", value: submission.rank, inline: true }] : []),
      { name: "Category", value: submission.category, inline: true },
      { name: "Proof", value: submission.proof, inline: false },
    ],
    footer: { text: `✅ Approved by ${result.approvedBy}` },
  };

  // 承認元のEmbedを緑に更新
  await fetch(
    `https://discord.com/api/v10/channels/${parsed.channelId}/messages/${parsed.messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ embeds: [updatedEmbed] }),
    }
  );

  // 承認ログをチャンネルに投稿
  await postApprovalLog(submission, env);

  return {
    ok: true,
    summaryLine: `✅ ${submission.player} (${submission.track}, ${submission.time})`,
    submission: submission,
  };
}

// ==========================================
// 🚀 /approve 本体ロジック（最大3件まで一括承認）
// ==========================================
async function handleApprove(interaction, env) {
  const userId = interaction.member?.user?.id || interaction.user?.id;

  const opts = {};
  for (const opt of interaction.data.options || []) {
    opts[opt.name] = opt.value;
  }

  const links = [opts.message_link, opts.message_link_2, opts.message_link_3].filter(Boolean);

  if (links.length === 0) {
    return errorEmbed("Please provide at least one message link.");
  }

  const results = [];
  for (const link of links) {
    // 1件ずつ順番に処理（同時実行による重複承認を避けるため）
    const r = await approveOneLink(link, userId, env);
    results.push(r);
  }

  const anyAuthError = results.find(
    (r) => !r.ok && r.summaryLine.includes("Only staff members")
  );
  if (anyAuthError) {
    return errorEmbed("Only staff members can use /approve.");
  }

  const allOk = results.every((r) => r.ok);
  const summary = results.map((r) => r.summaryLine).join("\n");

  // 3lap shroomで承認成功した記録のみ抽出（マイルストームチェック用）
  const approvedSubmissions = results
    .filter((r) => r.ok && r.submission && r.submission.category === "3lap shroom")
    .map((r) => r.submission);

  return {
    embed: {
      color: allOk ? 0x57f287 : 0xed4245,
      title: allOk ? "✅ Records Approved" : "⚠️ Approval Results",
      description: summary,
    },
    approvedSubmissions,
  };
}

// 数字を序数（1st, 2nd, 3rd, 4th...）に変換
function toOrdinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ==========================================
// 🚀 /rsubmit 本体ロジック
// ==========================================
async function handleRsubmit(interaction, env) {
  const tracks = await loadTracks(env);
  const channelId = interaction.channel_id;
  const executorId = interaction.member?.user?.id || interaction.user?.id;

  // 引数の取得
  const opts = {};
  for (const opt of interaction.data.options || []) {
    opts[opt.name] = opt.value;
  }
  const category = opts.category || "3lap shroom";

  // ① "as" 指定がある場合はスタッフ確認をしてから対象ユーザーを切り替える
  let targetUserId = executorId;
  if (opts.as) {
    const staffCheck = await verifyStaff(executorId, env);
    if (!staffCheck.success) {
      return errorEmbed("Only staff members can use the `as` option to submit on behalf of another player.");
    }
    targetUserId = opts.as;
  }

  // ② 直近5件から「対象ユーザー」のURL付きメッセージを探す（proof指定時はスキップ）
  let url = opts.proof || null;
  let time = null;
  let track = null;

  if (!url) {
    const refMessage = await fetchRecentTargetMessage(
      channelId,
      targetUserId,
      env.DISCORD_BOT_TOKEN,
      !!opts.as // as使用時は送信者を問わない
    );

    if (!refMessage) {
      return { embed: errorEmbed(
          (opts.as
            ? "Couldn't find a recent message with a URL from that player in the last 5 messages.\n"
            : "Couldn't find a recent message with a URL from you in the last 5 messages.\n") +
            "Please post the proof link first, then run /rsubmit."
        ), autoApprovedSubmission: null };
    }

    const messageText = refMessage.content || "";
    url = extractUrl(messageText);

    // ③ タイム検出（メッセージ本文 → YouTubeタイトル）
    time = extractTime(messageText);
    track = extractTrack(messageText, tracks.searchList);

    if ((!time || !track) && url && /youtu\.?be/i.test(url)) {
      const youtubeTitle = await getYouTubeTitle(url);
      if (youtubeTitle) {
        if (!time) time = extractTime(youtubeTitle);
        if (!track) track = extractTrack(youtubeTitle, tracks.searchList);
      }
    }
  }

  // 手動入力オプションがあれば優先（バリデーション付き）
  if (opts.track) {
    const matched = tracks.byLower.get(String(opts.track).trim().toLowerCase());
    if (!matched) {
      return { embed: errorEmbed(`Invalid track name: \`${opts.track}\`\nPlease check the track abbreviation (e.g. \`CT\`, \`N64 MR\`, \`GCN MaC\`).`), autoApprovedSubmission: null };
    }
    // フルネームが入力された場合は略称に変換
    track = matched.abbr;
  }
  if (opts.time) {
    if (!/^(\d{1,2}:[0-5]\d\.\d{3}|\d{1,2}\.\d{3})$/.test(opts.time)) {
      return { embed: errorEmbed(`Invalid time format: \`${opts.time}\`\nPlease use \`mm:ss.SSS\` or \`ss.SSS\` (e.g. \`1:23.456\` or \`12.345\`).`), autoApprovedSubmission: null };
    }
    time = opts.time;
  }

  // ④ 不足項目チェック
  const missing = [];
  if (!track) missing.push("track");
  if (!time) missing.push("time");
  if (!url) missing.push("proof URL");

  if (missing.length > 0) {
    const fieldList = missing.join(", ");
    const exampleParts = [];
    if (missing.includes("track")) exampleParts.push("CT");
    if (missing.includes("time")) exampleParts.push("1:23.456");
    return { embed: errorEmbed(
        `Failed to fetch: **${fieldList}**.\n` +
          (missing.includes("proof URL")
            ? "No proof URL found in the message."
            : `Please specify manually: \`/rsubmit ${exampleParts.join(" ")}\``)
      ), autoApprovedSubmission: null };
  }

  // ⑤ プレイヤー認証（提出対象として記録されるのは targetUserId のPlayer_Name）
  const lookup = await lookupPlayerName(targetUserId, env);
  if (!lookup.success) {
    return { embed: errorEmbed(
        lookup.message === "Discord ID not found in dictionary"
          ? (opts.as
              ? "That Discord account isn't linked to a player name yet. Please register them first."
              : "Your Discord account isn't linked to a player name yet. Please contact staff.")
          : `Authentication failed: ${lookup.message}`
      ), autoApprovedSubmission: null };
  }
  const playerName = lookup.playerName;

  // ⑥ GASへ記録を提出（Submissionsシートに書き込み。staffのas提出は即時承認）
  const submitResult = await submitRecordToGAS(targetUserId, track, time, url, env, !!opts.as, category);
  if (!submitResult.success) {
    return { embed: errorEmbed(`Record could not be saved: ${submitResult.message}`), autoApprovedSubmission: null };
  }

  // ⑦ 成功 Embed
  const isAutoApproved = !!submitResult.autoApproved;

  // as使用時の自動承認ログ投稿
  if (isAutoApproved) {
    const submission = { track, category, time, player: playerName, proof: url };
    await postApprovalLog(submission, env);
  }
  const isFlap = category === "flap";
  const rawRank = submitResult.rank;
  const rankDisplay = rawRank && rawRank !== "N/A" ? toOrdinal(parseInt(rawRank.replace("#", ""))) : "N/A";

  const fields = [
    { name: "Player", value: playerName, inline: true },
    { name: "Track", value: track, inline: true },
    { name: "Time", value: time, inline: true },
  ];
  if (!isFlap) {
    fields.push({ name: "Rank", value: rankDisplay, inline: true });
  }
  fields.push({ name: "Category", value: category, inline: true });
  fields.push({ name: "Proof", value: url, inline: false });

  const successEmbed = {
    color: isAutoApproved ? 0x57f287 : 0xfee75c,
    title: isAutoApproved ? "✅ Record Submitted & Approved" : "✅ Record Submitted",
    fields,
    footer: {
      text: isAutoApproved
        ? `✅ Auto-approved · Submitted by staff on behalf of ${playerName}`
        : opts.as
        ? `⏳ Pending staff approval · Submitted by staff on behalf of ${playerName}`
        : "⏳ Pending staff approval",
    },
  };

  return {
    embed: successEmbed,
    autoApprovedSubmission: isAutoApproved && category === "3lap shroom"
      ? { track, category, time, player: playerName, proof: url }
      : null,
  };
}

// ==========================================
// 📨 Deferred Response 用ヘルパー
//    interactionの編集APIで「本当の回答」を後から送る
// ==========================================
async function sendFollowup(applicationId, interactionToken, payload) {
  await fetch(
    `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
}

function deferredResponse() {
  return jsonResponse({ type: 5 }); // "考え中..." を即座に表示
}

// ==========================================
// 🌐 メインハンドラ
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 🛠️ コマンド登録（一時利用）
    if (url.pathname === "/register-commands") {
      return await registerCommands(env);
    }

    // 🔧 ロールセットアップ（グループ別）
    if (url.pathname.startsWith("/setup-roles/")) {
      const group = url.pathname.replace("/setup-roles/", "").toLowerCase();
      return await handleSetupRoles(env, group);
    }

    if (request.method === "GET") {
      return new Response("ctgp7-discord-bot is running ✅", { status: 200 });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { valid, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === 1) {
      return jsonResponse({ type: 1 }); // PING → PONG
    }

    if (interaction.type === 2 && interaction.data?.name === "rsubmit") {
      // マイルストームチェックを別のwaitUntilに登録（確実に実行される）
      ctx.waitUntil(checkAndAnnounceRankingMilestones(env, []));
      ctx.waitUntil(
        (async () => {
          const result = await handleRsubmit(interaction, env);
          await sendFollowup(env.DISCORD_APPLICATION_ID, interaction.token, { embeds: [result.embed] });
        })()
      );
      return deferredResponse();
    }

    if (interaction.type === 2 && interaction.data?.name === "approve") {
      // マイルストームチェックを別のwaitUntilに登録（確実に実行される）
      ctx.waitUntil(checkAndAnnounceRankingMilestones(env, []));
      ctx.waitUntil(
        (async () => {
          const result = await handleApprove(interaction, env);
          await sendFollowup(env.DISCORD_APPLICATION_ID, interaction.token, { embeds: [result.embed] });
        })()
      );
      return deferredResponse();
    }

    if (interaction.type === 2 && interaction.data?.name === "removeerror") {
      ctx.waitUntil(handleRemoveError(interaction, env));
      // 何も返さない（Discord側には「アプリが応答しました」と表示されるが即座に消える）
      return jsonResponse({ type: 4, data: { content: "", flags: 64 } });
    }

    return jsonResponse({ type: 4, data: { content: "🚧 Unknown command." } });
  },
};

// ==========================================
// 🛠️ コマンド登録（一時利用・1回実行したら不要）
// ==========================================
async function registerCommands(env) {
  const commands = [
    {
      name: "rsubmit",
      description: "Submit a record from your recent message",
      type: 1,
      options: [
        {
          name: "category",
          description: "Category to submit for",
          type: 3,
          required: false,
          choices: [
            { name: "3lap shroom (default)", value: "3lap shroom" },
            { name: "flap", value: "flap" },
            { name: "shroomless", value: "shroomless" },
          ],
        },
        { name: "track", description: "Track name (auto-detected if omitted)", type: 3, required: false },
        { name: "time", description: "Time mm:ss.SSS or ss.SSS (auto-detected if omitted)", type: 3, required: false },
        { name: "proof", description: "Proof URL (uses recent message if omitted)", type: 3, required: false },
        { name: "as", description: "[Staff only] Submit on behalf of another player", type: 6, required: false },
      ],
    },
    {
      name: "removeerror",
      description: "[Staff only] Delete a Bot error message by its link",
      type: 1,
      options: [
        {
          name: "message_link",
          description: "Link to the Bot's error message to delete",
          type: 3,
          required: true,
        },
      ],
    },
    {
      name: "approve",
      description: "[Staff only] Approve up to 3 records by message link",
      type: 1,
      options: [
        {
          name: "message_link",
          description: "Link to the Bot's Record Submitted Embed message",
          type: 3,
          required: true,
        },
        {
          name: "message_link_2",
          description: "Second record to approve (optional)",
          type: 3,
          required: false,
        },
        {
          name: "message_link_3",
          description: "Third record to approve (optional)",
          type: 3,
          required: false,
        },
      ],
    },
  ];

  const res = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    }
  );
  const result = await res.text();
  return new Response(`Status: ${res.status}\n\n${result}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
