import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { combinedSlots, twoHandedSlots } from "../shared/equipment.mjs";

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributesGroupName: "$",
  attributeNamePrefix: "",
  transformTagName: (n) => n.toLowerCase(),
  transformAttributeName: (n) => n.toLowerCase(),
  parseAttributeValue: false,
  processEntities: true,
});
export const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export const a = (v) => v?.$ || {};
// A known DDA component subclass; do not execute mod scripts to discover types.
const ranged = (item) => item.rangedweapon ?? item.switchablerangedweapon;
const kindOf = (item) => {
  if (ranged(item)) return "weapon";
  const wearable = arr(item.wearable)[0];
  const holdable = arr(item.holdable ?? item.meleeweapon ?? item.throwable)[0];
  if (
    item.repairtool ||
    (wearable &&
      holdable &&
      combinedSlots(a(wearable).slots, a(holdable).slots))
  )
    return "tool";
  return wearable ? "clothing" : "tool";
};
// Read explicit pose assignments only. Never evaluate Conditions, Lua or effects.
function collectPosePresets(item) {
  const presets = [];
  const keys = [
    "holdpos",
    "aimpos",
    "holdangle",
    "aimangle",
    "handle1",
    "handle2",
    "slots",
    "aimable",
    "controlpose",
    "usehandrotationforholdangle",
  ];
  function visit(node, source) {
    if (!node || typeof node !== "object") return;
    for (const [tag, children] of Object.entries(node)) {
      if (tag === "$") continue;
      arr(children).forEach((child, i) => {
        const childPath = `${source}/${tag}[${i}]`;
        const attrs = a(child);
        if (
          tag === "statuseffect" &&
          bool(attrs.setvalue) &&
          /this/i.test(attrs.target || attrs.targettype || "")
        ) {
          const values = Object.fromEntries(
            keys
              .filter((k) => attrs[k] !== undefined)
              .map((k) => [k, attrs[k]]),
          );
          if (Object.keys(values).some((k) => k !== "slots")) {
            const conditions = arr(child.conditional)
              .map((c) =>
                Object.entries(a(c))
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" "),
              )
              .join("; ");
            const required = arr(child.requireditems)
              .map((c) => a(c).items || a(c).tags || a(c).identifier)
              .filter(Boolean)
              .join(",");
            presets.push({
              name: `${attrs.type || "StatusEffect"} · ${conditions || required || "条件见源 XML"}${attrs.delay ? " · delay=" + attrs.delay : ""}`,
              source: childPath,
              values,
            });
          }
        }
        visit(child, childPath);
      });
    }
  }
  visit(item, "Item");
  return presets;
}
const vec = (v, fallback) =>
  v == null ? fallback : String(v).split(",").map(Number);
const num = (v, fallback) =>
  Number.isFinite(Number(v)) && v !== undefined ? Number(v) : fallback;
const bool = (v, fallback = false) =>
  v === undefined ? fallback : String(v).toLowerCase() === "true";
export const assetUrl = (p) =>
  "/api/asset/" + Buffer.from(p).toString("base64url");
