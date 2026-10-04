import { useEffect, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KImage,
  Rect as KRect,
  Circle,
  Line,
  Text as KText,
  Group,
  Transformer,
} from "react-konva";
import {
  ActionIcon,
  Group as UIGroup,
  Text,
  Badge,
  Tooltip,
  SegmentedControl,
  Button,
  Checkbox,
  NumberInput,
  Slider,
  Select,
} from "@mantine/core";
import { IconFocusCentered, IconMinus, IconPlus } from "@tabler/icons-react";
import Konva from "konva";
import useImage from "use-image";
import type {
  Project,
  SpriteLayer,
  Vec,
  Rect,
  Reference,
  Limb,
  Socket,
} from "../model";
import {
  buildRig,
  markerToPixel,
  originAfterDrag,
  pixelToMarker,
  pixelToSocket,
  socketToPixel,
  wearableTransform,
  rotate,
  add,
  mul,
  sub,
} from "../geometry";
import { round } from "../model";
import {
  buildHolding,
  formatPose,
  itemOriginAfterDrag,
  itemPointToWorld,
  markerFromWorld,
  markerInItem,
  poseBool,
  positionFromWorld,
  worldToItemPoint,
  type HoldPreview,
} from "../holding";
import { MeleeControls } from "./MeleeControls";
import { attachmentPosition, attachmentRotation } from "../attachments";
import type { PreviewHandle } from "./McpPanel";
import { equipmentPreview, hasHolding } from "../../shared/equipment.mjs";

