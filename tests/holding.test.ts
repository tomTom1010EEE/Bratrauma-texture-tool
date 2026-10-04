import test from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import { newLayer, newProject, type Reference, type Vec } from "../src/model";
import {
  buildHolding,
  markerInItem,
  markerFromWorld,
  itemPointToWorld,
  positionFromWorld,
  itemOriginAfterDrag,
  heldSlots,
  meleeFrame,
} from "../src/holding";
import { add, rotate } from "../src/geometry";
import { exportXml, parseProject, validateProject } from "../src/exporter";

const close = (a: number[], b: number[], epsilon = 1e-6) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < epsilon, `${a} != ${b}`));
function reference(): Reference {
  const types = [
    "Torso",
    "RightArm",
    "RightForearm",
    "RightHand",
    "LeftArm",
    "LeftForearm",
    "LeftHand",
  ];
  return {
    name: "IK fixture",
    workshopId: "fixture",
    file: "fixture",
    gender: "female",
    limbScale: 0.5,
    jointScale: 0.5,
    textureScale: 1,
    limbs: types.map((limb, id) => ({
      ...newLayer(),
      id,
      limb,
      limbScale: 1,
      pullPos: [0, 0],
      spriteOrientation: 180,
    })),
    joints: [
      { a: 0, b: 1, anchorA: [0, 0], anchorB: [0, 30], scale: 1 },
      { a: 1, b: 2, anchorA: [0, -30], anchorB: [0, 20], scale: 1 },
      { a: 2, b: 3, anchorA: [0, -20], anchorB: [0, 20], scale: 1 },
      { a: 0, b: 4, anchorA: [0, 0], anchorB: [0, 30], scale: 1 },
      { a: 4, b: 5, anchorA: [0, -30], anchorB: [0, 20], scale: 1 },
      { a: 5, b: 6, anchorA: [0, -20], anchorB: [0, 20], scale: 1 },
    ],
    hair: [],
    heads: [],
  };
}
const preview = { mode: "hold", hand: "right", direction: 0 } as const;

test("melee preparation follows MeleeWeapon's two hitPos rotations, independent of cursor", () => {
  const p = newProject("tool");
  p.holdableType = "MeleeWeapon";
  p.pose = { aimpos: "40,5", holdangle: "30", aimangle: "20" };
  const a = buildHolding(reference(), p, {
    ...preview,
    mode: "aim",
    progress: 1,
    direction: 0,
  });
  const b = buildHolding(reference(), p, {
    ...preview,
    mode: "aim",
    progress: 1,
    direction: 160,
  });
  assert.equal(a.positionRotation, -45);
  assert.equal(a.rotation, -140);
  close(a.at, b.at);
  assert.equal(a.rotation, b.rotation);
  assert.equal(a.frame?.prepare, true);
});
test("melee SwingPos uses physics units and unreachable target keeps item at primary grip", () => {
  const p = newProject("tool");
  p.holdableType = "MeleeWeapon";
  p.melee = {
    swing: true,
    swingPos: [2, 0],
    swingForce: [3, -1],
    reload: 1,
    requireAim: true,
  };
  const f = meleeFrame(p, { ...preview, mode: "swing", progress: 0.5 });
  close(f.vector, [200, 0]);
  assert.equal(f.hit, -67.5);
  const result = buildHolding(reference(), p, {
    ...preview,
    mode: "swing",
    progress: 0.5,
  });
  const h = result.hands.find((h) => h.side === "right")!;
  assert.ok(h.error > 0);
  close(
    itemPointToWorld(markerInItem(p, "handle1"), result.at, result.rotation),
    h.actual,
  );
});
test("melee Swing=false and RequireAimToUse=false retain engine fallbacks", () => {
  const p = newProject("tool");
  p.holdableType = "MeleeWeapon";
  p.melee = {
    swing: false,
    swingPos: [2, 0],
    swingForce: [3, -1],
    reload: 1,
    requireAim: false,
  };
  const frame = meleeFrame(p, { ...preview, mode: "swing", progress: 0 });
  close(frame.vector, [40, -15]);
  assert.equal(frame.hit, 0);
  assert.equal(frame.relativeAngle, 0);
  assert.equal(meleeFrame(p, { ...preview, mode: "aim" }).prepare, false);
});

