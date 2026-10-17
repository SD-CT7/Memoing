
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

document.getElementById("enablePush").addEventListener("click", () => {
  document.getElementById("pushStatus").textContent =
    "通知機能はまだ準備中です。次の手順で登録機能を追加します。";
});
