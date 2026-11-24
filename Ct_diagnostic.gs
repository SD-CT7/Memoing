// ==========================================
// ⚙️ 基本設定
// ==========================================
// 🚨 ここに「Player_Dictionary」や「Submissions」があるメインのスプレッドシートのIDを貼ってください！
const MAIN_SS_ID = "14Sn51n_NGd_X1cpIZHSk-w5noxTFySHlAs85NVK_TFE"; 

const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1482971957480652911/1AfSpMPxIHGtOH0OC3d-YmYCNrCK5N6kfjF6jbfxd5nQE86965YaXUnVYJ3gonaKhvb0";
const SITE_URL = "https://ctgp-7-submission.netlify.app/"; // サイトのURL
// スタッフ判定は Supabase の players.is_staff を使う(Dict.gs の isStaffName_)

// 🏆 リーダーボード自動化用 スプシID
const TARGET_SS_ID_1 = "14Sn51n_NGd_X1cpIZHSk-w5noxTFySHlAs85NVK_TFE";
const TARGET_SS_ID_2 = "1I8z7cbKY2tpw2BvKi1hA3KPifSOOlkR6ji3NvbdE1a0"; 
const TARGET_SS_ID_3 = "1aqhIBbpPZBoziX9KXVK7c4JL9Zir7OLp0uWcgjoFn90";

const PROBLEMATIC_NAMES = ["2AM", "101", "168", "78", "nick eh 30"];

// 🔐 Discord Bot (Cloudflare Worker) からのリクエストを検証する共有シークレット
// Worker側のコードにも同じ文字列を設定してください（環境変数 WORKER_SHARED_SECRET 推奨）
const WORKER_SHARED_SECRET = "api-0320";

// 🏁 コース名と略称の変換辞書
// コース辞書は Supabase の tracks テーブルを使う(Dict.gs の resolveTrack_ / trackAbbrOf_)

// 🌍 国名と略称の変換辞書（必要に応じて追加してください）
const COUNTRY_ABBR = {
"Austria": "at",
"Australia": "au",
"Barbados": "bb",
"Belgium": "be",
"Bolivia": "bo",
"Canada": "ca",
"Chile": "cl",
"Germany": "de",
"Algeria": "dz",
"Spain": "es",
"France": "fr",
"Honduras": "hn",
"Israel": "il",
"Iceland": "is",
"Italy": "it",
"Japan": "jp",
"Korea": "kr",
"Malaysia": "my",
"Nicaragua": "ni",
"Netherlands": "nl",
"Philippines": "ph",
"Romania": "ro",
"Scotland": "scotland",
"UK": "uk",
"USA": "us"
};

// ==========================================
// 🌐 HTMLからの通信を受け取る処理
// ==========================================
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  let action = "unknown";
  const diagId = Utilities.getUuid().slice(0, 8);

  try {
    const data = JSON.parse(e.postData.contents);
    action = data.action || "unknown";
    const isDiscordAction = String(action).indexOf("discord") === 0 ||
      action === "scheduleMilestoneCheck";

    if (isDiscordAction) {
      console.log("[DIAG " + diagId + "] doPost START action=" + action);
      console.log("[DIAG " + diagId + "] shared secret=" +
        (data.secret === WORKER_SHARED_SECRET ? "MATCH" : "MISMATCH"));
    }

    let result = {};

    if (action === "login") {
      result = handleLogin(data.pn, data.password);
    } else if (action === "requestAccount") {
      result = handleRequestAccount(data.pn, data.password, data.discord, data.country, data.channel);
    } else if (action === "submit") {
      result = handleSubmit(data.pn, data.password, data.track, data.category, data.time, data.proof);
    } else if (action === "getPending") {
      result = handleGetPending(data.pn, data.password);
    } else if (action === "handleDecision") {
      result = handleDecision(data.pn, data.password, data.targetPn, data.decision);
    } else if (action === "getPendingRecords") {
      result = handleGetPendingRecords(data.pn, data.password);
    } else if (action === "handleRecordAction") {
      result = handleRecordAction(data.pn, data.password, data.row, data.decision);
    } else if (action === "getPlayerList") {
  result = handleGetPlayerList(data.pn, data.password);
  } else if (action === "staffSubmit") {
  result = handleStaffSubmit(data.pn, data.password, data.targetPn, data.track, data.category, data.time, data.proof);
} else if (action === "discordLookup") {
  result = handleDiscordLookup(data.secret, data.discordId);
} else if (action === "discordSubmit") {
  result = handleDiscordSubmit(data.secret, data.discordId, data.track, data.category, data.time, data.proof, data.autoApprove);
} else if (action === "discordApprove") {
  result = handleDiscordApprove(data.secret, data.discordId, data.player, data.track, data.time, data.proof);
} else if (action === "discordVerifyStaff") {
  result = handleDiscordVerifyStaff(data.secret, data.discordId);
} else if (action === "discordGetWRHolder") {
  result = handleDiscordGetWRHolder(data.secret, data.trackAbbr);
} else if (action === "discordGetAllPlayers") {
  result = handleDiscordGetAllPlayers(data.secret);
} else if (action === "discordSetupRoles") {
  result = handleDiscordSetupRoles(data.secret, data.group);
} else if (action === "scheduleMilestoneCheck") {
  result = handleScheduleMilestoneCheck(data.secret, data.submissions);
}

    if (isDiscordAction) {
      console.log("[DIAG " + diagId + "] action result success=" +
        (result && result.success === true ? "true" :
         result && result.success === false ? "false" : "not-returned"));
      if (result && result.success === false) {
        console.warn("[DIAG " + diagId + "] action rejected message=" +
          String(result.message || "no message").slice(0, 180));
      }
      console.log("[DIAG " + diagId + "] doPost END action=" + action);
    }

    output.setContent(JSON.stringify(result));
  } catch (error) {
    console.error("[DIAG " + diagId + "] doPost ERROR action=" + action +
      " message=" + String(error && error.message || error).slice(0, 300));
    output.setContent(JSON.stringify({ success: false, message: "Server error: " + error.toString() }));
  }
  return output;
}

// ==========================================
// 🤖 Discord Bot (Cloudflare Worker) 用API
// ==========================================
// Discord IDからPlayer_Nameを引く。Supabase の player_discord_accounts を参照。
// Discord IDがスタッフかどうかだけを確認する（/rsubmit の as オプション用）
// ==========================================
// 🏆 マイルストームチェック（トリガー経由）
// ==========================================

