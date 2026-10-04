import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { exists, xmlFile, a, scan, importItem, reference } from "./library.mjs";
import { installMcp } from "./mcp-service.mjs";
import { VERSION } from "../shared/mcp-contract.mjs";
import {
  createSaveback,
  sourceAccess,
  fingerprint,
  readXmlText,
} from "./saveback.mjs";

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const gameRoot =
  process.env.BAROTRAUMA_GAME || "D:/SteamLibrary/steamapps/common/Barotrauma";
const workshop =
  process.env.BAROTRAUMA_WORKSHOP ||
  "D:/SteamLibrary/steamapps/workshop/content/602960";
const roots = [],
  cache = new Map();
const saveback = createSaveback(gameRoot);
async function register(folder) {
  if (
    !path.isAbsolute(folder) ||
    path.parse(folder).root === path.resolve(folder)
  )
    throw new Error("请选择具体 Mod 文件夹");
  const dir = await fs.realpath(folder);
  if (!(await fs.stat(dir)).isDirectory()) throw new Error("这不是文件夹");
  const old = roots.find((r) => r.path.toLowerCase() === dir.toLowerCase());
  if (old) return old;
  let meta = {};
  try {
    meta = a((await xmlFile(path.join(dir, "filelist.xml"))).contentpackage);
  } catch {
    /* loose textures */
  }
  const r = {
    id: Buffer.from(dir).toString("base64url"),
    path: dir,
    name: meta.name || path.basename(dir),
    workshopId:
      meta.steamworkshopid ||
      (/^\d+$/.test(path.basename(dir)) ? path.basename(dir) : ""),
  };
  Object.assign(r, await sourceAccess(r, null, gameRoot));
  roots.push(r);
  return r;
}
for (const p of [
  path.join(gameRoot, "LocalMods/Empire Arms"),
  path.join(workshop, "2809175631"),
  path.join(workshop, "3159849099"),
  path.join(workshop, "3630177833"),
  path.join(workshop, "3443540295"),
  path.join(workshop, "2852411866"), // texture dependency used by 九州武库 Rebalance
]) {
  if (await exists(p)) await register(p);
}
const app = express();
const httpServer = createServer(app);
app.disable("x-powered-by");
app.use((req, res, next) => {
  const allowedHosts = ["127.0.0.1", "localhost", "[::1]"];
  if (!allowedHosts.includes(req.hostname))
    return res.status(403).json({ error: "只允许本机访问" });
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    return res.status(403).json({ error: "不允许跨站访问本地资源" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
// Images in editor snapshots/captures can be larger than ordinary XML requests.
app.use("/api/editor", express.json({ limit: "16mb" }));
app.use(express.json({ limit: "2mb" }));
const rootOf = (req) => {
  const r = roots.find((r) => r.id === req.query.root);
  if (!r) throw new Error("请选择已连接的 Mod");
  return r;
};
async function safeFile(p) {
  const real = await fs.realpath(p);
  const within = (dir) => {
    const rel = path.relative(dir, real);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  if (
    !roots.some((r) => within(r.path)) &&
    !within(path.join(gameRoot, "Content"))
  )
    throw new Error("文件不在已连接的资源目录中");
  return real;
}
app.get("/api/health", (req, res) =>
  res.json({ app: "abyss-sprite-lab", phase: 2, version: VERSION, mcp: true }),
);
app.get("/api/roots", (req, res) => res.json(roots));
app.post("/api/roots", async (req, res) =>
  res.json(await register(String(req.body.path || ""))),
);
app.get("/api/library", async (req, res) => {
  const root = rootOf(req);
  if (req.query.refresh) cache.delete(root.id);
  if (!cache.has(root.id)) cache.set(root.id, await scan(root));
  res.json(cache.get(root.id));
});
app.get("/api/item", async (req, res) => {
  const root = rootOf(req),
    file = await safeFile(String(req.query.file));
  if (!file.toLowerCase().endsWith(".xml")) throw new Error("需要 XML 文件");
  if (path.relative(root.path, file).startsWith(".."))
    throw new Error("物品不在当前 Mod 中");
  const raw = await readXmlText(file);
  const imported = await importItem(
    file,
    String(req.query.id),
    root,
    roots,
    gameRoot,
  );
  if (fingerprint(raw) !== fingerprint(await fs.readFile(file, "utf8")))
    throw new Error("导入期间文件发生变化，请重试。");
  res.json(await saveback.bind(imported, root, String(req.query.id), raw));
});
app.post("/api/save/preview", async (req, res) =>
  res.json(await saveback.preview(req.body.project)),
);
app.post("/api/save/commit", async (req, res) => {
  const result = await saveback.commit(req.body.planId);
  cache.clear();
  res.json(result);
});
app.post("/api/attachments", async (req, res) => {
  // Read-only candidate lookup; never execute a mod or equip an in-game item.
  const preferred = roots.find((r) => r.id === req.body.rootId);
  if (
    !preferred ||
    !Array.isArray(req.body.sockets) ||
    req.body.sockets.length > 100
  )
    throw new Error("请重新导入来源物品");
  const libraries = [];
  for (const root of [preferred, ...roots.filter((r) => r !== preferred)]) {
    if (!cache.has(root.id)) cache.set(root.id, await scan(root));
    libraries.push({ root, library: cache.get(root.id) });
  }
  const previews = [],
    groups = new Set();
  for (const socket of req.body.sockets) {
    if (socket.hidden || groups.has(socket.slotGroup || socket.id)) continue;
    const tokens = String(socket.items || "")
      .toLowerCase()
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const exclude = String(socket.excludedIdentifiers || "")
      .toLowerCase()
      .split(",")
      .map((v) => v.trim());
    let found;
    for (const { root, library } of libraries) {
      const item = library.items.find(
        (i) =>
          !exclude.includes(i.id.toLowerCase()) &&
          tokens.some(
            (t) =>
              i.id.toLowerCase() === t ||
              i.tags
                ?.toLowerCase()
                .split(",")
                .map((s) => s.trim())
                .includes(t),
          ),
      );
      if (item) {
        found = { root, item };
        break;
      }
    }
    if (!found) continue;
    const p = await importItem(
      found.item.file,
      found.item.id,
      found.root,
      roots,
      gameRoot,
    );
    const layers = p.layers.filter((l) =>
      ["item", "contained", "decorative"].includes(l.role),
    );
    if (!layers.some((l) => l.role === "item")) continue;
    const parentTags = String(req.body.tags || "")
      .toLowerCase()
      .split(",");
    const contained = layers.find(
      (l) =>
        l.role === "contained" &&
        (l.extra.allowedcontaineridentifiers
          ?.toLowerCase()
          .split(",")
          .includes(String(req.body.identifier).toLowerCase()) ||
          l.extra.allowedcontainertags
            ?.toLowerCase()
            .split(",")
            .some((t) => parentTags.includes(t))),
    );
    previews.push({
      id: socket.id,
      preview: {
        identifier: found.item.id,
        scale: p.itemScale,
        layers,
        selected: (contained || layers.find((l) => l.role === "item")).id,
      },
    });
    groups.add(socket.slotGroup || socket.id);
  }
  res.json(previews);
});
app.get("/api/reference", async (req, res) => {
  const root =
    roots.find((r) => r.id === req.query.root) ||
    roots.find((r) => r.workshopId === "2809175631");
  if (!root)
    throw new Error(
      "未找到木卫二萌化计划 (2809175631)，请连接本地 Mod 文件夹。不会回退到原版人物。",
    );
  res.json(
    await reference(
      root,
      roots,
      gameRoot,
      req.query.gender === "male" ? "male" : "female",
    ),
  );
});
app.get("/api/asset/:id", async (req, res) => {
  const p = await safeFile(Buffer.from(req.params.id, "base64url").toString());
  if (!/\.(png|webp|jpe?g)$/i.test(p))
    throw new Error("仅支持 PNG / JPEG / WebP 贴图");
  res.sendFile(p);
});
const port = Number(process.env.PORT || 4317);
await installMcp(app, {
  workspace,
  port,
  saveback,
  onSaved: () => cache.clear(),
});
app.use("/api", (err, req, res, next) =>
  res
    .status(400)
    .json({ code: err.code || "REQUEST_ERROR", error: err.message }),
);
if (process.argv.includes("--dev")) {
  const vite = await import("vite");
  const dev = await vite.createServer({
    root: workspace,
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: "spa",
  });
  app.use(dev.middlewares);
} else {
  app.use(express.static(path.join(workspace, "dist")));
  app.get("/{*splat}", (req, res) =>
    res.sendFile(path.join(workspace, "dist/index.html")),
  );
}
httpServer.listen(port, "127.0.0.1", () =>
  console.log(
    `Sprite Lab: http://127.0.0.1:${port} · ${roots.length} local mod libraries`,
  ),
);
