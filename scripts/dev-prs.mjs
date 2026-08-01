#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";

const PROXY_PORT = process.env.PRS_PROXY_PORT ?? "3010";
const NEXT_PORT = process.env.PORT ?? "3000";

function freePort(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (!out) return;
    for (const pid of out.split("\n")) {
      if (pid) process.kill(Number(pid), "SIGTERM");
    }
  } catch {
    /* nothing listening */
  }
}

freePort(PROXY_PORT);
freePort(NEXT_PORT);

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
run("npx", ["next", "dev", "--webpack", "--port", NEXT_PORT]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
