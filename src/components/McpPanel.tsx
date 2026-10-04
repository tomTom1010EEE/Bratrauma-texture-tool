import { useEffect, useRef, useState } from "react";
import { hasHolding } from "../../shared/equipment.mjs";
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import type { Project, Reference, Socket } from "../model";
import {
  buildHolding,
  itemPointToWorld,
  markerInItem,
  type HoldPreview,
} from "../holding";
import { buildRig } from "../geometry";
import { exportXml, validateProject } from "../exporter";
import {
  applyCalibrationPatch,
  previewPatch,
} from "../../shared/mcp-contract.mjs";

export type EditorView = HoldPreview & {
  facing: number;
  bodyPose: "neutral" | "relaxed";
  skeleton: boolean;
  gender: string;
  head: number;
  frontHair: string;
  backHair: string;
  ghost: boolean;
  selectedLayer: string;
  selectedSocket: string | null;
};
export type PreviewCapture = {
  image: string;
  width: number;
  height: number;
  view: Record<string, unknown>;
};
export type PreviewHandle = {
  capture: (fit?: boolean) => Promise<PreviewCapture>;
};
type Proposal = {
  proposalId: string;
  revision: number;
  status: string;
  expires: number;
  file: string;
  changes: { node: string; attribute: string; before: string; after: string }[];
  warnings: string[];
  result?: { backup: string; count: number };
  error?: string;
};
type Command = {
  id: string;
  name: string;
  args: any;
  expectedRevision: number;
  expires: number;
};
const post = async (url: string, data: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(12000),
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error), { code: value.code });
  return value;
};
const paint = () => new Promise<void>((resolve) => setTimeout(resolve, 50));

