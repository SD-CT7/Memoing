
self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: "CTWW Room Monitor",
      body: event.data ? event.data.text() : "通知を受信しました。"
    };
  }

  const title = data.title || "CTWW Room Monitor";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "監視対象のプレイヤーがオンラインになりました。",
      icon: "/icon.png",
      data: { url: "/" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(
      event.notification.data?.url || "/"
    )
  );
});