// Workerから呼ばれる：1分後にマイルストームチェックを実行するトリガーを作成
function handleScheduleMilestoneCheck(secret, submissions) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: 'Unauthorized' };
  }

  // 承認された記録情報をスクリプトプロパティに保存（トリガー実行時に参照）
  PropertiesService.getScriptProperties().setProperty(
    'PENDING_MILESTONE_SUBMISSIONS',
    JSON.stringify(submissions || [])
  );

  // 既存の同名トリガーを削除（重複防止）
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runMilestoneCheck') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // 1分後に実行するトリガーを作成
  ScriptApp.newTrigger('runMilestoneCheck')
    .timeBased()
    .after(60 * 1000) // 1分後
    .create();

  return { success: true };
}

// トリガーから呼ばれる：実際のマイルストームチェック処理
function runMilestoneCheck() {
  // 自分自身のトリガーを削除（一回限り）
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runMilestoneCheck') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const botToken = PropertiesService.getScriptProperties().getProperty('DISCORD_BOT_TOKEN');
  const submissionsJson = PropertiesService.getScriptProperties().getProperty('PENDING_MILESTONE_SUBMISSIONS');
  const submissions = JSON.parse(submissionsJson || '[]');

  if (!botToken) { console.error('DISCORD_BOT_TOKEN not set'); return; }

  const rankingGasUrl = PropertiesService.getScriptProperties().getProperty('GAS_RANKING_URL');
  if (!rankingGasUrl) { console.error('GAS_RANKING_URL not set'); return; }

  // Rankings.gs の syncAndUpdate を1回呼ぶだけ
  const first = submissions.length > 0 ? submissions[0] : null;
  const payload = first
    ? { action: 'syncAndUpdate', player: first.player, trackAbbr: first.track, category: '3l', expectedTime: first.time }
    : { action: 'syncAndUpdate' };

  const response = UrlFetchApp.fetch(rankingGasUrl, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(response.getContentText());
  const milestones = result.milestones || [];
  const afterSnapshot = result.snapshot || {};

  // Supabase から PlayerName → Discord ID の逆引き辞書
  const allPlayers = handleDiscordGetAllPlayers(WORKER_SHARED_SECRET);
  if (!allPlayers.success) return;
  const playerToDiscordId = allPlayers.players;

  const guildId = DISCORD_GUILD_ID_PROP;
  const channelId = ANNOUNCE_CHANNEL_ID_PROP;

  // マイルストーン到達者の処理
  milestones.forEach(function(m) {
    const discordId = playerToDiscordId[m.player];
    if (!discordId) return;

    if (m.milestone !== 1) {
      const rank = afterSnapshot[m.player];
      if (rank) {
        const newRoleName = getRoleNameForRankGAS(rank);
        const newRoleId = ROLE_IDS_GAS[newRoleName];
        const currentRoles = getMemberRolesGAS(guildId, discordId, botToken);
        RANK_ROLE_ORDER.forEach(function(roleName) {
          const roleId = ROLE_IDS_GAS[roleName];
          if (roleId && currentRoles.includes(roleId) && roleName !== newRoleName) {
            removeRoleGAS(guildId, discordId, roleId, botToken);
            Utilities.sleep(300);
          }
        });
        addRoleGAS(guildId, discordId, newRoleId, botToken);
        Utilities.sleep(300);
      }
    }

    const msg = getMilestoneMessageGAS(String(m.milestone), discordId);
    if (msg) {
      sendAnnouncementGAS(channelId, msg, botToken);
      Utilities.sleep(500);
    }
  });

  // BKTチェック
  submissions.forEach(function(submission) {
    if (!submission.track || !submission.player) return;
    const wrResult = handleDiscordGetWRHolder(WORKER_SHARED_SECRET, submission.track);
    if (!wrResult.success || wrResult.player !== submission.player) return;

    const discordId = playerToDiscordId[submission.player];
    if (!discordId) return;

    const currentRoles = getMemberRolesGAS(guildId, discordId, botToken);
    if (currentRoles.includes('773829394296340501')) return;

    addRoleGAS(guildId, discordId, '773829394296340501', botToken);
    Utilities.sleep(300);
    sendAnnouncementGAS(channelId,
      'Congratulations, <@' + discordId + '>!!\nYou got a wonderful BKT!!\nKeep your Best!',
      botToken
    );
  });
}

// Calcシートの現在のK:Mランキングを { playerName: rank } で返す
function getCalcSnapshot_() {
  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const calcSheet = ss.getSheetByName('Calc');
  if (!calcSheet) return {};

  const lastRow = calcSheet.getLastRow();
  if (lastRow < 2) return {};

  const values = calcSheet.getRange(2, 11, lastRow - 1, 3).getValues();
  const snapshot = {};
  values.forEach(function(row) {
    const name = String(row[0]).trim();
    const rank = Number(row[2]);
    if (name && rank) snapshot[name] = rank;
  });
  return snapshot;
}

// ==========================================
// 🔧 ロールセットアップ（GAS側でDiscord APIを叩く）
// ==========================================
const DISCORD_BOT_TOKEN_PROP = 'DISCORD_BOT_TOKEN'; // スクリプトプロパティに保存
const ANNOUNCE_CHANNEL_ID_PROP = '1529458075847889056';
const DISCORD_GUILD_ID_PROP = '769256864894025758';

const ROLE_IDS_GAS = {
  'Top 5':   '1309501077540049128',
  'Top 10':  '1309501178941280266',
  'Top 20':  '1309501801384640653',
  'Top 30':  '1309501853678964757',
  'Top 40':  '1309502067571953734',
  'Top 50':  '1309502107199737856',
  'Top 50+': '1309502302192664637',
};

const RANK_ROLE_ORDER = ['Top 5', 'Top 10', 'Top 20', 'Top 30', 'Top 40', 'Top 50', 'Top 50+'];

function getRoleNameForRankGAS(rank) {
  if (rank <= 5)  return 'Top 5';
  if (rank <= 10) return 'Top 10';
  if (rank <= 20) return 'Top 20';
  if (rank <= 30) return 'Top 30';
  if (rank <= 40) return 'Top 40';
  if (rank <= 50) return 'Top 50';
  return 'Top 50+';
}

function getMilestoneMessageGAS(milestone, discordId) {
  const mention = '<@' + discordId + '>';
  switch (String(milestone)) {
    case 'new': return 'Welcome to leaderboard ' + mention + '!\nYou have entered the leaderboard just now!\nKeep it up!';
    case '50':  return 'Nice work ' + mention + '!\nYou have reached the Top 50 on the leaderboard!';
    case '40':  return 'Nice work, ' + mention + '!\nYou\'ve climbed into the Top 40!';
    case '30':  return 'Great work, ' + mention + '!\nYou\'ve climbed to the Top 30!';
    case '20':  return 'Well done, ' + mention + '!\nYou\'ve made the Top 20!';
    case '10':  return 'Great job, ' + mention + '!\nYou\'re now in the Top 10!';
    case '5':   return 'Congratulations, ' + mention + '!\nYou broke into the Top 5!';
    default: return null;
  }
}

function discordFetch(url, method, body, botToken) {
  const options = {
    method: method,
    headers: {
      'Authorization': 'Bot ' + botToken,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };
  if (body) options.payload = JSON.stringify(body);
  return UrlFetchApp.fetch(url, options);
}

function getMemberRolesGAS(guildId, userId, botToken) {
  const res = discordFetch(
    'https://discord.com/api/v10/guilds/' + guildId + '/members/' + userId,
    'GET', null, botToken
  );
  if (res.getResponseCode() !== 200) return [];
  const data = JSON.parse(res.getContentText());
  return data.roles || [];
}

function addRoleGAS(guildId, userId, roleId, botToken) {
  discordFetch(
    'https://discord.com/api/v10/guilds/' + guildId + '/members/' + userId + '/roles/' + roleId,
    'PUT', null, botToken
  );
}

function removeRoleGAS(guildId, userId, roleId, botToken) {
  discordFetch(
    'https://discord.com/api/v10/guilds/' + guildId + '/members/' + userId + '/roles/' + roleId,
    'DELETE', null, botToken
  );
}

function sendAnnouncementGAS(channelId, content, botToken) {
  discordFetch(
    'https://discord.com/api/v10/channels/' + channelId + '/messages',
    'POST', { content: content }, botToken
  );
}

function handleDiscordSetupRoles(secret, group) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: 'Unauthorized' };
  }

  // グループ → ランク範囲のマッピング
  const groupRanges = {
    'top5':  { min: 1,  max: 5 },
    'top10': { min: 6,  max: 10 },
    'top20': { min: 11, max: 20 },
    'top30': { min: 21, max: 30 },
    'top40': { min: 31, max: 40 },
    'top50': { min: 41, max: 50 },
    'top51': { min: 51, max: Infinity },
  };

  const range = groupRanges[String(group).toLowerCase()];
  if (!range) {
    return { success: false, message: 'Invalid group: ' + group + '. Use top5/top10/top20/top30/top40/top50/top51' };
  }

  // BotトークンをスクリプトプロパティFromに取得
  const botToken = PropertiesService.getScriptProperties().getProperty(DISCORD_BOT_TOKEN_PROP);
  if (!botToken) {
    return { success: false, message: 'DISCORD_BOT_TOKEN not set in Script Properties' };
  }

  const guildId = DISCORD_GUILD_ID_PROP;
  const channelId = ANNOUNCE_CHANNEL_ID_PROP;

  // Supabase から PlayerName → Discord ID の逆引き辞書を作る
  const allPlayers = handleDiscordGetAllPlayers(secret);
  if (!allPlayers.success) return allPlayers;
  const playerToDiscordId = allPlayers.players;

  // Calc シートからランキングスナップショットを取得
  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const calcSheet = ss.getSheetByName('Calc');
  if (!calcSheet) return { success: false, message: 'Calc sheet not found' };

  const lastRow = calcSheet.getLastRow();
  const values = calcSheet.getRange(2, 11, lastRow - 1, 3).getValues();

  let processed = 0;
  let skipped = 0;

  for (const row of values) {
    const playerName = String(row[0]).trim();
    const rank = Number(row[2]);
    if (!playerName || !rank) continue;

    // ランク範囲フィルター
    if (rank < range.min || rank > range.max) continue;

    const discordId = playerToDiscordId[playerName];
    if (!discordId) { skipped++; continue; }

    const newRoleName = getRoleNameForRankGAS(rank);
    const newRoleId = ROLE_IDS_GAS[newRoleName];

    // 現在のロールを取得して古いランキングロールを削除
    const currentRoles = getMemberRolesGAS(guildId, discordId, botToken);
    for (const roleName of RANK_ROLE_ORDER) {
      const roleId = ROLE_IDS_GAS[roleName];
      if (roleId && currentRoles.includes(roleId) && roleName !== newRoleName) {
        removeRoleGAS(guildId, discordId, roleId, botToken);
        Utilities.sleep(300); // レート制限対策
      }
    }

    // 新しいロールを付与
    addRoleGAS(guildId, discordId, newRoleId, botToken);
    Utilities.sleep(300);

    // アナウンスメッセージ送信
    const milestone = rank <= 5 ? '5' : rank <= 10 ? '10' : rank <= 20 ? '20' :
                      rank <= 30 ? '30' : rank <= 40 ? '40' : rank <= 50 ? '50' : 'new';
    const msg = getMilestoneMessageGAS(milestone, discordId);
    if (msg) {
      sendAnnouncementGAS(channelId, msg, botToken);
      Utilities.sleep(500); // レート制限対策
    }

    processed++;
  }

  return { success: true, processed, skipped };
}

