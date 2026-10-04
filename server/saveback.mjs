// Source-preserving, coordinate-only writeback. Never serialize the whole XML tree.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { XMLValidator, XMLParser } from "fast-xml-parser";

export const fingerprint = (text) =>
  createHash("sha256").update(text).digest("hex");
export async function readXmlText(file) {
  const bytes = await fs.readFile(file);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes))
    throw new Error("源文件不是无损 UTF-8，已禁止回写；请先用编辑器确认编码。");
  return text;
}
export const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
};
const forbidden = (p) =>
  /(?:^|[\\/])(?:workshop|workshopmods)(?:[\\/]|$)/i.test(p);
export async function sourceAccess(root, file, gameRoot) {
  try {
    const local = await fs.realpath(path.join(gameRoot, "LocalMods"));
    const realRoot = await fs.realpath(root.path);
    const realFile = file ? await fs.realpath(file) : realRoot;
    const rel = path.relative(local, realRoot);
    if (
      forbidden(root.path) ||
      forbidden(realRoot) ||
      forbidden(realFile) ||
      !inside(local, realRoot) ||
      rel.includes(path.sep)
    )
      return {
        writable: false,
        reason:
          "只读：仅允许 LocalMods 下的直接 Mod 目录，工坊 / Installed 不可回写。",
      };
    if (
      file &&
      (!inside(realRoot, realFile) ||
        !/\.xml$/i.test(realFile) ||
        path.basename(realFile).toLowerCase() === "filelist.xml")
    )
      return { writable: false, reason: "只读：源 XML 不在本地 Mod 内。" };
    const manifest = await fs.realpath(path.join(realRoot, "filelist.xml"));
    if (!inside(realRoot, manifest)) throw new Error("filelist.xml 越界");
    const manifestText = await readXmlText(manifest);
    if (
      XMLValidator.validate(manifestText) !== true ||
      !/<contentpackage\b/i.test(manifestText)
    )
      throw new Error("缺少有效的 Mod filelist.xml");
    if (file && (await fs.stat(realFile)).nlink > 1)
      throw new Error("不允许回写硬链接文件");
    return {
      writable: true,
      reason: "本地开发 Mod · 仅回写坐标属性",
      file: realFile,
    };
  } catch (e) {
    return {
      writable: false,
      reason: "只读：无法确认安全的 LocalMods 来源（" + e.message + "）。",
    };
  }
}

