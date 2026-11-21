
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const logFile = "Logs.txt";

  // ログファイルを新規作成・初期化
  fs.writeFileSync(
    logFile,
    `Web Inspection Log\nStarted: ${new Date().toISOString()}\n\n`
  );

  function log(type, message) {
    const line = `[${new Date().toISOString()}] [${type}] ${message}\n`;

    fs.appendFileSync(logFile, line);
    console.log(line.trim());
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", msg => {
    log(`CONSOLE:${msg.type()}`, msg.text());
  });

  page.on("pageerror", error => {
    log("PAGE ERROR", error.stack || error.message);
  });

  page.on("requestfailed", request => {
    log(
      "REQUEST FAILED",
      `${request.url()} | ${request.failure()?.errorText || "Unknown"}`
    );
  });

  page.on("response", response => {
    if (response.status() >= 400) {
      log(
        "HTTP ERROR",
        `${response.status()} ${response.statusText()} | ${response.url()}`
      );
    }
  });

  try {
    const url = process.argv[2];

    if (!url) throw new Error("URLを指定してください");

    log("INFO", `Target: ${url}`);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    log("INFO", "Page loaded");

    await page.waitForTimeout(10000);

  } catch (error) {
    log("FATAL ERROR", error.stack || error.message);
  } finally {
    await browser.close();
    log("INFO", "Inspection finished");
  }
})();