// プレイヤー名 → Discord ID の逆引き辞書を返す(Supabase の player_discord_accounts)
function handleDiscordGetAllPlayers(secret) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: "Unauthorized" };
  }
  return { success: true, players: getDiscordIdByPlayerName_() };
}

// 指定コースの現在1位プレイヤーとタイムを返す（BKTチェック用）
function handleDiscordGetWRHolder(secret, trackAbbr) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: "Unauthorized" };
  }
  if (!trackAbbr) {
    return { success: false, message: "trackAbbr is required" };
  }

  try {
    const ss3 = SpreadsheetApp.openById(TARGET_SS_ID_3);
    const sheet = ss3.getSheetByName(trackAbbr);
    if (!sheet) return { success: false, message: "Sheet not found: " + trackAbbr };

    const data = sheet.getDataRange().getValues();

    // ヘッダー行を探す
    let headerRow = -1;
    for (let i = 0; i < data.length; i++) {
      const row = data[i].map(v => String(v).trim().toLowerCase());
      if (row.includes("rank")) { headerRow = i; break; }
    }
    if (headerRow === -1) return { success: false, message: "Header not found" };

    const header = data[headerRow].map(v => String(v).trim().toLowerCase());
    const playerColIdx = header.findIndex(h => h === "player" || h === "プレイヤー");
    const timeColIdx = header.findIndex(h => h === "time" || h === "タイム");
    if (playerColIdx === -1 || timeColIdx === -1) return { success: false, message: "Column not found" };

    // 1行目（ヘッダーの次の行）が1位
    const firstRow = data[headerRow + 1];
    if (!firstRow || !firstRow[playerColIdx]) return { success: true, player: null, time: null };

    return {
      success: true,
      player: String(firstRow[playerColIdx]).trim(),
      time: String(firstRow[timeColIdx]).trim()
    };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

function handleDiscordVerifyStaff(secret, discordId) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: "Unauthorized" };
  }
  const lookup = handleDiscordLookup(secret, discordId);
  if (!lookup.success) {
    return { success: false, message: lookup.message };
  }
  if (!lookup.isStaff) {
    return { success: false, message: "Not a staff member" };
  }
  return { success: true, playerName: lookup.playerName };
}

