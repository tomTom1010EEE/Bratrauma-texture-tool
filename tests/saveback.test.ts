import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import {
  coordinatePatch,
  createSaveback,
  sourceAccess,
  readXmlText,
} from "../server/saveback.mjs";
import { importItem } from "../server/library.mjs";

const raw =
  '\uFEFF<?xml version="1.0" encoding="utf-8"?>\r\n<Items>\r\n<!-- <Item identifier="gun"><Sprite origin="0,0"/></Item> -->\r\n<Item identifier="gun" Scale=\'0.5\' health="123">\r\n <Sprite texture="missing.png" sourcerect="0,0,100,30" origin = \'0.5,0.5\' />\r\n <Holdable handle1="-10,0" holdangle="30"><StatusEffect type="OnUse" target="This" holdangle="999"><LuaHook name="keep_me" /></StatusEffect></Holdable>\r\n <RangedWeapon barrelpos="25,0"><Attack damage="999" /></RangedWeapon>\r\n <ItemContainer capacity="1" hideitems="false"><SubContainer capacity="1"><Containable items="scope" rotation="5"><StatusEffect type="OnInserted" target="This" /></Containable></SubContainer></ItemContainer>\r\n <Fabricate><RequiredItem identifier="steel" amount="5"/></Fabricate>\r\n</Item>\r\n<Item identifier="other"><Sprite texture="other.png" /></Item>\r\n</Items>';
