#!/usr/bin/env node
/**
 * Production entry: PRS SSE proxy + Next server (Docker / LAN presentation host).
 */
import { spawn } from "node:child_process";

const PORT = process.env.PORT ?? "3000";
const HOST = process.env.HOSTNAME ?? "0.0.0.0";

const children = [];

function run(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
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

run(process.execPath, ["scripts/prs-proxy.mjs"]);
run("npx", ["next", "start", "--webpack", "-H", HOST, "-p", PORT]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