// Discord ID → プレイヤー名(Supabase の player_discord_accounts + players)
function handleDiscordLookup(secret, discordId) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: "Unauthorized" };
  }
  if (!discordId) {
    return { success: false, message: "discordId is required" };
  }
  const found = lookupDiscord_(discordId);
  if (!found) {
    return { success: false, message: "Discord ID not found in dictionary" };
  }
  return { success: true, playerName: found.playerName, isStaff: found.isStaff, isProxy: found.isProxy };
}

// Discord Botからの提出を受け付けて Submissions シートに書き込む（パスワード不要・Discord IDで認証済み）
function handleDiscordSubmit(secret, discordId, track, category, time, proof, autoApprove) {
  console.log("[DIAG discordSubmit] handler START");
  if (secret !== WORKER_SHARED_SECRET) {
    console.warn("[DIAG discordSubmit] shared secret=MISMATCH");
    return { success: false, message: "Unauthorized" };
  }
  console.log("[DIAG discordSubmit] shared secret=MATCH");

  console.log("[DIAG discordSubmit] before player lookup");
  const lookup = handleDiscordLookup(secret, discordId);
  if (!lookup.success) {
    console.warn("[DIAG discordSubmit] player lookup FAILED: " +
      String(lookup.message || "unknown").slice(0, 180));
    return { success: false, message: lookup.message };
  }
  const pn = lookup.playerName;
  console.log("[DIAG discordSubmit] player lookup=SUCCESS");

  if (!track || !time || !proof) {
    console.warn("[DIAG discordSubmit] required fields missing");
    return { success: false, message: "track, time and proof are required" };
  }

  console.log("[DIAG discordSubmit] before open spreadsheet");
  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Submissions");
  if (!sheet) {
    console.error("[DIAG discordSubmit] Submissions sheet NOT FOUND");
    return { success: false, message: "Submissions sheet not found." };
  }

  const finalCategory = category || "3lap shroom";
  console.log("[DIAG discordSubmit] before appendRow");
  sheet.appendRow([new Date(), pn, track, time, proof, false, finalCategory]);
  console.log("[DIAG discordSubmit] after appendRow row=" + sheet.getLastRow());

  if (autoApprove) {
    const lastRow = sheet.getLastRow();
    try {
      const success = executeRecordApproval({
        player: pn,
        track: track,
        time: time,
        proof: proof,
        category: finalCategory,
      });
      if (success) sheet.getRange(lastRow, 6).setValue(true);
      console.log("[DIAG discordSubmit] autoApprove result=" + !!success);
    } catch (e) {
      console.error("[DIAG discordSubmit] autoApprove ERROR: " +
        String(e && e.message || e).slice(0, 250));
    }
  }

  console.log("[DIAG discordSubmit] before rank calculation");
  const trackAbbr = trackAbbrOf_(track);
  const rank = calcSubmissionRank(trackAbbr, time, finalCategory);
  const rankStr = rank !== null ? toOrdinalGAS(rank) : "N/A";

  const msg = `@everyone 🎮 **New Record Submitted (via Discord)**\n**Player:** \`${pn}\`\n**Track:** \`${track}\`\n**Category:** \`${finalCategory}\`\n**Time:** \`${time}\`\n**Rank:** \`${rankStr}\`\n**Proof:** ${proof}\nReview on Dashboard: ${SITE_URL}`;
  console.log("[DIAG discordSubmit] before Discord notification");
  sendDiscordNotification(msg);
  console.log("[DIAG discordSubmit] handler SUCCESS");

  return { success: true, playerName: pn, autoApproved: !!autoApprove, rank: rankStr };
}

// Discord Botからの承認 (/approve) を受け付ける。
// Embed内の Player/Track/Time/Proof から Submissions シートの該当行を逆引きして承認する。
function handleDiscordApprove(secret, discordId, player, track, time, proof) {
  if (secret !== WORKER_SHARED_SECRET) {
    return { success: false, message: "Unauthorized" };
  }

  // 実行者がスタッフかチェック（Supabase の players.is_staff）
  const lookup = handleDiscordLookup(secret, discordId);
  if (!lookup.success) {
    return { success: false, message: "Could not verify your identity: " + lookup.message };
  }
  if (!lookup.isStaff) {
    return { success: false, message: "Only staff members can use /approve." };
  }

  if (!player || !track || !time || !proof) {
    return { success: false, message: "player, track, time and proof are required" };
  }

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Submissions");
  if (!sheet) return { success: false, message: "Submissions sheet not found." };

  const data = sheet.getDataRange().getValues();
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    const rowPlayer = String(data[i][1]).trim();
    const rowTrack = String(data[i][2]).trim();
    const rowTime = String(data[i][3]).trim();
    const rowProof = String(data[i][4]).trim();
    const status = data[i][5];
    const isApproved = String(status).toUpperCase() === "TRUE" || status === true;
    const isRejected = String(status).toUpperCase() === "REJECTED";

    if (
      rowPlayer === String(player).trim() &&
      rowTrack === String(track).trim() &&
      rowTime === String(time).trim() &&
      rowProof === String(proof).trim() &&
      !isApproved && !isRejected
    ) {
      targetRow = i + 1; // シート上の行番号
      break;
    }
  }

  if (targetRow === -1) {
    return { success: false, message: "Matching pending record not found in Submissions sheet." };
  }

  // パスワード認証を経由せず、承認ロジックだけを実行（スタッフ確認は上ですでに完了済み）
  // /approve はDiscordの3秒/15分制限の影響を受けるため、Supabase同期はスキップして高速化する
  // （Supabase反映は手動 syncAll() で後から追いつかせる運用）
  const recordData = {
    timestamp: sheet.getRange(targetRow, 1).getValue(),
    player: sheet.getRange(targetRow, 2).getDisplayValue(),
    track: sheet.getRange(targetRow, 3).getDisplayValue(),
    time: sheet.getRange(targetRow, 4).getDisplayValue(),
    proof: sheet.getRange(targetRow, 5).getDisplayValue(),
    category: sheet.getRange(targetRow, 7).getDisplayValue(),
    skipSupabaseSync: true
  };

  try {
    const success = executeRecordApproval(recordData);
    if (success) {
      sheet.getRange(targetRow, 6).setValue(true);
      return { success: true, row: targetRow, approvedBy: lookup.playerName };
    }
    return { success: false, message: "executeRecordApproval returned false." };
  } catch (e) {
    return { success: false, message: "Spreadsheet update failed: " + e.message };
  }
}