async function fixture(t: any) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sprite-save-test-"));
  // Cleanup only a test-owned, exact mkdtemp path, never real mods.
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const mod = path.join(base, "LocalMods", "Dev");
  await fs.mkdir(mod, { recursive: true });
  await fs.writeFile(
    path.join(mod, "filelist.xml"),
    '<contentpackage name="dev" steamworkshopid="123"><Item file="%ModDir%/items.xml" /></contentpackage>',
  );
  const file = path.join(mod, "items.xml");
  await fs.writeFile(file, raw);
  const root = { path: mod, name: "Dev", workshopId: "123" };
  const p = await importItem(file, "gun", root, [root], base);
  return { base, root, file, p };
}
test("coordinate patch preserves all non-coordinate bytes, casing, BOM, CRLF and scripts", async (t) => {
  const { p } = await fixture(t),
    q = structuredClone(p);
  q.itemScale = 0.75;
  q.layers[0].origin = [1.1, -0.4];
  q.pose.holdangle = "45";
  q.identifier = "DO_NOT_WRITE";
  q.holdableSlots = "Head";
  q.pose.controlpose = "false";
  const result = coordinatePatch(raw, "gun", p, q);
  assert.equal(
    result.text,
    raw
      .replace("Scale='0.5'", "Scale='0.75'")
      .replace("origin = '0.5,0.5'", "origin = '1.1,-0.4'")
      .replace('holdangle="30"', 'holdangle="45"'),
  );
  assert.equal(result.changes.length, 3);
  assert.ok(result.warnings.some((w) => w.includes("slots")));
});
test("can add coordinates to a pre-existing Containable without changing structure", async (t) => {
  const { p } = await fixture(t),
    q = structuredClone(p);
  const s = q.sockets.find((s) => s.items === "scope")!;
  assert.equal(s.declaredPosition, false);
  s.position = [10, 20];
  s.rotation = 15;
  const result = coordinatePatch(raw, "gun", p, q);
  assert.equal(
    result.text,
    raw.replace(
      '<Containable items="scope" rotation="5">',
      '<Containable items="scope" rotation="15" itempos="10,20">',
    ),
  );
});
test("ignores forged source paths and never writes gameplay or new containers", async (t) => {
  const { p } = await fixture(t),
    q = structuredClone(p);
  q.layers[0].sourcePath = "RangedWeapon[0]/Attack[0]";
  q.layers[0].origin = [0.1, 0.2];
  q.sockets.push({
    id: "new",
    name: "new",
    position: [1, 2],
    rotation: 0,
    depth: 0.5,
    items: "anything",
    source: "containable",
  });
  const out = coordinatePatch(raw, "gun", p, q);
  assert.equal(
    out.text,
    raw.replace("origin = '0.5,0.5'", "origin = '0.1,0.2'"),
  );
  assert.ok(out.warnings.some((w) => w.includes("新增")));
  q.itemScale = NaN;
  assert.throws(() => coordinatePatch(raw, "gun", p, q));
});
test("only verified LocalMods is writable; published local copy is allowed; workshop and junction escapes denied", async (t) => {
  const f = await fixture(t);
  assert.equal((await sourceAccess(f.root, f.file, f.base)).writable, true);
  const workshop = path.join(f.base, "WorkshopMods", "Installed", "123");
  await fs.mkdir(workshop, { recursive: true });
  await fs.writeFile(path.join(workshop, "items.xml"), raw);
  assert.equal(
    (
      await sourceAccess(
        { path: workshop },
        path.join(workshop, "items.xml"),
        f.base,
      )
    ).writable,
    false,
  );
  assert.equal(
    (await sourceAccess(f.root, path.join(workshop, "items.xml"), f.base))
      .writable,
    false,
  );
  const link = path.join(f.base, "LocalMods", "Linked");
  await fs.symlink(workshop, link, "junction");
  assert.equal(
    (await sourceAccess({ path: link }, path.join(link, "items.xml"), f.base))
      .writable,
    false,
  );
  const sibling = path.join(f.base, "LocalModsElsewhere");
  await fs.mkdir(sibling);
  assert.equal(
    (await sourceAccess({ path: sibling }, null, f.base)).writable,
    false,
  );
});
test("commit uses server plan, produces exact backup and invalidates stale source session", async (t) => {
  const f = await fixture(t),
    saves = createSaveback(f.base);
  await saves.bind(f.p, f.root, "gun", raw);
  const q = structuredClone(f.p);
  q.itemScale = 0.8;
  const plan = await saves.preview(q);
  q.itemScale = 10; // no post-preview mutation may change committed plan
  const saved = await saves.commit(plan.planId);
  assert.equal(await fs.readFile(saved.backup, "utf8"), raw);
  assert.equal(
    await fs.readFile(f.file, "utf8"),
    raw.replace("Scale='0.5'", "Scale='0.8'"),
  );
  await assert.rejects(saves.preview(q), /失效/);
});
test("external edits before preview or confirmation are never overwritten", async (t) => {
  const f = await fixture(t),
    saves = createSaveback(f.base);
  await saves.bind(f.p, f.root, "gun", raw);
  const q = structuredClone(f.p);
  q.itemScale = 0.8;
  const plan = await saves.preview(q);
  await fs.writeFile(f.file, raw + "\r\n<!-- external edit -->");
  await assert.rejects(saves.commit(plan.planId), /已改变/);
  await assert.rejects(saves.preview(q), /其他程序/);
  assert.equal(
    await fs.readFile(f.file, "utf8"),
    raw + "\r\n<!-- external edit -->",
  );
});
test("a hard link created after preview makes the source readonly at commit", async (t) => {
  const f = await fixture(t),
    saves = createSaveback(f.base);
  await saves.bind(f.p, f.root, "gun", raw);
  const q = structuredClone(f.p);
  q.itemScale = 0.8;
  const plan = await saves.preview(q);
  const duplicate = path.join(f.base, "hardlink.xml");
  await fs.link(f.file, duplicate);
  assert.equal((await sourceAccess(f.root, f.file, f.base)).writable, false);
  await assert.rejects(saves.commit(plan.planId), /硬链接/);
  assert.equal(await fs.readFile(f.file, "utf8"), raw);
});
test("HTTP import / preview / commit round-trip and WorkshopMods / cross-origin denial", async (t) => {
  const f = await fixture(t);
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const process = spawn(globalThis.process.execPath, ["server/index.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...globalThis.process.env,
      PORT: String(port),
      BAROTRAUMA_GAME: f.base,
      BAROTRAUMA_WORKSHOP: path.join(f.base, "workshop"),
    },
  });
  t.after(() => {
    process.kill();
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "test server started");
  const post = (endpoint: string, body: unknown, origin?: string) =>
    fetch(base + endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  const root = await (await post("/api/roots", { path: f.root.path })).json();
  assert.equal(root.writable, true);
  const p = await (
    await fetch(
      base +
        "/api/item?" +
        new URLSearchParams({ root: root.id, file: f.file, id: "gun" }),
    )
  ).json();
  p.itemScale = 0.65;
  assert.equal(
    (
      await post(
        "/api/save/preview",
        { project: p },
        "https://untrusted.example",
      )
    ).status,
    403,
  );
  const response = await post("/api/save/preview", { project: p });
  assert.equal(response.status, 200);
  const plan = await response.json();
  assert.equal(plan.changes.length, 1);
  const savedResponse = await post("/api/save/commit", { planId: plan.planId });
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(await fs.readFile(saved.backup, "utf8"), raw);
  assert.equal(
    await fs.readFile(f.file, "utf8"),
    raw.replace("Scale='0.5'", "Scale='0.65'"),
  );
  const installed = path.join(f.base, "WorkshopMods", "Installed", "123");
  await fs.mkdir(installed, { recursive: true });
  await fs.writeFile(path.join(installed, "items.xml"), raw);
  const readonlyRoot = await (
    await post("/api/roots", { path: installed })
  ).json();
  assert.equal(readonlyRoot.writable, false);
  const w = await (
    await fetch(
      base +
        "/api/item?" +
        new URLSearchParams({
          root: readonlyRoot.id,
          file: path.join(installed, "items.xml"),
          id: "gun",
        }),
    )
  ).json();
  w.itemScale = 4;
  w.source.writable = true; // Client-side permission flags are not authority.
  assert.equal((await post("/api/save/preview", { project: w })).status, 400);
  assert.equal(
    await fs.readFile(path.join(installed, "items.xml"), "utf8"),
    raw,
  );
});
test("ambiguous case-duplicate attributes and non UTF-8 files cannot be rewritten", async (t) => {
  const f = await fixture(t);
  assert.throws(
    () =>
      coordinatePatch(
        raw.replace("Scale='0.5'", "Scale='0.5' scale='1'"),
        "gun",
        f.p,
        f.p,
      ),
    /大小写重复/,
  );
  await fs.writeFile(f.file, Buffer.from([0xff, 0xfe, 0x3c, 0x00]));
  await assert.rejects(readXmlText(f.file), /UTF-8/);
});
