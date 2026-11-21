const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", msg =>
    console.log(`[${msg.type()}] ${msg.text()}`)
  );

  page.on("pageerror", error =>
    console.log("[PAGE ERROR]", error.message)
  );

  page.on("requestfailed", request =>
    console.log("[REQUEST FAILED]", request.url())
  );

  page.on("response", response => {
    if (response.status() >= 400) {
      console.log(
        "[HTTP ERROR]",
        response.status(),
        response.url()
      );
    }
  });

  await page.goto(process.argv[2], {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(10000);

  await browser.close();
})();