// ==========================================
// 🔐 アカウント・認証関連の処理
// ==========================================
function authenticate(pn, password) {
  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Player_Dictionary");
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === pn && String(data[i][1]) === String(password)) {
      const isApproved = String(data[i][2]).toUpperCase() === "TRUE";
      const isBlacklisted = String(data[i][4]).toUpperCase() === "TRUE";

      if (isBlacklisted) return { valid: false, message: "This account has been blacklisted." };
      if (!isApproved) return { valid: false, message: "Your account is pending staff approval." };
      
      return { valid: true, rowIndex: i + 1, isStaff: isStaffName_(pn) };
    }
  }
  return { valid: false, message: "Invalid name or password." };
}

function handleLogin(pn, password) {
  const auth = authenticate(pn, password);
  if (auth.valid) return { success: true, isStaff: auth.isStaff };
  return { success: false, message: auth.message };
}

function handleRequestAccount(pn, password, discord, country, channel) {
  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Player_Dictionary");
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === pn) return { success: false, message: "This Player Name is already taken." };
  }
  // プレイヤー情報(国・チャンネル)は Supabase の players に pending で登録。シートはログイン用の資格情報だけ。
  const countryCode = COUNTRY_ABBR[country] || String(country || '').trim().toLowerCase();
  if (!createPendingPlayer_(pn, countryCode, channel, discord)) {
    return { success: false, message: "This Player Name is already taken." };
  }
  sheet.appendRow([pn, password, false, discord, false, country, channel]);

  const msg = `@everyone\n🆕 **New Account Request**\n**Player:** \`${pn}\`\n**Country:** \`${country}\`\n**Channel:** ${channel || "N/A"}\n**Discord:** \`${discord || "N/A"}\`\nReview on Dashboard: ${SITE_URL}`;
  sendDiscordNotification(msg);
  return { success: true, message: "Request sent successfully." };
}

function handleGetPending(pn, password) {
  const auth = authenticate(pn, password);
  if (!auth.valid || !auth.isStaff) return { success: false, message: "Unauthorized access." };

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Player_Dictionary");
  const data = sheet.getDataRange().getValues();
  let pendingList = [];

  for (let i = 1; i < data.length; i++) {
    const isApproved = String(data[i][2]).toUpperCase() === "TRUE";
    if (data[i][0] && !isApproved) pendingList.push({ pn: data[i][0], discord: data[i][3] });
  }
  return { success: true, pendingList: pendingList };
}

function handleDecision(pn, password, targetPn, decision) {
  const auth = authenticate(pn, password);
  if (!auth.valid || !auth.isStaff) return { success: false, message: "Unauthorized access." };

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Player_Dictionary");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const isApproved = String(data[i][2]).toUpperCase() === "TRUE";
    if (data[i][0] === targetPn && !isApproved) {
      if (decision !== "approve" && decision !== "reject") break;
      const approve = decision === "approve";
      // 先に Supabase の players を更新(失敗したらシートは触らない)
      if (!decidePlayer_(targetPn, approve) && approve) {
        // players に行が無い古い申請: 作ってから承認する
        createPendingPlayer_(targetPn, COUNTRY_ABBR[data[i][5]] || String(data[i][5] || '').trim().toLowerCase(), data[i][6], data[i][3]);
        decidePlayer_(targetPn, true);
      }
      if (approve) sheet.getRange(i + 1, 3).setValue(true);
      else sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, message: "Player not found or already approved." };
}

// ==========================================
// 📝 記録提出の処理
// ==========================================
function handleSubmit(pn, password, track, category, time, proof) {
  const auth = authenticate(pn, password);
  if (!auth.valid) return { success: false, message: auth.message };

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  // 🌟 修正ポイント①: メインスプシの正しいシート名（Submissions）に変更しました
  const sheet = ss.getSheetByName("Submissions");
  if (!sheet) return { success: false, message: "Submissions sheet not found." };

  sheet.appendRow([new Date(), pn, track, time, proof, false, category]);

  const msg = `@everyone 🎮 **New Record Submitted**\n**Player:** \`${pn}\`\n**Track:** \`${track}\`\n**Category:** \`${category}\`\n**Time:** \`${time}\`\n**Proof:** ${proof}\nReview on Dashboard: ${SITE_URL}`;

  sendDiscordNotification(msg);

  return { success: true };
}

// 数字を序数（1st, 2nd, 3rd, 4th...）に変換
function toOrdinalGAS(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// タイム文字列 mm:ss.SSS を秒数（小数）に変換
function timeToSeconds(timeStr) {
  const m = String(timeStr).trim().match(/^(\d{1,2}):([0-5]\d)\.(\d{3})$/);
  if (!m) return Infinity;
  return parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 1000;
}

// Time Trials Charts から該当コース・カテゴリの現在のランキングを取得し、
// 提出タイムが何位相当かを返す
// 見つからない場合は null を返す
function calcSubmissionRank(trackAbbr, submitTime, category) {
  try {
    const categoryStr = String(category).toLowerCase();
    const submitSec = timeToSeconds(submitTime);

    // shroomless: TARGET_SS_ID_1 の times シートから計算
    if (categoryStr.includes("shroomless")) {
      const ss1 = SpreadsheetApp.openById(TARGET_SS_ID_1);
      const sheet1 = ss1.getSheetByName("times") || ss1.getSheets()[0];
      if (!sheet1) return null;
      const data1 = sheet1.getDataRange().getValues();

      // コース名を検索（A列）
      const searchTrackName = trackAbbr.replace(" (Glitch)", " G");
      for (let i = 1; i < data1.length; i++) {
        if (String(data1[i][0]).replace(/_/g, " ") !== searchTrackName) continue;

        // 横方向に1runner,1time,...形式でタイムを収集（B=index1, timeは+1ずつ5列おき）
        const existingTimes = [];
        for (let r = 0; r < 50; r++) {
          const col = 1 + (r * 5); // 1runner列
          const timeCol = col + 1;  // 1time列
          const t = data1[i][timeCol];
          if (!t || String(t).trim() === "" || String(t).trim() === "-") break;
          existingTimes.push(timeToSeconds(String(t).trim()));
        }
        if (existingTimes.length === 0) return 1;
        return existingTimes.filter(t => t < submitSec).length + 1;
      }
      return null;
    }

    // flap: ランク計算なし
    if (categoryStr.includes("flap")) return null;

    // 3lap shroom: TARGET_SS_ID_3（Time Trials Charts）から計算
    const ss3 = SpreadsheetApp.openById(TARGET_SS_ID_3);
    const sheet = ss3.getSheetByName(trackAbbr);
    if (!sheet) return null;

    const data = sheet.getDataRange().getValues();

    // ヘッダー行を探す（"Rank" または "rank" がある行）
    let headerRow = -1;
    for (let i = 0; i < data.length; i++) {
      const row = data[i].map(v => String(v).trim().toLowerCase());
      if (row.includes("rank")) {
        headerRow = i;
        break;
      }
    }
    if (headerRow === -1) return null;

    const header = data[headerRow].map(v => String(v).trim().toLowerCase());
    const timeColIdx = header.findIndex(h => h === "time" || h === "タイム");
    if (timeColIdx === -1) return null;

    const existingTimes = [];
    for (let i = headerRow + 1; i < data.length; i++) {
      const t = data[i][timeColIdx];
      if (!t || String(t).trim() === "") break;
      existingTimes.push(timeToSeconds(String(t).trim()));
    }

    if (existingTimes.length === 0) return 1;
    return existingTimes.filter(t => t < submitSec).length + 1;
  } catch (e) {
    console.error("calcSubmissionRank error: " + e.message);
    return null;
  }
}

function sendDiscordNotification(message) {
  if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith("http")) return;
  const payload = JSON.stringify({ content: message });
  const options = { method: "POST", contentType: "application/json", payload: payload };
  try { UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options); } catch (e) {}
}

