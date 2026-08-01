#!/usr/bin/env node
/**
 * Local same-origin PRS proxy for presentation consumers.
 * Browser → Next (/prs-api) → this proxy → http://<tailscale>:8080/api
 */
import http from "node:http";
import { URL } from "node:url";

const PRS_HOST = (process.env.PRS_HOST ?? "http://100.91.252.69:8080").replace(/\/$/, "");
const PORT = Number(process.env.PRS_PROXY_PORT ?? 3010);
const BIND = process.env.PRS_PROXY_BIND ?? "127.0.0.1";

const ALLOWED = new Set([
  "presentation/snapshot",
  "runtime/events/stream",
  "brain_and_soul/transport/stream",
  "vision/snapshot/latest",
]);

function isAllowed(pathname) {
  const path = pathname.replace(/^\/+/, "");
  if (path.startsWith("vision/")) return true;
  for (const prefix of ALLOWED) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "accept, cache-control",
};

const server = http.createServer((req, res) => {
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, { ...CORS, "access-control-max-age": "86400" });
    res.end();
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    res.writeHead(405, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const incoming = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  let apiPath = incoming.pathname;
  if (apiPath.startsWith("/prs-api/")) apiPath = apiPath.slice("/prs-api/".length);
  else if (apiPath.startsWith("/api/")) apiPath = apiPath.slice("/api/".length);
  else apiPath = apiPath.replace(/^\//, "");
  apiPath = apiPath.replace(/\/+$/, "");

  if (!isAllowed(apiPath)) {
    res.writeHead(404, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify({ error: "PRS proxy path not allowed" }));
    return;
  }

  const upstream = new URL(`${PRS_HOST}/api/${apiPath}`);
  upstream.search = incoming.search;

  req.socket?.setNoDelay?.(true);

  const proxyReq = http.request(
    upstream,
    {
      method: "GET",
      headers: {
        accept: req.headers.accept ?? "text/event-stream, application/json, */*",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    },
    (proxyRes) => {
      proxyRes.socket?.setNoDelay?.(true);
      const headers = {
        ...CORS,
        "cache-control": "no-store, no-cache, must-revalidate",
        "x-accel-buffering": "no",
      };
      const contentType = proxyRes.headers["content-type"];
      if (contentType) headers["content-type"] = contentType;
      // Pass SSE through unbuffered; never aggregate the body.
      if (String(contentType ?? "").includes("text/event-stream")) {
        headers["connection"] = "keep-alive";
      }
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      if (method === "HEAD") {
        proxyRes.resume();
        res.end();
        return;
      }
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify({ error: error.message }));
    } else {
      res.destroy(error);
    }
  });

  req.on("close", () => {
    proxyReq.destroy();
  });

  proxyReq.end();
});

server.listen(PORT, BIND, () => {
  console.log(`[prs-proxy] http://${BIND}:${PORT}/prs-api → ${PRS_HOST}/api (SSE unbuffered + CORS)`);
});