// Tokenize valid XML, retaining exact spans, quotes, casing, BOM and whitespace.
// Comments/CDATA/PI are skipped, never searched for fake Item/attributes.
export function xmlSpans(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("不支持 DTD");
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error("源 XML 无效：" + valid.err.msg);
  const root = { name: "", children: [] },
    stack = [root];
  const token =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[\w:.-]+\s*>|<[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  for (const match of text.matchAll(token)) {
    const s = match[0];
    if (/^<[!?]/.test(s)) continue;
    if (s.startsWith("</")) {
      stack.pop();
      continue;
    }
    const tag = /^<([\w:.-]+)/.exec(s)[1];
    const node = {
      name: tag.toLowerCase(),
      children: [],
      start: match.index,
      end: match.index + s.length,
      attrs: {},
    };
    const attr = /([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
    for (const a of s.matchAll(attr)) {
      if (node.attrs[a[1].toLowerCase()])
        throw new Error("属性名大小写重复，无法安全确定目标：" + a[1]);
      const valueStart = match.index + a.index + a[0].indexOf(a[2]) + 1;
      node.attrs[a[1].toLowerCase()] = {
        value: a[3],
        start: valueStart,
        end: valueStart + a[3].length,
      };
    }
    stack.at(-1).children.push(node);
    if (!/\/\s*>$/.test(s)) stack.push(node);
  }
  return root;
}
const decode = (s) =>
  new XMLParser({ ignoreAttributes: false }).parse(
    `<n v="${s.replaceAll('"', "&quot;")}"/>`,
  ).n["@_v"];
function findItem(root, id) {
  const matches = [];
  function visit(n) {
    for (const c of n.children) {
      if (
        c.name === "item" &&
        String(decode(c.attrs.identifier?.value || "")) === id
      )
        matches.push(c);
      else if (["", "items", "override"].includes(c.name)) visit(c);
    }
  }
  visit(root);
  if (matches.length !== 1)
    throw new Error("源物品定义不唯一或已不存在，请重新导入。");
  return matches[0];
}
const nodeAt = (item, route) => {
  if (!route) return item;
  return route.split("/").reduce((n, segment) => {
    const m = /^([a-z]+)\[(\d+)\]$/i.exec(segment);
    if (!m || !n) throw new Error("无效的源节点路径");
    const child = n.children.filter((c) => c.name === m[1].toLowerCase())[
      Number(m[2])
    ];
    if (!child) throw new Error("源节点已改变，请重新导入");
    return child;
  }, item);
};
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const number = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e7)
    throw new Error("坐标数值无效");
  return String(Number(v.toFixed(6)));
};
const vector = (v, count) => {
  if (!Array.isArray(v) || v.length !== count) throw new Error("坐标维度无效");
  return v.map(number).join(",");
};
const poseValue = (v, count) => {
  if (typeof v !== "string" || !v.trim()) throw new Error("持握坐标无效");
  const ns = v.split(",");
  if (ns.some((n) => !n.trim())) throw new Error("持握坐标无效");
  return count === 2 ? vector(ns.map(Number), 2) : number(Number(v));
};

export function coordinatePatch(text, originalId, base, edited) {
  const item = findItem(xmlSpans(text), originalId);
  const changes = [],
    replacements = [],
    additions = new Map(),
    warnings = [];
  const targets = new Map();
  const set = (route, key, value) => {
    const node = nodeAt(item, route),
      target = `${route}@${key}`;
    if (targets.has(target) && targets.get(target) !== value)
      throw new Error("同一容器的共享属性有冲突：" + target);
    if (targets.has(target)) return;
    targets.set(target, value);
    const existing = node.attrs[key];
    if (existing?.value === value) return;
    changes.push({
      node: route || "Item",
      attribute: key,
      before: existing?.value ?? "（未声明）",
      after: value,
    });
    if (existing)
      replacements.push({ start: existing.start, end: existing.end, value });
    else {
      const at = node.end - (text[node.end - 2] === "/" ? 2 : 1);
      additions.set(at, (additions.get(at) || "") + ` ${key}="${value}"`);
    }
  };
  const scalar = (route, key, old, v, positive = false) => {
    if (equal(old, v)) return;
    if (positive && !(v > 0)) throw new Error(key + " 必须大于 0");
    set(route, key, number(v));
  };
  const tuple = (route, key, old, v, n = 2) => {
    if (!equal(old, v)) set(route, key, vector(v, n));
  };
  scalar("", "scale", base.itemScale, edited.itemScale, true);
  const hold = base.holdableType.toLowerCase() + "[0]";
  for (const key of ["handle1", "handle2"])
    tuple(hold, key, base[key], edited[key]);
  for (const key of ["holdpos", "aimpos", "holdangle", "aimangle"]) {
    if (!equal(base.pose[key], edited.pose?.[key]))
      set(
        hold,
        key,
        poseValue(edited.pose?.[key], key.endsWith("pos") ? 2 : 1),
      );
  }
  if (base.hasBarrel) {
    const route =
      (base.kind === "tool"
        ? "repairtool"
        : base.weaponComponent?.toLowerCase() || "rangedweapon") + "[0]";
    tuple(route, "barrelpos", base.barrel, edited.barrel);
    if (base.kind === "tool")
      scalar(
        route,
        "barrelrotation",
        base.barrelRotation,
        edited.barrelRotation,
      );
  }
  for (const old of base.layers) {
    const l = edited.layers?.find((n) => n.id === old.id);
    if (!l) {
      warnings.push("未删除源图层 " + old.name + "：安全保存不改节点结构。");
      continue;
    }
    if (!old.sourcePath) throw new Error("缺少图层来源，请重新导入");
    if (l.texture.xmlPath !== old.texture.xmlPath)
      warnings.push("未更改贴图文件路径：" + old.name);
    if (
      [
        "role",
        "limb",
        "depthLimb",
        "inheritScale",
        "inheritOrigin",
        "inheritSourceRect",
        "inheritLimbDepth",
        "hideLimb",
        "hideOtherWearables",
        "canBeHidden",
        "ignoreLimbScale",
        "ignoreRagdollScale",
        "ignoreTextureScale",
      ].some((k) => !equal(old[k], l[k]))
    )
      warnings.push("未修改图层绑定、继承与隐藏规则：" + old.name);
    if (l.rect[0] < 0 || l.rect[1] < 0 || l.rect[2] <= 0 || l.rect[3] <= 0)
      throw new Error("框选区域无效");
    tuple(old.sourcePath, "sourcerect", old.rect, l.rect, 4);
    tuple(old.sourcePath, "origin", old.origin, l.origin);
    tuple(old.sourcePath, "offset", old.offset, l.offset);
    // Main Sprite scale is Item.scale. Only write role-specific supported fields.
    if (["wearable", "decorative"].includes(old.role))
      scalar(old.sourcePath, "scale", old.scale, l.scale, true);
    scalar(old.sourcePath, "rotation", old.rotation, l.rotation);
    scalar(old.sourcePath, "depth", old.depth, l.depth);
  }
  for (const old of base.sockets) {
    const s = edited.sockets?.find((n) => n.id === old.id);
    if (!s) {
      warnings.push("未删除源容器规则：" + old.name);
      continue;
    }
    // Import includes rules with no itempos: adding this attribute creates a mount
    // without changing capacity, accepted items, status effects, or scripts.
    tuple(old.sourcePath, "itempos", old.position, s.position);
    scalar(
      old.sourcePath,
      old.source === "container" ? "itemrotation" : "rotation",
      old.rotation,
      s.rotation,
    );
    if (s.depth !== old.depth) {
      if (old.depthEditable) {
        scalar(old.containerPath, "containedspritedepth", old.depth, s.depth);
        warnings.push(
          "绘制深度是整个 " +
            old.containerPath +
            " 的共享属性，会影响该容器所有配件。",
        );
      } else
        warnings.push(
          "未保存单挂点深度：此容器使用槽位深度数组，需在源 XML 中调整。",
        );
    }
    if (
      s.items !== old.items ||
      s.filterAttribute !== old.filterAttribute ||
      s.hidden !== old.hidden
    )
      warnings.push("未修改容器接纳规则/隐藏开关：" + old.name);
    if (s.preview)
      warnings.push(
        "配件预览自身的缩放/原点不回写配件源文件：" +
          s.name +
          "；请单独导入该配件保存。",
      );
  }
  if (
    edited.layers?.some((l) => !base.layers.some((b) => b.id === l.id)) ||
    edited.sockets?.some((s) => !base.sockets.some((b) => b.id === s.id))
  )
    warnings.push(
      "新增图层/容器结构仅保留在工程和导出模板；回写不新增接纳规则或槽位。",
    );
  if (
    base.holdableSlots !== edited.holdableSlots ||
    base.twoHanded !== edited.twoHanded ||
    base.slots !== edited.slots ||
    ["aimable", "controlpose", "usehandrotationforholdangle"].some(
      (k) => base.pose[k] !== edited.pose?.[k],
    )
  )
    warnings.push("未更改 slots、持握开关或人物行为；只保存坐标与角度。");
  if (!equal(base.melee, edited.melee))
    warnings.push("近战行为参数仅用于预览，不回写攻击行为。");
  for (const [start, value] of additions)
    replacements.push({ start, end: start, value });
  let output = text;
  for (const r of replacements.sort((a, b) => b.start - a.start))
    output = output.slice(0, r.start) + r.value + output.slice(r.end);
  if (XMLValidator.validate(output) !== true)
    throw new Error("修改后的 XML 未通过校验，未写入");
  return { text: output, changes, warnings: [...new Set(warnings)] };
}

export function createSaveback(gameRoot) {
  const sessions = new Map(),
    plans = new Map(),
    locks = new Set();
  return {
    async bind(project, root, id, raw) {
      const access = await sourceAccess(root, project.source.file, gameRoot);
      const token = randomUUID();
      project.source = {
        ...project.source,
        originalId: id,
        ...access,
        token,
        fingerprint: fingerprint(raw),
      };
      sessions.set(token, {
        base: structuredClone(project),
        root,
        id,
        raw,
        file: project.source.file,
      });
      if (sessions.size > 1000) sessions.delete(sessions.keys().next().value);
      return project;
    },
    async preview(project) {
      const session = sessions.get(project.source?.token);
      if (!session)
        throw new Error(
          "来源会话已失效，请重新导入原 Mod 后再保存（工程草稿仍可下载）。",
        );
      const access = await sourceAccess(session.root, session.file, gameRoot);
      if (!access.writable) throw new Error(access.reason);
      const disk = await readXmlText(access.file);
      if (fingerprint(disk) !== fingerprint(session.raw))
        throw new Error(
          "源 XML 已被其他程序修改。未覆盖，请先下载草稿并重新导入。",
        );
      const patch = coordinatePatch(disk, session.id, session.base, project);
      const planId = randomUUID();
      plans.set(planId, {
        ...patch,
        session,
        project: structuredClone(project),
        expires: Date.now() + 600000,
      });
      if (plans.size > 100) plans.delete(plans.keys().next().value);
      return {
        planId,
        file: access.file,
        changes: patch.changes,
        warnings: patch.warnings,
      };
    },
    async commit(planId) {
      const plan = plans.get(planId);
      if (!plan || plan.expires < Date.now())
        throw new Error("保存预览已过期，请重新查看差异。");
      const { session } = plan;
      const lockKey = session.file.toLowerCase();
      if (locks.has(lockKey)) throw new Error("文件正在保存，请稍后重试。");
      locks.add(lockKey);
      try {
        const access = await sourceAccess(session.root, session.file, gameRoot);
        if (!access.writable) throw new Error(access.reason);
        const disk = await readXmlText(access.file);
        if (fingerprint(disk) !== fingerprint(session.raw))
          throw new Error("源 XML 已改变，保存已取消。");
        if (!plan.changes.length) throw new Error("没有可回写的坐标变更。");
        const suffix =
          new Date().toISOString().replace(/[:.]/g, "-") +
          "-" +
          randomUUID().slice(0, 8);
        const backup = access.file + ".sprite-lab-" + suffix + ".bak";
        const temp = access.file + ".sprite-lab-" + suffix + ".tmp";
        await fs.writeFile(backup, disk, { flag: "wx" });
        await fs.writeFile(temp, plan.text, { flag: "wx" });
        const recheck = await sourceAccess(
          session.root,
          session.file,
          gameRoot,
        );
        if (
          !recheck.writable ||
          recheck.file !== access.file ||
          fingerprint(await fs.readFile(access.file, "utf8")) !==
            fingerprint(disk)
        ) {
          await fs.unlink(temp);
          throw new Error(
            "保存期间源文件或目录发生变化，已中止；原文件未覆盖。",
          );
        }
        await fs.rename(temp, access.file);
        plans.delete(planId);
        // This token is intentionally invalidated: re-import to get a fresh, honest baseline.
        sessions.delete(plan.project.source.token);
        return { file: access.file, backup, count: plan.changes.length };
      } finally {
        locks.delete(lockKey);
      }
    },
  };
}