// ==========================================
// 🏆 スタッフ用メニュー（スプレッドシート上から実行）
// ==========================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛠️ Staff Menu')
    .addItem('✅ 選択した記録を承認してボードに反映', 'approveSelectedRecordFromMenu')
    .addToUi();
}

function approveSelectedRecordFromMenu() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // 🌟 修正ポイント②: 「submissions」が含まれていれば小文字・大文字問わず通過するようにしました
  if (!sheet.getName().toLowerCase().includes("submissions")) {
    ui.alert("エラー: 記録の提出シート (Submissions) で実行してください。"); return;
  }

  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert("エラー: 見出し行ではなく、承認したい記録の行を選択してください。"); return;
  }

  const status = sheet.getRange(row, 6).getValue();
  if (status === true || String(status).toUpperCase() === "TRUE") {
    ui.alert("この記録は既に承認済みです。"); return;
  }

  const recordData = {
    timestamp: sheet.getRange(row, 1).getValue(),
    player: sheet.getRange(row, 2).getValue(),
    track: sheet.getRange(row, 3).getValue(),
    time: sheet.getRange(row, 4).getValue(),
    proof: sheet.getRange(row, 5).getValue(),
    category: sheet.getRange(row, 7).getValue()
  };

  try {
    const success = executeRecordApproval(recordData);
    if (success) {
      sheet.getRange(row, 6).setValue(true);
      ui.alert("成功！\n指定された条件に従い、全てのリーダーボードに記録が反映・ソートされました。");
    }
  } catch (e) { ui.alert("エラーが発生しました: " + e.message); }
}

function executeRecordApproval(record) {
  const timeMs = timeToMs(record.time);
  const trackAbbr = trackAbbrOf_(record.track);
  const categoryStr = String(record.category).toLowerCase();

  // 国コードは Supabase の players.country(小文字コード)から取得
  const playerRow = findPlayer_(record.player);
  const playerCountry = (playerRow && playerRow.country) || "";

  let dateObj = new Date(record.timestamp);
  if(isNaN(dateObj.getTime())) dateObj = new Date();
  const formattedDate = dateObj.toISOString().split('T')[0];

 // ① times (Shroomless)
  if (categoryStr.includes("shroomless")) {
    const ss1 = SpreadsheetApp.openById(TARGET_SS_ID_1);
    const sheet1 = ss1.getSheetByName("times") || ss1.getSheets()[0];
    const data1 = sheet1.getDataRange().getValues();

    // 🚨【Glitch対応の追加】照合用に " (Glitch)" を " G" に変換したコース名を作る
    const searchTrackName = record.track.replace(" (Glitch)", " G");

    for(let i = 1; i < data1.length; i++) {
      // 🚨 record.track の代わりに searchTrackName を使って比較する！
      if(String(data1[i][0]).replace(/_/g, " ") === searchTrackName) {
        let runners = [];
        for(let r = 0; r < 8; r++) {
          let col = 1 + (r * 5);
          if(data1[i][col] && data1[i][col] !== "-") {
            runners.push({ name: data1[i][col], time: data1[i][col+1], ms: timeToMs(data1[i][col+1]), video: data1[i][col+2], channel: data1[i][col+3], country: data1[i][col+4] });
          }
        }
        runners.push({ name: record.player, time: record.time, ms: timeMs, video: record.proof, channel: "", country: playerCountry });
        runners.sort((a,b) => a.ms - b.ms);
        runners = runners.slice(0, 8);
        for(let r = 0; r < 8; r++) {
          let col = 2 + (r * 5);
          if(runners[r]) {
            // 🚨 ここでリストに入っているかチェックし、入っていれば ' をつける
            let safeName = PROBLEMATIC_NAMES.includes(String(runners[r].name).trim()) ? "'" + runners[r].name : runners[r].name;
            sheet1.getRange(i+1, col, 1, 5).setValues([[ safeName, runners[r].time, runners[r].video, runners[r].channel, runners[r].country ]]);
          }
        }
        break;
      }
    }
  }

 // ② Top 5s Submissions (3-lap系 または flap)
  if (categoryStr.includes("3-lap") || categoryStr.includes("3l") || categoryStr.includes("flap")) {
    const ss2 = SpreadsheetApp.openById(TARGET_SS_ID_2);
    const sheet2 = ss2.getSheetByName("Submissions") || ss2.getSheets()[0];
    
    // 見えないスペースやプルダウンに絶対に騙されない最強のコード
    const aColValues = sheet2.getRange("A:A").getValues();
    let realLastRow = 0;
    for (let r = aColValues.length - 1; r >= 0; r--) {
      if (String(aColValues[r][0]).trim() !== "") { 
        realLastRow = r + 1; 
        break; 
      }
    }
    
    const startRow = realLastRow < 1 ? 2 : realLastRow + 1;
    
    // カテゴリによってラップ数を変える
    const lapLabel = categoryStr.includes("flap") ? "1L" : "3L";
    
    // 🚨【大正解の修正】ARRAYFORMULAの邪魔をしないように、A〜E列（5列分）だけを書く！
    sheet2.getRange(startRow, 1, 1, 5).setValues([[ trackAbbr, lapLabel, record.player, record.time, record.proof ]]);
  }

// ③ Time Trials Charts (略称別総合ランキング)
  // 🚨「3-lap（または3l）」が含まれ、かつ「shroom」が含まれ、さらに「shroomlessではない」場合のみ実行！
  if ((categoryStr.includes("3-lap") || categoryStr.includes("3l")) && 
      categoryStr.includes("shroom") && 
      !categoryStr.includes("shroomless")) {
    
    const ss3 = SpreadsheetApp.openById(TARGET_SS_ID_3);
    const sheet3 = ss3.getSheetByName(trackAbbr);
    
    if (sheet3) {
      let records = [];
      const lastRow = sheet3.getLastRow();
      
      if (lastRow >= 7) {
        // B列〜G列のデータを読み込む
        const data3 = sheet3.getRange(7, 2, lastRow - 6, 6).getDisplayValues();
        for(let i = 0; i < data3.length; i++) {
          const existingPlayer = String(data3[i][1]).trim(); // C列: プレイヤー名
          const newPlayer = String(record.player).trim();
          
          // 名前が違う場合のみ残す（＝過去の自分は消去）
          if(existingPlayer && existingPlayer !== newPlayer) { 
            records.push({ player: data3[i][1], time: data3[i][3], ms: timeToMs(data3[i][3]), date: data3[i][4], proof: data3[i][5] });
          }
        }
      }
      
      // 新しい記録を追加
      records.push({ player: record.player, time: record.time, ms: timeMs, date: formattedDate, proof: record.proof });
      // タイム順（ミリ秒）に並び替え
      records.sort((a,b) => a.ms - b.ms);
      
      // 書き込むデータを「左側(B,C)」と「右側(E,F,G)」の2つに分ける
      let outputBC = [];
      let outputEFG = [];
      for(let i = 0; i < records.length; i++) {
        
        // 🚨 ここでリストに入っているかチェックし、入っていれば ' をつける！
        let pName = String(records[i].player).trim();
        let safeNameChart = PROBLEMATIC_NAMES.includes(pName) ? "'" + records[i].player : records[i].player;
        
        outputBC.push([i+1, safeNameChart]); // B列(順位), C列(名前)
        outputEFG.push([records[i].time, records[i].date, records[i].proof]); // E列(タイム), F列(日付), G列(証明)
      }
      
      if(lastRow >= 7) {
        // D列を消さないように、左側と右側を別々にクリアする
        sheet3.getRange(7, 2, lastRow - 6, 2).clearContent(); // B〜C列をクリア
        sheet3.getRange(7, 5, lastRow - 6, 3).clearContent(); // E〜G列をクリア
      }
      
      // D列を完全にまたいで、別々に書き込む
      sheet3.getRange(7, 2, outputBC.length, 2).setValues(outputBC); // B〜C列を書き込み
      sheet3.getRange(7, 5, outputEFG.length, 3).setValues(outputEFG); // E〜G列を書き込み
    }
  } // 👈 🚨新しく追加した if 文の閉じカッコ

  // ④ Supabase同期（Time Trials Charts と同じ条件: 3-lap系 & shroom & shroomlessではない）
  if ((categoryStr.includes("3-lap") || categoryStr.includes("3l")) &&
      categoryStr.includes("shroom") &&
      !categoryStr.includes("shroomless")) {
    try {
      if (!record.skipSupabaseSync) {
        syncRecordToSupabase(record.player, trackAbbr, record.time, record.proof, playerCountry);
      }
    } catch (e) {
      // Supabase同期に失敗してもスプシへの書き込みは成功しているので処理を続ける
      console.error("Supabase sync error: " + e.message);
    }
  }

  // ⑤ Supabase同期（Flap: flap_times に最速記録のみ保持）
  if (categoryStr.includes("flap")) {
    try {
      if (!record.skipSupabaseSync) {
        syncFlapToSupabase(record.player, trackAbbr, record.time, record.proof);
      }
    } catch (e) {
      console.error("Supabase flap sync error: " + e.message);
    }
  }

  return true;
}

