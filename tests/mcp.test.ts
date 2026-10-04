import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { newProject } from "../src/model";
import {
  applyCalibrationPatch,
  definitionsByName,
} from "../shared/mcp-contract.mjs";
const brokerModule = "../server/editor-sessions.mjs";
const { createEditorSessions, publicState } = await import(brokerModule);
const snapshot = (revision = 1) => ({
  revision,
  project: newProject(),
  view: { mode: "hold" },
  label: "test",
});

test("MCP coordinate schema rejects gameplay, forged source, nonfinite values and unknown targets atomically", () => {
  const p = newProject();
  for (const patch of [
    { damage: 100 },
    { source: { token: "forged" } },
    { itemScale: Infinity },
    { itemScale: 0 },
    { pose: { swingforce: [1, 2] } },
    { layers: [{ id: p.layers[0].id, texture: "evil" }] },
  ])
    assert.throws(() => applyCalibrationPatch(p, patch));
  assert.throws(() =>
    applyCalibrationPatch(p, {
      itemScale: 2,
      layers: [{ id: "missing", origin: [0, 0] }],
    }),
  );
  const q = applyCalibrationPatch(p, {
    itemScale: 0.8,
    handle1: [-20, 4],
    pose: { holdpos: [100, -5], aimangle: 25 },
    layers: [{ id: p.layers[0].id, origin: [1.1, -0.5] }],
  });
  assert.equal(q.itemScale, 0.8);
  assert.equal(q.pose.holdpos, "100,-5");
  assert.equal(q.pose.aimangle, "25");
  assert.deepEqual(q.layers[0].origin, [1.1, -0.5]);
  assert.notEqual(p.itemScale, q.itemScale);
  assert.throws(() =>
    definitionsByName
      .get("get_status")!
      .inputSchema.parse({ arbitraryFile: "C:/" }),
  );
});

test("MCP broker enforces owner, revision, read-only, single-flight and ack state", async () => {
  const b = createEditorSessions();
  const c = b.register(snapshot());
  assert.throws(() => b.poll(c.sessionId, "wrong", {}), /凭据/);
  await assert.rejects(
    b.command(c.sessionId, "patch_calibration", {}, 1, true),
    /开启允许修改/,
  );
  b.poll(c.sessionId, c.owner, { allowEdit: true });
  await assert.rejects(
    b.command(c.sessionId, "patch_calibration", {}, 0, true),
    /页面已改变/,
  );
  const pending = b.command(c.sessionId, "patch_calibration", {}, 1, true);
  await assert.rejects(
    b.command(c.sessionId, "undo", {}, 1, true),
    /待处理命令/,
  );
  const { command } = b.poll(c.sessionId, c.owner, { allowEdit: true });
  b.poll(c.sessionId, c.owner, {
    state: snapshot(2),
    allowEdit: true,
    ack: { id: command.id, result: { applied: true } },
  });
  assert.deepEqual(await pending, { applied: true, revision: 2 });
  assert.throws(
    () => b.poll(c.sessionId, c.owner, { state: snapshot(1), allowEdit: true }),
    /过期/,
  );
  const changed = snapshot(2);
  changed.project.itemScale = 9;
  assert.throws(
    () => b.poll(c.sessionId, c.owner, { state: changed, allowEdit: true }),
    /相同版本/,
  );
  assert.equal(b.list().length, 1);
});

test("MCP revocation, disconnect and timeout cancel queued operations; credentials never leak", async () => {
  const b = createEditorSessions({ timeoutMs: 15 });
  const c = b.register(snapshot(), true);
  const pending = b.command(c.sessionId, "patch_calibration", {}, 1, true);
  b.poll(c.sessionId, c.owner, { allowEdit: false });
  await assert.rejects(pending, /关闭 MCP 修改权限/);
  await assert.rejects(
    b.command(c.sessionId, "render_preview", {}, 1),
    /未及时响应/,
  );
  assert.equal(
    b.poll(c.sessionId, c.owner, { allowEdit: false }).command,
    null,
  );
  const read = b.command(c.sessionId, "evaluate_pose", {}, 1);
  b.close(c.sessionId, c.owner);
  await assert.rejects(read, /关闭共享/);
  assert.throws(() => b.state(c.sessionId), /离线/);
  const source = { project: { source: { token: "private", file: "x" } } };
  assert.equal(publicState(source).project.source.token, undefined);
  assert.equal(source.project.source.token, "private");
});

