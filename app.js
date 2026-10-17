
const playerInput = document.getElementById("playerName");
const saveButton = document.getElementById("savePlayer");
const playerStatus = document.getElementById("playerStatus");

saveButton.addEventListener("click", () => {
  const playerName = playerInput.value.trim();

  if (!playerName) {
    playerStatus.textContent = "プレイヤー名を入力してください。";
    return;
  }

  playerStatus.textContent =
    `監視対象を「${playerName}」に設定しました。`;

  // この段階では画面上の設定のみです。
  // 実際の監視処理は次の段階で実装します。
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("このブラウザーはService Workerに対応していません。");
  }

  if (!window.isSecureContext) {
    throw new Error("HTTPSで公開されたサイトを開いてください。");
  }

  return await navigator.serviceWorker.register("/sw.js");
}

document.getElementById("enablePush").addEventListener("click", async () => {
  const status = document.getElementById("pushStatus");

  try {
    await registerServiceWorker();

    status.textContent =
      "Service Workerを登録できました。次は通知購読の設定を行います。";
  } catch (error) {
    status.textContent = "登録に失敗しました: " + error.message;
  }
});
