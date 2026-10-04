import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be between 1024 and 65535");
const url = `http://127.0.0.1:${port}`;
async function health() {
  try {
    return (
      (
        await (
          await fetch(url + "/api/health", {
            signal: AbortSignal.timeout(1000),
          })
        ).json()
      ).app === "abyss-sprite-lab"
    );
  } catch {
    return false;
  }
}
function open() {
  console.log(`Sprite Lab: ${url}`);
  if (process.argv.includes("--no-open")) return;
  const child = spawn(
    process.platform === "win32"
      ? "cmd.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open",
    process.platform === "win32" ? ["/c", "start", "", url] : [url],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.on("error", () => console.log("Open this address in your browser."));
  child.unref();
}
if (!(await health())) {
  if (!fs.existsSync(path.join(root, "node_modules", "vite"))) {
    console.error(
      "Dependencies are missing. Run pnpm install, then start.cmd again.",
    );
    process.exit(1);
  }
  // Build only when sources/config/lockfile are newer, so a second launch is fast.
  const target = path.join(root, "dist", "index.html");
  function latest(folder) {
    return Math.max(
      ...fs
        .readdirSync(folder, { withFileTypes: true })
        .map((e) =>
          e.isDirectory()
            ? latest(path.join(folder, e.name))
            : fs.statSync(path.join(folder, e.name)).mtimeMs,
        ),
      0,
    );
  }
  const dirty =
    !fs.existsSync(target) ||
    Math.max(
      latest(path.join(root, "src")),
      fs.statSync(path.join(root, "vite.config.ts")).mtimeMs,
      fs.statSync(path.join(root, "pnpm-lock.yaml")).mtimeMs,
    ) > fs.statSync(target).mtimeMs;
  if (dirty) {
    for (const [file, args] of [
      ["typescript/bin/tsc", ["-b"]],
      ["vite/bin/vite.js", ["build"]],
    ]) {
      const result = spawnSync(
        process.execPath,
        [path.join(root, "node_modules", file), ...args],
        { cwd: root, stdio: "inherit", windowsHide: true },
      );
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
  const local = path.join(root, ".local");
  fs.mkdirSync(local, { recursive: true });
  const log = fs.openSync(path.join(local, "server.log"), "a");
  const server = spawn(
    process.execPath,
    [path.join(root, "server/index.mjs")],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
    },
  );
  server.unref();
  fs.closeSync(log);
  fs.writeFileSync(path.join(local, "server.pid"), String(server.pid));
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (await health()) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) {
    console.error(
      "Server did not start. Check .local/server.log (the port may be occupied).",
    );
    process.exit(1);
  }
}
open();