export function McpPanel(props: {
  project: Project;
  getProject: () => Project;
  reference: Reference | null;
  view: EditorView;
  label: string;
  update: (p: Project) => void;
  load: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  setPreview: (p: Partial<EditorView>) => void;
  capture: (fit?: boolean) => Promise<PreviewCapture>;
  isEditing: () => boolean;
}) {
  const live = useRef(props);
  live.current = props;
  const [opened, setOpened] = useState(false),
    [shared, setShared] = useState(false),
    [allowEdit, setAllowEdit] = useState(false);
  const [connection, setConnection] = useState<{
    sessionId: string;
    owner: string;
  } | null>(null);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const permissions = useRef({ shared, allowEdit });
  permissions.current = { shared, allowEdit };
  const [error, setError] = useState(""),
    [status, setStatus] = useState("未共享"),
    [lastAction, setLastAction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null),
    [saving, setSaving] = useState(false);
  const sequence = useRef({ revision: 0, json: "" });
  const snapshot = () => {
    const state = {
      project: live.current.getProject(),
      view: live.current.view,
      label: live.current.label,
      referenceReady: !!live.current.reference,
    };
    const json = JSON.stringify(state);
    if (sequence.current.json !== json) {
      sequence.current.json = json;
      sequence.current.revision++;
    }
    return { ...state, revision: sequence.current.revision };
  };
  const guard = (command: Command) => {
    if (!permissions.current.shared)
      throw new Error("SHARING_DISABLED: 用户已关闭共享。");
    if (Date.now() >= command.expires)
      throw new Error("COMMAND_EXPIRED: 命令已过期。");
    if (live.current.isEditing())
      throw new Error("EDITOR_BUSY: 正在拖动标定，请完成操作后重试。");
    if (snapshot().revision !== command.expectedRevision)
      throw new Error("REVISION_CONFLICT: 页面已改变，请重新读取。");
  };
  const execute = async (command: Command) => {
    guard(command);
    const p = live.current.getProject();
    const readOnly = [
      "check_revision",
      "evaluate_pose",
      "render_preview",
      "export_calibration",
    ].includes(command.name);
    if (!readOnly && !permissions.current.allowEdit)
      throw new Error("EDIT_DISABLED: 未允许 MCP 修改。");
    let result: Record<string, unknown> = {};
    switch (command.name) {
      case "check_revision":
        break;
      case "patch_calibration":
        live.current.update(applyCalibrationPatch(p, command.args.patch));
        break;
      case "open_item":
        live.current.load(command.args.project);
        break;
      case "undo":
        live.current.undo();
        break;
      case "redo":
        live.current.redo();
        break;
      case "set_preview":
        live.current.setPreview(
          previewPatch.parse(command.args.preview) as Partial<EditorView>,
        );
        break;
      case "assemble_attachments": {
        const matches = command.args as {
          id: string;
          preview: Socket["preview"];
        }[];
        live.current.update({
          ...p,
          sockets: p.sockets.map((s) => ({
            ...s,
            preview: matches.find((m) => m.id === s.id)?.preview,
          })),
        });
        result = { attached: matches.length };
        break;
      }
      case "export_calibration":
        result = { xml: exportXml(p), warnings: validateProject(p) };
        break;
      case "evaluate_pose": {
        const reference = live.current.reference;
        if (!reference)
          throw new Error("REFERENCE_UNAVAILABLE: 人物资源尚未加载。");
        const view = {
          ...live.current.view,
          ...(command.args.preview
            ? (previewPatch.parse(command.args.preview) as object)
            : {}),
        };
        if (!hasHolding(p))
          result = {
            kind: "clothing",
            rig: buildRig(reference, view.bodyPose).map((r) => ({
              limb: r.limb.limb,
              position: r.position,
              rotation: r.rotation,
            })),
            warnings: validateProject(p),
          };
        else {
          const h = buildHolding(reference, p, view, view.bodyPose);
          result = {
            itemPosition: h.at,
            itemRotation: h.rotation,
            shoulder: h.shoulder,
            hands: h.hands,
            notes: h.notes,
            melee: h.melee,
            frame: h.frame,
            coordinates: "canonical unmirrored display pixels, Y down",
            markers: Object.fromEntries(
              (["handle1", "handle2", "barrel"] as const).map((k) => [
                k,
                itemPointToWorld(markerInItem(p, k), h.at, h.rotation),
              ]),
            ),
            preview: view,
          };
        }
        break;
      }
      case "render_preview":
        result = await live.current.capture(command.args.fit);
        guard(command);
        break;
      case "approve_save":
        setProposal(command.args as Proposal);
        result = {
          status: "pending",
          message: "等待页面内人工确认；尚未写入。",
        };
        break;
      default:
        throw new Error("UNKNOWN_COMMAND: 不支持此编辑器命令。");
    }
    if (!readOnly) {
      setLastAction(command.name);
      await paint();
    }
    return { ...result, revision: snapshot().revision };
  };
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    if (!shared) {
      setStatus("未共享");
      return;
    }
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>,
      owner: { sessionId: string; owner: string } | null = null;
    let ack: any = null;
    const completed = new Map<string, any>();
    async function poll() {
      try {
        const state = snapshot();
        if (!owner) {
          owner = await post("/api/editor/register", {
            state,
            allowEdit: permissions.current.allowEdit,
          });
          if (cancelled) {
            await post(`/api/editor/${owner!.sessionId}/close`, {
              owner: owner!.owner,
            });
            return;
          }
          setConnection(owner);
          setStatus("已连接");
        }
        const response = await post(`/api/editor/${owner!.sessionId}/poll`, {
          owner: owner!.owner,
          state,
          allowEdit: permissions.current.allowEdit,
          ack,
        });
        ack = null;
        setError("");
        if (cancelled) return;
        if (response.command) {
          const command: Command = response.command;
          if (completed.has(command.id)) ack = completed.get(command.id);
          else {
            try {
              ack = {
                id: command.id,
                result: await executeRef.current(command),
              };
            } catch (e) {
              const message = (e as Error).message;
              ack = {
                id: command.id,
                error: { code: message.split(":")[0], message },
              };
            }
            completed.set(command.id, ack);
            if (completed.size > 30)
              completed.delete(completed.keys().next().value!);
          }
        }
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setStatus("重连中");
        if ((e as { code?: string }).code === "EDITOR_OFFLINE") {
          owner = null;
          setConnection(null);
        }
      }
      if (!cancelled) timer = setTimeout(poll, ack ? 30 : 650);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setConnection(null);
      if (owner)
        void post(`/api/editor/${owner.sessionId}/close`, {
          owner: owner.owner,
        }).catch(() => {});
    };
  }, [shared]);
  async function decide(approve: boolean) {
    const c = connectionRef.current;
    if (!proposal) return;
    if (!c) {
      if (!approve) setProposal(null);
      return;
    }
    setSaving(true);
    try {
      if (
        approve &&
        (snapshot().revision !== proposal.revision || live.current.isEditing())
      )
        throw new Error("工程已变化，请拒绝旧提案并让 MCP 重新预览差异。");
      const result = await post(`/api/editor/${c.sessionId}/approve`, {
        owner: c.owner,
        proposalId: proposal.proposalId,
        approve,
        state: snapshot(),
        allowEdit: permissions.current.allowEdit,
      });
      setProposal(result);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Button
        size="xs"
        variant={shared ? "light" : "default"}
        color={shared ? "teal" : undefined}
        onClick={() => setOpened(true)}
      >
        MCP{shared ? " · 已共享" : ""}
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="MCP · 本地协作接口"
        size="lg"
      >
        <Stack gap="sm">
          <Alert>
            仅共享本标签页；默认只读。启用修改后，AI 调整可撤销，不会自动保存到
            Mod。原文件保存必须逐次在此页面确认。
          </Alert>
          <Switch
            label="共享当前工程给 MCP"
            checked={shared}
            onChange={(e) => {
              setShared(e.currentTarget.checked);
              if (!e.currentTarget.checked) setAllowEdit(false);
            }}
          />
          <Switch
            label="允许 MCP 修改坐标和预览（不自动写文件）"
            disabled={!shared}
            checked={allowEdit}
            onChange={(e) => setAllowEdit(e.currentTarget.checked)}
          />
          <Group>
            <Badge>{status}</Badge>
            <Text size="xs">最近操作：{lastAction || "无"}</Text>
          </Group>
          {connection && <Code block>sessionId: {connection.sessionId}</Code>}
          <Text size="sm">
            客户端使用 stdio：Node 执行本项目的
            server/mcp.mjs。先启动本地服务，再连接 MCP；详情见 README 的 MCP
            接入章节。
          </Text>
          <Text size="xs" c="dimmed">
            关闭页面或关闭共享后，会话停止响应。重启服务会使原保存来源会话失效，需重新导入物品。不要公开
            .local 中的连接凭据。
          </Text>
          {error && <Alert color="red">{error}</Alert>}
        </Stack>
      </Modal>
      <Modal
        opened={!!proposal}
        onClose={() => {
          if (!saving) {
            if (proposal?.status === "pending") void decide(false);
            else setProposal(null);
          }
        }}
        title="MCP 请求保存 · 请人工核对"
        size="lg"
        closeOnClickOutside={false}
      >
        {proposal && (
          <Stack gap="sm">
            <Alert color="orange">
              只保存以下坐标差异；生成备份，不修改脚本、伤害或容器规则。确认的是此提案快照。
            </Alert>
            <Text size="xs" style={{ overflowWrap: "anywhere" }}>
              {proposal.file}
            </Text>
            <Text size="sm">
              状态：{proposal.status} · {proposal.changes.length} 项
            </Text>
            <ScrollArea.Autosize mah={260}>
              {proposal.changes.map((c, i) => (
                <Code
                  block
                  key={i}
                >{`${c.node} / ${c.attribute}\n− ${c.before}\n+ ${c.after}`}</Code>
              ))}
            </ScrollArea.Autosize>
            {proposal.warnings.map((w) => (
              <Text size="xs" c="orange" key={w}>
                {w}
              </Text>
            ))}
            {proposal.result && (
              <Alert color="teal">
                已保存。备份：{proposal.result.backup}
                。继续保存前请重新导入来源。
              </Alert>
            )}
            {(error || proposal.error) && (
              <Alert color="red">{error || proposal.error}</Alert>
            )}
            {proposal.status === "pending" ? (
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={saving}
                  onClick={() => void decide(false)}
                >
                  拒绝此次保存
                </Button>
                <Button
                  loading={saving}
                  disabled={
                    !shared ||
                    !allowEdit ||
                    !proposal.changes.length ||
                    Date.now() >= proposal.expires
                  }
                  onClick={() => void decide(true)}
                >
                  确认 MCP 保存这些坐标
                </Button>
              </Group>
            ) : (
              <Button onClick={() => setProposal(null)}>关闭</Button>
            )}
          </Stack>
        )}
      </Modal>
    </>
  );
}
