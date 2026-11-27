/**
 * ============================================================
 *  GAS JSON エクスポート プロキシ
 * ============================================================
 *
 * 【デプロイ手順】
 * 1. https://script.google.com で「新しいプロジェクト」を作成
 * 2. このコードをすべて貼り付けて保存
 * 3. 初回は forceOAuthScopes_() を一度実行して権限を承認
 * 4. 「デプロイ」→「新しいデプロイ」
 *    - 種類の選択: ウェブアプリ
 *    - 説明: 任意（例: GAS Export Proxy）
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 「自分のみ」または「全員」
 *      ※ ツールから呼ぶ場合は「全員」推奨（匿名でも動く）
 * 5. 「デプロイ」後に表示されるウェブアプリURLをコピー
 * 6. 変換ツールの「プロキシURL」欄に貼る
 *
 * 【呼び出し例】
 *   GET  https://script.google.com/macros/s/XXXX/exec?id=PROJECT_ID
 *   POST https://script.google.com/macros/s/XXXX/exec
 *        body: {"id":"PROJECT_ID"}
 *
 * 【注意】
 * - プロキシを実行するGoogleアカウントが、対象のApps Scriptプロジェクトに
 *   アクセスできる必要があります（編集者 or 閲覧者）。
 * - 他人の非公開プロジェクトは取得できません。
 */

function doGet(e) {
  const id = (e && e.parameter && e.parameter.id) ? e.parameter.id.trim() : '';
  return handleRequest_(id);
}

function doPost(e) {
  let id = '';
  try {
    if (e && e.postData && e.postData.contents) {
      const body = JSON.parse(e.postData.contents);
      id = (body.id || '').toString().trim();
    }
  } catch (_) {}
  if (!id && e && e.parameter) {
    id = (e.parameter.id || '').toString().trim();
  }
  return handleRequest_(id);
}

/**
 * メイン処理
 */
function handleRequest_(projectId) {
  const out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);

  // CORS 対応（ブラウザからの fetch を許可）
  // ContentService は CORS ヘッダーを直接付けられないが、
  // ウェブアプリは Google 側で一定の CORS を処理する。
  // 問題が出る場合は JSONP 風にするか、フロントで mode: 'no-cors' は使わない。

  if (!projectId) {
    return json_(out, {
      ok: false,
      error: 'project id is required. Use ?id=PROJECT_ID or POST {"id":"..."}'
    });
  }

  // ID の簡易バリデーション
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(projectId)) {
    return json_(out, {
      ok: false,
      error: 'invalid project id format'
    });
  }

  try {
    const exportUrl =
      'https://script.google.com/feeds/download/export?id=' +
      encodeURIComponent(projectId) +
      '&format=json';

    const res = UrlFetchApp.fetch(exportUrl, {
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        Accept: 'application/json'
      },
      muteHttpExceptions: true,
      followRedirects: true
    });

    const code = res.getResponseCode();
    const body = res.getContentText();

    if (code !== 200) {
      return json_(out, {
        ok: false,
        error: 'export request failed',
        status: code,
        detail: body.slice(0, 800)
      });
    }

    // 正常時はそのままプロジェクトJSONを返す
    // （フロント側で files[] を処理する）
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (parseErr) {
      return json_(out, {
        ok: false,
        error: 'response is not valid JSON',
        detail: body.slice(0, 300)
      });
    }

    // フロントが扱いやすいよう ok フラグを付ける（元データは維持）
    if (Array.isArray(parsed.files)) {
      parsed.ok = true;
      parsed.projectId = projectId;
      return json_(out, parsed);
    }

    // 想定外の形でもそのまま返す
    return json_(out, {
      ok: true,
      projectId: projectId,
      raw: parsed
    });

  } catch (err) {
    return json_(out, {
      ok: false,
      error: err.message || String(err)
    });
  }
}

function json_(output, obj) {
  output.setContent(JSON.stringify(obj));
  return output;
}

/**
 * 初回実行用：必要なOAuthスコープを引き出す
 * エディタでこの関数を選択して「実行」→ 権限を承認してください
 */
function forceOAuthScopes_() {
  // UrlFetchApp + ScriptApp.getOAuthToken() で必要なスコープが付与される
  ScriptApp.getOAuthToken();
  // Drive 関連を触る場合があるため念のため
  try {
    DriveApp.getRootFolder();
  } catch (_) {}
  Logger.log('OAuth scopes are ready. You can now deploy the web app.');
}
