import { randomUUID } from "node:crypto";

export class BridgeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new BridgeError(code, message);
};
export const publicState = (state) => {
  const result = structuredClone(state);
  if (result?.project?.source) delete result.project.source.token;
  return result;
};

// UI is the authority for a tab's live draft. The broker serializes external
// commands; the UI checks revision AGAIN at execution, closing the polling race.
export function createEditorSessions({
  timeoutMs = 15000,
  staleMs = 20000,
  now = Date.now,
} = {}) {
  const sessions = new Map();
  function get(id) {
    const s = sessions.get(id);
    if (!s || now() - s.seen > staleMs)
      fail("EDITOR_OFFLINE", "共享页面已离线，请打开页面并开启 MCP 共享。");
    return s;
  }
  function owner(id, secret) {
    const s = get(id);
    if (secret !== s.owner) fail("FORBIDDEN", "编辑器会话凭据无效。");
    return s;
  }
  function accept(s, state) {
    if (
      !state ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      !state.project?.layers ||
      !state.view
    )
      fail("INVALID_STATE", "无效的工程快照。");
    if (s.state && state.revision < s.state.revision)
      fail("REVISION_CONFLICT", "过期的页面快照。");
    if (
      s.state &&
      state.revision === s.state.revision &&
      JSON.stringify(s.state) !== JSON.stringify(state)
    )
      fail("REVISION_CONFLICT", "相同版本不能对应不同快照。");
    s.state = structuredClone(state);
  }
  const api = {
    register(state, allowEdit = false) {
      for (const [id, s] of sessions)
        if (now() - s.seen > staleMs) {
          s.pending?.reject(
            new BridgeError("EDITOR_OFFLINE", "共享页面已离线。"),
          );
          sessions.delete(id);
        }
      if (sessions.size >= 32) fail("LIMIT", "共享标签页数量已达上限。");
      const s = {
        id: randomUUID(),
        owner: randomUUID(),
        seen: now(),
        allowEdit: !!allowEdit,
        state: null,
        pending: null,
      };
      accept(s, state);
      sessions.set(s.id, s);
      return { sessionId: s.id, owner: s.owner };
    },
    list() {
      return [...sessions.values()]
        .filter((s) => now() - s.seen <= staleMs)
        .map((s) => ({
          sessionId: s.id,
          revision: s.state.revision,
          name: s.state.project.name,
          identifier: s.state.project.identifier,
          label: s.state.label,
          allowEdit: s.allowEdit,
          busy: !!s.pending,
        }));
    },
    state(id) {
      return structuredClone(get(id).state);
    },
    requireRevision(id, revision, edit = false) {
      const s = get(id);
      if (edit && !s.allowEdit)
        fail("EDIT_DISABLED", "请在页面 MCP 面板开启允许修改。");
      if (s.state.revision !== revision)
        fail("REVISION_CONFLICT", "页面已改变，请重新读取当前工程后重试。");
      return s;
    },
    poll(id, secret, { state, allowEdit, ack }) {
      const s = owner(id, secret);
      if (state) accept(s, state);
      s.seen = now();
      s.allowEdit = !!allowEdit;
      if (ack && s.pending?.id === ack.id) {
        const pending = s.pending;
        s.pending = null;
        if (ack.error)
          pending.reject(
            new BridgeError(
              ack.error.code || "EDITOR_ERROR",
              ack.error.message,
            ),
          );
        else
          pending.resolve({
            ...ack.result,
            revision: ack.result?.revision ?? s.state.revision,
          });
      }
      if (s.pending && s.pending.edit && !s.allowEdit) {
        s.pending.reject(
          new BridgeError("EDIT_DISABLED", "页面已关闭 MCP 修改权限。"),
        );
        s.pending = null;
      }
      const p = s.pending;
      return {
        command: p
          ? {
              id: p.id,
              name: p.name,
              args: p.args,
              expectedRevision: p.expectedRevision,
              expires: p.expires,
            }
          : null,
      };
    },
    async command(id, name, args, expectedRevision, edit = false) {
      const s = api.requireRevision(id, expectedRevision, edit);
      if (s.pending) fail("EDITOR_BUSY", "该标签页有待处理命令，请稍后重试。");
      return new Promise((resolve, reject) => {
        const p = {
          id: randomUUID(),
          name,
          args,
          expectedRevision,
          edit,
          expires: now() + timeoutMs,
          resolve: null,
          reject: null,
        };
        const timer = setTimeout(() => {
          if (s.pending === p) s.pending = null;
          reject(
            new BridgeError(
              "EDITOR_TIMEOUT",
              "页面未及时响应；不要盲目重复修改，请先读取状态确认结果。",
            ),
          );
        }, timeoutMs);
        p.resolve = (value) => {
          clearTimeout(timer);
          resolve(value);
        };
        p.reject = (error) => {
          clearTimeout(timer);
          reject(error);
        };
        s.pending = p;
      });
    },
    close(id, secret) {
      const s = owner(id, secret);
      s.pending?.reject(new BridgeError("EDITOR_OFFLINE", "用户关闭共享。"));
      sessions.delete(id);
    },
    authorizeOwner: owner,
  };
  return api;
}
