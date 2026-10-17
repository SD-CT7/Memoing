
const COLLECTOR_URL =
  "https://ctww-room-collector.sddazo-0320.workers.dev";

const playerInput = document.getElementById("playerName");
const saveButton = document.getElementById("savePlayer");
const playerStatus = document.getElementById("playerStatus");
const enablePushButton = document.getElementById("enablePush");
const pushStatus = document.getElementById("pushStatus");

const PLAYER_STORAGE_KEY = "ctwwRoomMonitorPlayerName";

function getPlayerName() {
  return playerInput.value.trim();
}

function setPlayerStatus(message) {
  if (playerStatus) playerStatus.textContent = message;
}

function setPushStatus(message) {
  if (pushStatus) pushStatus.textContent = message;
}

function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function getVapidPublicKey() {
  const response = await fetch(
    `${COLLECTOR_URL}/api/vapid-public-key`
  );

  if (!response.ok) {
    throw new Error(`公開鍵の取得に失敗しました (HTTP ${response.status})`);
  }

  const result = await response.json();

  if (!result.publicKey) {
    throw new Error("VAPID公開鍵が返されませんでした。");
  }

  return result.publicKey;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("このブラウザーはService Workerに対応していません。");
  }

  if (!window.isSecureContext) {
    throw new Error("HTTPSで公開されたサイトを開いてください。");
  }

  await navigator.serviceWorker.register("/sw.js");
  return await navigator.serviceWorker.ready;
}

// プレイヤー名を保存
saveButton?.addEventListener("click", () => {
  const playerName = getPlayerName();

  if (!playerName) {
    setPlayerStatus("プレイヤー名を入力してください。");
    return;
  }

  localStorage.setItem(PLAYER_STORAGE_KEY, playerName);
  setPlayerStatus(`監視対象を「${playerName}」に設定しました。`);
});

// 保存済みのプレイヤー名を復元
const savedPlayerName = localStorage.getItem(PLAYER_STORAGE_KEY);

if (savedPlayerName && playerInput) {
  playerInput.value = savedPlayerName;
}

// プッシュ通知を有効化し、購読情報をCloudflareに保存
enablePushButton?.addEventListener("click", async () => {
  try {
    if (!("PushManager" in window) || !("Notification" in window)) {
      throw new Error("このブラウザーはプッシュ通知に対応していません。");
    }

    const playerName = getPlayerName();

    if (!playerName) {
      throw new Error("先にプレイヤー名を入力してください。");
    }

    enablePushButton.disabled = true;
    setPushStatus("通知の準備をしています…");

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error(
        permission === "denied"
          ? "通知がブロックされています。ブラウザーのサイト設定を確認してください。"
          : "通知の許可が選択されませんでした。"
      );
    }

    const registration = await registerServiceWorker();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const publicKey = await getVapidPublicKey();

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey),
      });
    }

    const response = await fetch(`${COLLECTOR_URL}/api/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        playerName,
        subscription: subscription.toJSON(),
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        result.error ||
          `購読情報の保存に失敗しました (HTTP ${response.status})`
      );
    }

    localStorage.setItem(PLAYER_STORAGE_KEY, playerName);

    setPlayerStatus(`監視対象：「${playerName}」`);
    setPushStatus(
      `通知購読を登録しました。「${playerName}」の情報をCloudflareに保存しました。`
    );
  } catch (error) {
    setPushStatus(`設定できませんでした: ${error.message}`);
  } finally {
    if (enablePushButton) {
      enablePushButton.disabled = false;
    }
  }
});
