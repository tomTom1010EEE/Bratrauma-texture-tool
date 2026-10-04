import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { XMLValidator } from "fast-xml-parser";
// The server intentionally remains plain Node ESM.
import {
  reference,
  importItem,
  scan,
  exists,
  itemNodes,
  parser,
} from "../server/library.mjs";
import { exportXml, parseProject, calibrationXml } from "../src/exporter";
import { buildRig, add, rotate, wearableTransform } from "../src/geometry";
import { equipmentPreview } from "../shared/equipment.mjs";
import { coordinatePatch } from "../server/saveback.mjs";
import type { Project, Reference } from "../src/model";
import { buildHolding } from "../src/holding";
import { markerInItem } from "../src/holding";

const game =
  process.env.BAROTRAUMA_GAME || "D:/SteamLibrary/steamapps/common/Barotrauma";
const workshop =
  process.env.BAROTRAUMA_WORKSHOP ||
  "D:/SteamLibrary/steamapps/workshop/content/602960";
const roots = [
  {
    path: path.join(game, "LocalMods/Empire Arms"),
    name: "Empire arms",
    workshopId: "",
  },
  {
    path: path.join(workshop, "2809175631"),
    name: "EA-HI",
    workshopId: "2809175631",
  },
  {
    path: path.join(workshop, "3159849099"),
    name: "Deep-Diving-Armory",
    workshopId: "3159849099",
  },
];
test("real STRV 122B+: one worn hull, forearm cannon follows IK, combined export and coordinate-only patch", async (t) => {
  if (!(await exists(roots[0].path)) || !(await exists(roots[1].path)))
    return t.skip("Empire Arms / EA-HI not installed");
  const file = path.join(roots[0].path, "gears/weapons.xml");
  const p = await importItem(file, "strv_122_b_p", roots[0], roots, game);
  const raw = await fs.readFile(file, "utf8");
  assert.equal(p.kind, "weapon");
  assert.equal(equipmentPreview(p).itemSprite, false);
  assert.equal(equipmentPreview(p, true).itemSprite, true);
  const gun = p.layers.find(
    (l) => l.role === "wearable" && l.limb === "RightForearm",
  )!;
  const hull = p.layers.find(
    (l) => l.role === "wearable" && l.limb === "Torso",
  )!;
  assert.deepEqual(gun.rect, [1493, 71, 600, 70]);
  assert.deepEqual(hull.rect, [28, 52, 1340, 560]);
  const ref = await reference(roots[1], roots, game);
  const scenes = [0, 45].map((direction) =>
    buildHolding(ref, p, { mode: "aim", hand: "right", direction }),
  );
  const forearms = scenes.map(
    (s) => s.rig.find((l) => l.limb.limb === "RightForearm")!,
  );
  assert.notEqual(forearms[0].rotation, forearms[1].rotation);
  assert.deepEqual(
    scenes[0].rig.find((l) => l.limb.limb === "Torso"),
    scenes[1].rig.find((l) => l.limb.limb === "Torso"),
  );
  const originalTransform = wearableTransform(gun, forearms[0].limb, ref);
  const q = structuredClone(p);
  q.itemScale *= 2;
  assert.deepEqual(
    wearableTransform(
      q.layers.find((l) => l.id === gun.id)!,
      forearms[0].limb,
      ref,
    ),
    originalTransform,
  );
  q.itemScale = p.itemScale;
  q.layers.find((l) => l.id === gun.id)!.origin = [0.1, 1.7];
  q.layers.find((l) => l.id === hull.id)!.origin = [0.75, 0.55];
  q.pose.aimpos = "72,6";
  const patched = coordinatePatch(raw, "strv_122_b_p", p, q);
  const start = raw.indexOf('<Item name="STRV 122B+"'),
    end = raw.indexOf("</Item>", start) + 7;
  assert.ok(start >= 0);
  const changedItem = raw
    .slice(start, end)
    .replace('origin="0,1.8"', 'origin="0.1,1.7"')
    .replace('origin="0.7,0.55"', 'origin="0.75,0.55"')
    .replace('aimpos="70,5"', 'aimpos="72,6"');
  assert.equal(
    patched.text,
    raw.slice(0, start) + changedItem + raw.slice(end),
  );
  assert.equal(patched.changes.length, 3);
  assert.equal(XMLValidator.validate(calibrationXml(q)), true);
  assert.ok(
    calibrationXml(q).includes('<Wearable slots="OuterClothes+RightHand">'),
  );
  assert.ok(calibrationXml(q).includes('aimpos="72,6"'));
  assert.equal(
    await fs.readFile(file, "utf8"),
    raw,
    "never write real mod during test",
  );
});
test("JiuZhou Rebalance resolves external TSM textures and nested slots", async (t) => {
  const root = {
    path: path.join(workshop, "3630177833"),
    name: "九州武库Rebalance",
    workshopId: "3630177833",
  };
  const dependency = {
    path: path.join(workshop, "2852411866"),
    name: "T.S.M MISSIONS-问君此去几时还",
    workshopId: "2852411866",
  };
  if (!(await exists(root.path)) || !(await exists(dependency.path)))
    return t.skip("JiuZhou / TSM not installed");
  const p = await importItem(
    path.join(root.path, "combatrifle.xml"),
    "tsm_qbu_191",
    root,
    [...roots, root, dependency],
    game,
  );
  assert.equal(p.kind, "weapon");
  assert.ok(p.layers[0].texture.xmlPath.startsWith("%ModDir:2852411866%"));
  assert.equal(
    p.warnings.filter(
      (w) => w.startsWith("贴图不存在") || w.startsWith("未解析贴图"),
    ).length,
    0,
  );
  assert.ok(p.sockets.some((s) => s.sourcePath?.includes("SubContainer")));
  assert.ok(p.posePresets?.some((s) => s.values.holdpos));
  assert.ok(p.posePresets?.every((s) => s.source.startsWith("Item/")));
  assert.equal(XMLValidator.validate(exportXml(p)), true);
});
test("real EA-HI arms: neutral/relaxed, hold/aim and one/two hand all preserve joints", async (t) => {
  if (!(await exists(roots[1].path)) || !(await exists(roots[0].path)))
    return t.skip("EA-HI / Empire Arms not installed");
  const ref = await reference(roots[1], roots, game, "female");
  const p = await importItem(
    path.join(roots[0].path, "gears/weapons.xml"),
    "EM_accurate",
    roots[0],
    roots,
    game,
  );
  assert.equal(
    ref.limbs.find((l) => l.limb === "RightArm")?.spriteOrientation,
    180,
  );
  assert.deepEqual(
    ref.limbs.find((l) => l.limb === "RightHand")?.pullPos,
    [0, 0],
  );
  assert.equal(p.pose.controlpose, "true");
  p.pose.aimpos = "90,10";
  p.pose.holdpos = "85,-5";
  for (const body of ["neutral", "relaxed"] as const)
    for (const mode of ["hold", "aim"] as const)
      for (const two of [false, true])
        for (const hand of ["right", "left"] as const) {
          p.twoHanded = two;
          const result = buildHolding(
            ref,
            p,
            { mode, hand, direction: 25 },
            body,
          );
          assert.equal(result.hands.length, two ? 2 : 1);
          assert.ok(result.hands.every((h) => Number.isFinite(h.error)));
          for (const j of ref.joints) {
            const a = result.rig.find((r) => r.limb.id === j.a)!,
              b = result.rig.find((r) => r.limb.id === j.b)!;
            const qa = add(
              a.position,
              rotate(
                [
                  j.anchorA[0] * j.scale * ref.jointScale,
                  -j.anchorA[1] * j.scale * ref.jointScale,
                ],
                a.rotation,
              ),
            );
            const qb = add(
              b.position,
              rotate(
                [
                  j.anchorB[0] * j.scale * ref.jointScale,
                  -j.anchorB[1] * j.scale * ref.jointScale,
                ],
                b.rotation,
              ),
            );
            assert.ok(Math.hypot(qa[0] - qb[0], qa[1] - qb[1]) < 1e-6);
          }
        }
});
test("Item scanner ignores nested recipe item references and XML comments", () => {
  const doc = parser.parse(
    '<Items><!-- <Item identifier="disabled"><Sprite /></Item> --><Item identifier="gun"><Sprite /><Deconstruct><Item identifier="steel" /></Deconstruct></Item></Items>',
  );
  assert.equal(itemNodes(doc).length, 1);
});
test("EA-HI real RepairTool preserves unscaled barrel and free-hand hold fallback", async (t) => {
  if (!(await exists(roots[1].path))) return t.skip("EA-HI not installed");
  const p = await importItem(
    path.join(roots[1].path, "Content/Addons/ESMTSeries/ESMTSeries.xml"),
    "EAHI_duogongnengtool",
    roots[1],
    roots,
    game,
  );
  assert.equal(p.kind, "tool");
  assert.equal(p.itemScale, 0.4);
  assert.deepEqual(markerInItem(p, "barrel"), [25, -4]);
  const ref = await reference(roots[1], roots, game);
  assert.equal(
    buildHolding(ref, p, { mode: "hold", hand: "right", direction: 0 })
      .followHand,
    true,
  );
  assert.equal(
    buildHolding(ref, p, { mode: "aim", hand: "right", direction: 0 })
      .followHand,
    false,
  );
});
test("EA-HI actual 15-limb / 14-joint rig with closed anchors", async (t) => {
  if (!(await exists(roots[1].path)))
    return t.skip("EA-HI local assets not installed");
  for (const gender of ["female", "male"]) {
    const ref: Reference = await reference(roots[1], roots, game, gender);
    assert.equal(ref.limbs.length, 15);
    assert.equal(ref.joints.length, 14);
    assert.equal(ref.limbScale, 0.5);
    assert.equal(ref.jointScale, 0.5);
    for (const pose of ["neutral", "relaxed"] as const) {
      const rig = buildRig(ref, pose);
      for (const j of ref.joints) {
        const a = rig.find((p) => p.limb.id === j.a)!,
          b = rig.find((p) => p.limb.id === j.b)!;
        const aa = add(
          a.position,
          rotate(
            [
              j.anchorA[0] * ref.jointScale * j.scale,
              -j.anchorA[1] * ref.jointScale * j.scale,
            ],
            a.rotation,
          ),
        );
        const bb = add(
          b.position,
          rotate(
            [
              j.anchorB[0] * ref.jointScale * j.scale,
              -j.anchorB[1] * ref.jointScale * j.scale,
            ],
            b.rotation,
          ),
        );
        assert.ok(Math.hypot(aa[0] - bb[0], aa[1] - bb[1]) < 1e-8);
      }
    }
    assert.ok(ref.heads.length > 1);
    assert.ok(ref.limbs.every((l) => l.texture.uri.startsWith("/api/asset/")));
  }
});
test("Empire Arms real wing and rifle survive calibration-only XML / JSON export", async (t) => {
  if (!(await exists(roots[0].path)))
    return t.skip("Empire Arms not installed");
  for (const [file, id] of [
    ["outfit.xml", "em_wing_headset"],
    ["weapons.xml", "EM_accurate"],
  ]) {
    const p: Project = await importItem(
      path.join(roots[0].path, "gears", file),
      id,
      roots[0],
      roots,
      game,
    );
    const xml = exportXml(p);
    assert.equal(XMLValidator.validate(xml), true);
    assert.equal(
      parseProject(JSON.stringify(p)).identifier,
      id + "_calibrated",
    );
    assert.ok(p.layers.length > 0);
    assert.equal(
      p.warnings.filter((w) => w.startsWith("贴图不存在")).length,
      0,
    );
    if (id === "em_wing_headset")
      assert.ok(
        p.layers.some((l) => l.role === "wearable" && l.limb === "Torso"),
      );
  }
});
test("DDA actual AK47 imports custom weapon + nested attachment sockets", async (t) => {
  if (!(await exists(roots[2].path))) return t.skip("DDA not installed");
  const p: Project = await importItem(
    path.join(roots[2].path, "weapon/rifle/rifle_steel/ak47.xml"),
    "deep_AK47",
    roots[2],
    roots,
    game,
  );
  assert.equal(p.kind, "weapon");
  assert.equal(p.weaponComponent, "SwitchableRangedWeapon");
  assert.deepEqual(p.barrel, [241, 24]);
  assert.equal(p.itemScale, 0.25);
  assert.equal(p.sockets.length, 7);
  const scope = p.sockets.find((s) => s.items.startsWith("holographic_sight"))!;
  assert.deepEqual(scope.position, [-14, 16.5]);
  assert.match(scope.sourcePath!, /SubContainer/);
  assert.equal(
    p.sockets.find((s) => s.items === "deep_chip")!.filterAttribute,
    "tags",
  );
  assert.equal(XMLValidator.validate(exportXml(p)), true);
  const lib = await scan(roots[2]);
  assert.ok(
    lib.items.some(
      (i: { id: string; kind: string }) =>
        i.id === "deep_AK47" && i.kind === "weapon",
    ),
  );
  assert.equal(
    lib.items.some((i: { relative: string }) =>
      i.relative.startsWith("GunSmith"),
    ),
    false,
    "Unregistered experimental GunSmith files must not shadow active weapons",
  );
});
