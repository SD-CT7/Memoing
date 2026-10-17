
const SOURCE_URL =
  "https://ctwwrooms.sddazo-0320.workers.dev/";

const RETENTION_SECONDS = 7 * 24 * 60 * 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function collectSnapshot(env) {
  const fetchedAt = Math.floor(Date.now() / 1000);

  const response = await fetch(SOURCE_URL, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Source API returned HTTP ${response.status}`);
  }

  const payload = await response.text();
  JSON.parse(payload);

  await env.DB.prepare(
    `INSERT INTO room_snapshots (fetched_at, payload)
     VALUES (?, ?)`
  ).bind(fetchedAt, payload).run();

  await env.DB.prepare(
    `DELETE FROM room_snapshots WHERE fetched_at < ?`
  ).bind(fetchedAt - RETENTION_SECONDS).run();

  console.log(
    `Snapshot saved at ${fetchedAt}; bytes=${new TextEncoder().encode(payload).length}`
  );
}

export default {
  async scheduled(controller, env, ctx) {
    await collectSnapshot(env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" &&
    url.pathname === "/api/vapid-public-key") {
  return jsonResponse({
    publicKey: env.VAPID_PUBLIC_KEY
  });
}

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      if (url.pathname === "/health") {
        return jsonResponse({
          status: "ok",
          collector: "ctww-room-collector",
        });
      }

      if (url.pathname === "/api/latest") {
        const row = await env.DB.prepare(
          `SELECT id, fetched_at, payload
           FROM room_snapshots
           ORDER BY fetched_at DESC, id DESC
           LIMIT 1`
        ).first();

        if (!row) {
          return jsonResponse({ error: "No snapshots yet" }, 404);
        }

        return jsonResponse({
          id: row.id,
          fetched_at: row.fetched_at,
          data: JSON.parse(row.payload),
        });
      }

      if (url.pathname === "/api/history") {
        const requestedLimit = Number(url.searchParams.get("limit") || 100);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
          : 100;

        const result = await env.DB.prepare(
          `SELECT id, fetched_at, payload
           FROM room_snapshots
           WHERE fetched_at >= ?
           ORDER BY fetched_at DESC, id DESC
           LIMIT ?`
        ).bind(
          Math.floor(Date.now() / 1000) - RETENTION_SECONDS,
          limit
        ).all();

        return jsonResponse({
          count: result.results.length,
          snapshots: result.results.map(row => ({
            id: row.id,
            fetched_at: row.fetched_at,
            data: JSON.parse(row.payload),
          })),
        });
      }

      return jsonResponse({
        error: "Not found",
        endpoints: ["/health", "/api/latest", "/api/history?limit=100"],
      }, 404);
    } catch (error) {
      console.error("Request failed:", error);
      return jsonResponse({ error: "Internal server error" }, 500);
    }
  },
};
