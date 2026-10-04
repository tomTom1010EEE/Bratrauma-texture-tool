import type {
  Vec,
  Rect,
  Limb,
  Reference,
  SpriteLayer,
  Project,
  Socket,
} from "./model";
export const rotate = ([x, y]: Vec, degrees: number): Vec => {
  const t = (degrees * Math.PI) / 180;
  return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
};
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec, n: number): Vec => [a[0] * n, a[1] * n];
// Image pixel coordinates are top-left/down; XML offsets are pivot-relative/up.
export function pixelToLocal(pixel: Vec, rect: Rect, origin: Vec): Vec {
  return [
    pixel[0] - rect[0] - rect[2] * origin[0],
    rect[3] * origin[1] - (pixel[1] - rect[1]),
  ];
}
export function localToPixel(local: Vec, rect: Rect, origin: Vec): Vec {
  return [
    rect[0] + rect[2] * origin[0] + local[0],
    rect[1] + rect[3] * origin[1] - local[1],
  ];
}
export function markerToPixel(
  v: Vec,
  layer: SpriteLayer,
  project: Project,
  barrel = false,
): Vec {
  return localToPixel(
    barrel && project.kind === "tool"
      ? mul(rotate(v, project.barrelRotation), 1 / project.itemScale)
      : v,
    layer.rect,
    layer.origin,
  );
}
export function pixelToMarker(
  v: Vec,
  layer: SpriteLayer,
  project: Project,
  barrel = false,
): Vec {
  const result = pixelToLocal(v, layer.rect, layer.origin);
  return barrel && project.kind === "tool"
    ? rotate(mul(result, project.itemScale), -project.barrelRotation)
    : result;
}
// Containable.itempos is already in display units. Container.itempos is scaled.
export function socketToPixel(
  s: Socket,
  layer: SpriteLayer,
  project: Project,
): Vec {
  return localToPixel(
    s.source === "container"
      ? s.position
      : mul(s.position, 1 / project.itemScale),
    layer.rect,
    layer.origin,
  );
}
export function pixelToSocket(
  pixel: Vec,
  s: Socket,
  layer: SpriteLayer,
  project: Project,
): Vec {
  const v = pixelToLocal(pixel, layer.rect, layer.origin);
  return s.source === "container" ? v : mul(v, project.itemScale);
}
export interface LimbPose {
  limb: Limb;
  position: Vec;
  rotation: number;
}
export function buildRig(
  ref: Reference,
  pose: "neutral" | "relaxed" = "neutral",
): LimbPose[] {
  const rotations: Record<string, number> =
    pose === "neutral"
      ? {}
      : {
          Torso: 5,
          Head: 0,
          Waist: 5,
          LeftArm: 6,
          RightArm: -5,
          LeftForearm: -6,
          RightForearm: -12,
          LeftHand: -6,
          RightHand: -12,
          LeftThigh: 3,
          RightThigh: -2,
          LeftLeg: 0,
          RightLeg: 0,
        };
  const map = new Map(
    ref.limbs.map((limb) => [
      limb.id,
      { limb, position: [0, 0] as Vec, rotation: rotations[limb.limb] || 0 },
    ]),
  );
  const connected = new Set([
    ref.limbs.find((l) => l.limb === "Torso")?.id ?? 0,
  ]);
  for (let pass = 0; pass < ref.limbs.length; pass++)
    for (const j of ref.joints) {
      const a = map.get(j.a),
        b = map.get(j.b);
      if (!a || !b) continue;
      const factor = j.scale * ref.jointScale;
      // JointScale applies once. A limb's sprite-specific Scale is NOT an anchor multiplier.
      const aa = rotate(
        [j.anchorA[0] * factor, -j.anchorA[1] * factor],
        a.rotation,
      );
      const bb = rotate(
        [j.anchorB[0] * factor, -j.anchorB[1] * factor],
        b.rotation,
      );
      if (connected.has(j.a) && !connected.has(j.b)) {
        b.position = sub(add(a.position, aa), bb);
        connected.add(j.b);
      } else if (connected.has(j.b) && !connected.has(j.a)) {
        a.position = sub(add(b.position, bb), aa);
        connected.add(j.a);
      }
    }
  return [...map.values()];
}
export function wearableTransform(
  layer: SpriteLayer,
  limb: Limb,
  ref: Reference,
) {
  const rect = layer.inheritSourceRect ? limb.rect : layer.rect;
  const originPixels: Vec = layer.inheritOrigin
    ? [limb.rect[2] * limb.origin[0], limb.rect[3] * limb.origin[1]]
    : [rect[2] * layer.origin[0], rect[3] * layer.origin[1]];
  let scale = layer.scale;
  if (layer.inheritScale) {
    if (!layer.ignoreTextureScale) scale *= ref.textureScale;
    if (!layer.ignoreLimbScale) scale *= limb.limbScale;
    if (!layer.ignoreRagdollScale) scale *= ref.limbScale;
  }
  return { rect, originPixels, scale };
}
export function originAfterDrag(
  layer: SpriteLayer,
  limb: Limb,
  ref: Reference,
  worldDelta: Vec,
  bodyRotation: number,
): Vec {
  const { rect, scale } = wearableTransform(layer, limb, ref);
  const local = rotate(worldDelta, -(bodyRotation - layer.rotation));
  return [
    layer.origin[0] - local[0] / (rect[2] * scale),
    layer.origin[1] - local[1] / (rect[3] * scale),
  ];
}
