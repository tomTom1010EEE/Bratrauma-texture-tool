import test from "node:test";
import assert from "node:assert/strict";
import { XMLValidator } from "fast-xml-parser";
import {
  newLayer,
  newProject,
  type Limb,
  type Reference,
  type Socket,
} from "../src/model";
import {
  pixelToLocal,
  localToPixel,
  markerToPixel,
  pixelToMarker,
  pixelToSocket,
  socketToPixel,
  buildRig,
  wearableTransform,
  originAfterDrag,
  add,
  rotate,
} from "../src/geometry";
import { exportXml, parseProject, validateProject } from "../src/exporter";

const close = (a: number[], b: number[]) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-8, `${a} != ${b}`));
function reference(): Reference {
  const torso = {
    ...newLayer(),
    id: 0,
    limb: "Torso",
    rect: [0, 0, 112, 192],
    origin: [0.5, 0.5],
    limbScale: 1,
  } as Limb;
  const head = {
    ...newLayer(),
    id: 1,
    limb: "Head",
    rect: [0, 0, 160, 228],
    origin: [0.6125, 0.33],
    limbScale: 0.5,
  } as Limb;
  return {
    name: "fixture",
    workshopId: "2809175631",
    file: "fixture",
    gender: "female",
    limbScale: 0.5,
    jointScale: 0.5,
    textureScale: 1,
    limbs: [torso, head],
    joints: [{ a: 0, b: 1, anchorA: [0, 80], anchorB: [0, -20], scale: 1 }],
    hair: [],
    heads: [],
  };
}
test("atlas / origin coordinates: Y up and origins outside 0..1", () => {
  close(pixelToLocal([250, 55], [100, 20, 200, 100], [0.5, 0.5]), [50, 15]);
  close(localToPixel([50, 15], [100, 20, 200, 100], [0.5, 0.5]), [250, 55]);
  close(pixelToLocal([0, 0], [0, 0, 100, 100], [1.1, -0.2]), [-110, -20]);
});
test("weapon handles and muzzle remain unscaled XML pixels", () => {
  const p = newProject("weapon");
  p.itemScale = 0.25;
  const l = p.layers[0];
  l.rect = [16, 353, 481, 108];
  close(markerToPixel([241, 24], l, p, true), [497.5, 383]);
  close(pixelToMarker([497.5, 383], l, p, true), [241, 24]);
});
test("RepairTool muzzle is display pixels, including barrelrotation", () => {
  const p = newProject("tool");
  p.itemScale = 0.25;
  const l = p.layers[0];
  l.rect = [0, 0, 100, 100];
  close(markerToPixel([10, 0], l, p, true), [90, 50]);
  p.barrelRotation = 90;
  close(markerToPixel([10, 0], l, p, true), [50, 10]);
  close(pixelToMarker([50, 10], l, p, true), [10, 0]);
});
test("DDA nested Containable positions are not multiplied by Item scale", () => {
  const p = newProject("weapon");
  p.itemScale = 0.25;
  const l = p.layers[0];
  l.rect = [16, 353, 481, 108];
  const s: Socket = {
    id: "scope",
    name: "scope",
    source: "containable",
    position: [-14, 16.5],
    rotation: 0,
    depth: -1,
    items: "scope",
  };
  close(socketToPixel(s, l, p), [200.5, 341]);
  close(pixelToSocket([200.5, 341], s, l, p), [-14, 16.5]);
  s.source = "container";
  close(socketToPixel(s, l, p), [242.5, 390.5]);
});
test("ragdoll joint scaling applies once, independent of sprite limb scale", () => {
  const ref = reference();
  const rig = buildRig(ref);
  close(rig[1].position, [0, -50]);
  ref.limbs[1].limbScale = 0.01;
  close(buildRig(ref)[1].position, [0, -50]);
});
test("reference joints still close in rotated static pose", () => {
  const ref = reference();
  const rig = buildRig(ref, "relaxed");
  for (const j of ref.joints) {
    const a = rig.find((p) => p.limb.id === j.a)!,
      b = rig.find((p) => p.limb.id === j.b)!;
    close(
      add(
        a.position,
        rotate(
          [j.anchorA[0] * ref.jointScale, -j.anchorA[1] * ref.jointScale],
          a.rotation,
        ),
      ),
      add(
        b.position,
        rotate(
          [j.anchorB[0] * ref.jointScale, -j.anchorB[1] * ref.jointScale],
          b.rotation,
        ),
      ),
    );
  }
});
test("wearable scale and inherited pixel origin match Limb rules", () => {
  const ref = reference(),
    head = ref.limbs[1],
    l = newLayer();
  l.rect = [0, 0, 300, 400];
  l.scale = 0.8;
  assert.equal(wearableTransform(l, head, ref).scale, 0.8);
  l.inheritScale = true;
  l.inheritOrigin = true;
  const t = wearableTransform(l, head, ref);
  assert.equal(t.scale, 0.2);
  close(t.originPixels, [98, 75.24]);
  l.ignoreLimbScale = true;
  assert.equal(wearableTransform(l, head, ref).scale, 0.4);
});
test("drag wearable converts translation into unbounded normalized origin", () => {
  const ref = reference(),
    l = newLayer();
  l.rect = [0, 0, 100, 200];
  l.scale = 0.5;
  close(originAfterDrag(l, ref.limbs[0], ref, [10, -20], 0), [0.3, 0.7]);
  close(originAfterDrag(l, ref.limbs[0], ref, [20, 10], 90), [0.3, 0.7]);
});
test("export a single XML Item, stripped of gameplay; preserve visual flags", () => {
  const p = newProject("weapon");
  p.name = 'A&B "test"';
  p.weaponComponent = "SwitchableRangedWeapon";
  p.layers[0].texture = {
    uri: "/api/asset/test",
    xmlPath: "%ModDir%/gun.png",
    name: "gun",
  };
  p.layers[0].sourceAttributes = { damage: "99" };
  p.sockets = [
    {
      id: "s",
      name: "muzzle",
      source: "containable",
      position: [58, 6],
      rotation: 5,
      depth: 0.1,
      items: "muzzle_tag",
      filterAttribute: "tags",
      sourcePath: "ItemContainer[0]/SubContainer[3]",
    },
  ];
  const xml = exportXml(p);
  assert.equal(XMLValidator.validate(xml), true);
  assert.equal((xml.match(/<Item /g) || []).length, 1);
  assert.match(xml, /<SwitchableRangedWeapon barrelpos=/);
  assert.match(
    xml,
    /<Containable tags="muzzle_tag" itempos="58,6" rotation="5" hide="false"/,
  );
  assert.match(xml, /containedspritedepth="0.1"/);
  assert.doesNotMatch(xml, /damage="99"|StatusEffect|<Lua/);
  assert.match(xml, /name="A&amp;B &quot;test&quot;"/);
  assert.deepEqual(validateProject(p), []);
});
test("JSON projects reject malformed coordinates or external image URLs", () => {
  const p = newProject();
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  p.layers[0].texture.uri = "https://untrusted.example/image.png";
  assert.throws(() => parseProject(JSON.stringify(p)), /不支持的贴图地址/);
  p.layers[0].texture.uri = "";
  p.handle1 = [NaN, 0];
  assert.throws(() => parseProject(JSON.stringify(p)), /项目参数损坏/);
});