// ==========================================
// 🌐 Supabase直接同期（承認時に呼び出す）
// ==========================================
const SUPABASE_URL = 'https://fpbwgncudjekqwplluct.supabase.co';
// 書き込みは service_role キー(Script Properties の SUPABASE_SERVICE_KEY)を使う。公開キーはここに置かない。

function syncRecordToSupabase(player, trackAbbr, time, proof, country) {
  const trackInfo = resolveTrack_(trackAbbr);
  const trackName = trackInfo ? trackInfo.key : null;
  if (!trackName) {
    console.warn("Supabase sync skipped: no track_name mapping for abbr=" + trackAbbr);
    return;
  }

  // プレイヤーは別名・大文字小文字を吸収して特定し、DBには正規の綴り(players.name)で保存する
  const playerRow = findPlayer_(player);
  const canonicalName = playerRow ? playerRow.name : player;

  // 🗑️ まず同プレイヤーの同コース・同カテゴリの既存レコードを削除（上書き方式）
  //    正規の綴りと、渡された綴り(旧データが別綴りで残っている場合)の両方を消す
  const namesToDelete = canonicalName === player ? [canonicalName] : [canonicalName, player];
  namesToDelete.forEach(function (nm) {
    UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/times'
      + '?track_name=eq.' + encodeURIComponent(trackName)
      + '&category=eq.General'
      + '&player=eq.' + encodeURIComponent(nm), {
      method: 'DELETE',
      headers: {
        ...supabaseAuthHeaders_(),   // service_role(Script Properties)
      },
      muteHttpExceptions: true
    });
  });

  // ✍️ 新しいレコードをINSERT
  // rankは暫定で0を入れ、Supabase_Formatted.gs の syncAll() で整合させてもらう想定
  const row = {
    track_name: trackName,
    category:   'General',
    rank:        0,
    player:      canonicalName,
    time:        time,
    video:       proof || '',
    channel:     (playerRow && playerRow.channel_url) || '',
    country:     country || (playerRow && playerRow.country) || '',
    player_id:   playerRow ? playerRow.id : null,
  };

  UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/times', {
    method: 'POST',
    headers: {
      ...supabaseAuthHeaders_(),   // service_role(Script Properties)
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify(row),
    muteHttpExceptions: true
  });
}

