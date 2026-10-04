import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentMatches,
  attachmentPosition,
  attachmentRotation,
  chooseAttachmentLayer,
} from "../src/attachments";
import { newProject, newLayer, type Socket } from "../src/model";
const socket: Socket = {
  id: "scope",
  name: "scope",
  position: [-14, 16.5],
  rotation: 0,
  containerRotation: 20,
  items: "scope, optics",
  excludedIdentifiers: "bad, blocked",
  source: "containable",
  depth: -1,
};
test("attachment filter supports identifiers, tags, exclusions and unrestricted container preview", () => {
  assert.ok(attachmentMatches(socket, { id: "scope" }));
  assert.ok(
    attachmentMatches(socket, { id: "red-dot", tags: "smallitem, optics" }),
  );
  assert.ok(!attachmentMatches(socket, { id: "blocked", tags: "optics" }));
  assert.ok(!attachmentMatches(socket, { id: "knife" }));
  assert.ok(
    attachmentMatches(
      { ...socket, items: "", source: "container" },
      { id: "any" },
    ),
  );
});
test("container coordinates scale with parent, Containable coordinates do not; zero rotation inherits", () => {
  const p = newProject("weapon");
  p.itemScale = 0.25;
  assert.deepEqual(attachmentPosition(socket, p), [-14, -16.5]);
  assert.deepEqual(
    attachmentPosition({ ...socket, source: "container" }, p),
    [-3.5, -4.125],
  );
  assert.equal(attachmentRotation(socket), 20);
  assert.equal(attachmentRotation({ ...socket, rotation: 10 }), 10);
});
test("matching ContainedSprite is selected only for its parent; normal sprite is fallback", () => {
  const p = newProject("weapon");
  p.tags = "gun,rifle";
  const main = newLayer("item"),
    special = newLayer("contained");
  special.extra = { allowedcontainertags: "rifle" };
  assert.equal(chooseAttachmentLayer([main, special], p).id, special.id);
  p.tags = "pistol";
  assert.equal(chooseAttachmentLayer([main, special], p).id, main.id);
});
