#!/usr/bin/env node
/**
 * Single public entry for the presentation host.
 * Browser → :PORT /prs-api/* → local PRS proxy (Tailscale origin, unbuffered SSE)
 * Browser → :PORT /*         → Next
 *
 * Keeps raw PRS off any public hostname/port; Cloudflare only needs this one port.
 */
import http from "node:http";
import { URL } from "node:url";

const LISTEN = Number(process.env.PORT ?? 3000);
const BIND = process.env.HOSTNAME ?? "0.0.0.0";
const NEXT_UPSTREAM = (process.env.NEXT_UPSTREAM ?? "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
const PRS_UPSTREAM = (
  process.env.PRS_PROXY_UPSTREAM ?? "http://127.0.0.1:3010"
).replace(/\/$/, "");

function isPrsPath(urlPath) {
  return urlPath === "/prs-api" || urlPath.startsWith("/prs-api/");
}

function proxy(req, res, upstreamBase) {
  const incoming = new URL(req.url ?? "/", `http://127.0.0.1:${LISTEN}`);
  const target = new URL(incoming.pathname + incoming.search, `${upstreamBase}/`);
  const headers = { ...req.headers, host: target.host };
  delete headers["content-length"];

  req.socket?.setNoDelay?.(true);

  const proxyReq = http.request(
    target,
    {
      method: req.method,
      headers,
    },
    (proxyRes) => {
      proxyRes.socket?.setNoDelay?.(true);
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end(error.message);
    } else {
      res.destroy(error);
    }
  });

  req.on("aborted", () => {
    proxyReq.destroy();
  });
  res.on("close", () => {
    proxyReq.destroy();
  });

  if (req.method === "GET" || req.method === "HEAD") {
    proxyReq.end();
    return;
  }
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${LISTEN}`).pathname;
  if (isPrsPath(pathname)) {
    proxy(req, res, PRS_UPSTREAM);
    return;
  }
  proxy(req, res, NEXT_UPSTREAM);
});

server.listen(LISTEN, BIND, () => {
  console.log(
    `[gateway] http://${BIND}:${LISTEN} → next ${NEXT_UPSTREAM} ; /prs-api → ${PRS_UPSTREAM}`,
  );
});