test(
  "real MCP SDK stdio handshake, tools, live edit relay and human-only save on isolated LocalMods",
  { timeout: 60000 },
  async (t) => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "sprite-mcp-test-"));
    const mod = path.join(temp, "LocalMods", "Dev");
    await fs.mkdir(mod, { recursive: true });
    const raw = `<Items><!--KEEP--><Item identifier="gun" scale="0.5"><Sprite texture="missing.png" sourcerect="0,0,50,20"/><Holdable handle1="1,2"/><RangedWeapon><Attack damage="123"/></RangedWeapon><StatusEffect><LuaHook name="do_not_change"/></StatusEffect></Item></Items>`;
    const file = path.join(mod, "items.xml");
    await fs.writeFile(file, raw);
    await fs.writeFile(
      path.join(mod, "filelist.xml"),
      '<contentpackage name="Dev"><Item file="%ModDir%/items.xml"/></contentpackage>',
    );
    const socket = net.createServer();
    await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
    const port = (socket.address() as net.AddressInfo).port;
    await new Promise<void>((r) => socket.close(() => r()));
    const base = `http://127.0.0.1:${port}`,
      runtime = path.join(temp, "runtime");
    const child = spawn(process.execPath, ["server/index.mjs"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      windowsHide: true,
      stdio: "pipe",
      env: {
        ...process.env,
        PORT: String(port),
        BAROTRAUMA_GAME: temp,
        BAROTRAUMA_WORKSHOP: path.join(temp, "workshop"),
        SPRITE_LAB_RUNTIME: runtime,
      },
    });
    let logs = "";
    child.stderr.on("data", (x) => (logs += x));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve("server/mcp.mjs")],
      env: { SPRITE_LAB_PORT: String(port), SPRITE_LAB_RUNTIME: runtime },
      stderr: "pipe",
    });
    const client = new Client({ name: "sprite-test", version: "1.0.0" });
    t.after(async () => {
      await client.close().catch(() => {});
      const ended = new Promise<void>((r) => child.once("exit", () => r()));
      if (child.exitCode === null) {
        child.kill();
        await ended;
      }
      await fs.rm(temp, { recursive: true, force: true });
    });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try {
        ready = (await fetch(base + "/api/health")).ok;
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 75));
    }
    assert.ok(ready, logs);
    const post = (endpoint: string, body: unknown, origin?: string) =>
      fetch(base + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/api/mcp/call", { name: "get_status" })).status,
      401,
    );
    assert.equal(
      (
        await post(
          "/api/editor/register",
          { state: snapshot() },
          "https://evil.example",
        )
      ).status,
      403,
    );
    const root = await (await post("/api/roots", { path: mod })).json();
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 18);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const text = result.content.find((c: any) => c.type === "text") as {
        text: string;
      };
      const data = JSON.parse(text.text);
      if (result.isError)
        throw Object.assign(new Error(data.error), { code: data.code });
      return data;
    };
    assert.equal((await call("get_status")).version, "0.4.0");
    assert.equal((await call("list_mods")).mods[0].id, root.id);
    assert.equal(
      (await call("search_items", { rootId: root.id, query: "gun" })).total,
      1,
    );
    const loaded = await call("load_item", {
      rootId: root.id,
      file,
      identifier: "gun",
    });
    assert.equal(loaded.project.source.token, undefined);
    // Simulated UI owns its private registration capability; MCP never receives it.
    const project = await (
      await fetch(
        base +
          "/api/item?" +
          new URLSearchParams({ root: root.id, file, id: "gun" }),
      )
    ).json();
    let state = { ...snapshot(1), project };
    const c = await (
      await post("/api/editor/register", { state, allowEdit: true })
    ).json();
    const sid = { sessionId: c.sessionId };
    let seenCommand: any = null;
    const respond = async (
      pending: Promise<any>,
      handler?: (cmd: any) => void,
    ) => {
      let cmd: any;
      for (let i = 0; i < 70; i++) {
        const poll = await (
          await post(`/api/editor/${c.sessionId}/poll`, {
            owner: c.owner,
            state,
            allowEdit: true,
          })
        ).json();
        if (poll.command) {
          cmd = poll.command;
          break;
        }
        await new Promise((r) => setTimeout(r, 15));
      }
      assert.ok(cmd, "command reached shared UI");
      seenCommand = cmd;
      handler?.(cmd);
      await post(`/api/editor/${c.sessionId}/poll`, {
        owner: c.owner,
        state,
        allowEdit: true,
        ack: { id: cmd.id, result: {} },
      });
      return pending;
    };
    assert.equal((await call("list_editors")).editors.length, 1);
    assert.equal(
      (await call("get_editor_state", sid)).project.source.token,
      undefined,
    );
    await respond(
      call("patch_calibration", {
        ...sid,
        expectedRevision: 1,
        patch: { itemScale: 0.75 },
      }),
      (cmd) => {
        state = {
          ...state,
          revision: 2,
          project: applyCalibrationPatch(state.project, cmd.args.patch),
        };
      },
    );
    assert.equal((await call("get_editor_state", sid)).project.itemScale, 0.75);
    await assert.rejects(
      call("patch_calibration", {
        ...sid,
        expectedRevision: 1,
        patch: { itemScale: 9 },
      }),
      /页面已改变/,
    );
    let proposal = await respond(
      call("preview_save", { ...sid, expectedRevision: 2 }),
    );
    assert.equal(proposal.planId, undefined);
    assert.equal(proposal.changes.length, 1);
    assert.equal(await fs.readFile(file, "utf8"), raw);
    // A human edit between preview and requesting approval invalidates the plan.
    state = { ...state, revision: 3, view: { mode: "aim" } };
    await post(`/api/editor/${c.sessionId}/poll`, {
      owner: c.owner,
      state,
      allowEdit: true,
    });
    await assert.rejects(
      call("commit_save", { ...sid, proposalId: proposal.proposalId }),
      /页面已改变/,
    );
    proposal = await respond(
      call("preview_save", { ...sid, expectedRevision: 3 }),
    );
    const pending = await respond(
      call("commit_save", { ...sid, proposalId: proposal.proposalId }),
    );
    assert.equal(pending.status, "pending");
    assert.equal(seenCommand.name, "approve_save");
    assert.equal(seenCommand.args.planId, undefined);
    assert.equal(
      await fs.readFile(file, "utf8"),
      raw,
      "MCP cannot commit without a human page approval",
    );
    // A further edit while the approval dialog is open must also refuse writing.
    state = { ...state, revision: 4, view: { mode: "hold" } };
    const staleApproval = await post(`/api/editor/${c.sessionId}/approve`, {
      owner: c.owner,
      proposalId: proposal.proposalId,
      approve: true,
      state,
      allowEdit: true,
    });
    assert.equal(staleApproval.status, 400);
    assert.equal((await staleApproval.json()).code, "REVISION_CONFLICT");
    assert.equal(await fs.readFile(file, "utf8"), raw);
    await post(`/api/editor/${c.sessionId}/approve`, {
      owner: c.owner,
      proposalId: proposal.proposalId,
      approve: false,
    });
    assert.equal(
      (
        await call("get_save_status", {
          ...sid,
          proposalId: proposal.proposalId,
        })
      ).status,
      "rejected",
    );
    proposal = await respond(
      call("preview_save", { ...sid, expectedRevision: 4 }),
    );
    await respond(
      call("commit_save", { ...sid, proposalId: proposal.proposalId }),
    );
    assert.equal(
      (
        await post(`/api/editor/${c.sessionId}/approve`, {
          owner: "forged",
          proposalId: proposal.proposalId,
          approve: true,
          state,
          allowEdit: true,
        })
      ).status,
      400,
    );
    const approved = await (
      await post(`/api/editor/${c.sessionId}/approve`, {
        owner: c.owner,
        proposalId: proposal.proposalId,
        approve: true,
        state,
        allowEdit: true,
      })
    ).json();
    assert.equal(approved.status, "approved");
    assert.equal(await fs.readFile(approved.result.backup, "utf8"), raw);
    assert.equal(
      await fs.readFile(file, "utf8"),
      raw.replace('scale="0.5"', 'scale="0.75"'),
    );
    assert.equal(
      (
        await call("get_save_status", {
          ...sid,
          proposalId: proposal.proposalId,
        })
      ).status,
      "approved",
    );
    assert.equal(
      (await call("commit_save", { ...sid, proposalId: proposal.proposalId }))
        .status,
      "approved",
      "retry does not write twice",
    );
  },
);