// Flap記録を flap_times に反映する。同一(コース, 選手)は最速のみ保持し、遅い/同タイムなら何もしない。
function syncFlapToSupabase(player, trackAbbr, time, proof) {
  const trackInfo = resolveTrack_(trackAbbr);
  if (!trackInfo || !trackInfo.key) {
    console.warn("Flap sync skipped: no track mapping for abbr=" + trackAbbr);
    return;
  }
  const playerRow = findPlayer_(player);
  if (!playerRow || playerRow.id == null) {
    console.warn("Flap sync skipped: player not in players table: " + player);
    return;
  }
  const newMs = timeToMs(time);
  if (!(newMs > 0) || newMs >= 999999999) {
    console.warn("Flap sync skipped: invalid time " + time);
    return;
  }

  const base = SUPABASE_URL + '/rest/v1/flap_times';
  const q = '?track_key=eq.' + encodeURIComponent(trackInfo.key) + '&player_id=eq.' + encodeURIComponent(playerRow.id);

  // 既存の自己ベストを確認
  const cur = UrlFetchApp.fetch(base + q + '&select=time_ms', {
    method: 'GET', headers: supabaseAuthHeaders_(), muteHttpExceptions: true
  });
  if (cur.getResponseCode() !== 200) {
    throw new Error('flap lookup failed: HTTP ' + cur.getResponseCode());
  }
  const existing = JSON.parse(cur.getContentText());
  if (existing.length && existing[0].time_ms <= newMs) return;   // 既存のほうが速い/同タイム

  const res = UrlFetchApp.fetch(base + '?on_conflict=track_key,player_id', {
    method: 'POST',
    headers: Object.assign({}, supabaseAuthHeaders_(), {
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    }),
    payload: JSON.stringify({
      track_key: trackInfo.key,
      player_id: playerRow.id,
      time_ms:   newMs,
      video_url: proof || null
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('flap upsert failed: HTTP ' + res.getResponseCode() + ' ' + res.getContentText());
  }
}

function timeToMs(timeStr) {
  if (!timeStr) return 999999999;
  const str = String(timeStr).trim();
  let ms = 0, parts = str.split(':');
  if (parts.length === 2) {
    ms += parseInt(parts[0], 10) * 60000;
    let secParts = parts[1].split('.');
    ms += parseInt(secParts[0], 10) * 1000;
    if (secParts[1]) ms += parseInt(secParts[1].padEnd(3, '0').substring(0,3), 10);
  } else {
    let secParts = str.split('.');
    ms += parseInt(secParts[0], 10) * 1000;
    if (secParts[1]) ms += parseInt(secParts[1].padEnd(3, '0').substring(0,3), 10);
  }
  return ms;
}

// ==========================================
// 🌟 追加：承認待ちの「記録」をシートから拾ってくる処理
// ==========================================
function handleGetPendingRecords(pn, password) {
  const auth = authenticate(pn, password);
  if (!auth.valid || !auth.isStaff) return { success: false, message: "Unauthorized access." };

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Submissions");
  if (!sheet) return { success: false, message: "Submissions sheet not found." };
  
  const data = sheet.getDataRange().getValues();
  let pendingRecords = [];

  // 1行目は見出しなので2行目(i=1)からチェック
  for (let i = 1; i < data.length; i++) {
    // F列（インデックス5）が承認状況 (true/false)
    const status = data[i][5];
    const isApproved = String(status).toUpperCase() === "TRUE" || status === true;
    const isRejected = String(status).toUpperCase() === "REJECTED"; 

    // 未承認で、かつ拒否もされていない記録だけをリストに追加
    if (data[i][1] && !isApproved && !isRejected) { 
      pendingRecords.push({
        row: i + 1,           // シート上の行番号
        timestamp: data[i][0],// A列: 日時
        player: data[i][1],   // B列: プレイヤー名
        track: data[i][2],    // C列: コース名
        time: data[i][3],     // D列: タイム
        proof: data[i][4],    // E列: 証拠URL
        category: data[i][6]  // G列: カテゴリー
      });
    }
  }
  return { success: true, records: pendingRecords };
}

// ==========================================
// 🌟 追加：サイトから「Approve/Reject」された時の処理
// ==========================================
// ==========================================
// 🌟 修正版：サイトから「Approve/Reject」された時の処理
// ==========================================
function handleRecordAction(pn, password, row, decision) {
  const auth = authenticate(pn, password);
  if (!auth.valid || !auth.isStaff) return { success: false, message: "Unauthorized access." };

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Submissions");
  if (!sheet) return { success: false, message: "Submissions sheet not found." };

  if (decision === "approve") {
    // 🚨【超重要修正】getValue() を getDisplayValue() に変更！
    // これで勝手に日付に変換されるのを防ぎ、「1:23.456」という純粋な文字として友達のプログラムに渡せます。
    const recordData = {
      timestamp: sheet.getRange(row, 1).getValue(),          // A列: 日時はDateのままでOK
      player: sheet.getRange(row, 2).getDisplayValue(),      // B列
      track: sheet.getRange(row, 3).getDisplayValue(),       // C列
      time: sheet.getRange(row, 4).getDisplayValue(),        // D列: 👈 今回のエラーの真犯人！
      proof: sheet.getRange(row, 5).getDisplayValue(),       // E列
      category: sheet.getRange(row, 7).getDisplayValue()     // G列
    };
    
    try {
      const success = executeRecordApproval(recordData);
      
      if (success) {
        sheet.getRange(row, 6).setValue(true); // F列に承認完了の印をつける
        return { success: true };
      }
    } catch (e) {
      // エラーメッセージもUIに合わせて英語にしました
      return { success: false, message: "Spreadsheet update failed: " + e.message };
    }
  } else if (decision === "reject") {
    sheet.getRange(row, 6).setValue("REJECTED");
    return { success: true };
  }
  
  return { success: false, message: "Invalid decision." };
}

function handleGetPlayerList(pn, password) {
  const auth = authenticate(pn, password);
  if (!auth.valid || !auth.isStaff) return { success: false, message: "Unauthorized." };
  const players = getPlayers_()
    .filter(function (p) { return p.status === 'approved' && !p.is_blacklisted; })
    .map(function (p) { return p.name; });
  return { success: true, players };
}

function handleStaffSubmit(pn, password, targetPn, track, category, time, proof) {
  const auth = authenticate(pn, password);
  if (!auth.valid || !auth.isStaff) return { success: false, message: "Unauthorized." };

  const ss = SpreadsheetApp.openById(MAIN_SS_ID);
  const sheet = ss.getSheetByName("Submissions");
  if (!sheet) return { success: false, message: "Submissions sheet not found." };

  sheet.appendRow([new Date(), targetPn, track, time, proof, true, category]);

  const recordData = {
    timestamp: new Date(),
    player: targetPn,
    track: track,
    time: time,
    proof: proof,
    category: category
  };

  try {
    executeRecordApproval(recordData);
  } catch (e) {
    return { success: false, message: "Spreadsheet update failed: " + e.message };
  }

  const msg = `🛡️ **Staff Record Added**\n**Added by:** \`${pn}\`\n**Player:** \`${targetPn}\`\n**Track:** \`${track}\`\n**Category:** \`${category}\`\n**Time:** \`${time}\`\n**Proof:** ${proof}`;
  sendDiscordNotification(msg);

  return { success: true };
}