export async function xmlFile(file) {
  const s = await fs.readFile(file, "utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error("不支持带 DTD 的 XML");
  const valid = XMLValidator.validate(s);
  if (valid !== true)
    throw new Error(`XML 第 ${valid.err.line} 行: ${valid.err.msg}`);
  return parser.parse(s);
}
export async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
export function itemNodes(node) {
  if (!node || typeof node !== "object") return [];
  return [
    ...arr(node.item).filter(
      (v) =>
        a(v).identifier &&
        ["sprite", "wearable", "holdable", "meleeweapon"].some((k) =>
          Object.hasOwn(v, k),
        ),
    ),
    ...arr(node.override).flatMap(itemNodes),
    ...arr(node.items).flatMap(itemNodes),
  ];
}
export async function walk(root, predicate) {
  const out = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        ["node_modules", "dist", "Subs", "Submarines"].includes(entry.name)
      )
        continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(p);
      else if (entry.isFile() && predicate(p)) out.push(p);
    }
  }
  await visit(root);
  return out;
}
export async function scan(root) {
  const files = await walk(root.path, (p) =>
    /\.(png|jpg|jpeg|webp|xml)$/i.test(p),
  );
  const textures = files
    .filter((p) => !/\.xml$/i.test(p))
    .map((p) => ({
      uri: assetUrl(p),
      xmlPath: "%ModDir%/" + path.relative(root.path, p).replaceAll("\\", "/"),
      name: path.basename(p),
      relative: path.relative(root.path, p),
      file: p,
    }));
  const items = [],
    errors = [];
  // Only registered Item content files are active; fallback for loose development folders.
  let active = null;
  try {
    const manifest = await xmlFile(path.join(root.path, "filelist.xml"));
    const itemFiles = arr(manifest.contentpackage?.item)
      .map((n) => a(n).file)
      .filter(Boolean);
    if (itemFiles.length)
      active = new Set(
        itemFiles.map((p) =>
          path
            .resolve(root.path, p.replace(/^%ModDir%[\\/]?/i, ""))
            .toLowerCase(),
        ),
      );
  } catch {
    /* loose asset directory */
  }
  for (const file of files.filter(
    (p) => /\.xml$/i.test(p) && (!active || active.has(p.toLowerCase())),
  )) {
    try {
      for (const item of itemNodes(await xmlFile(file))) {
        const at = a(item);
        items.push({
          id: at.identifier,
          name: at.name || at.identifier,
          file,
          relative: path.relative(root.path, file),
          tags: at.tags || "",
          kind: kindOf(item),
        });
      }
    } catch (err) {
      errors.push({ file, message: err.message });
    }
  }
  return { textures, items, errors };
}
export function resolveTexture(
  ref,
  file,
  root,
  roots,
  gameRoot,
  gender = "female",
) {
  ref = (ref || "").replace(/\[GENDER\]/gi, gender);
  if (!ref) return "";
  const cross = ref.match(/^%ModDir:([^%]+)%[\\/]?(.*)/i);
  if (cross) {
    const other = roots.find(
      (r) =>
        r.workshopId === cross[1] ||
        r.name.toLowerCase() === cross[1].toLowerCase(),
    );
    return other ? path.resolve(other.path, cross[2]) : "";
  }
  if (/^%ModDir%/i.test(ref))
    return path.resolve(root.path, ref.replace(/^%ModDir%[\\/]?/i, ""));
  if (/^Content[\\/]/i.test(ref)) return path.resolve(gameRoot, ref);
  return path.resolve(path.dirname(file), ref);
}
function sprite(node, role, file, root, roots, gameRoot, gender, index) {
  const at = a(node);
  const textureFile = resolveTexture(
    at.texture,
    file,
    root,
    roots,
    gameRoot,
    gender,
  );
  return {
    id: role + "-" + index,
    name: at.name || `${role} ${index + 1}`,
    role,
    texture: {
      uri: textureFile ? assetUrl(textureFile) : "",
      xmlPath: at.texture || "",
      name: path.basename(textureFile || at.texture || "未指定贴图"),
    },
    rect: vec(at.sourcerect, [0, 0, 64, 64]),
    origin: vec(at.origin, [0.5, 0.5]),
    scale: num(at.scale, 1),
    rotation: num(at.rotation, 0),
    depth: num(at.depth, 0.55),
    offset: vec(at.offset, [0, 0]),
    limb: at.limb || "Torso",
    depthLimb: at.depthlimb || "None",
    inheritScale: bool(at.inheritscale ?? at.inherittexturescale),
    ignoreLimbScale: bool(at.ignorelimbscale),
    ignoreRagdollScale: bool(at.ignoreragdollscale),
    ignoreTextureScale: bool(at.ignoretexturescale),
    inheritOrigin: bool(at.inheritorigin),
    inheritSourceRect: bool(at.inheritsourcerect),
    inheritLimbDepth: bool(at.inheritlimbdepth, true),
    hideLimb: bool(at.hidelimb),
    hideOtherWearables: bool(at.hideotherwearables),
    canBeHidden: bool(at.canbehiddenbyotherwearables, true),
    visible: true,
    opacity: 1,
    export: true,
    extra: {
      allowedcontainertags: at.allowedcontainertags,
      allowedcontaineridentifiers: at.allowedcontaineridentifiers,
      usewhenattached: at.usewhenattached,
      decorativespritebehavior: at.decorativespritebehavior,
    },
    sourceAttributes: at,
  };
}
export async function importItem(file, id, root, roots, gameRoot) {
  const item = itemNodes(await xmlFile(file)).find(
    (n) => a(n).identifier === id,
  );
  if (!item) throw new Error("没有找到这个物品定义");
  const at = a(item),
    wearable = arr(item.wearable)[0],
    holdable = arr(item.holdable ?? item.meleeweapon ?? item.throwable)[0];
  const layers = [];
  const add = (node, role, sourcePath) => {
    if (node)
      layers.push({
        ...sprite(
          node,
          role,
          file,
          root,
          roots,
          gameRoot,
          "female",
          layers.length,
        ),
        sourcePath,
      });
  };
  add(arr(item.sprite)[0], "item", "Sprite[0]");
  arr(wearable?.sprite).forEach((n, i) =>
    add(n, "wearable", `Wearable[0]/Sprite[${i}]`),
  );
  arr(item.decorativesprite).forEach((n, i) =>
    add(n, "decorative", `DecorativeSprite[${i}]`),
  );
  arr(item.containedsprite).forEach((n, i) =>
    add(n, "contained", `ContainedSprite[${i}]`),
  );
  add(arr(item.inventoryicon)[0], "icon", "InventoryIcon[0]");
  const warnings = [];
  if (at.variantof)
    warnings.push(
      `variantof=${at.variantof}：当前读取显式字段，未展开基类；导出前请核对缺省字段。`,
    );
  if (
    item.lightcomponent ||
    layers.some((l) => l.sourceAttributes.alphaclipotherwearables)
  )
    warnings.push("灯光和 AlphaClip 动态遮罩不在第一阶段预览范围内。");
  if (item.decorativesprite)
    warnings.push(
      "DecorativeSprite 预览静态 offset/rotation/scale；动态动画与 Conditional 不参与模板导出。",
    );
  if (item.switchablerangedweapon)
    warnings.push(
      "SwitchableRangedWeapon：按 RangedWeapon 的静态 barrelpos 读取；导出保留组件名，运行仍依赖原扩展。射击模式与动态改枪逻辑不模拟。",
    );
  if (root.workshopId === "3159849099")
    warnings.push(
      "DDA 的 Lua / StatusEffect 可能切换贴图、origin、枪口或握点；这里标定的是 XML 初始状态，不执行 Mod 代码。",
    );
  for (const l of layers) {
    if (!l.texture.uri) warnings.push(`未解析贴图：${l.texture.xmlPath}`);
    else if (
      !(await exists(
        Buffer.from(l.texture.uri.split("/").pop(), "base64url").toString(),
      ))
    )
      warnings.push(`贴图不存在：${l.texture.xmlPath}`);
    else if (!l.sourceAttributes.sourcerect) {
      const file = Buffer.from(
        l.texture.uri.split("/").pop(),
        "base64url",
      ).toString();
      if (/\.png$/i.test(file)) {
        const handle = await fs.open(file, "r");
        try {
          const header = Buffer.alloc(24);
          await handle.read(header, 0, 24, 0);
          if (
            header
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          )
            l.rect = [0, 0, header.readUInt32BE(16), header.readUInt32BE(20)];
        } finally {
          await handle.close();
        }
      } else
        warnings.push(
          `${l.name} 未声明 sourcerect；请在贴图面板点击“整张图”或重新框选。`,
        );
    }
  }
  const sockets = [];
  const visitContainer = (container, location, top, topPath, slotStart = 0) => {
    const depths = a(top).containedspritedepths?.split(",").map(Number) || [];
    const depth = num(depths[slotStart], num(a(top).containedspritedepth, -1));
    const common = {
      containerPath: topPath,
      slotGroup: location,
      depthEditable: !depths.length,
      containerRotation: num(a(top).itemrotation, 0),
    };
    if (
      container === top &&
      (a(container).itempos || !arr(container.containable).length)
    )
      sockets.push({
        id: `socket-${location}`,
        name: "容器挂点",
        position: vec(a(container).itempos, [0, 0]),
        rotation: num(a(container).itemrotation, 0),
        depth,
        items: "",
        source: "container",
        sourcePath: location,
        ...common,
        declaredPosition: a(container).itempos !== undefined,
        hidden: bool(a(top).hideitems, true),
      });
    arr(container.containable).forEach((n, ni) => {
      sockets.push({
        id: `socket-${location}-${ni}`,
        name:
          a(n).items ||
          a(n).identifiers ||
          a(n).identifier ||
          a(n).tags ||
          "配件",
        position: vec(
          a(n).itempos,
          vec(a(top).itempos, [0, 0]).map((v) => v * num(at.scale, 1)),
        ),
        rotation: num(a(n).rotation, 0),
        // Vanilla reads drawing depth from ItemContainer, not Containable.
        depth,
        items:
          a(n).items || a(n).identifiers || a(n).identifier || a(n).tags || "",
        source: "containable",
        filterAttribute: a(n).tags ? "tags" : "items",
        sourcePath: location + `/Containable[${ni}]`,
        ...common,
        declaredPosition: a(n).itempos !== undefined,
        excludedIdentifiers: a(n).excludedidentifiers || "",
        hidden: bool(a(n).hide) || bool(a(top).hideitems, true),
        sourceAttributes: a(n),
      });
    });
    let nextSlot = slotStart + num(a(container).capacity, 1);
    arr(container.subcontainer).forEach((sub, si) => {
      visitContainer(
        sub,
        location + `/SubContainer[${si}]`,
        top,
        topPath,
        nextSlot,
      );
      nextSlot += num(a(sub).capacity, 1);
    });
  };
  arr(item.itemcontainer).forEach((container, ci) =>
    visitContainer(
      container,
      `ItemContainer[${ci}]`,
      container,
      `ItemContainer[${ci}]`,
    ),
  );
  if (sockets.length)
    warnings.push(
      "配件页可按接纳规则装配预览；已有规则坐标可安全回写。新容器结构仅导出待合并片段，不复制或改写原容器逻辑。",
    );
  return {
    schemaVersion: 1,
    name: at.name || at.identifier,
    identifier: at.identifier + "_calibrated",
    kind: kindOf(item),
    itemScale: num(at.scale, 1),
    tags: at.tags || "",
    body: item.body
      ? {
          width: num(a(arr(item.body)[0]).width, 0),
          height: num(a(arr(item.body)[0]).height, 0),
          radius: num(a(arr(item.body)[0]).radius, 0),
        }
      : undefined,
    melee: item.meleeweapon
      ? {
          swing: bool(a(holdable).swing, true),
          swingPos: vec(a(holdable).swingpos, [2, 0]),
          swingForce: vec(a(holdable).swingforce, [3, -1]),
          reload: num(a(holdable).reload, 0.5),
          requireAim: bool(at.requireaimtouse, true),
        }
      : undefined,
    weaponComponent: item.switchablerangedweapon
      ? "SwitchableRangedWeapon"
      : "RangedWeapon",
    slots: a(wearable).slots || "OuterClothes",
    twoHanded: twoHandedSlots(a(holdable).slots),
    holdableType: item.meleeweapon
      ? "MeleeWeapon"
      : item.throwable
        ? "Throwable"
        : "Holdable",
    holdableSlots: a(holdable).slots || "Any,RightHand,LeftHand",
    handle1: vec(a(holdable).handle1, [0, 0]),
    handle2: vec(a(holdable).handle2, vec(a(holdable).handle1, [0, 0])),
    barrel: vec(a(arr(ranged(item) ?? item.repairtool)[0]).barrelpos, [0, 0]),
    hasBarrel: !!(ranged(item) || item.repairtool),
    barrelRotation: num(a(arr(item.repairtool)[0]).barrelrotation, 0),
    pose: {
      holdpos: a(holdable).holdpos,
      aimpos: a(holdable).aimpos,
      holdangle: a(holdable).holdangle,
      aimangle: a(holdable).aimangle,
      aimable: a(holdable).aimable,
      controlpose: a(holdable).controlpose,
      usehandrotationforholdangle: a(holdable).usehandrotationforholdangle,
    },
    posePresets: collectPosePresets(item),
    layers,
    sockets,
    warnings,
    source: {
      file,
      mod: root.name,
      workshopId: root.workshopId,
      rootId: root.id,
    },
  };
}
export async function reference(root, roots, gameRoot, gender = "female") {
  const folder = path.join(root.path, "Content/Characters/Human");
  const file = path.join(folder, "Ragdolls/HumanDefaultRagdoll.xml");
  const rag = (await xmlFile(file)).ragdoll;
  const human = (await xmlFile(path.join(folder, "Human.xml"))).override
    .character;
  const limbs = arr(rag.limb).map((n) => {
    const sp = arr(n.sprite)[0];
    const l = sprite(
      { ...sp, $: { ...a(sp), texture: a(sp).texture || a(rag).texture } },
      "reference",
      file,
      root,
      roots,
      gameRoot,
      gender,
      a(n).id,
    );
    return {
      ...l,
      id: Number(a(n).id),
      limb: a(n).type,
      limbScale: num(a(n).scale, 1),
      pullPos: vec(a(n).pullpos, [0, 0]),
      spriteOrientation: num(
        a(n).spriteorientation,
        num(a(rag).spritesheetorientation, 0),
      ),
    };
  });
  function descendants(node, tag) {
    if (!node || typeof node !== "object") return [];
    return Object.entries(node).flatMap(([k, v]) =>
      k === tag
        ? arr(v)
        : k === "$"
          ? []
          : arr(v).flatMap((n) => descendants(n, tag)),
    );
  }
  const hair = descendants(human, "wearable")
    .filter(
      (n) =>
        ["beard", "moustache"].includes(a(n).type?.toLowerCase()) &&
        (!a(n).tags ||
          a(n)
            .tags.split(",")
            .map((t) => t.trim())
            .includes(gender)),
    )
    .map((n, i) => ({
      ...sprite(
        arr(n.sprite)[0],
        "hair",
        path.join(folder, "Human.xml"),
        root,
        roots,
        gameRoot,
        gender,
        i,
      ),
      group: a(n).type.toLowerCase(),
      inheritScale: true,
    }));
  const heads = descendants(human, "head")
    .filter((n) =>
      a(n)
        .tags?.split(",")
        .map((t) => t.trim())
        .includes(gender),
    )
    .map((n) => ({
      name: a(n).tags.split(",")[0],
      index: vec(a(n).sheetindex, [0, 0]),
    }));
  return {
    name: root.name,
    workshopId: root.workshopId,
    file,
    gender,
    limbScale: num(a(rag).limbscale, 1),
    jointScale: num(a(rag).jointscale, 1),
    textureScale: num(a(rag).texturescale, 1),
    limbs,
    joints: arr(rag.joint).map((j) => ({
      a: num(a(j).limb1, 0),
      b: num(a(j).limb2, 0),
      anchorA: vec(a(j).limb1anchor, [0, 0]),
      anchorB: vec(a(j).limb2anchor, [0, 0]),
      scale: num(a(j).scale, 1),
    })),
    hair,
    heads,
  };
}
