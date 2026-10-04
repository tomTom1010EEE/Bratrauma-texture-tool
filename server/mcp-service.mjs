import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { definitionsByName, VERSION } from "../shared/mcp-contract.mjs";
import {
  createEditorSessions,
  BridgeError,
  publicState,
} from "./editor-sessions.mjs";

export async function installMcp(app, { workspace, port, saveback, onSaved }) {
  const editors = createEditorSessions();
  const proposals = new Map();
  const bearer = randomBytes(32).toString("hex");
  const url = `http://127.0.0.1:${port}`;
  const runtime =
    process.env.SPRITE_LAB_RUNTIME || path.join(workspace, ".local");
  await fs.mkdir(runtime, { recursive: true });
  const configFile = path.join(runtime, `mcp-${port}.json`);
  await fs.writeFile(
    configFile,
    JSON.stringify({ url, token: bearer, version: VERSION }),
    { mode: 0o600 },
  );
  const protect = (req, res, next) => {
    const actual = Buffer.from(req.headers.authorization || "");
    const expected = Buffer.from(`Bearer ${bearer}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return res
        .status(401)
        .json({ code: "UNAUTHORIZED", error: "MCP 凭据失效，请重连服务。" });
    next();
  };
  const clean = () => {
    for (const p of proposals.values())
      if (["prepared", "pending"].includes(p.status) && p.expires < Date.now())
        p.status = "expired";
    if (proposals.size > 100)
      for (const [id, p] of proposals) {
        if (!["prepared", "pending", "saving"].includes(p.status))
          proposals.delete(id);
      }
  };
  function proposal(id, sessionId) {
    clean();
    const p = proposals.get(id);
    if (!p || p.sessionId !== sessionId)
      throw new BridgeError("PROPOSAL_NOT_FOUND", "保存提案不存在。");
    return p;
  }
  const proposalView = (p) => ({
    proposalId: p.id,
    sessionId: p.sessionId,
    revision: p.revision,
    status: p.status,
    expires: p.expires,
    file: p.plan.file,
    changes: p.plan.changes,
    warnings: p.plan.warnings,
    result: p.result,
    error: p.error,
  });
  const api = async (endpoint, body) => {
    const r = await fetch(url + endpoint, {
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(20000),
    });
    const value = await r.json();
    if (!r.ok) throw new BridgeError(value.code || "SOURCE_ERROR", value.error);
    return value;
  };
  const readItem = (args) =>
    api(
      "/api/item?" +
        new URLSearchParams({
          root: args.rootId,
          file: args.file,
          id: args.identifier,
        }),
    );
  async function call(name, raw) {
    const definition = definitionsByName.get(name);
    if (!definition) throw new BridgeError("UNKNOWN_TOOL", "未知 MCP 工具。");
    const parsed = definition.inputSchema.safeParse(raw);
    if (!parsed.success)
      throw new BridgeError("INVALID_ARGUMENT", parsed.error.message);
    const args = parsed.data;
    if (name === "get_status")
      return {
        ...(await api("/api/health")),
        transport: "stdio",
        liveEditors: editors.list().length,
        savePolicy: "coordinate-only; mandatory in-page human approval",
      };
    if (name === "list_mods") return { mods: await api("/api/roots") };
    if (name === "search_items") {
      const lib = await api(
        "/api/library?" + new URLSearchParams({ root: args.rootId }),
      );
      const q = args.query.toLowerCase();
      const found = lib.items.filter((i) =>
        `${i.name} ${i.id} ${i.file}`.toLowerCase().includes(q),
      );
      return {
        total: found.length,
        items: found.slice(args.offset, args.offset + args.limit),
        nextOffset:
          args.offset + args.limit < found.length
            ? args.offset + args.limit
            : null,
        errors: lib.errors,
      };
    }
    if (name === "load_item")
      return publicState({ project: await readItem(args) });
    if (name === "list_editors") return { editors: editors.list() };
    if (name === "get_editor_state")
      return publicState(editors.state(args.sessionId));
    if (name === "get_save_status")
      return proposalView(proposal(args.proposalId, args.sessionId));
    const state = editors.state(args.sessionId);
    const revision = args.expectedRevision ?? state.revision;
    editors.requireRevision(args.sessionId, revision, !definition.readOnly);
    if (name === "preview_save") {
      clean();
      if (proposals.size >= 100)
        throw new BridgeError("LIMIT", "保存提案过多，请等待旧提案过期。");
      // Ask the UI to verify the latest local revision (including unpublished edits).
      await editors.command(args.sessionId, "check_revision", {}, revision);
      const plan = await saveback.preview(state.project);
      editors.requireRevision(args.sessionId, revision);
      const p = {
        id: randomUUID(),
        sessionId: args.sessionId,
        revision,
        plan,
        expires: Date.now() + 540000,
        status: "prepared",
      };
      proposals.set(p.id, p);
      return proposalView(p);
    }
    if (name === "commit_save") {
      const p = proposal(args.proposalId, args.sessionId);
      if (p.status !== "prepared") return proposalView(p);
      editors.requireRevision(args.sessionId, p.revision, true);
      p.status = "pending";
      try {
        await editors.command(
          args.sessionId,
          "approve_save",
          proposalView(p),
          p.revision,
          true,
        );
      } catch (e) {
        p.status = "rejected";
        p.error = e.message;
        throw e;
      }
      return proposalView(p);
    }
    if (name === "open_item") {
      const project = await readItem(args);
      return editors.command(args.sessionId, name, { project }, revision, true);
    }
    if (name === "assemble_attachments") {
      const rootId = state.project.source?.rootId;
      if (!rootId)
        throw new BridgeError(
          "SOURCE_REQUIRED",
          "请先从资源库导入带来源的物品。",
        );
      const result = await api("/api/attachments", {
        rootId,
        sockets: state.project.sockets,
        identifier:
          state.project.source?.originalId || state.project.identifier,
        tags: state.project.tags,
      });
      return editors.command(args.sessionId, name, result, revision, true);
    }
    return editors.command(
      args.sessionId,
      name,
      args,
      revision,
      !definition.readOnly,
    );
  }
  // Separate owner capability for each browser tab. Never returned through MCP.
  app.post("/api/editor/register", (req, res) =>
    res.json(editors.register(req.body.state, req.body.allowEdit)),
  );
  app.post("/api/editor/:id/poll", (req, res) =>
    res.json(editors.poll(req.params.id, req.body.owner, req.body)),
  );
  app.post("/api/editor/:id/close", (req, res) => {
    editors.close(req.params.id, req.body.owner);
    for (const p of proposals.values())
      if (
        p.sessionId === req.params.id &&
        ["pending", "prepared"].includes(p.status)
      ) {
        p.status = "rejected";
        p.error = "用户关闭了共享页面会话。";
      }
    res.json({ closed: true });
  });
  app.post("/api/editor/:id/approve", async (req, res) => {
    editors.authorizeOwner(req.params.id, req.body.owner);
    const p = proposal(req.body.proposalId, req.params.id);
    if (p.status !== "pending")
      throw new BridgeError("INVALID_PROPOSAL", "此提案不再等待确认。");
    if (req.body.approve !== true) {
      p.status = "rejected";
      return res.json(proposalView(p));
    }
    editors.poll(req.params.id, req.body.owner, {
      state: req.body.state,
      allowEdit: req.body.allowEdit,
    });
    editors.requireRevision(req.params.id, p.revision, true);
    p.status = "saving";
    try {
      p.result = await saveback.commit(p.plan.planId);
      p.status = "approved";
      onSaved();
    } catch (e) {
      p.status = "failed";
      p.error = e.message;
    }
    res.json(proposalView(p));
  });
  app.post("/api/mcp/call", protect, async (req, res) => {
    try {
      res.json(await call(req.body.name, req.body.arguments || {}));
    } catch (e) {
      res.status(400).json({ code: e.code || "TOOL_ERROR", error: e.message });
    }
  });
  return { call, editors, configFile };
}
