import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Divider,
  Drawer,
  FileButton,
  Group,
  Loader,
  Modal,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBox,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconCrosshair,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFileCode,
  IconFolder,
  IconHandMove,
  IconHelp,
  IconLayersIntersect,
  IconPlus,
  IconRefresh,
  IconRuler2,
  IconScissors,
  IconSearch,
  IconSettings,
  IconShirt,
  IconTarget,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { CharacterViewport, TextureViewport } from "./components/Viewport";
import { HoldingPanel } from "./components/HoldingPanel";
import { SaveBack } from "./components/SaveBack";
import { McpPanel, type PreviewHandle } from "./components/McpPanel";
import { AttachmentsPanel } from "./components/AttachmentsPanel";
import { attachmentMatches, chooseAttachmentLayer } from "./attachments";
import type { HoldPreview } from "./holding";
import {
  limbNames,
  limbLabels,
  newLayer,
  newProject,
  roleLabels,
  round,
} from "./model";
import type {
  Project,
  SpriteLayer,
  Texture,
  Library,
  Root,
  Reference,
  Vec,
  Role,
  Socket,
} from "./model";
import { exportXml, parseProject, validateProject } from "./exporter";
import { wearableTransform } from "./geometry";
import { hasHolding, isCombinedEquipment } from "../shared/equipment.mjs";
// QA tabs do not replace the developer's autosaved working project.
const testDraft = new URLSearchParams(location.search).get("test");
const draftKey =
  testDraft === null
    ? "sprite-lab-v1"
    : "sprite-lab-qa-v1" +
      (testDraft && testDraft !== "1"
        ? ":" + encodeURIComponent(testDraft)
        : "");

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "读取失败");
  return body;
}
const notifyError = (error: unknown) =>
  notifications.show({
    color: "red",
    title: "操作未完成",
    message: error instanceof Error ? error.message : String(error),
  });
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function Num({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  description,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  description?: string;
}) {
  return (
    <NumberInput
      label={label}
      description={description}
      size="xs"
      value={round(value)}
      onChange={(v) => {
        if (typeof v === "number" && Number.isFinite(v))
          onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
      }}
      step={step}
      min={min}
      max={max}
      decimalScale={5}
    />
  );
}
function Pair({
  labels,
  value,
  onChange,
  step = 1,
  min,
}: {
  labels: [string, string];
  value: Vec;
  onChange: (v: Vec) => void;
  step?: number;
  min?: number;
}) {
  return (
    <div className="pair">
      <Num
        label={labels[0]}
        value={value[0]}
        step={step}
        min={min}
        onChange={(v) => onChange([v, value[1]])}
      />
      <Num
        label={labels[1]}
        value={value[1]}
        step={step}
        min={min}
        onChange={(v) => onChange([value[0], v])}
      />
    </div>
  );
}
function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="inspector-section">
      <Group justify="space-between" mb={12}>
        <Text size="xs" fw={650} c="#adbccc">
          {title}
        </Text>
        {aside}
      </Group>
      <Stack gap="sm">{children}</Stack>
    </section>
  );
}

