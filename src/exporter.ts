import type { Project, SpriteLayer } from "./model";
import { round, newLayer, newProject } from "./model";
import { heldSlots } from "./holding";
import { hasHolding, isCombinedEquipment } from "../shared/equipment.mjs";
const esc = (v: unknown) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
const fmt = (v: unknown): string =>
  Array.isArray(v)
    ? v.map((n) => (typeof n === "number" ? round(n) : n)).join(",")
    : typeof v === "number"
      ? String(round(v))
      : String(v);
const attrs = (data: Record<string, unknown>) =>
  Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}="${esc(fmt(v))}"`)
    .join(" ");
function sprite(l: SpriteLayer, indent: string) {
  const base = {
    name: l.name,
    texture: l.texture.xmlPath,
    sourcerect: l.rect,
    origin: l.origin,
    depth: l.depth,
  };
  if (l.role === "wearable")
    return `${indent}<sprite ${attrs({ ...base, limb: l.limb, scale: l.scale, rotation: l.rotation, inheritscale: l.inheritScale, ignorelimbscale: l.ignoreLimbScale, ignoretexturescale: l.ignoreTextureScale, ignoreragdollscale: l.ignoreRagdollScale, inheritorigin: l.inheritOrigin, inheritsourcerect: l.inheritSourceRect, inheritlimbdepth: l.inheritLimbDepth, depthlimb: l.depthLimb, hidelimb: l.hideLimb, hideotherwearables: l.hideOtherWearables, canbehiddenbyotherwearables: l.canBeHidden })} />`;
  const tag =
    l.role === "icon"
      ? "InventoryIcon"
      : l.role === "contained"
        ? "ContainedSprite"
        : l.role === "decorative"
          ? "DecorativeSprite"
          : "Sprite";
  const extra = Object.fromEntries(
    [
      "allowedcontainertags",
      "allowedcontaineridentifiers",
      "usewhenattached",
      "decorativespritebehavior",
    ].map((k) => [k, l.extra?.[k]]),
  );
  return `${indent}<${tag} ${attrs({ ...base, ...(l.role === "decorative" ? { scale: l.scale, rotation: l.rotation, offset: l.offset } : {}), ...(l.role === "contained" ? extra : {}) })} />`;
}
export function holdableXml(p: Project): string {
  const tag = ["MeleeWeapon", "Throwable"].includes(p.holdableType)
    ? p.holdableType
    : "Holdable";
  return `<${tag} ${attrs({
    slots: heldSlots(p),
    controlpose: p.pose.controlpose ?? "false",
    aimable: p.pose.aimable ?? "true",
    usehandrotationforholdangle: p.pose.usehandrotationforholdangle ?? "false",
    handle1: p.handle1,
    handle2: p.handle2,
    holdpos: p.pose.holdpos ?? "0,0",
    aimpos: p.pose.aimpos ?? "0,0",
    holdangle: p.pose.holdangle ?? "0",
    aimangle: p.pose.aimangle ?? "0",
    msg: "ItemMsgPickUpSelect",
  })} />`;
}
export function calibrationXml(p: Project): string {
  const main = p.layers.find((l) => l.role === "item");
  const barrel = p.hasBarrel
    ? `\n  <${p.kind === "tool" ? "RepairTool" : p.weaponComponent || "RangedWeapon"} ${attrs({ barrelpos: p.barrel, barrelrotation: p.kind === "tool" ? p.barrelRotation : undefined })} />`
    : "";
  const worn = isCombinedEquipment(p)
    ? `  <Wearable ${attrs({ slots: p.slots })}>\n${p.layers
        .filter((l) => l.role === "wearable" && l.export)
        .map((l) => sprite(l, "    "))
        .join("\n")}\n  </Wearable>\n`
    : "";
  return `<Item scale="${fmt(p.itemScale)}">\n${main ? sprite(main, "  ") + "\n" : ""}${worn}  ${holdableXml(p)}${barrel}\n</Item>`;
}
export function validateProject(p: Project): string[] {
  const errors: string[] = [];
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(p.identifier))
    errors.push("identifier 只能包含字母、数字、下划线、点和连字符。");
  if (!Number.isFinite(p.itemScale) || p.itemScale <= 0)
    errors.push("Item scale 必须大于 0。");
  if (!p.layers.some((l) => l.export)) errors.push("至少需要一个导出图层。");
  if (p.layers.filter((l) => l.export && l.role === "item").length > 1)
    errors.push("只能有一个物品主贴图，其余请设为装饰或收纳贴图。");
  if (
    ![...p.handle1, ...p.handle2, ...p.barrel, p.barrelRotation].every(
      Number.isFinite,
    )
  )
    errors.push("握点 / 枪口参数无效。");
  for (const key of ["holdpos", "aimpos", "holdangle", "aimangle"]) {
    const value = p.pose[key];
    if (value === undefined) continue;
    const parts = typeof value === "string" ? value.split(",") : [];
    if (
      parts.length !== (key.endsWith("pos") ? 2 : 1) ||
      parts.some((v) => !v.trim() || !Number.isFinite(Number(v)))
    )
      errors.push(`${key}：持握参数无效。`);
  }
  for (const key of ["aimable", "controlpose", "usehandrotationforholdangle"])
    if (p.pose[key] !== undefined && !/^(true|false)$/i.test(p.pose[key]!))
      errors.push(`${key}：必须为 true / false。`);
  for (const s of p.sockets)
    if (![...s.position, s.rotation, s.depth].every(Number.isFinite))
      errors.push(`${s.name}：挂点参数无效。`);
  for (const l of p.layers.filter((l) => l.export)) {
    if (!l.texture.uri || !l.texture.xmlPath)
      errors.push(`${l.name}：请选择贴图并填写 XML 贴图路径。`);
    if (
      !l.rect.every(Number.isFinite) ||
      l.rect[2] <= 0 ||
      l.rect[3] <= 0 ||
      l.rect[0] < 0 ||
      l.rect[1] < 0
    )
      errors.push(`${l.name}：框选区域无效。`);
    if (
      ![...l.origin, l.scale, l.rotation, l.depth, ...l.offset].every(
        Number.isFinite,
      ) ||
      l.scale <= 0
    )
      errors.push(`${l.name}：变换数值无效。`);
  }
  return errors;
}
export function exportXml(p: Project): string {
  const layers = p.layers.filter((l) => l.export);
  const out = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<Items>",
    "  <!-- Sprite Lab 第二阶段：仅外观、握点与持握标定模板。请补充弹药、工具功能、配方及平衡数值。 -->",
    `  <Item ${attrs({ name: p.name, identifier: p.identifier, category: p.kind === "weapon" ? "Weapon" : "Equipment", tags: "smallitem", scale: p.itemScale })}>`,
  ];
  const main = layers.find((l) => l.role === "item") || layers[0];
  if (main && !layers.some((l) => l.role === "item"))
    out.push(sprite({ ...main, role: "item" }, "    "));
  for (const l of layers.filter((l) => l.role !== "wearable"))
    out.push(sprite(l, "    "));
  if (main)
    out.push(
      `    <Body ${attrs({ width: main.rect[2], height: main.rect[3], density: 10 })} />`,
    );
  const worn = layers.filter((l) => l.role === "wearable");
  if (worn.length) {
    out.push(
      `    <Wearable ${attrs({ slots: p.slots, msg: "ItemMsgPickUpSelect" })}>`,
    );
    for (const l of worn) out.push(sprite(l, "      "));
    out.push("    </Wearable>");
  }
  if (hasHolding(p)) {
    out.push("    " + holdableXml(p));
    if (p.hasBarrel)
      out.push(
        `    <${p.kind === "weapon" ? (p.weaponComponent === "SwitchableRangedWeapon" ? "SwitchableRangedWeapon" : "RangedWeapon") : "RepairTool"} ${attrs({ barrelpos: p.barrel, barrelrotation: p.kind === "tool" ? p.barrelRotation : undefined })} />`,
      );
  }
  if (p.sockets.length) {
    out.push(
      "    <!-- 配件挂点片段：合并到目标 ItemContainer；不会自动构建原 Mod 的配件逻辑。 -->",
    );
    for (const s of p.sockets) {
      if (s.sourcePath)
        out.push(
          `    <!-- 来源 ${esc(s.sourcePath).replaceAll("--", "- -")}；独立片段，非原容器槽位拓扑。 -->`,
        );
      if (s.source === "container")
        out.push(
          `    <ItemContainer ${attrs({ capacity: 1, hideitems: s.hidden ?? false, itempos: s.position, itemrotation: s.rotation, containedspritedepth: s.depth >= 0 ? s.depth : undefined })} />`,
        );
      else
        out.push(
          `    <ItemContainer ${attrs({ capacity: 1, hideitems: false, containedspritedepth: s.depth >= 0 ? s.depth : undefined })}>`,
          `      <Containable ${attrs({ [s.filterAttribute === "tags" ? "tags" : "items"]: s.items || "attachment_identifier", itempos: s.position, rotation: s.rotation, hide: s.hidden ?? false })} />`,
          "    </ItemContainer>",
        );
    }
  }
  out.push("  </Item>", "</Items>");
  return out.join("\n");
}
export function parseProject(text: string): Project {
  let p = JSON.parse(text);
  if (
    !p ||
    p.schemaVersion !== 1 ||
    !Array.isArray(p.layers) ||
    !["weapon", "tool", "clothing"].includes(p.kind) ||
    !Array.isArray(p.sockets) ||
    !p.layers.length ||
    p.layers.length > 500 ||
    p.sockets.length > 500
  )
    throw new Error("不是有效的 Sprite Lab v1 项目");
  const tuple = (v: unknown, length: number) =>
    Array.isArray(v) &&
    v.length === length &&
    v.every((n) => typeof n === "number" && Number.isFinite(n));
  p = { ...newProject(p.kind), ...p };
  if (
    !["name", "identifier", "slots", "holdableType"].every(
      (k) => typeof p[k] === "string",
    ) ||
    !tuple(p.handle1, 2) ||
    !tuple(p.handle2, 2) ||
    !tuple(p.barrel, 2) ||
    !Number.isFinite(p.itemScale) ||
    p.itemScale <= 0 ||
    !Number.isFinite(p.barrelRotation) ||
    !p.pose ||
    typeof p.pose !== "object" ||
    Array.isArray(p.pose) ||
    Object.values(p.pose).some(
      (v) => v !== undefined && typeof v !== "string",
    ) ||
    (p.holdableSlots !== undefined && typeof p.holdableSlots !== "string") ||
    !Array.isArray(p.warnings)
  )
    throw new Error("项目参数损坏");
  if (validateProject(p).some((e) => /持握参数|true \/ false/.test(e)))
    throw new Error("持握姿态参数损坏");
  if (
    p.posePresets !== undefined &&
    (!Array.isArray(p.posePresets) ||
      p.posePresets.length > 500 ||
      p.posePresets.some(
        (v: { name: unknown; source: unknown; values: unknown }) =>
          !v ||
          typeof v.name !== "string" ||
          typeof v.source !== "string" ||
          !v.values ||
          typeof v.values !== "object" ||
          Array.isArray(v.values) ||
          Object.values(v.values).some((x) => typeof x !== "string"),
      ))
  )
    throw new Error("源姿态片段损坏");
  const checkLayer = (l: SpriteLayer): SpriteLayer => {
    if (
      !l ||
      !l.texture ||
      typeof l.texture.uri !== "string" ||
      typeof l.texture.xmlPath !== "string" ||
      typeof l.name !== "string" ||
      typeof l.id !== "string" ||
      !["item", "wearable", "decorative", "contained", "icon"].includes(
        l.role,
      ) ||
      !tuple(l.rect, 4) ||
      !tuple(l.origin, 2) ||
      !tuple(l.offset, 2) ||
      ![l.scale, l.rotation, l.depth, l.opacity].every(Number.isFinite) ||
      l.scale <= 0 ||
      l.rect[2] <= 0 ||
      l.rect[3] <= 0
    )
      throw new Error("项目图层结构损坏");
    if (
      l.texture.uri &&
      !l.texture.uri.startsWith("/api/asset/") &&
      !/^data:image\/(png|jpeg|webp);base64,/.test(l.texture.uri)
    )
      throw new Error("项目包含不支持的贴图地址");
    return { ...newLayer(l.role), ...l };
  };
  p.layers = p.layers.map(checkLayer);
  if (
    p.melee &&
    (!tuple(p.melee.swingPos, 2) ||
      !tuple(p.melee.swingForce, 2) ||
      !Number.isFinite(p.melee.reload) ||
      p.melee.reload < 0 ||
      typeof p.melee.swing !== "boolean" ||
      typeof p.melee.requireAim !== "boolean")
  )
    throw new Error("近战预览参数损坏");
  if (new Set(p.layers.map((l: SpriteLayer) => l.id)).size !== p.layers.length)
    throw new Error("图层 ID 重复");
  for (const s of p.sockets) {
    if (
      !s ||
      typeof s.id !== "string" ||
      typeof s.items !== "string" ||
      !tuple(s.position, 2) ||
      ![s.rotation, s.depth].every(Number.isFinite) ||
      !["container", "containable"].includes(s.source)
    )
      throw new Error("配件挂点结构损坏");
    if (s.preview) {
      if (
        !Number.isFinite(s.preview.scale) ||
        s.preview.scale <= 0 ||
        !Array.isArray(s.preview.layers)
      )
        throw new Error("配件预览结构损坏");
      s.preview.layers = s.preview.layers.map(checkLayer);
    }
  }
  return p;
}