export function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 500, height: 480 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new ResizeObserver(([e]) =>
      setSize({ width: e.contentRect.width, height: e.contentRect.height }),
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);
  return { ref, ...size };
}
const colors: Record<string, string> = {
  origin: "#faaf5c",
  h1: "#54d9b2",
  h2: "#b8a0ff",
  barrel: "#ff6d87",
};
function Marker({
  at,
  color,
  label,
  zoom,
  move,
  start,
  end,
  facing = 1,
}: {
  at: Vec;
  color: string;
  label: string;
  zoom: number;
  move?: (p: Vec) => void;
  start?: () => void;
  end?: () => void;
  facing?: number;
}) {
  return (
    <Group
      name="mcp-screen-marker"
      x={at[0]}
      y={at[1]}
      draggable={!!move}
      onMouseDown={(e) => (e.cancelBubble = true)}
      onDragStart={start}
      onDragMove={(e) => {
        e.cancelBubble = true;
        move?.([e.target.x(), e.target.y()]);
      }}
      onDragEnd={(e) => {
        e.cancelBubble = true;
        end?.();
      }}
    >
      <Circle
        radius={6 / zoom}
        fill="#111822"
        stroke={color}
        strokeWidth={2 / zoom}
      />
      <Line
        points={[-10 / zoom, 0, 10 / zoom, 0]}
        stroke={color}
        strokeWidth={1 / zoom}
        listening={false}
      />
      <Line
        points={[0, -10 / zoom, 0, 10 / zoom]}
        stroke={color}
        strokeWidth={1 / zoom}
        listening={false}
      />
      <KText
        text={label}
        x={10 / zoom}
        y={-18 / zoom}
        fill={color}
        fontSize={11 / zoom}
        scaleX={facing}
        listening={false}
      />
    </Group>
  );
}
export function TextureViewport({
  layer,
  project,
  tool,
  onLayer,
  onProject,
  onDimensions,
  onGestureStart,
  onGestureEnd,
}: {
  layer: SpriteLayer;
  project: Project;
  tool: string;
  onLayer: (p: Partial<SpriteLayer>) => void;
  onProject: (p: Partial<Project>) => void;
  onDimensions: (size: Vec) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const { ref, width, height } = useSize();
  const [img, status] = useImage(layer.texture.uri);
  const [camera, setCamera] = useState({ x: 40, y: 40, zoom: 1 });
  const [drawing, setDrawing] = useState<Vec | null>(null);
  const stageRef = useRef<Konva.Stage>(null),
    rectRef = useRef<Konva.Rect>(null),
    trRef = useRef<Konva.Transformer>(null);
  const [cursor, setCursor] = useState<Vec>([0, 0]);
  const fit = () => {
    if (!img) return;
    const zoom = Math.max(
      0.05,
      Math.min((width - 80) / img.width, (height - 80) / img.height, 3),
    );
    setCamera({
      x: (width - img.width * zoom) / 2,
      y: (height - img.height * zoom) / 2,
      zoom,
    });
  };
  const fitSelection = () => {
    const zoom = Math.max(
      0.03,
      Math.min(20, (width - 90) / layer.rect[2], (height - 90) / layer.rect[3]),
    );
    setCamera({
      x: width / 2 - (layer.rect[0] + layer.rect[2] / 2) * zoom,
      y: height / 2 - (layer.rect[1] + layer.rect[3] / 2) * zoom,
      zoom,
    });
  };
  useEffect(() => {
    fit();
    if (img) onDimensions([img.width, img.height]);
  }, [img, width, height]);
  useEffect(() => {
    if (tool === "crop" && rectRef.current && trRef.current) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [tool, layer.id]);
  const toPoint = (): Vec => {
    const stage = stageRef.current!;
    const p = stage.getPointerPosition()!;
    return [(p.x - camera.x) / camera.zoom, (p.y - camera.y) / camera.zoom];
  };
  const clamp = (p: Vec): Vec =>
    img
      ? [
          Math.max(0, Math.min(img.width, Math.round(p[0]))),
          Math.max(0, Math.min(img.height, Math.round(p[1]))),
        ]
      : p;
  const cropFrom = (p: Vec, q: Vec): Rect => [
    Math.min(p[0], q[0]),
    Math.min(p[1], q[1]),
    Math.max(1, Math.abs(q[0] - p[0])),
    Math.max(1, Math.abs(q[1] - p[1])),
  ];
  const place = (mode: string, p: Vec) => {
    if (mode === "origin")
      onLayer({
        origin: [
          (p[0] - layer.rect[0]) / layer.rect[2],
          (p[1] - layer.rect[1]) / layer.rect[3],
        ],
        inheritOrigin: false,
      });
    else if (["h1", "h2", "barrel"].includes(mode))
      onProject({
        [mode === "h1" ? "handle1" : mode === "h2" ? "handle2" : "barrel"]:
          pixelToMarker(p, layer, project, mode === "barrel"),
      });
    else if (mode.startsWith("socket:"))
      onProject({
        sockets: project.sockets.map((s) =>
          s.id === mode.slice(7)
            ? { ...s, position: pixelToSocket(p, s, layer, project) }
            : s,
        ),
      });
  };
  const canMark = hasHolding(project) && layer.role === "item";
  const z = camera.zoom;
  return (
    <div className="viewport-wrap">
      <div className="canvas-info">
        <span>ATLAS / 贴图空间</span>
        <span>{img ? `${img.width} × ${img.height} px` : "选择贴图开始"}</span>
      </div>
      <div
        ref={ref}
        className={"canvas checker tool-" + tool}
        data-testid="atlas-canvas"
      >
        {status === "failed" && (
          <div className="canvas-empty">
            贴图读取失败
            <br />
            <small>检查本地目录与 texture 路径</small>
          </div>
        )}
        {!layer.texture.uri && (
          <div className="canvas-empty">
            从资源库选择一张贴图
            <br />
            <small>框选区域 → 标记原点 / 握点 → 对照人物</small>
          </div>
        )}
        <Stage
          width={width}
          height={height}
          ref={stageRef}
          x={camera.x}
          y={camera.y}
          scaleX={z}
          scaleY={z}
          draggable={tool === "pan"}
          onDragEnd={(e) => {
            if (e.target === stageRef.current)
              setCamera((c) => ({ ...c, x: e.target.x(), y: e.target.y() }));
          }}
          onWheel={(e) => {
            e.evt.preventDefault();
            const p = e.target.getStage()!.getPointerPosition()!;
            const zoom = Math.max(
              0.03,
              Math.min(30, z * (e.evt.deltaY > 0 ? 0.9 : 1.1)),
            );
            setCamera({
              x: p.x - ((p.x - camera.x) / z) * zoom,
              y: p.y - ((p.y - camera.y) / z) * zoom,
              zoom,
            });
          }}
          onMouseDown={(e) => {
            if (e.evt.button !== 0 || tool === "pan" || !img) return;
            const p = toPoint();
            if (
              tool === "crop" &&
              e.target !== rectRef.current &&
              e.target.getParent()?.className !== "Transformer"
            ) {
              setDrawing(clamp(p));
            } else if (e.target === e.target.getStage()) place(tool, p);
          }}
          onMouseMove={() => {
            const p = toPoint();
            setCursor(p);
            if (drawing)
              onLayer({
                rect: cropFrom(drawing, clamp(p)),
                inheritSourceRect: false,
              });
          }}
          onMouseUp={() => setDrawing(null)}
        >
          <Layer>
            {img && <KImage image={img} listening={false} />}
            <KRect
              ref={rectRef}
              x={layer.rect[0]}
              y={layer.rect[1]}
              width={layer.rect[2]}
              height={layer.rect[3]}
              stroke="#55d6c2"
              strokeWidth={1.5 / z}
              fill="rgba(70,205,181,0.04)"
              draggable={tool === "crop" && !drawing}
              listening={tool === "crop"}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                if (e.evt.shiftKey && tool === "crop")
                  setDrawing(clamp(toPoint()));
              }}
              onDragEnd={(e) => {
                e.cancelBubble = true;
                const n = e.target;
                onLayer({
                  rect: [
                    Math.max(
                      0,
                      Math.min(
                        (img?.width || 1) - layer.rect[2],
                        Math.round(n.x()),
                      ),
                    ),
                    Math.max(
                      0,
                      Math.min(
                        (img?.height || 1) - layer.rect[3],
                        Math.round(n.y()),
                      ),
                    ),
                    layer.rect[2],
                    layer.rect[3],
                  ],
                  inheritSourceRect: false,
                });
              }}
              onTransformEnd={() => {
                const n = rectRef.current!;
                const a = clamp([n.x(), n.y()]),
                  b = clamp([
                    n.x() + n.width() * n.scaleX(),
                    n.y() + n.height() * n.scaleY(),
                  ]);
                n.scaleX(1);
                n.scaleY(1);
                onLayer({ rect: cropFrom(a, b), inheritSourceRect: false });
              }}
            />
            {tool === "crop" && (
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                keepRatio={false}
                anchorSize={7}
                borderStroke="#55d6c2"
                anchorStroke="#55d6c2"
                anchorFill="#17262a"
                boundBoxFunc={(old, box) =>
                  box.width < 1 || box.height < 1 ? old : box
                }
              />
            )}
            {img && (
              <Marker
                at={[
                  layer.rect[0] + layer.rect[2] * layer.origin[0],
                  layer.rect[1] + layer.rect[3] * layer.origin[1],
                ]}
                color={colors.origin}
                label="O · 原点"
                zoom={z}
                move={(p) => place("origin", p)}
                start={onGestureStart}
                end={onGestureEnd}
              />
            )}
            {canMark && (
              <>
                <Marker
                  at={markerToPixel(project.handle1, layer, project)}
                  color={colors.h1}
                  label="H1"
                  zoom={z}
                  move={(p) => place("h1", p)}
                  start={onGestureStart}
                  end={onGestureEnd}
                />
                {
                  <Marker
                    at={markerToPixel(project.handle2, layer, project)}
                    color={colors.h2}
                    label="H2"
                    zoom={z}
                    move={(p) => place("h2", p)}
                    start={onGestureStart}
                    end={onGestureEnd}
                  />
                }
                {project.hasBarrel && (
                  <Marker
                    at={markerToPixel(project.barrel, layer, project, true)}
                    color={colors.barrel}
                    label={project.kind === "tool" ? "工具作用点" : "枪口"}
                    zoom={z}
                    move={(p) => place("barrel", p)}
                    start={onGestureStart}
                    end={onGestureEnd}
                  />
                )}
                {project.sockets
                  .filter((s) => tool === "socket:" + s.id)
                  .map((s) => (
                    <Marker
                      key={s.id}
                      at={socketToPixel(s, layer, project)}
                      color="#6ea9ff"
                      label={s.name.split(",")[0].slice(0, 24)}
                      zoom={z}
                      move={(p) => place("socket:" + s.id, p)}
                      start={onGestureStart}
                      end={onGestureEnd}
                    />
                  ))}
              </>
            )}
          </Layer>
        </Stage>
      </div>
      <div className="viewport-footer">
        <Text size="xs" c="dimmed">
          X {cursor[0].toFixed(0)} · Y {cursor[1].toFixed(0)}
        </Text>
        <UIGroup gap={6}>
          <Text size="xs">{Math.round(z * 100)}%</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={!img}
            onClick={fitSelection}
          >
            聚焦框选
          </Button>
          <Tooltip label="适应贴图">
            <ActionIcon variant="subtle" aria-label="适应贴图" onClick={fit}>
              <IconFocusCentered size={16} />
            </ActionIcon>
          </Tooltip>
        </UIGroup>
      </div>
    </div>
  );
}
function CropImage({
  layer,
  scale,
  origin,
  rect,
  ...props
}: {
  layer: SpriteLayer | Limb;
  scale: number;
  origin?: Vec;
  rect?: Rect;
  x?: number;
  y?: number;
  rotation?: number;
  opacity?: number;
  listening?: boolean;
}) {
  const [img] = useImage(layer.texture.uri);
  const r = rect || layer.rect;
  if (!img) return null;
  return (
    <KImage
      image={img}
      crop={{ x: r[0], y: r[1], width: r[2], height: r[3] }}
      width={r[2]}
      height={r[3]}
      offsetX={origin?.[0] ?? r[2] * layer.origin[0]}
      offsetY={origin?.[1] ?? r[3] * layer.origin[1]}
      scaleX={scale}
      scaleY={scale}
      listening={false}
      {...props}
    />
  );
}
export function CharacterViewport({
  captureHandle,
  remotePreviewEpoch,
  reference: refData,
  project,
  selected,
  onSelectLayer,
  onLayer,
  skeleton,
  facing,
  pose,
  head,
  frontHair,
  backHair,
  ghost,
  preview,
  onPreview,
  onProject,
  onItemLayer,
  onGestureStart,
  onGestureEnd,
  selectedSocket,
  onSocket,
}: {
  captureHandle?: React.MutableRefObject<PreviewHandle | null>;
  remotePreviewEpoch?: number;
  reference: Reference | null;
  project: Project;
  selected: SpriteLayer;
  onSelectLayer: (id: string) => void;
  onLayer: (p: Partial<SpriteLayer>) => void;
  skeleton: boolean;
  facing: number;
  pose: "neutral" | "relaxed";
  head: number;
  frontHair: string;
  backHair: string;
  ghost: boolean;
  preview: HoldPreview;
  onPreview: (p: Partial<HoldPreview>) => void;
  onProject: (p: Partial<Project>) => void;
  onItemLayer: (id: string, p: Partial<SpriteLayer>) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  selectedSocket: string | null;
  onSocket: (id: string, p: Partial<Socket>) => void;
}) {
  const { ref, width, height } = useSize();
  const [zoom, setZoom] = useState(2.5);
  const [center, setCenter] = useState<Vec>([0, 24]);
  const [mode, setMode] = useState("character");
  const [editMode, setEditMode] = useState("position");
  const [wheelEditsScale, setWheelEditsScale] = useState(false);
  const socket = project.sockets.find((s) => s.id === selectedSocket);
  const socketLayer = socket?.preview?.layers.find(
    (l) => l.id === socket.preview?.selected,
  );
  const melee = project.holdableType === "MeleeWeapon";
  const stageRef = useRef<Konva.Stage>(null);
  const gesture = useRef<{ start: Vec; update: (delta: Vec) => void } | null>(
    null,
  );
  const markerDrag = useRef<{
    at: Vec;
    rotation: number;
    project: Project;
  } | null>(null);
  const itemOnly = mode === "item" && hasHolding(project);
  const equipment = equipmentPreview(project, itemOnly);
  useEffect(() => {
    if (equipment.combined) setEditMode("position");
  }, [equipment.combined]);
  const pan = useRef<{ start: Vec; center: Vec } | null>(null);
  const holding =
    refData && equipment.holding
      ? buildHolding(refData, project, preview, pose)
      : null;
  const rig = holding?.rig ?? (refData ? buildRig(refData, pose) : []);
  const itemAt: Vec = holding?.at ?? [0, 0];
  const itemRotation = holding?.rotation ?? 0;
  const poses = new Map(rig.map((p) => [p.limb.limb, p]));
  const clothing = project.layers.filter(
    (l) => equipment.wearables && l.role === "wearable" && l.visible,
  );
  const worldX = width / 2 - center[0] * zoom * facing,
    worldY = (height - 24) / 2 - center[1] * zoom;
  useEffect(() => {
    if (!captureHandle) return;
    captureHandle.current = {
      capture: async (fit = true) => {
        if (!refData)
          throw new Error("REFERENCE_UNAVAILABLE: 人物贴图尚未加载。");
        const stage = stageRef.current;
        if (!stage || width < 2 || height < 2)
          throw new Error("PREVIEW_UNAVAILABLE: 预览不可见。");
        const pending = stage.find("Image").some((node) => {
          const image = (node as Konva.Image).image() as
            | HTMLImageElement
            | undefined;
          return !image || !image.complete || !image.naturalWidth;
        });
        if (pending)
          throw new Error(
            "ASSET_NOT_READY: 有贴图未加载，请稍后重试或检查资源路径。",
          );
        if (fit) {
          const scene = stage.findOne(".mcp-scene") as Konva.Group | undefined;
          if (!scene) throw new Error("PREVIEW_UNAVAILABLE: 预览场景未就绪。");
          // Clone only the world-space scene: never move the user's view or edit state.
          const clone = scene.clone({
            x: 0,
            y: 0,
            scaleX: facing,
            scaleY: 1,
          }) as Konva.Group;
          try {
            const bounds = clone.getClientRect();
            const outputWidth = 1000,
              outputHeight = 800,
              pad = 36;
            const scale = Math.min(
              (outputWidth - pad * 2) / Math.max(1, bounds.width),
              (outputHeight - pad * 2) / Math.max(1, bounds.height),
            );
            // UI annotations have constant screen sizes (stored divided by zoom).
            // Re-fit geometry without magnifying grips, skeleton dots and labels.
            const overlayRatio = zoom / scale;
            clone
              .find(".mcp-screen-marker")
              .forEach((n) => n.scale({ x: overlayRatio, y: overlayRatio }));
            clone
              .find((n: Konva.Node) => n.getType() === "Shape")
              .forEach((n) => {
                if (n.findAncestor(".mcp-screen-marker")) return;
                const shape = n as Konva.Shape;
                shape.strokeWidth(shape.strokeWidth() * overlayRatio);
                if (shape.dash()?.length)
                  shape.dash(shape.dash().map((v) => v * overlayRatio));
                if (n instanceof Konva.Circle)
                  n.radius(n.radius() * overlayRatio);
                if (n instanceof Konva.Text)
                  n.fontSize(n.fontSize() * overlayRatio);
              });
            clone.scale({ x: facing * scale, y: scale });
            clone.position({
              x: (outputWidth - bounds.width * scale) / 2 - bounds.x * scale,
              y: (outputHeight - bounds.height * scale) / 2 - bounds.y * scale,
            });
            const canvas = clone.toCanvas({
              x: 0,
              y: 0,
              width: outputWidth,
              height: outputHeight,
              pixelRatio: 1,
            });
            const context = canvas.getContext("2d")!;
            context.globalCompositeOperation = "destination-over";
            context.fillStyle = "#101821";
            context.fillRect(0, 0, outputWidth, outputHeight);
            return {
              image: canvas.toDataURL("image/png").split(",")[1],
              width: outputWidth,
              height: outputHeight,
              view: {
                fit: true,
                mode,
                equipment,
                facing,
                pose,
                skeleton,
                preview,
                bounds,
                scale,
                head,
                frontHair,
                backHair,
                ghost,
              },
            };
          } finally {
            clone.destroy();
          }
        }
        stage.draw();
        const pixelRatio = Math.min(1, 1600 / Math.max(width, height));
        const data = stage.toDataURL({ pixelRatio });
        if (data.length > 8 * 1024 * 1024)
          throw new Error("IMAGE_TOO_LARGE: 请缩小预览画布后重试。");
        return {
          image: data.split(",")[1],
          width: Math.round(width * pixelRatio),
          height: Math.round(height * pixelRatio),
          view: {
            mode,
            equipment,
            zoom,
            center,
            facing,
            pose,
            skeleton,
            preview,
            head,
            frontHair,
            backHair,
            ghost,
          },
        };
      },
    };
    return () => {
      captureHandle.current = null;
    };
  });
  const pointer = (): Vec => {
    const p = stageRef.current?.getPointerPosition();
    return p
      ? [(p.x - worldX) / (zoom * facing), (p.y - worldY) / zoom]
      : [0, 0];
  };
  const beginGesture = (
    e: Konva.KonvaEventObject<MouseEvent>,
    update: (delta: Vec) => void,
  ) => {
    if (e.evt.button !== 0) return;
    e.cancelBubble = true;
    onGestureStart();
    gesture.current = { start: pointer(), update };
  };
  useEffect(() => {
    const finish = () => {
      if (gesture.current) onGestureEnd();
      gesture.current = null;
      pan.current = null;
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, []);
  const extent: Vec[] = [];
  const include = (
    rect: Rect,
    origin: Vec,
    scale: number,
    at: Vec,
    rotation: number,
  ) => {
    for (const x of [0, rect[2]])
      for (const y of [0, rect[3]])
        extent.push(
          add(
            at,
            rotate(
              [(x - origin[0]) * scale, (y - origin[1]) * scale],
              rotation,
            ),
          ),
        );
  };
  type Draw = { key: string; depth: number; node: React.ReactNode };
  const draws: Draw[] = [];
  if (refData)
    for (const p of rig) {
      const hiding = clothing.some((l) => l.limb === p.limb.limb && l.hideLimb);
      const limb = { ...p.limb, rect: [...p.limb.rect] as Rect };
      if (limb.limb === "Head" && refData.heads[head]) {
        limb.rect[0] += limb.rect[2] * refData.heads[head].index[0];
        limb.rect[1] += limb.rect[3] * refData.heads[head].index[1];
      }
      if (!hiding || ghost)
        draws.push({
          key: "limb-" + limb.id,
          depth: limb.depth,
          node: (
            <CropImage
              layer={limb}
              x={p.position[0]}
              y={p.position[1]}
              rotation={p.rotation}
              scale={refData.limbScale * limb.limbScale * refData.textureScale}
              opacity={hiding ? 0.2 : 1}
            />
          ),
        });
      if (!itemOnly && (!hiding || ghost))
        include(
          limb.rect,
          [limb.rect[2] * limb.origin[0], limb.rect[3] * limb.origin[1]],
          refData.limbScale * limb.limbScale * refData.textureScale,
          p.position,
          p.rotation,
        );
      if (limb.limb === "Head" && !hiding)
        for (const [id, dep] of [
          [backHair, 0.17],
          [frontHair, 0.049],
        ] as const) {
          const hair = refData.hair.find((h) => h.id === id);
          if (!itemOnly && hair)
            include(
              hair.rect,
              [hair.rect[2] * hair.origin[0], hair.rect[3] * hair.origin[1]],
              refData.limbScale *
                limb.limbScale *
                refData.textureScale *
                hair.scale,
              p.position,
              p.rotation,
            );
          if (hair)
            draws.push({
              key: id,
              depth: dep,
              node: (
                <CropImage
                  layer={hair}
                  x={p.position[0]}
                  y={p.position[1]}
                  rotation={p.rotation}
                  scale={
                    refData.limbScale *
                    limb.limbScale *
                    refData.textureScale *
                    hair.scale
                  }
                />
              ),
            });
        }
    }
  if (refData)
    for (const l of clothing) {
      const p = poses.get(l.limb);
      if (!p) continue;
      const other = clothing.find(
        (o) => o.limb === l.limb && o.hideOtherWearables,
      );
      if (other && other.id !== l.id && l.canBeHidden) continue;
      const activeLimb = { ...p.limb, rect: [...p.limb.rect] as Rect };
      if (activeLimb.limb === "Head" && refData.heads[head]) {
        activeLimb.rect[0] += activeLimb.rect[2] * refData.heads[head].index[0];
        activeLimb.rect[1] += activeLimb.rect[3] * refData.heads[head].index[1];
      }
      const t = wearableTransform(l, activeLimb, refData);
      if (!itemOnly)
        include(
          t.rect,
          t.originPixels,
          t.scale,
          p.position,
          p.rotation - l.rotation,
        );
      const chosen = l.id === selected.id;
      const depth = l.inheritLimbDepth
        ? (poses.get(l.depthLimb)?.limb.depth ?? p.limb.depth) -
          0.00001 * (project.slots.includes("OuterClothes") ? 2 : 1)
        : l.depth;
      draws.push({
        key: l.id,
        depth,
        node: (
          <Group
            x={p.position[0]}
            y={p.position[1]}
            rotation={p.rotation - l.rotation}
            onMouseDown={(e) => {
              if (chosen && !l.inheritOrigin)
                beginGesture(e, (delta) =>
                  onLayer({
                    origin: originAfterDrag(
                      l,
                      activeLimb,
                      refData,
                      delta,
                      p.rotation,
                    ),
                  }),
                );
            }}
          >
            <CropImage
              layer={l}
              scale={t.scale}
              rect={t.rect}
              origin={t.originPixels}
              opacity={l.opacity}
            />
            {chosen && (
              <KRect
                x={-t.originPixels[0] * t.scale}
                y={-t.originPixels[1] * t.scale}
                width={t.rect[2] * t.scale}
                height={t.rect[3] * t.scale}
                stroke="#54d9b2"
                strokeWidth={1 / zoom}
                dash={[4 / zoom, 4 / zoom]}
                fill="rgba(70,205,181,0.015)"
              />
            )}
          </Group>
        ),
      });
    }
  const item = project.layers.find((l) => l.role === "item" && l.visible);
  const itemDraws: Draw[] = project.layers
    .filter((l) => ["item", "decorative"].includes(l.role) && l.visible)
    .map((l) => ({
      key: l.id,
      depth: l.depth,
      node: (
        <CropImage
          layer={l}
          scale={project.itemScale * (l.role === "decorative" ? l.scale : 1)}
          x={l.role === "decorative" ? l.offset[0] * project.itemScale : 0}
          y={l.role === "decorative" ? -l.offset[1] * project.itemScale : 0}
          rotation={-l.rotation}
          opacity={l.opacity}
        />
      ),
    }));
  for (const s of project.sockets) {
    const l = s.preview?.layers.find((l) => l.id === s.preview?.selected);
    if (!l || !s.preview || s.hidden) continue;
    const depth = s.depth < 0 ? l.depth : s.depth;
    itemDraws.push({
      key: s.id,
      depth: (item?.depth ?? 0.55) + (depth - (item?.depth ?? 0.55)) / 10000,
      node: (
        <CropImage
          layer={l}
          scale={s.preview.scale}
          x={s.position[0] * (s.source === "container" ? project.itemScale : 1)}
          y={
            -s.position[1] * (s.source === "container" ? project.itemScale : 1)
          }
          rotation={-attachmentRotation(s)}
        />
      ),
    });
    for (const d of s.preview.layers.filter(
      (l) => l.role === "decorative" && l.visible,
    )) {
      const offset = rotate(
        [d.offset[0] * s.preview.scale, -d.offset[1] * s.preview.scale],
        -attachmentRotation(s),
      );
      const at = add(attachmentPosition(s, project), offset);
      itemDraws.push({
        key: s.id + d.id,
        depth:
          (item?.depth ?? 0.55) + (d.depth - (item?.depth ?? 0.55)) / 10000,
        node: (
          <CropImage
            layer={d}
            scale={s.preview.scale * d.scale}
            x={at[0]}
            y={at[1]}
            rotation={-attachmentRotation(s) - d.rotation}
          />
        ),
      });
    }
  }
  if (item && equipment.itemSprite) {
    for (const l of project.layers.filter(
      (l) => ["item", "decorative"].includes(l.role) && l.visible,
    ))
      include(
        l.rect,
        [l.rect[2] * l.origin[0], l.rect[3] * l.origin[1]],
        project.itemScale * (l.role === "decorative" ? l.scale : 1),
        add(
          itemAt,
          rotate(
            l.role === "decorative"
              ? [
                  l.offset[0] * project.itemScale,
                  -l.offset[1] * project.itemScale,
                ]
              : [0, 0],
            itemRotation,
          ),
        ),
        itemRotation - l.rotation,
      );
    for (const s of project.sockets) {
      const l = s.preview?.layers.find((l) => l.id === s.preview?.selected);
      if (l && s.preview && !s.hidden)
        include(
          l.rect,
          [l.rect[2] * l.origin[0], l.rect[3] * l.origin[1]],
          s.preview.scale,
          add(
            itemAt,
            rotate(
              [
                s.position[0] *
                  (s.source === "container" ? project.itemScale : 1),
                -s.position[1] *
                  (s.source === "container" ? project.itemScale : 1),
              ],
              itemRotation,
            ),
          ),
          itemRotation - attachmentRotation(s),
        );
    }
  }
  if (holding && item && equipment.itemSprite) {
    const arm = poses.get(
      !project.twoHanded && preview.hand === "left" ? "LeftArm" : "RightArm",
    );
    const headDepth = poses.get("Head")?.limb.depth ?? 0.05;
    const heldDepth =
      !project.twoHanded && preview.hand === "left"
        ? Math.max(headDepth + 0.000001, (arm?.limb.depth ?? 0.14) - 0.000002)
        : Math.min(headDepth - 0.000001, (arm?.limb.depth ?? 0.02) + 0.000002);
    for (const draw of itemDraws)
      draws.push({
        key: "held-" + draw.key,
        depth: heldDepth + draw.depth - item.depth,
        node: (
          <Group x={itemAt[0]} y={itemAt[1]} rotation={itemRotation}>
            {draw.node}
          </Group>
        ),
      });
  }
  const fit = () => {
    if (!extent.length) return;
    const minX = Math.min(...extent.map((p) => p[0])),
      maxX = Math.max(...extent.map((p) => p[0]));
    const minY = Math.min(...extent.map((p) => p[1])),
      maxY = Math.max(...extent.map((p) => p[1]));
    setCenter([(minX + maxX) / 2, (minY + maxY) / 2]);
    setZoom(
      Math.max(
        0.1,
        Math.min(
          5,
          (width - 60) / Math.max(1, maxX - minX),
          (height - 42) / Math.max(1, maxY - minY),
        ),
      ),
    );
  };
  const focusHeld = () => {
    if (!holding || !item) return fit();
    const points: Vec[] = [
      add(holding.shoulder, [-35, -40]),
      add(holding.shoulder, [35, 55]),
    ];
    if (equipment.combined && refData) {
      for (const l of clothing.filter((l) => /Arm|Hand/.test(l.limb))) {
        const p = poses.get(l.limb);
        if (!p) continue;
        const t = wearableTransform(l, p.limb, refData);
        for (const x of [0, t.rect[2]])
          for (const y of [0, t.rect[3]])
            points.push(
              add(
                p.position,
                rotate(
                  [
                    (x - t.originPixels[0]) * t.scale,
                    (y - t.originPixels[1]) * t.scale,
                  ],
                  p.rotation - l.rotation,
                ),
              ),
            );
      }
    } else
      for (const x of [0, item.rect[2]])
        for (const y of [0, item.rect[3]])
          points.push(
            itemPointToWorld(
              [
                (x - item.origin[0] * item.rect[2]) * project.itemScale,
                (y - item.origin[1] * item.rect[3]) * project.itemScale,
              ],
              itemAt,
              itemRotation,
            ),
          );
    const min: Vec = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
    ];
    const max: Vec = [
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    setCenter(mul(add(min, max), 0.5));
    setZoom(
      Math.max(
        0.1,
        Math.min(
          5,
          (width - 65) / (max[0] - min[0]),
          (height - 42) / (max[1] - min[1]),
        ),
      ),
    );
  };
  useEffect(fit, [
    width,
    height,
    itemOnly,
    equipment.combined,
    project.identifier,
    refData,
  ]);
  return (
    <div className="viewport-wrap">
      <div className="canvas-info">
        {hasHolding(project) ? (
          <SegmentedControl
            size="xs"
            aria-label="人物预览模式"
            value={mode}
            onChange={setMode}
            data={[
              {
                value: "character",
                label: equipment.combined ? "穿戴＋持握" : "实时持握",
              },
              {
                value: "item",
                label: equipment.combined ? "落地主图" : "物品组装",
              },
            ]}
          />
        ) : (
          <span>CHARACTER / 人物参照</span>
        )}
        <Badge variant="light" color="teal" size="xs">
          EA-HI · 2809175631
        </Badge>
      </div>
      <div className="preview-tools">
        {equipment.holding && (
          <>
            <SegmentedControl
              size="xs"
              aria-label="持握状态"
              value={preview.mode}
              onChange={(v) => onPreview({ mode: v as HoldPreview["mode"] })}
              data={[
                { value: "hold", label: "静态" },
                { value: "aim", label: melee ? "准备" : "瞄准" },
                ...(melee ? [{ value: "swing", label: "挥击" }] : []),
              ]}
            />
            {!project.twoHanded && !equipment.combined && (
              <SegmentedControl
                size="xs"
                aria-label="预览手"
                value={preview.hand}
                onChange={(v) => onPreview({ hand: v as HoldPreview["hand"] })}
                data={[
                  { value: "right", label: "右手" },
                  { value: "left", label: "左手" },
                ]}
              />
            )}
            <SegmentedControl
              size="xs"
              aria-label="预览拖动模式"
              value={editMode}
              onChange={setEditMode}
              data={[
                { value: "position", label: "位置" },
                ...(!equipment.combined
                  ? [{ value: "origin", label: "原点" }]
                  : []),
                { value: "handles", label: "握点" },
              ]}
            />
          </>
        )}
        <Checkbox
          size="xs"
          label="滚轮改贴图"
          checked={wheelEditsScale}
          onChange={(e) => setWheelEditsScale(e.currentTarget.checked)}
        />
        <Text size="10px" c="dimmed">
          {wheelEditsScale ? "Alt + 滚轮改视图" : "Alt + 滚轮改贴图"}
        </Text>
        <Badge size="xs" color="gray" variant="light">
          {socket?.preview
            ? "配件预览"
            : (!itemOnly && selected.role === "wearable") ||
                selected.role === "decorative"
              ? "图层"
              : "Item"}{" "}
          scale{" "}
          {round(
            socket?.preview
              ? socket.preview.scale
              : (!itemOnly && selected.role === "wearable") ||
                  selected.role === "decorative"
                ? selected.scale
                : project.itemScale,
          )}
        </Badge>
      </div>
      {equipment.combined && !itemOnly && (
        <div className="preview-tools">
          <Select
            size="xs"
            aria-label="复合装备衣片"
            placeholder="选择车体 / 武器衣片"
            value={selected.role === "wearable" ? selected.id : null}
            data={project.layers
              .filter((l) => l.role === "wearable")
              .map((l) => ({
                value: l.id,
                label: `${l.name} · ${l.limb}`,
              }))}
            onChange={(id) => {
              if (id) onSelectLayer(id);
            }}
            style={{ flex: 1 }}
          />
          <Text size="10px" c="dimmed">
            衣片原点 / 缩放独立于持握坐标
          </Text>
        </div>
      )}
      {melee && !itemOnly && (
        <MeleeControls
          stopEpoch={remotePreviewEpoch}
          project={project}
          preview={preview}
          onPreview={onPreview}
        />
      )}
      {hasHolding(project) && !itemOnly && !melee && preview.mode === "aim" && (
        <div className="aim-controls">
          <Text size="10px" c="dimmed">
            瞄准方向 ↑+
          </Text>
          <Slider
            aria-label="瞄准方向滑块"
            min={-180}
            max={180}
            step={1}
            value={preview.direction}
            onChange={(direction) => onPreview({ direction })}
            disabled={!poseBool(project, "aimable", true)}
            style={{ flex: 1 }}
          />
          <NumberInput
            aria-label="瞄准方向（预览）"
            size="xs"
            w={80}
            suffix="°"
            value={round(preview.direction, 1)}
            min={-180}
            max={180}
            onChange={(v) => {
              if (typeof v === "number" && Number.isFinite(v))
                onPreview({ direction: v });
            }}
          />
        </div>
      )}
      <div
        className="canvas rig-canvas"
        ref={ref}
        data-testid="character-canvas"
      >
        {!refData && (
          <div className="canvas-empty">
            正在读取木萌人物…
            <br />
            <small>需连接本地 2809175631 Mod</small>
          </div>
        )}
        <Stage
          width={width}
          height={height}
          ref={stageRef}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage() && e.evt.button === 0) {
              const at = stageRef.current?.getPointerPosition();
              if (at) pan.current = { start: [at.x, at.y], center };
            }
          }}
          onMouseMove={() => {
            if (gesture.current)
              gesture.current.update(sub(pointer(), gesture.current.start));
            else if (pan.current) {
              const at = stageRef.current?.getPointerPosition();
              if (at)
                setCenter([
                  pan.current.center[0] -
                    (at.x - pan.current.start[0]) / (zoom * facing),
                  pan.current.center[1] - (at.y - pan.current.start[1]) / zoom,
                ]);
            }
          }}
          onMouseUp={() => {
            if (gesture.current) onGestureEnd();
            gesture.current = null;
            pan.current = null;
          }}
          onMouseLeave={() => {
            if (gesture.current) onGestureEnd();
            gesture.current = null;
            pan.current = null;
          }}
          onWheel={(e) => {
            e.evt.preventDefault();
            const factor = e.evt.deltaY > 0 ? 1 / 1.05 : 1.05;
            if (wheelEditsScale !== e.evt.altKey) {
              if (socket?.preview)
                onSocket(socket.id, {
                  preview: {
                    ...socket.preview,
                    scale: Math.max(
                      0.001,
                      Math.min(100, socket.preview.scale * factor),
                    ),
                  },
                });
              else if (
                (!itemOnly && selected.role === "wearable") ||
                selected.role === "decorative"
              )
                onLayer({
                  scale: Math.max(
                    0.001,
                    Math.min(100, selected.scale * factor),
                  ),
                });
              else
                onProject({
                  itemScale: Math.max(
                    0.001,
                    Math.min(100, project.itemScale * factor),
                  ),
                });
              return;
            }
            const newZoom = Math.min(
              10,
              Math.max(0.1, zoom * (e.evt.deltaY > 0 ? 0.9 : 1.1)),
            );
            const local = pointer(),
              at = stageRef.current?.getPointerPosition();
            if (at)
              setCenter([
                local[0] - (at.x - width / 2) / (newZoom * facing),
                local[1] - (at.y - (height - 24) / 2) / newZoom,
              ]);
            setZoom(newZoom);
          }}
        >
          <Layer>
            <Line
              points={[0, worldY + 143 * zoom, width, worldY + 143 * zoom]}
              stroke="#283342"
              dash={[6, 6]}
              listening={false}
            />
            <Group
              name="mcp-scene"
              x={worldX}
              y={worldY}
              scaleX={zoom * facing}
              scaleY={zoom}
            >
              {!itemOnly &&
                draws
                  .sort((a, b) => b.depth - a.depth)
                  .map((d) => <Group key={d.key}>{d.node}</Group>)}
              {!itemOnly && skeleton && refData && (
                <Group listening={false}>
                  {refData.joints.map((j, i) => {
                    const p = rig.find((r) => r.limb.id === j.a)!,
                      q = rig.find((r) => r.limb.id === j.b)!;
                    const anchor = add(
                      p.position,
                      rotate(
                        [
                          j.anchorA[0] * refData.jointScale * j.scale,
                          -j.anchorA[1] * refData.jointScale * j.scale,
                        ],
                        p.rotation,
                      ),
                    );
                    return (
                      <Group key={i}>
                        <Line
                          points={[...p.position, ...anchor, ...q.position]}
                          stroke="#71b8ee"
                          opacity={0.65}
                          strokeWidth={0.65 / zoom}
                        />
                        <Circle
                          x={anchor[0]}
                          y={anchor[1]}
                          radius={2.6 / zoom}
                          fill="#111a24"
                          stroke="#86ccff"
                          strokeWidth={1 / zoom}
                        />
                      </Group>
                    );
                  })}
                  {rig.map((p) => (
                    <Circle
                      key={p.limb.id}
                      x={p.position[0]}
                      y={p.position[1]}
                      radius={1.5 / zoom}
                      fill="#faaf5c"
                    />
                  ))}
                </Group>
              )}
              {item && equipment.itemSprite && itemOnly && (
                <Group>
                  {itemDraws
                    .sort((a, b) => b.depth - a.depth)
                    .map((d) => (
                      <Group key={d.key}>{d.node}</Group>
                    ))}
                </Group>
              )}
              {item && hasHolding(project) && (
                <>
                  {equipment.itemSprite && (
                    <Group x={itemAt[0]} y={itemAt[1]} rotation={itemRotation}>
                      <KRect
                        x={-item.rect[2] * item.origin[0] * project.itemScale}
                        y={-item.rect[3] * item.origin[1] * project.itemScale}
                        width={item.rect[2] * project.itemScale}
                        height={item.rect[3] * project.itemScale}
                        stroke={
                          editMode === "origin" || itemOnly
                            ? "#faaf5c"
                            : "#54d9b2"
                        }
                        strokeWidth={1 / zoom}
                        dash={[4 / zoom, 4 / zoom]}
                        fill="rgba(84,217,178,0.015)"
                        onMouseDown={(e) => {
                          if (editMode === "origin" || itemOnly)
                            beginGesture(e, (delta) =>
                              onItemLayer(item.id, {
                                origin: itemOriginAfterDrag(
                                  item.origin,
                                  [item.rect[2], item.rect[3]],
                                  project.itemScale,
                                  itemRotation,
                                  delta,
                                ),
                              }),
                            );
                          else if (
                            holding &&
                            !holding.followHand &&
                            !(melee && preview.mode === "swing") &&
                            editMode === "position"
                          )
                            beginGesture(e, (delta) =>
                              onProject({
                                pose: {
                                  ...project.pose,
                                  [holding.key]: formatPose(
                                    positionFromWorld(
                                      add(itemAt, delta),
                                      holding.shoulder,
                                      holding.positionRotation,
                                    ),
                                  ),
                                },
                              }),
                            );
                        }}
                      />
                    </Group>
                  )}
                  <Marker
                    at={itemAt}
                    color="#faaf5c"
                    label={
                      equipment.combined && !itemOnly
                        ? `${holding?.key || "O"} · 物理原点`
                        : editMode === "origin" || itemOnly
                          ? "O · 贴图原点"
                          : holding?.key || "O"
                    }
                    zoom={zoom}
                    facing={facing}
                    start={() => {
                      onGestureStart();
                      markerDrag.current = {
                        at: itemAt,
                        rotation: itemRotation,
                        project,
                      };
                    }}
                    end={onGestureEnd}
                    move={
                      holding &&
                      !holding.followHand &&
                      !(melee && preview.mode === "swing") &&
                      editMode === "position"
                        ? (point) =>
                            onProject({
                              pose: {
                                ...project.pose,
                                [holding.key]: formatPose(
                                  positionFromWorld(
                                    point,
                                    holding.shoulder,
                                    holding.positionRotation,
                                  ),
                                ),
                              },
                            })
                        : undefined
                    }
                  />
                  {(editMode === "handles" || itemOnly) &&
                    (
                      [
                        "handle1",
                        "handle2",
                        ...(project.hasBarrel ? ["barrel"] : []),
                      ] as ("handle1" | "handle2" | "barrel")[]
                    ).map((key) => (
                      <Marker
                        key={key}
                        at={itemPointToWorld(
                          markerInItem(project, key),
                          itemAt,
                          itemRotation,
                        )}
                        color={
                          key === "handle1"
                            ? colors.h1
                            : key === "handle2"
                              ? colors.h2
                              : colors.barrel
                        }
                        label={
                          key === "handle1"
                            ? "H1 · 右手"
                            : key === "handle2"
                              ? "H2 · 左手"
                              : "枪口 / 作用点"
                        }
                        zoom={zoom}
                        facing={facing}
                        start={() => {
                          onGestureStart();
                          markerDrag.current = {
                            at: itemAt,
                            rotation: itemRotation,
                            project,
                          };
                        }}
                        end={onGestureEnd}
                        move={(point) => {
                          const start = markerDrag.current ?? {
                            at: itemAt,
                            rotation: itemRotation,
                            project,
                          };
                          onProject({
                            [key]: markerFromWorld(
                              point,
                              start.at,
                              start.rotation,
                              start.project,
                              key,
                            ),
                          });
                        }}
                      />
                    ))}
                  {holding &&
                    !holding.followHand &&
                    !melee &&
                    editMode === "position" && (
                      <Marker
                        at={itemPointToWorld(
                          [
                            Math.max(
                              40,
                              Math.min(
                                90,
                                item.rect[2] * project.itemScale * 0.4,
                              ),
                            ),
                            -24,
                          ],
                          itemAt,
                          itemRotation,
                        )}
                        color="#8dbdff"
                        label={holding.aim ? "↻ aimangle" : "↻ holdangle"}
                        zoom={zoom}
                        facing={facing}
                        start={() => {
                          onGestureStart();
                          markerDrag.current = {
                            at: itemAt,
                            rotation: itemRotation,
                            project,
                          };
                        }}
                        end={onGestureEnd}
                        move={(point) => {
                          const origin = markerDrag.current?.at ?? itemAt;
                          const v = sub(point, origin);
                          const localAngle =
                            (Math.atan2(
                              -24,
                              Math.max(
                                40,
                                Math.min(
                                  90,
                                  item.rect[2] * project.itemScale * 0.4,
                                ),
                              ),
                            ) *
                              180) /
                            Math.PI;
                          const rotation =
                            (Math.atan2(v[1], v[0]) * 180) / Math.PI -
                            localAngle;
                          const base = holding.aim
                            ? holding.positionRotation
                            : poses.get("Torso")?.rotation || 0;
                          const value =
                            ((((base - rotation + 180) % 360) + 360) % 360) -
                            180;
                          onProject({
                            pose: {
                              ...project.pose,
                              [holding.aim ? "aimangle" : "holdangle"]:
                                formatPose(value),
                            },
                          });
                        }}
                      />
                    )}
                  {holding && (
                    <Group listening={false}>
                      <Line
                        points={[...holding.shoulder, ...itemAt]}
                        stroke="#faaf5c"
                        dash={[3 / zoom, 4 / zoom]}
                        opacity={0.5}
                        strokeWidth={1 / zoom}
                      />
                      <Circle
                        x={holding.shoulder[0]}
                        y={holding.shoulder[1]}
                        radius={3 / zoom}
                        stroke="#faaf5c"
                        strokeWidth={1 / zoom}
                      />
                      {holding.hands.map((hand) => (
                        <Group key={hand.side}>
                          <Circle
                            x={hand.target[0]}
                            y={hand.target[1]}
                            radius={3 / zoom}
                            stroke={
                              hand.error > 0.5
                                ? "#ff6d87"
                                : hand.side === "right"
                                  ? colors.h1
                                  : colors.h2
                            }
                            strokeWidth={1.5 / zoom}
                          />
                          {hand.error > 0.5 && (
                            <Line
                              points={[...hand.actual, ...hand.target]}
                              stroke="#ff6d87"
                              strokeWidth={2 / zoom}
                              dash={[4 / zoom, 3 / zoom]}
                            />
                          )}
                        </Group>
                      ))}
                      {project.hasBarrel && (
                        <Line
                          points={[
                            ...itemPointToWorld(
                              markerInItem(project, "barrel"),
                              itemAt,
                              itemRotation,
                            ),
                            ...itemPointToWorld(
                              add(
                                markerInItem(project, "barrel"),
                                rotate(
                                  [45, 0],
                                  project.kind === "tool"
                                    ? -project.barrelRotation
                                    : 0,
                                ),
                              ),
                              itemAt,
                              itemRotation,
                            ),
                          ]}
                          stroke="#ff6d87"
                          opacity={0.7}
                          dash={[5 / zoom, 3 / zoom]}
                          strokeWidth={1 / zoom}
                        />
                      )}
                    </Group>
                  )}
                  {socket && equipment.itemSprite && (
                    <>
                      {socketLayer && socket.preview && !socket.hidden && (
                        <Group
                          x={
                            itemPointToWorld(
                              attachmentPosition(socket, project),
                              itemAt,
                              itemRotation,
                            )[0]
                          }
                          y={
                            itemPointToWorld(
                              attachmentPosition(socket, project),
                              itemAt,
                              itemRotation,
                            )[1]
                          }
                          rotation={itemRotation - attachmentRotation(socket)}
                        >
                          <KRect
                            x={
                              -socketLayer.origin[0] *
                              socketLayer.rect[2] *
                              socket.preview.scale
                            }
                            y={
                              -socketLayer.origin[1] *
                              socketLayer.rect[3] *
                              socket.preview.scale
                            }
                            width={socketLayer.rect[2] * socket.preview.scale}
                            height={socketLayer.rect[3] * socket.preview.scale}
                            stroke="#b8a0ff"
                            strokeWidth={1 / zoom}
                            fill="rgba(184,160,255,0.08)"
                            onMouseDown={(e) =>
                              beginGesture(e, (delta) => {
                                if (editMode === "origin")
                                  onSocket(socket.id, {
                                    preview: {
                                      ...socket.preview!,
                                      layers: socket.preview!.layers.map((l) =>
                                        l.id === socketLayer.id
                                          ? {
                                              ...l,
                                              origin: itemOriginAfterDrag(
                                                l.origin,
                                                [l.rect[2], l.rect[3]],
                                                socket.preview!.scale,
                                                itemRotation -
                                                  attachmentRotation(socket),
                                                delta,
                                              ),
                                            }
                                          : l,
                                      ),
                                    },
                                  });
                                else {
                                  const local = rotate(delta, -itemRotation);
                                  const factor =
                                    socket.source === "container"
                                      ? project.itemScale
                                      : 1;
                                  onSocket(socket.id, {
                                    position: [
                                      socket.position[0] + local[0] / factor,
                                      socket.position[1] - local[1] / factor,
                                    ],
                                  });
                                }
                              })
                            }
                          />
                        </Group>
                      )}
                      <Marker
                        at={itemPointToWorld(
                          attachmentPosition(socket, project),
                          itemAt,
                          itemRotation,
                        )}
                        color="#b8a0ff"
                        label="配件挂点 · itempos"
                        zoom={zoom}
                        facing={facing}
                        start={onGestureStart}
                        end={onGestureEnd}
                        move={(p) => {
                          const local = worldToItemPoint(
                              p,
                              itemAt,
                              itemRotation,
                            ),
                            scale =
                              socket.source === "container"
                                ? project.itemScale
                                : 1;
                          onSocket(socket.id, {
                            position: [
                              round(local[0] / scale),
                              round(-local[1] / scale),
                            ],
                          });
                        }}
                      />
                    </>
                  )}
                </>
              )}
            </Group>
            <Line
              points={[22, height - 34, 22 + 100 * zoom, height - 34]}
              stroke="#8394a8"
              strokeWidth={1}
            />
            <Line
              points={[22, height - 38, 22, height - 30]}
              stroke="#8394a8"
            />
            <KText
              text="100 游戏显示像素（1 m）"
              x={22}
              y={height - 24}
              fontSize={10}
              fill="#7d90a6"
            />
          </Layer>
        </Stage>
        <div className="reference-note">
          {equipment.combined && !itemOnly
            ? "拖衣片改 origin · Alt＋滚轮改衣片 scale · 橙色点改持握位置"
            : socket
              ? "紫色挂点改 itempos · 原点模式拖配件图 · 滚轮缩放配件仅预览"
              : project.kind === "clothing"
                ? selected.inheritOrigin
                  ? "当前继承肢体 origin · 取消继承后可拖动衣片"
                  : "拖动选中衣片改 origin · Alt + 滚轮改 scale"
                : itemOnly
                  ? "拖动主图改 origin · 配件随物品整体变换"
                  : editMode === "origin"
                    ? "拖动主图改 origin · 握点坐标保持不变"
                    : editMode === "handles"
                      ? "拖动 H1 / H2 / 枪口 · 实时回写 XML"
                      : melee
                        ? preview.mode === "swing"
                          ? "近战挥击预览 · 握点 / 原点仍可标定，攻击行为不回写"
                          : "近战位置标定 · 角度在右侧输入，准备不随准星"
                        : "拖动物品改位置 · 蓝色旋钮改角度"}
        </div>
      </div>
      {holding && (
        <div className="holding-readout" data-testid="pose-readout">
          <span>
            {holding.frame?.swing
              ? `SwingPos=${project.melee?.swingPos.join(",") || "2,0"}（物理单位）`
              : `${holding.key}=${project.pose[holding.key] || "0,0"}`}{" "}
            · 物品原点 {itemAt.map((n) => round(n, 1)).join(",")} · 旋转{" "}
            {round(-itemRotation, 1)}°
          </span>
          <span
            style={{
              color: holding.hands.some((h) => h.error > 0.5)
                ? "#ff8597"
                : "#8aabbb",
            }}
          >
            {holding.hands
              .map(
                (h) =>
                  `${h.side === "right" ? "右" : "左"}手${h.error > 0.5 ? "超出 " + round(h.error, 1) + "px" : "可达"}`,
              )
              .join(" · ") || "参考手臂随动"}{" "}
            · 静态 IK / 非物理模拟
          </span>
          {holding.notes.map((note) => (
            <span key={note} className="holding-warning">
              {note}
            </span>
          ))}
        </div>
      )}
      <div className="viewport-footer">
        <Text size="xs" c="dimmed">
          {itemOnly
            ? "主图 / 装饰 / 挂接配件"
            : `${refData?.limbs.length ?? 0} 肢体 · ${refData?.joints.length ?? 0} 关节 · ${pose === "neutral" ? "绑定参考姿态" : "放松参考姿态"}`}
        </Text>
        <UIGroup gap={2}>
          {holding && (
            <Button variant="subtle" size="compact-xs" onClick={focusHeld}>
              聚焦持握
            </Button>
          )}
          <ActionIcon variant="subtle" aria-label="适应预览" onClick={fit}>
            <IconFocusCentered size={15} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            aria-label="缩小人物"
            onClick={() => setZoom((z) => Math.max(0.3, z / 1.2))}
          >
            <IconMinus size={14} />
          </ActionIcon>
          <Text size="xs">{Math.round(zoom * 100)}%</Text>
          <ActionIcon
            variant="subtle"
            aria-label="放大人物"
            onClick={() => setZoom((z) => Math.min(10, z * 1.2))}
          >
            <IconPlus size={14} />
          </ActionIcon>
        </UIGroup>
      </div>
    </div>
  );
}
