
const { chromium } = require("playwright");
const fs = require("fs");

const LOG_FILE = "Logs.txt";
const MAX_BODY_SIZE = 100 * 1024; // 100 KB

fs.writeFileSync(
  LOG_FILE,
  `WEB INSPECTION LOG\nStarted: ${new Date().toISOString()}\n\n`
);

function log(section, message) {
  fs.appendFileSync(
    LOG_FILE,
    `\n[${new Date().toISOString()}] [${section}]\n${message}\n`
  );
  console.log(`[${section}] ${message}`);
}

function safeHeaders(headers) {
  const result = { ...headers };

  for (const key of Object.keys(result)) {
    if (/authorization|cookie|token|api-key/i.test(key)) {
      result[key] = "[REDACTED]";
    }
  }

  return result;
}

(async () => {
  const url = process.argv[2];

  if (!url) {
    log("ERROR", "URLを指定してください");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Console
  page.on("console", msg => {
    log(`CONSOLE:${msg.type()}`, msg.text());
  });

  page.on("pageerror", error => {
    log("PAGE ERROR", error.stack || error.message);
  });

  // Network: Request
  page.on("request", async request => {
    let headers = {};

    try {
      headers = safeHeaders(await request.allHeaders());
    } catch {}

    log("NETWORK REQUEST", [
      `URL: ${request.url()}`,
      `Method: ${request.method()}`,
      `Type: ${request.resourceType()}`,
      `Headers: ${JSON.stringify(headers, null, 2)}`,
      `Payload: ${request.postData() || "(none)"}`
    ].join("\n"));
  });

  // Network: Response
  page.on("response", async response => {
    const request = response.request();

    let headers = {};
    let body = "(not available)";

    try {
      headers = safeHeaders(await response.allHeaders());

      const contentType =
        response.headers()["content-type"] || "";

      const contentLength =
        Number(response.headers()["content-length"] || 0);

      const isText =
        /json|text|javascript|xml|x-www-form-urlencoded|graphql/i
          .test(contentType);

      if (isText && contentLength <= MAX_BODY_SIZE) {
        const text = await response.text();

        body = text.length > MAX_BODY_SIZE
          ? text.slice(0, MAX_BODY_SIZE) + "\n[TRUNCATED]"
          : text;
      } else if (!isText) {
        body = `[Binary / unsupported content: ${contentType}]`;
      } else {
        body = "[Response too large]";
      }
    } catch (error) {
      body = `[BODY ERROR] ${error.message}`;
    }

    log("NETWORK RESPONSE", [
      `URL: ${response.url()}`,
      `Method: ${request.method()}`,
      `Status: ${response.status()} ${response.statusText()}`,
      `Headers: ${JSON.stringify(headers, null, 2)}`,
      `Body:\n${body}`
    ].join("\n"));
  });

  // Network: Failed requests
  page.on("requestfailed", request => {
    log("NETWORK FAILED", [
      `URL: ${request.url()}`,
      `Method: ${request.method()}`,
      `Reason: ${request.failure()?.errorText || "Unknown"}`
    ].join("\n"));
  });

  // WebSocket
  page.on("websocket", ws => {
    log("WEBSOCKET", `URL: ${ws.url()}`);

    ws.on("close", () => {
      log("WEBSOCKET CLOSED", ws.url());
    });

    ws.on("socketerror", error => {
      log("WEBSOCKET ERROR", `${ws.url()} ${error}`);
    });
  });

  try {
    log("INFO", `Target: ${url}`);

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    log("INFO", "Page loaded. Monitoring for 30 seconds.");

    await page.waitForTimeout(30000);

  } catch (error) {
    log("FATAL ERROR", error.stack || error.message);
  } finally {
    await browser.close();
    log("INFO", "Inspection finished.");
  }
})();
