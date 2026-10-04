import test from "node:test";
import assert from "node:assert/strict";
import { XMLParser } from "fast-xml-parser";
import {
  combinedSlots,
  equipmentPreview,
  isCombinedEquipment,
  twoHandedSlots,
} from "../shared/equipment.mjs";
import { newLayer, newProject } from "../src/model";
import { calibrationXml, exportXml, parseProject } from "../src/exporter";
import { heldSlots } from "../src/holding";

test("compound detection compares slot sets, not item names or separate alternatives", () => {
  assert.ok(
    combinedSlots("OuterClothes+RightHand", "righthand + outerclothes"),
  );
  assert.ok(
    combinedSlots("Any,OuterClothes+RightHand", "Any,RightHand+OuterClothes"),
  );
  for (const [w, h] of [
    ["OuterClothes", "Any,RightHand,LeftHand"],
    ["OuterClothes,RightHand", "OuterClothes,RightHand"],
    ["OuterClothes+RightHand", "Any,OuterClothes+RightHand"],
    ["RightHand+LeftHand", "LeftHand+RightHand"],
    ["", ""],
  ])
    assert.equal(combinedSlots(w, h), false, `${w} / ${h}`);
});

function compound() {
  const p = newProject("weapon");
  p.slots = p.holdableSlots = "OuterClothes+RightHand";
  p.twoHanded = false;
  p.layers.push({
    ...newLayer("wearable"),
    name: "cannon",
    limb: "RightForearm",
  });
  p.layers.push({ ...newLayer("wearable"), name: "hull", limb: "Torso" });
  p.layers.forEach((l) => (l.texture.uri = "/api/asset/fixture"));
  return p;
}

test("compound equipped view hides ground sprite, keeps wearables and live IK without mutating layers", () => {
  const p = compound(),
    original = structuredClone(p);
  assert.deepEqual(equipmentPreview(p), {
    combined: true,
    holding: true,
    itemSprite: false,
    wearables: true,
  });
  assert.deepEqual(equipmentPreview(p, true), {
    combined: true,
    holding: false,
    itemSprite: true,
    wearables: false,
  });
  assert.deepEqual(p, original);
  assert.equal(equipmentPreview(newProject("weapon")).itemSprite, true);
  assert.equal(equipmentPreview(newProject("clothing")).wearables, true);
  p.holdableSlots = "Any,RightHand,LeftHand";
  assert.equal(isCombinedEquipment(p), false);
  assert.equal(equipmentPreview(p).wearables, false);
});

test("old schema-1 clothing-classified compound exposes holding and exports both components", () => {
  const p = compound();
  p.kind = "clothing";
  const loaded = parseProject(JSON.stringify(p));
  assert.equal(equipmentPreview(loaded).holding, true);
  const parser = new XMLParser({ ignoreAttributes: false });
  for (const xml of [exportXml(loaded), calibrationXml(loaded)]) {
    const doc = parser.parse(xml),
      item = doc.Items?.Item ?? doc.Item;
    assert.equal(item.Holdable["@_slots"], "OuterClothes+RightHand");
    assert.equal(item.Wearable["@_slots"], "OuterClothes+RightHand");
    assert.equal(item.Wearable.sprite.length, 2);
    assert.equal(item.Sprite["@_sourcerect"], loaded.layers[0].rect.join(","));
  }
});

test("both hands plus clothing slots retain the full compound slot expression", () => {
  const p = compound();
  p.slots = p.holdableSlots = "LeftHand+OuterClothes+RightHand";
  p.twoHanded = true;
  assert.ok(twoHandedSlots(p.slots));
  assert.equal(heldSlots(p), p.slots);
  assert.equal(isCombinedEquipment(p), true);
});