test("holdpos rotates with holdangle, but never with Item scale", () => {
  const p = newProject("weapon");
  p.pose = { holdpos: "40,10", holdangle: "90" };
  const ref = reference();
  const scene = buildHolding(ref, p, preview);
  close(scene.at, [-10, -40]);
  p.itemScale = 3;
  close(buildHolding(ref, p, preview).at, scene.at);
  close(
    positionFromWorld(scene.at, scene.shoulder, scene.positionRotation),
    [40, 10],
  );
});
test("aimpos rotates with aim direction, not the extra aimangle", () => {
  const p = newProject("weapon");
  p.pose = { aimpos: "40,10", aimangle: "30" };
  const scene = buildHolding(reference(), p, {
    ...preview,
    mode: "aim",
    direction: 90,
  });
  close(scene.at, [-10, -40]);
  assert.equal(scene.rotation, -120);
  close(
    positionFromWorld(scene.at, scene.shoulder, scene.positionRotation),
    [40, 10],
  );
});
test("IK closes all shoulder/elbow/wrist anchors and reaches both grips", () => {
  const ref = reference(),
    p = newProject("weapon");
  p.pose = { holdpos: "40,0" };
  p.handle1 = [-10, 0];
  p.handle2 = [10, 0];
  const scene = buildHolding(ref, p, preview);
  assert.equal(scene.hands.length, 2);
  for (const h of scene.hands) close(h.target, h.actual);
  for (const j of ref.joints) {
    const a = scene.rig.find((p) => p.limb.id === j.a)!,
      b = scene.rig.find((p) => p.limb.id === j.b)!;
    const anchor = (v: Vec, pose: typeof a) =>
      add(pose.position, rotate([v[0] * 0.5, -v[1] * 0.5], pose.rotation));
    close(anchor(j.anchorA, a), anchor(j.anchorB, b));
  }
});
test("unreachable IK clamps arms rather than stretching; no NaNs at zero distance", () => {
  const ref = reference(),
    p = newProject("weapon");
  p.pose = { holdpos: "200,0" };
  p.handle1 = p.handle2 = [0, 0];
  const scene = buildHolding(ref, p, preview);
  assert.ok(scene.hands.every((h) => h.error > 139.9));
  p.pose.holdpos = "1,0";
  p.handle1 = [-2, 0];
  assert.ok(
    buildHolding(ref, p, preview).rig.every((p) =>
      [...p.position, p.rotation].every(Number.isFinite),
    ),
  );
});
test("left one-handed uses H2; changing unheld H1 does not move the arm", () => {
  const p = newProject("tool");
  p.pose = { holdpos: "40,0" };
  p.handle2 = [-5, 0];
  const scene = buildHolding(reference(), p, { ...preview, hand: "left" });
  assert.deepEqual(
    scene.hands.map((h) => h.side),
    ["left"],
  );
  const target = scene.hands[0].target;
  p.handle1 = [500, 500];
  close(
    buildHolding(reference(), p, { ...preview, hand: "left" }).hands[0].target,
    target,
  );
});
test("zero aimpos falls back to hold and zero holdpos follows hand without forcing IK", () => {
  const p = newProject("weapon");
  p.pose = { holdpos: "0,0", aimpos: "0,0", holdangle: "20" };
  const scene = buildHolding(reference(), p, { ...preview, mode: "aim" });
  assert.equal(scene.aim, false);
  assert.equal(scene.followHand, true);
  assert.equal(scene.hands.length, 0);
  const hand = scene.rig.find((p) => p.limb.limb === "RightHand")!;
  close(
    itemPointToWorld(markerInItem(p, "handle1"), scene.at, scene.rotation),
    hand.position,
  );
});
test("aimable and usehandrotation flags retain engine semantics", () => {
  const p = newProject("weapon");
  p.pose = {
    holdpos: "40,0",
    aimpos: "40,0",
    aimable: "false",
    usehandrotationforholdangle: "true",
  };
  assert.equal(buildHolding(reference(), p, preview).followHand, true);
  const scene = buildHolding(reference(), p, {
    ...preview,
    mode: "aim",
    direction: 70,
  });
  assert.equal(scene.rotation, 0);
  assert.equal(scene.followHand, false);
});
test("world marker inverse for weapons and tools at every angle / mirrored display", () => {
  for (const kind of ["weapon", "tool"] as const)
    for (const degrees of [-170, -90, 25, 180])
      for (const facing of [-1, 1]) {
        const p = newProject(kind);
        p.itemScale = 0.23;
        p.barrelRotation = 36;
        const at: Vec = [40, -20];
        for (const key of ["handle1", "handle2", "barrel"] as const) {
          const world = itemPointToWorld(markerInItem(p, key), at, degrees);
          const screen: Vec = [200 + world[0] * 2 * facing, 100 + world[1] * 2];
          const unmirrored: Vec = [
            (screen[0] - 200) / (2 * facing),
            (screen[1] - 100) / 2,
          ];
          close(markerFromWorld(unmirrored, at, degrees, p, key), p[key]);
        }
      }
});
test("drag main artwork changes origin in scaled, rotated local space", () => {
  const delta = rotate([10, -5], 90);
  close(
    itemOriginAfterDrag([0.5, 0.5], [200, 100], 0.25, 90, delta),
    [0.3, 0.7],
  );
});
test("export carries poses, independent Item scale, booleans and single-hand H2", () => {
  const p = newProject("tool");
  p.itemScale = 0.21;
  p.pose = {
    holdpos: "44,-12",
    aimpos: "55,6",
    holdangle: "-32",
    aimangle: "5",
    aimable: "false",
    controlpose: "false",
    usehandrotationforholdangle: "true",
  };
  p.holdableSlots = "Any,LeftHand";
  p.layers[0].texture.uri = "/api/asset/test";
  const doc = new XMLParser({ ignoreAttributes: false }).parse(exportXml(p));
  assert.equal(doc.Items.Item["@_scale"], "0.21");
  assert.equal(doc.Items.Item.Sprite["@_scale"], undefined);
  const h = doc.Items.Item.Holdable;
  for (const [k, v] of Object.entries(p.pose)) assert.equal(h["@_" + k], v);
  assert.equal(h["@_slots"], "Any,LeftHand");
  assert.equal(h["@_handle2"], "20,0");
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  p.twoHanded = true;
  assert.equal(heldSlots(p), "Any,RightHand+LeftHand");
});
test("bad pose values rejected while legacy schema-1 missing fields still load", () => {
  const p = newProject("weapon");
  p.layers[0].texture.uri = "/api/asset/test";
  p.pose = {};
  assert.deepEqual(parseProject(JSON.stringify(p)).pose, {});
  for (const [key, value] of [
    ["holdpos", "NaN,2"],
    ["aimpos", "1,2,3"],
    ["holdangle", ""],
    ["aimable", "yes"],
  ]) {
    const bad = { ...p, pose: { [key]: value } };
    assert.ok(validateProject(bad).length > 0);
    assert.throws(() => parseProject(JSON.stringify(bad)), /持握/);
  }
});
