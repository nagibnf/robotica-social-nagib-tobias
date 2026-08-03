#!/usr/bin/env node
/**
 * Production entry: internal Next + internal PRS proxy + public gateway.
 * Only the gateway port is published; PRS stays on Tailscale via loopback proxy.
 */
import { spawn } from "node:child_process";

const PUBLIC_PORT = process.env.PORT ?? "3000";
const PUBLIC_BIND = process.env.HOSTNAME ?? "0.0.0.0";
const NEXT_INTERNAL_PORT = process.env.NEXT_INTERNAL_PORT ?? "3001";
const PRS_PROXY_PORT = process.env.PRS_PROXY_PORT ?? "3010";

const children = [];

function run(command, args, env = process.env) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  child.on("exit", (code, signal) => {
    for (const other of children) {
      if (other !== child && !other.killed) other.kill(signal ?? "SIGTERM");
    }
    process.exit(code ?? 1);
  });
  children.push(child);
  return child;
}

// PRS proxy: loopback only — never published.
run(process.execPath, ["scripts/prs-proxy.mjs"], {
  ...process.env,
  PRS_PROXY_PORT,
  PRS_PROXY_BIND: "127.0.0.1",
});

// Next: loopback only; gateway is the public face.
run("npx", ["next", "start", "-H", "127.0.0.1", "-p", NEXT_INTERNAL_PORT], {
  ...process.env,
  PORT: NEXT_INTERNAL_PORT,
  HOSTNAME: "127.0.0.1",
});

run(process.execPath, ["scripts/presentation-gateway.mjs"], {
  ...process.env,
  PORT: PUBLIC_PORT,
  HOSTNAME: PUBLIC_BIND,
  NEXT_UPSTREAM: `http://127.0.0.1:${NEXT_INTERNAL_PORT}`,
  PRS_PROXY_UPSTREAM: `http://127.0.0.1:${PRS_PROXY_PORT}`,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