export default function App() {
  const [project, setProject] = useState<Project>(() => {
    try {
      const s = localStorage.getItem(draftKey);
      if (s) return parseProject(s);
    } catch {
      /* invalid saved draft */
    }
    return newProject();
  });
  const [selection, setSelection] = useState(project.layers[0]?.id || "");
  const [roots, setRoots] = useState<Root[]>([]),
    [rootId, setRootId] = useState("");
  const [library, setLibrary] = useState<Library>({
    textures: [],
    items: [],
    errors: [],
  });
  const [reference, setReference] = useState<Reference | null>(null),
    [refError, setRefError] = useState("");
  const [gender, setGender] = useState("female"),
    [head, setHead] = useState(0),
    [frontHair, setFrontHair] = useState(""),
    [backHair, setBackHair] = useState("");
  const [pose, setPose] = useState<"neutral" | "relaxed">("neutral"),
    [facing, setFacing] = useState(1),
    [skeleton, setSkeleton] = useState(true),
    [ghost, setGhost] = useState(false);
  const [holdPreview, setHoldPreview] = useState<HoldPreview>({
    mode: "hold",
    hand: "right",
    direction: 0,
  });
  const [previewFocused, setPreviewFocused] = useState(false);
  const [tool, setTool] = useState("crop"),
    [dimensions, setDimensions] = useState<Vec>([0, 0]);
  const [drawer, setDrawer] = useState<"resources" | "export" | "help" | null>(
      null,
    ),
    [resourceTab, setResourceTab] = useState<string | null>("items");
  const [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState(false),
    [folder, setFolder] = useState("");
  const [layerModal, setLayerModal] = useState(false),
    [newRole, setNewRole] = useState<Role>("wearable"),
    [newModal, setNewModal] = useState(false),
    [newKind, setNewKind] = useState<Project["kind"]>("clothing");
  const [inspectorTab, setInspectorTab] = useState<string | null>(
    hasHolding(project) ? "holding" : "sprite",
  );
  const [attachmentSocket, setAttachmentSocket] = useState<string | null>(null);
  const [selectedSocket, setSelectedSocket] = useState<string | null>(
    project.sockets[0]?.id || null,
  );
  const [matchingAttachments, setMatchingAttachments] = useState(true);
  const [saveState, setSaveState] = useState("草稿已保存");
  const previewHandle = useRef<PreviewHandle | null>(null);
  const [remotePreviewEpoch, setRemotePreviewEpoch] = useState(0);
  const history = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    current = useRef(project),
    lastEdit = useRef(0);
  const gestureStart = useRef<Project | null>(null),
    gestureRecorded = useRef(false);
  const beginEditGesture = () => {
    gestureStart.current = current.current;
    gestureRecorded.current = false;
  };
  const endEditGesture = () => {
    gestureStart.current = null;
    gestureRecorded.current = false;
    lastEdit.current = 0;
  };
  const layer =
    project.layers.find((l) => l.id === selection) || project.layers[0];
  const update = (p: Project, force = false) => {
    if (gestureStart.current) {
      if (!gestureRecorded.current) {
        history.current = [...history.current.slice(-59), gestureStart.current];
        gestureRecorded.current = true;
      }
    } else if (force || Date.now() - lastEdit.current > 600)
      history.current = [...history.current.slice(-59), current.current];
    lastEdit.current = Date.now();
    future.current = [];
    current.current = p;
    setProject(p);
  };
  const edit = (change: Partial<Project>) =>
    update({ ...current.current, ...change });
  const editLayer = (change: Partial<SpriteLayer>) => {
    const id = layer.id;
    update({
      ...current.current,
      layers: current.current.layers.map((l) =>
        l.id === id ? { ...l, ...change } : l,
      ),
    });
  };
  const undo = () => {
    const previous = history.current.pop();
    if (previous) {
      future.current.push(current.current);
      current.current = previous;
      setProject(previous);
      lastEdit.current = 0;
    }
  };
  const redo = () => {
    const next = future.current.pop();
    if (next) {
      history.current.push(current.current);
      current.current = next;
      setProject(next);
      lastEdit.current = 0;
    }
  };
  const loadProject = (p: Project) => {
    if (!p.layers.length) throw new Error("项目没有图层");
    update(p, true);
    setSelection(
      p.layers.find(
        (l) =>
          l.role ===
          (p.kind === "clothing" || isCombinedEquipment(p)
            ? "wearable"
            : "item"),
      )?.id || p.layers[0].id,
    );
    setTool("crop");
    setSelectedSocket(p.sockets[0]?.id || null);
    setInspectorTab(hasHolding(p) ? "holding" : "sprite");
    setHoldPreview((v) => ({
      ...v,
      mode: "hold",
      progress: 1,
      hand:
        /LeftHand/i.test(p.holdableSlots || "") &&
        !/RightHand/i.test(p.holdableSlots || "")
          ? "left"
          : "right",
    }));
  };
  useEffect(() => {
    api<Root[]>("/api/roots")
      .then((rs) => {
        setRoots(rs);
        setRootId(rs[0]?.id || "");
      })
      .catch(notifyError);
  }, []);
  useEffect(() => {
    let active = true;
    setRefError("");
    api<Reference>("/api/reference?gender=" + gender)
      .then((r) => {
        if (!active) return;
        setReference(r);
        setFrontHair(r.hair.find((h) => h.group === "moustache")?.id || "");
        setBackHair(r.hair.find((h) => h.group === "beard")?.id || "");
        setHead(0);
      })
      .catch((e) => {
        if (active) setRefError(e.message);
      });
    return () => {
      active = false;
    };
  }, [gender, roots.length]);
  useEffect(() => {
    if (!rootId) return;
    let active = true;
    setBusy(true);
    api<Library>("/api/library?root=" + encodeURIComponent(rootId))
      .then((l) => {
        if (active) setLibrary(l);
      })
      .catch(notifyError)
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [rootId]);
  useEffect(() => {
    setSaveState("正在保存…");
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(project));
        setSaveState("草稿已保存");
      } catch {
        setSaveState("请下载项目：草稿超出浏览器容量");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [project]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(tag) ||
        (e.target as HTMLElement).isContentEditable
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        download(
          project.identifier + ".sprite-lab.json",
          JSON.stringify(project, null, 2),
          "application/json",
        );
      } else if (e.key.toLowerCase() === "c") setTool("crop");
      else if (e.key.toLowerCase() === "o") setTool("origin");
      else if (e.key.toLowerCase() === "v") setTool("pan");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const importItem = async (item: Library["items"][number]) => {
    setBusy(true);
    try {
      const imported = await api<Project>(
        "/api/item?" +
          new URLSearchParams({ root: rootId, file: item.file, id: item.id }),
      );
      if (attachmentSocket) {
        const layers = imported.layers.filter((l) =>
          ["item", "contained", "decorative"].includes(l.role),
        );
        if (!layers.length)
          throw new Error("这个物品没有可用于挂载的 Sprite / ContainedSprite");
        const socket = current.current.sockets.find(
          (s) => s.id === attachmentSocket,
        );
        if (socket && !attachmentMatches(socket, item))
          throw new Error(
            "此物品不符合当前 Containable 接纳规则。请选匹配项，或为新增模板填写正确 identifier / tag。",
          );
        const preview = {
          identifier: item.id,
          scale: imported.itemScale,
          layers,
          selected: chooseAttachmentLayer(layers, current.current).id,
        };
        edit({
          sockets: current.current.sockets.map((s) =>
            s.id === attachmentSocket
              ? {
                  ...s,
                  preview: {
                    ...preview,
                  },
                }
              : socket?.slotGroup && s.slotGroup === socket.slotGroup
                ? { ...s, preview: undefined }
                : s,
          ),
        });
        setSelectedSocket(attachmentSocket);
        setAttachmentSocket(null);
      } else loadProject(imported);
      setDrawer(null);
      notifications.show({
        title: "已读取标定字段",
        message: item.name + " · 原文件保持不变",
        color: "teal",
      });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const editSocket = (id: string, changes: Partial<Socket>) =>
    edit({
      sockets: current.current.sockets.map((s) =>
        s.id === id ? { ...s, ...changes } : s,
      ),
    });
  const autoAttachments = async () => {
    setBusy(true);
    const sourceToken = current.current.source?.token;
    try {
      const results = await api<{ id: string; preview: Socket["preview"] }[]>(
        "/api/attachments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rootId: project.source?.rootId,
            identifier: project.source?.originalId || project.identifier,
            tags: project.tags,
            sockets: project.sockets,
          }),
        },
      );
      if (sourceToken !== current.current.source?.token) return;
      edit({
        sockets: current.current.sockets.map((s) => ({
          ...s,
          preview: results.find((r) => r.id === s.id)?.preview,
        })),
      });
      setSelectedSocket(results[0]?.id || project.sockets[0]?.id || null);
      notifications.show({
        title: "已装配预览",
        message: `${results.length} 个挂点找到配件；不执行 Lua / StatusEffect，隐藏或缺少资源的挂点不装配。`,
        color: "teal",
      });
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const addSocket = () => {
    const id = crypto.randomUUID();
    edit({
      sockets: [
        ...project.sockets,
        {
          id,
          name: "新配件挂点",
          position: [0, 0],
          rotation: 0,
          depth: -1,
          items: "attachment_identifier",
          source: "containable",
          filterAttribute: "items",
          hidden: false,
        },
      ],
    });
    setSelectedSocket(id);
  };
  const chooseTexture = (t: Texture) => {
    editLayer({ texture: { uri: t.uri, xmlPath: t.xmlPath, name: t.name } });
    setDrawer(null);
    setTool("crop");
  };
  const uploadTexture = (file: File | null) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      return notifyError("请选择 PNG、JPEG 或 WebP");
    const reader = new FileReader();
    reader.onload = () => {
      editLayer({
        texture: {
          uri: reader.result as string,
          xmlPath: "%ModDir%/gears/" + file.name,
          name: file.name,
        },
      });
      notifications.show({
        title: "贴图已载入",
        message: "导出时请将图片放到 XML texture 指定的路径。",
        color: "teal",
      });
    };
    reader.readAsDataURL(file);
  };
  const addRoot = async () => {
    setBusy(true);
    try {
      const r = await api<Root>("/api/roots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folder }),
      });
      setRoots(await api<Root[]>("/api/roots"));
      setRootId(r.id);
      setSettings(false);
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };
  const xml = exportXml(project),
    errors = validateProject(project);
  const limb = reference?.limbs.find((l) => l.limb === layer.limb);
  const effective =
    limb && reference
      ? wearableTransform(layer, limb, reference)
      : {
          scale: layer.scale,
          rect: layer.rect,
          originPixels: [
            layer.rect[2] * layer.origin[0],
            layer.rect[3] * layer.origin[1],
          ],
        };
  const textureBoundsBad =
    dimensions[0] > 0 &&
    (layer.rect[0] + layer.rect[2] > dimensions[0] ||
      layer.rect[1] + layer.rect[3] > dimensions[1]);
  const canMark = layer.role === "item" && hasHolding(project);
  const tools = [
    { value: "pan", label: "平移", icon: IconHandMove },
    { value: "crop", label: "框选", icon: IconScissors },
    { value: "origin", label: "原点", icon: IconCrosshair },
    ...(canMark
      ? [
          { value: "h1", label: "握点 1", icon: IconTarget },
          { value: "h2", label: "握点 2", icon: IconTarget },
          ...(project.hasBarrel
            ? [
                {
                  value: "barrel",
                  label: project.kind === "tool" ? "作用点" : "枪口",
                  icon: IconTarget,
                },
              ]
            : []),
        ]
      : []),
  ];

  return (
    <div className="app">
      <header className="header">
        <Group gap={12}>
          <div>
            <div className="brand-title">Barotrauma Chara Texture Tool</div>
            <div className="brand-sub">人物与物品贴图标定工具</div>
          </div>
          <Divider orientation="vertical" ml={14} mr={10} />
          <Badge variant="outline" color="teal" size="sm">
            阶段 02 / 持握与装配
          </Badge>
        </Group>
        <Group gap={8}>
          <McpPanel
            project={project}
            getProject={() => current.current}
            reference={reference}
            label={testDraft === null ? "工作页面" : `测试：${testDraft}`}
            view={{
              ...holdPreview,
              facing,
              bodyPose: pose,
              skeleton,
              gender,
              head,
              frontHair,
              backHair,
              ghost,
              selectedLayer: selection,
              selectedSocket,
            }}
            update={(p) => {
              endEditGesture();
              update(p, true);
              lastEdit.current = 0;
            }}
            load={loadProject}
            undo={undo}
            redo={redo}
            isEditing={() => !!gestureStart.current}
            setPreview={(p) => {
              setRemotePreviewEpoch((v) => v + 1);
              if (p.facing !== undefined) setFacing(p.facing);
              if (p.bodyPose !== undefined) setPose(p.bodyPose);
              if (p.skeleton !== undefined) setSkeleton(p.skeleton);
              const { facing: _f, bodyPose: _b, skeleton: _s, ...hold } = p;
              setHoldPreview((v) => ({ ...v, ...hold }));
            }}
            capture={async (fit) => {
              if (!previewHandle.current)
                throw new Error("PREVIEW_UNAVAILABLE: 预览尚未挂载。");
              return previewHandle.current.capture(fit);
            }}
          />
          <Tooltip label="撤销 Ctrl+Z">
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label="撤销"
              disabled={!history.current.length}
              onClick={undo}
            >
              <IconArrowBackUp size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="重做 Ctrl+Shift+Z">
            <ActionIcon
              variant="subtle"
              size="lg"
              aria-label="重做"
              disabled={!future.current.length}
              onClick={redo}
            >
              <IconArrowForwardUp size={19} />
            </ActionIcon>
          </Tooltip>
          <Button
            variant="default"
            size="xs"
            leftSection={<IconDownload size={15} />}
            onClick={() =>
              download(
                project.identifier + ".sprite-lab.json",
                JSON.stringify(project, null, 2),
                "application/json",
              )
            }
          >
            保存项目
          </Button>
          <SaveBack
            project={project}
            reload={async () => {
              if (!project.source?.rootId || !project.source.originalId) return;
              try {
                loadProject(
                  await api<Project>(
                    "/api/item?" +
                      new URLSearchParams({
                        root: project.source.rootId,
                        file: project.source.file,
                        id: project.source.originalId,
                      }),
                  ),
                );
              } catch (e) {
                notifyError(e);
              }
            }}
          />
          <Button
            size="xs"
            color="teal"
            leftSection={<IconFileCode size={16} />}
            onClick={() => setDrawer("export")}
          >
            导出 XML
          </Button>
          <ActionIcon
            variant="subtle"
            size="lg"
            aria-label="使用说明"
            onClick={() => setDrawer("help")}
          >
            <IconHelp size={20} />
          </ActionIcon>
        </Group>
      </header>
      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="eyebrow">01 / ASSET LIBRARY</div>
            <Group justify="space-between" mt={8} mb={12}>
              <Text size="sm" fw={650}>
                本地资源
              </Text>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="连接资源目录"
                onClick={() => setSettings(true)}
              >
                <IconSettings size={16} />
              </ActionIcon>
            </Group>
            <Select
              aria-label="Mod 资源库"
              size="xs"
              data={roots.map((r) => ({ value: r.id, label: r.name }))}
              value={rootId}
              onChange={(v) => setRootId(v || "")}
              searchable
            />
            <Button
              mt="sm"
              fullWidth
              variant="light"
              color="gray"
              size="xs"
              leftSection={<IconFolder size={15} />}
              onClick={() => {
                setResourceTab("items");
                setDrawer("resources");
              }}
            >
              打开资源库 {busy && <Loader size={12} ml={10} />}
            </Button>
            <Text size="xs" c="dimmed" mt={8}>
              {library.items.length} 个物品 · {library.textures.length} 张贴图
            </Text>
          </div>
          <div className="project-block">
            <div className="eyebrow">当前标定</div>
            <Text fw={650} size="sm" mt={8} lineClamp={2}>
              {project.name}
            </Text>
            <Text size="xs" c="dimmed" mt={3}>
              {isCombinedEquipment(project)
                ? "复合装备 · 穿戴＋持握"
                : project.kind === "clothing"
                  ? "服装 / 饰件"
                  : project.kind === "weapon"
                    ? project.twoHanded
                      ? "双手武器"
                      : "单手武器"
                    : "手持工具"}
            </Text>
            <Group gap={6} mt={12}>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => setNewModal(true)}
              >
                新建
              </Button>
              <FileButton
                accept=".json"
                onChange={async (f) => {
                  if (f)
                    try {
                      loadProject(parseProject(await f.text()));
                    } catch (e) {
                      notifyError(e);
                    }
                }}
              >
                {(props) => (
                  <Button {...props} size="compact-xs" variant="default">
                    打开项目
                  </Button>
                )}
              </FileButton>
            </Group>
          </div>
          <Group justify="space-between" className="layers-heading">
            <Group gap={7}>
              <IconLayersIntersect size={15} />
              <Text size="xs" fw={650}>
                图层
              </Text>
              <Badge size="xs" color="gray" variant="light">
                {project.layers.length}
              </Badge>
            </Group>
            <ActionIcon
              variant="subtle"
              size="sm"
              aria-label="添加图层"
              onClick={() => setLayerModal(true)}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Group>
          <ScrollArea className="layer-list" type="auto">
            {project.layers.map((l) => (
              <div
                key={l.id}
                className={"layer-row " + (l.id === layer.id ? "selected" : "")}
                onClick={() => {
                  setSelection(l.id);
                  setTool("crop");
                  if (isCombinedEquipment(project)) setInspectorTab("sprite");
                }}
              >
                <div className="layer-icon">
                  {l.role === "wearable" ? (
                    <IconShirt size={18} />
                  ) : (
                    <IconBox size={18} />
                  )}
                </div>
                <div className="layer-text">
                  <Text size="xs" fw={550} truncate>
                    {l.name}
                  </Text>
                  <Text size="10px" c="dimmed">
                    {l.role === "wearable"
                      ? `${limbLabels[l.limb] || l.limb} · ${l.limb}`
                      : roleLabels[l.role]}
                  </Text>
                </div>
                <ActionIcon
                  variant="transparent"
                  size="sm"
                  aria-label={"显示或隐藏 " + l.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    edit({
                      layers: project.layers.map((o) =>
                        o.id === l.id ? { ...o, visible: !o.visible } : o,
                      ),
                    });
                  }}
                >
                  {l.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                </ActionIcon>
              </div>
            ))}
          </ScrollArea>
          <div className="sidebar-bottom">
            <div className="eyebrow">WORKFLOW</div>
            <div className="workflow-step">
              <span>1</span>选择 / 导入资源
              <IconCheck size={13} />
            </div>
            <div className="workflow-step active">
              <span>2</span>框选与坐标标定
            </div>
            <div className="workflow-step">
              <span>3</span>人物对照与导出
            </div>
            <Text size="10px" c="dimmed" mt={12}>
              拖动预览 → 返回标定数值
              <br />
              Alt + 滚轮 · 调整贴图缩放
            </Text>
          </div>
        </aside>

        <section className="main-area">
          <div className="document-bar">
            <Group gap={8}>
              <IconFileCode size={16} color="#67cdb9" />
              <Text size="xs" fw={550}>
                {project.identifier}
              </Text>
              <IconChevronRight size={13} color="#596d83" />
              <Text size="xs" c="dimmed">
                {layer.name}
              </Text>
            </Group>
            <Text size="10px" c="dimmed">
              {saveState}
            </Text>
          </div>
          <div className="toolbar">
            <Group gap={4}>
              {tools.map((t) => (
                <Tooltip
                  key={t.value}
                  label={
                    t.label +
                    (t.value === "crop"
                      ? " · C"
                      : t.value === "origin"
                        ? " · O"
                        : t.value === "pan"
                          ? " · V"
                          : "")
                  }
                >
                  <Button
                    size="compact-xs"
                    variant={tool === t.value ? "light" : "subtle"}
                    color={tool === t.value ? "teal" : "gray"}
                    leftSection={<t.icon size={14} />}
                    onClick={() => setTool(t.value)}
                  >
                    {t.label}
                  </Button>
                </Tooltip>
              ))}
            </Group>
            <Group gap={7}>
              <Button
                size="compact-xs"
                variant={previewFocused ? "light" : "subtle"}
                onClick={() => setPreviewFocused((v) => !v)}
              >
                {previewFocused ? "返回双视图" : "展开人物预览"}
              </Button>
              <FileButton
                accept="image/png,image/jpeg,image/webp"
                onChange={uploadTexture}
              >
                {(props) => (
                  <Button
                    {...props}
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconUpload size={13} />}
                  >
                    本地图片
                  </Button>
                )}
              </FileButton>
              <Button
                size="compact-xs"
                variant="default"
                onClick={() => {
                  setResourceTab("textures");
                  setDrawer("resources");
                }}
              >
                更换贴图
              </Button>
            </Group>
          </div>
          {refError && (
            <Alert color="red" p="xs" m="xs">
              {refError}
            </Alert>
          )}
          <div
            className={"canvases" + (previewFocused ? " preview-focused" : "")}
          >
            {!previewFocused && (
              <TextureViewport
                layer={layer}
                project={project}
                tool={tool}
                onLayer={editLayer}
                onProject={edit}
                onDimensions={setDimensions}
                onGestureStart={beginEditGesture}
                onGestureEnd={endEditGesture}
              />
            )}
            <CharacterViewport
              captureHandle={previewHandle}
              remotePreviewEpoch={remotePreviewEpoch}
              reference={reference}
              project={project}
              selected={layer}
              onSelectLayer={(id) => {
                setSelection(id);
                setTool("crop");
                setInspectorTab("sprite");
              }}
              onLayer={editLayer}
              skeleton={skeleton}
              facing={facing}
              pose={pose}
              head={head}
              frontHair={frontHair}
              backHair={backHair}
              ghost={ghost}
              onGestureStart={beginEditGesture}
              onGestureEnd={endEditGesture}
              preview={holdPreview}
              selectedSocket={
                inspectorTab === "attachments" ? selectedSocket : null
              }
              onSocket={editSocket}
              onPreview={(p) => setHoldPreview((v) => ({ ...v, ...p }))}
              onProject={edit}
              onItemLayer={(id, changes) =>
                edit({
                  layers: current.current.layers.map((l) =>
                    l.id === id ? { ...l, ...changes } : l,
                  ),
                })
              }
            />
          </div>
          <div className="reference-controls">
            <Group gap={8}>
              <IconRuler2 size={16} color="#68a4bc" />
              <Text size="xs" fw={600}>
                人物参考
              </Text>
              <Select
                size="xs"
                w={92}
                aria-label="人物性别"
                data={[
                  { value: "female", label: "女性" },
                  { value: "male", label: "男性" },
                ]}
                value={gender}
                onChange={(v) => setGender(v || "female")}
              />
              <Select
                size="xs"
                w={115}
                aria-label="参考姿态"
                value={pose}
                onChange={(v) => setPose(v as typeof pose)}
                data={[
                  { value: "neutral", label: "绑定姿态" },
                  { value: "relaxed", label: "放松姿态" },
                ]}
              />
              <Button
                variant="default"
                size="compact-xs"
                onClick={() => setFacing((v) => -v)}
              >
                朝向 {facing === 1 ? "→" : "←"}
              </Button>
            </Group>
            <Group gap={15}>
              <Checkbox
                size="xs"
                label="骨架"
                checked={skeleton}
                onChange={(e) => setSkeleton(e.currentTarget.checked)}
              />
              <Checkbox
                size="xs"
                label="透视原肢体"
                checked={ghost}
                onChange={(e) => setGhost(e.currentTarget.checked)}
              />
            </Group>
          </div>
          <div className="reference-appearance">
            <Select
              size="xs"
              w={108}
              aria-label="脸型"
              placeholder="脸型"
              value={String(head)}
              onChange={(v) => setHead(Number(v))}
              data={
                reference?.heads.map((h, i) => ({
                  value: String(i),
                  label: "脸型 " + (i + 1),
                })) || []
              }
            />
            <Select
              size="xs"
              w={145}
              aria-label="前发"
              placeholder="前发"
              value={frontHair}
              onChange={(v) => setFrontHair(v || "")}
              data={[
                { value: "", label: "无前发" },
                ...(reference?.hair
                  .filter((h) => h.group === "moustache")
                  .map((h, i) => ({ value: h.id, label: "前发 " + (i + 1) })) ||
                  []),
              ]}
              searchable
            />
            <Select
              size="xs"
              w={145}
              aria-label="后发"
              placeholder="后发"
              value={backHair}
              onChange={(v) => setBackHair(v || "")}
              data={[
                { value: "", label: "无后发" },
                ...(reference?.hair
                  .filter((h) => h.group === "beard")
                  .map((h, i) => ({ value: h.id, label: "后发 " + (i + 1) })) ||
                  []),
              ]}
              searchable
            />
            <Text size="10px" c="dimmed">
              LimbScale {reference?.limbScale ?? "—"} · JointScale{" "}
              {reference?.jointScale ?? "—"} · 静态关节重建，非游戏物理模拟
            </Text>
          </div>
          <div className="coordinate-strip">
            <div>
              <i className="dot amber" />
              origin <Code>{layer.origin.map((n) => round(n)).join(", ")}</Code>
            </div>
            <div>
              <i className="dot teal" />
              sourcerect{" "}
              <Code>{layer.rect.map((n) => round(n)).join(", ")}</Code>
            </div>
            <div className="strip-right">
              {layer.role === "wearable"
                ? `有效缩放 ${round(effective.scale)} · ${limbLabels[layer.limb]}`
                : `Item scale ${project.itemScale}`}
            </div>
          </div>
        </section>

        <aside className="inspector">
          <Tabs value={inspectorTab} onChange={setInspectorTab}>
            <Tabs.List grow>
              <Tabs.Tab value="sprite">贴图</Tabs.Tab>
              <Tabs.Tab value="item">物品 / 握点</Tabs.Tab>
              {hasHolding(project) && (
                <Tabs.Tab value="attachments">配件</Tabs.Tab>
              )}
              {hasHolding(project) && <Tabs.Tab value="holding">持握</Tabs.Tab>}
            </Tabs.List>
            <ScrollArea className="inspector-scroll" type="auto">
              <Tabs.Panel value="attachments">
                <AttachmentsPanel
                  project={project}
                  selected={selectedSocket}
                  select={setSelectedSocket}
                  edit={editSocket}
                  auto={autoAttachments}
                  add={addSocket}
                  busy={busy}
                  choose={(id) => {
                    setAttachmentSocket(id);
                    setResourceTab("items");
                    setSearch("");
                    if (project.source?.rootId)
                      setRootId(project.source.rootId);
                    setDrawer("resources");
                  }}
                />
              </Tabs.Panel>
              <Tabs.Panel value="sprite">
                {layer.role === "item" && (
                  <Section title="主贴图缩放 / Item scale">
                    <Num
                      label="主贴图 scale"
                      value={project.itemScale}
                      min={0.001}
                      step={0.01}
                      onChange={(itemScale) => edit({ itemScale })}
                    />
                    <Text size="10px" c="dimmed">
                      游戏由 Item scale 缩放主图与握点；不是
                      Sprite.scale。人物预览 Alt +
                      滚轮也可调整，图集仍显示原始像素。
                    </Text>
                  </Section>
                )}
                <Section
                  title="图层属性"
                  aside={
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      size="sm"
                      aria-label="删除当前图层"
                      disabled={project.layers.length === 1}
                      onClick={() => {
                        const next = project.layers.filter(
                          (l) => l.id !== layer.id,
                        );
                        edit({ layers: next });
                        setSelection(next[0].id);
                      }}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  }
                >
                  <TextInput
                    size="xs"
                    label="图层名称"
                    value={layer.name}
                    onChange={(e) => editLayer({ name: e.currentTarget.value })}
                  />
                  <Select
                    size="xs"
                    label="导出节点"
                    data={Object.entries(roleLabels).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                    value={layer.role}
                    onChange={(v) => editLayer({ role: v as Role })}
                  />
                  <TextInput
                    size="xs"
                    label="texture · XML 路径"
                    value={layer.texture.xmlPath}
                    onChange={(e) =>
                      editLayer({
                        texture: {
                          ...layer.texture,
                          xmlPath: e.currentTarget.value,
                        },
                      })
                    }
                  />
                  <Checkbox
                    size="xs"
                    label="包含在导出模板中"
                    checked={layer.export}
                    onChange={(e) =>
                      editLayer({ export: e.currentTarget.checked })
                    }
                  />
                </Section>
                <Section
                  title="框选 / SourceRect"
                  aside={
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={!dimensions[0]}
                      onClick={() =>
                        editLayer({
                          rect: [0, 0, dimensions[0], dimensions[1]],
                          inheritSourceRect: false,
                        })
                      }
                    >
                      整张图
                    </Button>
                  }
                >
                  <Pair
                    labels={["X", "Y"]}
                    value={[layer.rect[0], layer.rect[1]]}
                    min={0}
                    onChange={(v) =>
                      editLayer({
                        rect: [v[0], v[1], layer.rect[2], layer.rect[3]],
                        inheritSourceRect: false,
                      })
                    }
                  />
                  <Pair
                    labels={["宽 W", "高 H"]}
                    value={[layer.rect[2], layer.rect[3]]}
                    min={1}
                    onChange={(v) =>
                      editLayer({
                        rect: [layer.rect[0], layer.rect[1], v[0], v[1]],
                        inheritSourceRect: false,
                      })
                    }
                  />
                  {textureBoundsBad && (
                    <Text size="xs" c="orange">
                      框选超出当前图片，请重新框选。
                    </Text>
                  )}
                </Section>
                <Section title="原点 / Origin">
                  <Pair
                    labels={["Origin X", "Origin Y"]}
                    value={layer.origin}
                    step={0.01}
                    onChange={(v) =>
                      editLayer({ origin: v, inheritOrigin: false })
                    }
                  />
                  <Text size="10px" c="dimmed">
                    相对裁切宽高的比例，允许小于 0 或大于 1。Y 增大 → 贴图上移。
                  </Text>
                  <Button
                    variant="subtle"
                    size="compact-xs"
                    onClick={() =>
                      editLayer({ origin: [0.5, 0.5], inheritOrigin: false })
                    }
                  >
                    设为裁切中心 0.5, 0.5
                  </Button>
                </Section>
                {layer.role === "wearable" && (
                  <>
                    <Section title="挂载与偏移">
                      <Select
                        size="xs"
                        label="绑定肢体 limb"
                        searchable
                        data={limbNames.map((value) => ({
                          value,
                          label: limbLabels[value] + " · " + value,
                        }))}
                        value={layer.limb}
                        onChange={(v) => editLayer({ limb: v || "Torso" })}
                      />
                      <Pair
                        labels={["水平偏移 →", "垂直偏移 ↓"]}
                        step={1}
                        value={[
                          (0.5 - layer.origin[0]) *
                            layer.rect[2] *
                            effective.scale,
                          (0.5 - layer.origin[1]) *
                            layer.rect[3] *
                            effective.scale,
                        ]}
                        onChange={(v) =>
                          editLayer({
                            origin: [
                              0.5 - v[0] / (layer.rect[2] * effective.scale),
                              0.5 - v[1] / (layer.rect[3] * effective.scale),
                            ],
                            inheritOrigin: false,
                          })
                        }
                      />
                      <Text size="10px" c="dimmed">
                        相对居中 origin
                        的肢体局部显示像素；拖动人物上的衣片也可调整。
                      </Text>
                      <div className="pair">
                        <Num
                          label="穿戴 scale"
                          value={layer.scale}
                          min={0.001}
                          step={0.01}
                          onChange={(v) => editLayer({ scale: v })}
                        />
                        <Num
                          label="rotation（°）"
                          value={layer.rotation}
                          step={1}
                          onChange={(v) => editLayer({ rotation: v })}
                        />
                      </div>
                      <Slider
                        aria-label="穿戴缩放"
                        value={layer.scale}
                        min={0.01}
                        max={Math.max(2, layer.scale)}
                        step={0.01}
                        onChange={(v) => editLayer({ scale: v })}
                      />
                      <Text size="xs" c="teal">
                        游戏有效缩放 {round(effective.scale)}
                      </Text>
                    </Section>
                    <Section title="继承规则">
                      <Switch
                        size="xs"
                        label="inheritscale / inherittexturescale"
                        checked={layer.inheritScale}
                        onChange={(e) =>
                          editLayer({ inheritScale: e.currentTarget.checked })
                        }
                      />
                      {layer.inheritScale && (
                        <>
                          <Checkbox
                            size="xs"
                            label="ignorelimbscale · 忽略肢体缩放"
                            checked={layer.ignoreLimbScale}
                            onChange={(e) =>
                              editLayer({
                                ignoreLimbScale: e.currentTarget.checked,
                              })
                            }
                          />
                          <Checkbox
                            size="xs"
                            label="ignoreragdollscale · 忽略全身缩放"
                            checked={layer.ignoreRagdollScale}
                            onChange={(e) =>
                              editLayer({
                                ignoreRagdollScale: e.currentTarget.checked,
                              })
                            }
                          />
                          <Checkbox
                            size="xs"
                            label="ignoretexturescale · 忽略贴图缩放"
                            checked={layer.ignoreTextureScale}
                            onChange={(e) =>
                              editLayer({
                                ignoreTextureScale: e.currentTarget.checked,
                              })
                            }
                          />
                        </>
                      )}
                      <Checkbox
                        size="xs"
                        label="inheritorigin · 继承肢体像素原点"
                        checked={layer.inheritOrigin}
                        onChange={(e) =>
                          editLayer({ inheritOrigin: e.currentTarget.checked })
                        }
                      />
                      <Checkbox
                        size="xs"
                        label="inheritsourcerect · 继承肢体框选"
                        checked={layer.inheritSourceRect}
                        onChange={(e) =>
                          editLayer({
                            inheritSourceRect: e.currentTarget.checked,
                          })
                        }
                      />
                      {(layer.inheritOrigin || layer.inheritSourceRect) && (
                        <Text size="10px" c="orange">
                          人物预览使用继承值；左侧画布显示此图层的自定义值。
                        </Text>
                      )}
                    </Section>
                  </>
                )}
                {layer.role === "decorative" && (
                  <Section title="配件变换">
                    <Pair
                      labels={["offset X →", "offset Y ↑"]}
                      value={layer.offset}
                      onChange={(v) => editLayer({ offset: v })}
                    />
                    <div className="pair">
                      <Num
                        label="scale"
                        value={layer.scale}
                        min={0.001}
                        step={0.01}
                        onChange={(v) => editLayer({ scale: v })}
                      />
                      <Num
                        label="rotation（°）"
                        value={layer.rotation}
                        onChange={(v) => editLayer({ rotation: v })}
                      />
                    </div>
                  </Section>
                )}
                <Section title="层级与遮挡">
                  <Num
                    label="depth · 越小越靠前"
                    value={layer.depth}
                    step={0.001}
                    min={0}
                    max={1}
                    onChange={(v) => editLayer({ depth: v })}
                  />
                  {layer.role === "wearable" && (
                    <>
                      <Checkbox
                        size="xs"
                        label="inheritlimbdepth · 继承肢体深度"
                        checked={layer.inheritLimbDepth}
                        onChange={(e) =>
                          editLayer({
                            inheritLimbDepth: e.currentTarget.checked,
                          })
                        }
                      />
                      <Select
                        label="depthlimb"
                        size="xs"
                        value={layer.depthLimb}
                        onChange={(v) => editLayer({ depthLimb: v || "None" })}
                        data={["None", ...limbNames]}
                      />
                      <Checkbox
                        size="xs"
                        label="hidelimb · 隐藏原肢体"
                        checked={layer.hideLimb}
                        onChange={(e) =>
                          editLayer({ hideLimb: e.currentTarget.checked })
                        }
                      />
                      <Checkbox
                        size="xs"
                        label="hideotherwearables · 隐藏其他衣片"
                        checked={layer.hideOtherWearables}
                        onChange={(e) =>
                          editLayer({
                            hideOtherWearables: e.currentTarget.checked,
                          })
                        }
                      />
                      <Checkbox
                        size="xs"
                        label="canbehidden… · 允许被其他衣片隐藏"
                        checked={layer.canBeHidden}
                        onChange={(e) =>
                          editLayer({ canBeHidden: e.currentTarget.checked })
                        }
                      />
                    </>
                  )}
                  <Text size="xs" c="dimmed">
                    预览透明度（不导出）
                  </Text>
                  <Slider
                    aria-label="预览透明度"
                    value={layer.opacity}
                    min={0.05}
                    max={1}
                    step={0.05}
                    onChange={(v) => editLayer({ opacity: v })}
                  />
                </Section>
              </Tabs.Panel>
              <Tabs.Panel value="item">
                <Section title="模板信息">
                  <TextInput
                    size="xs"
                    label="物品名称"
                    value={project.name}
                    onChange={(e) => edit({ name: e.currentTarget.value })}
                  />
                  <TextInput
                    size="xs"
                    label="identifier"
                    value={project.identifier}
                    onChange={(e) =>
                      edit({ identifier: e.currentTarget.value })
                    }
                  />
                  <Select
                    size="xs"
                    label="类型"
                    data={[
                      { value: "clothing", label: "服装 / 饰件" },
                      { value: "weapon", label: "枪械 / 武器" },
                      { value: "tool", label: "手持工具" },
                    ]}
                    value={project.kind}
                    onChange={(v) => edit({ kind: v as Project["kind"] })}
                  />
                  <Num
                    label="Item scale · 物品缩放"
                    value={project.itemScale}
                    min={0.001}
                    step={0.01}
                    onChange={(v) => edit({ itemScale: v })}
                  />
                  {isCombinedEquipment(project) ? (
                    <Alert color="teal" p="xs" fz="xs">
                      复合槽位：{project.slots}
                      。穿戴与持握同时生效；主图只在落地预览显示，人物使用各肢体衣片。
                    </Alert>
                  ) : project.kind === "clothing" ? (
                    <Select
                      label="装备槽位"
                      size="xs"
                      value={project.slots}
                      data={Array.from(
                        new Set([
                          project.slots,
                          "OuterClothes",
                          "InnerClothes",
                          "Head",
                          "Headset",
                          "Bag",
                          "Any,Head",
                        ]),
                      )}
                      onChange={(v) => edit({ slots: v || "OuterClothes" })}
                    />
                  ) : (
                    <Switch
                      size="xs"
                      label="双手持握"
                      checked={project.twoHanded}
                      onChange={(e) =>
                        edit({ twoHanded: e.currentTarget.checked })
                      }
                    />
                  )}
                </Section>
                {hasHolding(project) && (
                  <>
                    <Section title="握点（局部像素 / Y 向上）">
                      <Pair
                        labels={["handle1 X", "handle1 Y"]}
                        value={project.handle1}
                        onChange={(v) => edit({ handle1: v })}
                      />
                      {
                        <Pair
                          labels={["handle2 X", "handle2 Y"]}
                          value={project.handle2}
                          onChange={(v) => edit({ handle2: v })}
                        />
                      }
                      <Text size="10px" c="dimmed">
                        选择物品主贴图，在画布点选或拖动 H1 /
                        H2。导出握点由游戏乘以 Item scale。
                      </Text>
                      <Checkbox
                        label="启用枪口 / 工具作用点"
                        size="xs"
                        checked={project.hasBarrel}
                        onChange={(e) =>
                          edit({ hasBarrel: e.currentTarget.checked })
                        }
                      />
                      {project.hasBarrel && (
                        <Pair
                          labels={["barrelpos X", "barrelpos Y"]}
                          value={project.barrel}
                          onChange={(v) => edit({ barrel: v })}
                        />
                      )}
                      {project.kind === "tool" && (
                        <>
                          <Num
                            label="barrelrotation（工具）"
                            value={project.barrelRotation}
                            onChange={(v) => edit({ barrelRotation: v })}
                          />
                          <Alert color="blue" p="xs" fz="xs">
                            RepairTool 的 barrelpos 不乘 Item
                            scale；画布已按引擎规则换算。
                          </Alert>
                        </>
                      )}
                    </Section>
                    <Section
                      title="配件 / 弹匣挂点"
                      aside={
                        <ActionIcon
                          aria-label="增加配件挂点"
                          variant="subtle"
                          size="sm"
                          onClick={() =>
                            edit({
                              sockets: [
                                ...project.sockets,
                                {
                                  id: crypto.randomUUID(),
                                  name: "配件挂点",
                                  position: [0, 0],
                                  rotation: 0,
                                  depth: 0.56,
                                  items: "attachment_identifier",
                                  source: "containable",
                                  filterAttribute: "items",
                                  hidden: false,
                                },
                              ],
                            })
                          }
                        >
                          <IconPlus size={15} />
                        </ActionIcon>
                      }
                    >
                      {!project.sockets.length && (
                        <Text size="xs" c="dimmed">
                          支持九州 / DDA 的挂点及
                          SubContainer。挂接预览不导出配件自身的物品定义。
                        </Text>
                      )}
                      {project.sockets.map((s) => (
                        <div className="socket-card" key={s.id}>
                          <Group justify="space-between">
                            <Text size="xs" lineClamp={1}>
                              {s.name}
                            </Text>
                            <Group gap={3}>
                              <ActionIcon
                                aria-label={"标记 " + s.name}
                                size="sm"
                                variant={
                                  tool === "socket:" + s.id ? "light" : "subtle"
                                }
                                onClick={() => {
                                  const main = project.layers.find(
                                    (l) => l.role === "item",
                                  );
                                  if (main) setSelection(main.id);
                                  setTool("socket:" + s.id);
                                }}
                              >
                                <IconTarget size={14} />
                              </ActionIcon>
                              <ActionIcon
                                size="sm"
                                aria-label={"删除 " + s.name}
                                color="red"
                                variant="subtle"
                                onClick={() =>
                                  edit({
                                    sockets: project.sockets.filter(
                                      (o) => o.id !== s.id,
                                    ),
                                  })
                                }
                              >
                                <IconTrash size={13} />
                              </ActionIcon>
                            </Group>
                          </Group>
                          <Text
                            size="10px"
                            c="dimmed"
                            style={{ overflowWrap: "anywhere" }}
                          >
                            {s.sourcePath || s.source} ·{" "}
                            {s.source === "containable"
                              ? "显示像素，不乘 Item scale"
                              : "贴图像素，乘 Item scale"}
                          </Text>
                          <Pair
                            labels={["itempos X", "itempos Y"]}
                            value={s.position}
                            onChange={(v) =>
                              edit({
                                sockets: project.sockets.map((o) =>
                                  o.id === s.id ? { ...o, position: v } : o,
                                ),
                              })
                            }
                          />
                          <TextInput
                            size="xs"
                            label="配件 identifier / tag"
                            value={s.items}
                            onChange={(e) =>
                              edit({
                                sockets: project.sockets.map((o) =>
                                  o.id === s.id
                                    ? { ...o, items: e.currentTarget.value }
                                    : o,
                                ),
                              })
                            }
                          />
                          <Select
                            size="xs"
                            label="匹配属性"
                            data={[
                              { value: "items", label: "items / identifier" },
                              { value: "tags", label: "tags" },
                            ]}
                            value={s.filterAttribute || "items"}
                            onChange={(v) =>
                              editSocket(s.id, {
                                filterAttribute:
                                  v === "tags" ? "tags" : "items",
                              })
                            }
                          />
                          <div className="pair">
                            <Num
                              label="配件 rotation（°）"
                              value={s.rotation}
                              onChange={(rotation) =>
                                editSocket(s.id, { rotation })
                              }
                            />
                            <Num
                              label="容器深度（-1 自动）"
                              value={s.depth}
                              step={0.01}
                              min={-1}
                              max={1}
                              onChange={(depth) => editSocket(s.id, { depth })}
                            />
                          </div>
                          <Checkbox
                            size="xs"
                            label="hide · 游戏中隐藏"
                            checked={s.hidden ?? false}
                            onChange={(e) =>
                              editSocket(s.id, {
                                hidden: e.currentTarget.checked,
                              })
                            }
                          />
                          <Button
                            size="compact-xs"
                            variant="light"
                            onClick={() => {
                              setAttachmentSocket(s.id);
                              setResourceTab("items");
                              setSearch("");
                              setDrawer("resources");
                            }}
                          >
                            {s.preview
                              ? "更换挂接预览 · " + s.preview.identifier
                              : "选择配件做挂接预览"}
                          </Button>
                          {s.preview && (
                            <>
                              <Select
                                size="xs"
                                label="配件预览贴图"
                                value={s.preview.selected}
                                data={s.preview.layers.map((l) => ({
                                  value: l.id,
                                  label: `${roleLabels[l.role]} · ${l.name}`,
                                }))}
                                onChange={(v) =>
                                  editSocket(s.id, {
                                    preview: {
                                      ...s.preview!,
                                      selected: v || s.preview!.layers[0].id,
                                    },
                                  })
                                }
                              />
                              <Num
                                label="配件自身 Item scale"
                                value={s.preview.scale}
                                min={0.001}
                                step={0.01}
                                onChange={(scale) =>
                                  editSocket(s.id, {
                                    preview: { ...s.preview!, scale },
                                  })
                                }
                              />
                              <Button
                                size="compact-xs"
                                variant="subtle"
                                color="gray"
                                onClick={() =>
                                  editSocket(s.id, { preview: undefined })
                                }
                              >
                                移除预览配件
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                    </Section>
                    <Section title="实时持握标定">
                      <Text size="xs" c="dimmed">
                        在“持握”页调整静态 /
                        瞄准位置和角度；人物预览同步求解手臂。
                      </Text>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => setInspectorTab("holding")}
                      >
                        打开持握标定
                      </Button>
                    </Section>
                  </>
                )}
                <Section title="导入记录">
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {project.source?.file || "新建模板"}
                  </Text>
                  {project.warnings.map((w, i) => (
                    <Text key={i} size="xs" c="orange">
                      {w}
                    </Text>
                  ))}
                </Section>
              </Tabs.Panel>
              {hasHolding(project) && (
                <Tabs.Panel value="holding">
                  <HoldingPanel
                    project={project}
                    preview={holdPreview}
                    onProject={edit}
                  />
                </Tabs.Panel>
              )}
            </ScrollArea>
          </Tabs>
        </aside>
      </main>
      <footer className="statusbar">
        <Group gap={7}>
          <span className="status-dot" />
          <span>
            本地运行 ·{" "}
            {project.source?.writable
              ? "LocalMods 坐标可回写"
              : "来源只读 / 模板"}
          </span>
        </Group>
        <span>
          拖动 / 框选 · 滚轮缩放 · C 框选 · O 原点 · V 平移 · Ctrl+Z 撤销
        </span>
        <span>Phase 02 · v0.4 / MCP</span>
      </footer>

      <Drawer
        opened={drawer === "resources"}
        onClose={() => {
          setDrawer(null);
          setAttachmentSocket(null);
        }}
        title={
          attachmentSocket ? "选择挂接预览配件 · 保留当前武器" : "本地资源库"
        }
        size="600px"
        position="left"
      >
        <Stack>
          <Select
            label="资源包"
            data={roots.map((r) => ({ value: r.id, label: r.name }))}
            value={rootId}
            searchable
            onChange={(v) => {
              setRootId(v || "");
              setSearch("");
            }}
          />
          <Group>
            <TextInput
              style={{ flex: 1 }}
              placeholder="搜索物品名、identifier 或贴图路径"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <ActionIcon
              size="lg"
              variant="default"
              aria-label="刷新资源库"
              onClick={async () => {
                setBusy(true);
                try {
                  setLibrary(
                    await api<Library>(
                      "/api/library?root=" +
                        encodeURIComponent(rootId) +
                        "&refresh=1",
                    ),
                  );
                } catch (e) {
                  notifyError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <IconRefresh size={17} />
            </ActionIcon>
          </Group>
          <Badge
            color={
              roots.find((r) => r.id === rootId)?.writable ? "teal" : "orange"
            }
            variant="light"
          >
            {roots.find((r) => r.id === rootId)?.writable
              ? "本地开发 Mod · 坐标可回写"
              : "工坊 / Installed / 未确认来源 · 只读"}
          </Badge>
          {attachmentSocket && (
            <Checkbox
              label="仅显示符合当前挂点规则的配件"
              checked={matchingAttachments}
              onChange={(e) => setMatchingAttachments(e.currentTarget.checked)}
            />
          )}
          <Tabs value={resourceTab} onChange={setResourceTab}>
            <Tabs.List>
              <Tabs.Tab value="items">已有物品 {library.items.length}</Tabs.Tab>
              <Tabs.Tab value="textures">
                贴图 {library.textures.length}
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="items" pt="sm">
              {busy ? (
                <Loader size="sm" />
              ) : (
                library.items
                  .filter(
                    (i) =>
                      !attachmentSocket ||
                      !matchingAttachments ||
                      attachmentMatches(
                        project.sockets.find((s) => s.id === attachmentSocket)!,
                        i,
                      ),
                  )
                  .filter((i) =>
                    `${i.name} ${i.id} ${i.relative}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .slice(0, 250)
                  .map((i, n) => (
                    <button
                      key={i.file + i.id + n}
                      className="resource-item"
                      onClick={() => importItem(i)}
                    >
                      <IconFileCode size={20} />
                      <div>
                        <Text size="sm" fw={550}>
                          {i.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {i.id}
                        </Text>
                        <Text size="10px" c="dimmed" lineClamp={1}>
                          {i.relative}
                        </Text>
                      </div>
                      <Badge color="gray" size="xs">
                        {i.kind}
                      </Badge>
                      <IconChevronRight size={15} />
                    </button>
                  ))
              )}
            </Tabs.Panel>
            <Tabs.Panel value="textures" pt="sm">
              <div className="texture-grid">
                {library.textures
                  .filter((t) =>
                    (t.relative || t.name)
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .slice(0, 160)
                  .map((t) => (
                    <button
                      key={t.uri}
                      className="texture-tile"
                      onClick={() => chooseTexture(t)}
                    >
                      <div className="thumbnail checker">
                        <img src={t.uri} loading="lazy" alt={t.name} />
                      </div>
                      <Text size="xs" lineClamp={1}>
                        {t.name}
                      </Text>
                      <Text size="10px" c="dimmed" lineClamp={1}>
                        {t.relative}
                      </Text>
                    </button>
                  ))}
              </div>
            </Tabs.Panel>
          </Tabs>
          {library.errors.length > 0 && (
            <Text size="xs" c="orange">
              {library.errors.length} 个 XML 无法解析，其余资源仍可使用。
            </Text>
          )}
          <Text size="xs" c="dimmed">
            列表按搜索结果显示前 250 个物品 / 160
            张贴图。读取本地资源，不上传图片。
          </Text>
        </Stack>
      </Drawer>
      <Drawer
        opened={drawer === "export"}
        onClose={() => setDrawer(null)}
        title="导出 · 标定物品模板"
        position="right"
        size="720px"
      >
        <Stack>
          <Alert
            color={errors.length ? "red" : "teal"}
            title={errors.length ? "请先完善标定" : "仅导出外观与坐标字段"}
          >
            {errors.length
              ? errors.join("\n")
              : "生成单个 Item 的 XML 模板。伤害、弹药、配方、StatusEffect 和 Lua 逻辑不包含在内。Body 为框选大小的占位碰撞体，需按用途调整。"}
          </Alert>
          <Group>
            <Button
              leftSection={<IconCopy size={16} />}
              variant="default"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(xml);
                  notifications.show({ color: "teal", message: "XML 已复制" });
                } catch (e) {
                  notifyError(e);
                }
              }}
            >
              复制 XML
            </Button>
            <Button
              leftSection={<IconDownload size={16} />}
              disabled={errors.length > 0}
              onClick={() =>
                download(project.identifier + ".xml", xml, "application/xml")
              }
            >
              下载物品模板
            </Button>
          </Group>
          <Textarea
            aria-label="导出 XML"
            value={xml}
            readOnly
            autosize
            minRows={20}
            maxRows={32}
            styles={{
              input: {
                fontFamily: "Consolas, monospace",
                fontSize: 12,
                lineHeight: 1.7,
              },
            }}
          />
          <Text size="xs" c="dimmed">
            PNG 不随 XML 打包。上传的图片保存在项目 JSON 中；本地 Mod
            贴图保持外部引用。完整标定可用“保存项目”继续编辑。
          </Text>
        </Stack>
      </Drawer>
      <Drawer
        opened={drawer === "help"}
        onClose={() => setDrawer(null)}
        title="贴图标定工作流"
        position="right"
        size="540px"
      >
        <Stack gap="lg">
          <Text>
            1. 在资源库导入已有物品，或新建服装 / 武器 / 工具。也可以上传一张
            PNG 开始。
          </Text>
          <Text>
            2. 选择图层，使用“框选”在整张图上拖出
            SourceRect；八个控制点可调整边界，按住 Shift
            可从现有框内重新框选。“聚焦框选”方便精调单个物体。
          </Text>
          <Text>
            3. 点选“原点 / 握点 1 / 握点 2 /
            枪口”，在贴图上标记；标记本身也可以拖动。导出坐标以物品原点为基准，Y
            向上。
          </Text>
          <Text>
            4. 服装选择 limb 后，直接在人物上拖动选中衣片，调整 scale /
            rotation。origin 可超出 0–1。需要拖动时关闭 inheritorigin。
          </Text>
          <Text>
            5. 用骨架、朝向、发型和遮挡开关检查效果，再导出单物品模板。保存项目
            JSON 可保留全部图层。
          </Text>
          <Divider />
          <Text size="sm" c="dimmed">
            人物贴图、关节与缩放来自本地
            EA-HI（2809175631）。静态姿态按关节重建，不执行游戏的重力、碰撞、游泳、动画
            IK、动态配件与着色器。
          </Text>
          <Text size="sm" c="dimmed">
            首阶段支持 SourceRect、Origin、握点、枪口、服装绑定 / 缩放 / 旋转 /
            深度 / 遮挡、DecorativeSprite 静态层、InventoryIcon、ContainedSprite
            和容器挂点。第二阶段支持 holdpos / aimpos、持握角与手臂静态
            IK、近战准备与挥击进度，以及配件装配联调。人物页可拖动改原点 /
            位置，Alt + 滚轮改实际缩放；普通滚轮只改变预览倍率。
          </Text>
          <Text size="sm" c="dimmed">
            保存项目下载工程；导出 XML 生成标定模板；“保存回
            Mod”才会在查看差异并确认后，备份并修改本地 LocalMods
            的坐标属性。工坊 / Installed 只读；不会改写脚本或伤害逻辑。
          </Text>
        </Stack>
      </Drawer>
      <Modal
        opened={settings}
        onClose={() => setSettings(false)}
        title="连接本地 Mod 文件夹"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            输入包含 filelist.xml 的 Mod 目录，或存放贴图的开发目录。
          </Text>
          <TextInput
            label="文件夹路径"
            placeholder="D:\SteamLibrary\steamapps\workshop\content\602960\…"
            value={folder}
            onChange={(e) => setFolder(e.currentTarget.value)}
          />
          <Button loading={busy} disabled={!folder.trim()} onClick={addRoot}>
            连接目录
          </Button>
          <Text size="xs" c="dimmed">
            已自动检测 Empire Arms、EA-HI、九州和 Deep Diving Armory。新下载的
            Mod 可在这里连接；自定义目录重启后需重新连接。
          </Text>
        </Stack>
      </Modal>
      <Modal
        opened={layerModal}
        onClose={() => setLayerModal(false)}
        title="添加标定图层"
      >
        <Stack>
          <Select
            label="图层类型"
            data={Object.entries(roleLabels).map(([value, label]) => ({
              value,
              label,
            }))}
            value={newRole}
            onChange={(v) => setNewRole(v as Role)}
          />
          <Button
            onClick={() => {
              const l = newLayer(newRole, layer.texture);
              edit({ layers: [...project.layers, l] });
              setSelection(l.id);
              setLayerModal(false);
              setTool("crop");
            }}
          >
            添加图层
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={newModal}
        onClose={() => setNewModal(false)}
        title="新建标定项目"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            当前项目可用撤销恢复；需要长期保留请先保存项目。
          </Text>
          <SegmentedControl
            value={newKind}
            onChange={(v) => setNewKind(v as Project["kind"])}
            data={[
              { value: "clothing", label: "服装" },
              { value: "weapon", label: "武器" },
              { value: "tool", label: "工具" },
            ]}
          />
          <Button
            onClick={() => {
              loadProject(newProject(newKind));
              setNewModal(false);
            }}
          >
            创建标定
          </Button>
        </Stack>
      </Modal>
    </div>
  );
}
