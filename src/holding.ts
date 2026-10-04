import type { Project, Reference, Vec } from "./model";
import { round } from "./model";
import { twoHandedSlots } from "../shared/equipment.mjs";
import { add, sub, mul, rotate, buildRig, type LimbPose } from "./geometry";

export type HoldPreview = {
  mode: "hold" | "aim" | "swing";
  hand: "right" | "left";
  /** Relative to facing: 0 forwards, positive upwards. Not an XML field. */
  direction: number;
  progress?: number;
};
// MeleeWeapon.Update passes aim=false to HoldItem, including during preparation.
// hitPos is radians; SwingPos is already in physics units (100 display px/unit).
export function meleeFrame(p: Project, preview: HoldPreview) {
  const m = p.melee || {
    swing: true,
    swingPos: [2, 0] as Vec,
    requireAim: true,
    reload: 0.5,
  };
  const progress = Math.max(0, Math.min(1, preview.progress ?? 1));
  const prepare = preview.mode === "aim" && m.requireAim;
  const swing = preview.mode === "swing";
  const start = m.requireAim ? 45 : 0;
  const hit = swing
    ? start - (start + 180) * progress
    : prepare
      ? 45 * progress
      : 0;
  return {
    key: prepare ? "aimpos" : "holdpos",
    vector: prepare
      ? poseVector(p, "aimpos")
      : swing && m.swing
        ? mul(m.swingPos, 100)
        : poseVector(p, "holdpos"),
    holdAngle: prepare || (swing && m.swing) ? hit : poseNumber(p, "holdangle"),
    relativeAngle: prepare
      ? poseNumber(p, "holdangle") + hit + poseNumber(p, "aimangle")
      : swing && m.swing
        ? poseNumber(p, "holdangle")
        : 0,
    prepare,
    swing,
    hit,
  };
}
export const poseVector = (p: Project, key: string): Vec => {
  const v = p.pose[key]?.split(",").map(Number);
  return v?.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : [0, 0];
};
export const poseNumber = (p: Project, key: string) => {
  const n = Number(p.pose[key] || 0);
  return Number.isFinite(n) ? n : 0;
};
export const poseBool = (p: Project, key: string, fallback = false) =>
  p.pose[key] === undefined ? fallback : p.pose[key]?.toLowerCase() === "true";
export const formatPose = (v: number | Vec) =>
  Array.isArray(v) ? v.map((n) => round(n)).join(",") : String(round(v));
export const flipY = (v: Vec): Vec => [v[0], -v[1]];
const length = (v: Vec) => Math.hypot(...v);
const angle = (v: Vec) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;

function joint(ref: Reference, rig: LimbPose[], a: string, b: string) {
  const pa = rig.find((p) => p.limb.limb === a),
    pb = rig.find((p) => p.limb.limb === b);
  if (!pa || !pb) return null;
  const j = ref.joints.find(
    (j) =>
      (j.a === pa.limb.id && j.b === pb.limb.id) ||
      (j.b === pa.limb.id && j.a === pb.limb.id),
  );
  if (!j) return null;
  const factor = ref.jointScale * j.scale;
  return {
    a: pa,
    b: pb,
    localA: mul(flipY(j.a === pa.limb.id ? j.anchorA : j.anchorB), factor),
    localB: mul(flipY(j.a === pa.limb.id ? j.anchorB : j.anchorA), factor),
  };
}
function pullLocal(ref: Reference, p: LimbPose) {
  return mul(flipY(p.limb.pullPos || [0, 0]), ref.limbScale * p.limb.limbScale);
}
export type HandResult = {
  side: "right" | "left";
  shoulder: Vec;
  target: Vec;
  actual: Vec;
  error: number;
  reach: number;
};
/** Static, anchor-preserving two-bone IK. Same elbow branch as HandIK(Dir=1).
 * The engine uses torques + physics; this editor solves the rest pose exactly
 * using each arm's XML anchors and PullPos, without stretching unreachable arms.
 */
function solveArm(
  ref: Reference,
  rig: LimbPose[],
  side: "right" | "left",
  target: Vec,
): HandResult | null {
  const prefix = side === "right" ? "Right" : "Left";
  const shoulder = joint(ref, rig, "Torso", prefix + "Arm");
  const elbow = joint(ref, rig, prefix + "Arm", prefix + "Forearm");
  const wrist = joint(ref, rig, prefix + "Forearm", prefix + "Hand");
  if (!shoulder || !elbow || !wrist) return null;
  const start = add(
    shoulder.a.position,
    rotate(shoulder.localA, shoulder.a.rotation),
  );
  const upperVector = sub(elbow.localA, shoulder.localB);
  // Hand follows forearm rotation, as in AnimController.HandIK.
  const lowerVector = add(
    sub(wrist.localA, elbow.localB),
    sub(pullLocal(ref, wrist.b), wrist.localB),
  );
  const a = length(upperVector),
    b = length(lowerVector),
    delta = sub(target, start);
  const distance = length(delta);
  if (a < 1e-6 || b < 1e-6) return null;
  const d = Math.max(Math.abs(a - b) + 1e-5, Math.min(a + b - 1e-5, distance));
  const theta = distance < 1e-6 ? Math.PI / 2 : Math.atan2(delta[1], delta[0]);
  const alpha = Math.acos(
    Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))),
  );
  const beta = Math.acos(
    Math.max(-1, Math.min(1, (b * b + d * d - a * a) / (2 * b * d))),
  );
  shoulder.b.rotation = ((theta + alpha) * 180) / Math.PI - angle(upperVector);
  shoulder.b.position = sub(
    start,
    rotate(shoulder.localB, shoulder.b.rotation),
  );
  const elbowAt = add(
    shoulder.b.position,
    rotate(elbow.localA, shoulder.b.rotation),
  );
  elbow.b.rotation = ((theta - beta) * 180) / Math.PI - angle(lowerVector);
  elbow.b.position = sub(elbowAt, rotate(elbow.localB, elbow.b.rotation));
  const wristAt = add(elbow.b.position, rotate(wrist.localA, elbow.b.rotation));
  wrist.b.rotation = elbow.b.rotation;
  wrist.b.position = sub(wristAt, rotate(wrist.localB, wrist.b.rotation));
  const actual = add(
    wrist.b.position,
    rotate(pullLocal(ref, wrist.b), wrist.b.rotation),
  );
  return {
    side,
    shoulder: start,
    target,
    actual,
    error: length(sub(actual, target)),
    reach: a + b,
  };
}

export function markerInItem(
  p: Project,
  key: "handle1" | "handle2" | "barrel",
): Vec {
  return flipY(
    key === "barrel" && p.kind === "tool"
      ? rotate(p.barrel, p.barrelRotation)
      : mul(p[key], p.itemScale),
  );
}
export function itemPointToWorld(local: Vec, at: Vec, rotation: number): Vec {
  return add(at, rotate(local, rotation));
}
export function worldToItemPoint(world: Vec, at: Vec, rotation: number): Vec {
  return rotate(sub(world, at), -rotation);
}
export function markerFromWorld(
  world: Vec,
  at: Vec,
  rotation: number,
  p: Project,
  key: "handle1" | "handle2" | "barrel",
): Vec {
  const local = flipY(worldToItemPoint(world, at, rotation));
  return key === "barrel" && p.kind === "tool"
    ? rotate(local, -p.barrelRotation)
    : mul(local, 1 / p.itemScale);
}
export function positionFromWorld(
  world: Vec,
  shoulder: Vec,
  positionRotation: number,
): Vec {
  return flipY(rotate(sub(world, shoulder), -positionRotation));
}
/** Artwork movement leaves body / handles fixed and changes normalized Sprite.origin. */
export function itemOriginAfterDrag(
  origin: Vec,
  size: Vec,
  scale: number,
  rotation: number,
  delta: Vec,
): Vec {
  const local = rotate(delta, -rotation);
  return [
    origin[0] - local[0] / (size[0] * scale),
    origin[1] - local[1] / (size[1] * scale),
  ];
}
export function heldSlots(p: Project): string {
  if (
    p.holdableSlots &&
    /RightHand|LeftHand/i.test(p.holdableSlots) &&
    twoHandedSlots(p.holdableSlots) === p.twoHanded
  )
    return p.holdableSlots;
  return p.twoHanded ? "Any,RightHand+LeftHand" : "Any,RightHand,LeftHand";
}

export function buildHolding(
  ref: Reference,
  p: Project,
  preview: HoldPreview,
  bodyPose: "neutral" | "relaxed" = "neutral",
) {
  const rig = buildRig(ref, bodyPose);
  const activeSides: ("right" | "left")[] = p.twoHanded
    ? ["right", "left"]
    : [preview.hand];
  const primary = p.twoHanded ? "right" : preview.hand;
  const shoulderSide = p.twoHanded
    ? "Left"
    : primary === "right"
      ? "Right"
      : "Left";
  const sj = joint(ref, rig, "Torso", shoulderSide + "Arm");
  const shoulder: Vec = sj
    ? add(sj.a.position, rotate(sj.localA, sj.a.rotation))
    : [0, 0];
  const torsoRotation = rig.find((l) => l.limb.limb === "Torso")?.rotation || 0;
  const melee = p.holdableType === "MeleeWeapon";
  const frame = melee ? meleeFrame(p, preview) : null;
  const aim = melee
    ? !!frame?.prepare
    : preview.mode === "aim" && length(poseVector(p, "aimpos")) > 0;
  const key = frame?.key ?? (aim ? "aimpos" : "holdpos");
  const vector = frame?.vector ?? poseVector(p, key);
  const followHand =
    length(vector) === 0 ||
    ((melee || !aim) && poseBool(p, "usehandrotationforholdangle"));
  const hand = rig.find(
    (l) => l.limb.limb === (primary === "right" ? "RightHand" : "LeftHand"),
  );
  let positionRotation = frame
    ? torsoRotation - frame.holdAngle
    : aim
      ? poseBool(p, "aimable", true)
        ? -preview.direction
        : torsoRotation
      : torsoRotation - poseNumber(p, "holdangle");
  let rotation =
    positionRotation -
    (frame ? frame.relativeAngle : aim ? poseNumber(p, "aimangle") : 0);
  let at: Vec = add(shoulder, rotate(flipY(vector), positionRotation));
  const notes: string[] = [];
  if (!sj) notes.push("缺少肩部关节，无法可靠求解持握。");
  if (!melee && preview.mode === "aim" && !aim)
    notes.push("aimpos=0,0：游戏会退回静态持握，未启用瞄准姿态。");
  if (!melee && aim && !poseBool(p, "aimable", true))
    notes.push("aimable=false：瞄准时方向跟随躯干，不跟随准星。");
  if (followHand && hand) {
    rotation = hand.rotation - (frame?.holdAngle ?? poseNumber(p, "holdangle"));
    if (length(vector) === 0)
      rotation += (hand.limb.spriteOrientation ?? 180) - 90;
    rotation -= frame?.relativeAngle ?? 0;
    positionRotation = rotation;
    const pull = add(
      hand.position,
      rotate(pullLocal(ref, hand), hand.rotation),
    );
    at = sub(
      pull,
      rotate(
        markerInItem(p, primary === "right" ? "handle1" : "handle2"),
        rotation,
      ),
    );
    notes.push(
      "自由随手模式：物品跟随参考手臂，未强制持握 IK；启用非零 holdpos 并关闭随手旋转可拖调位置。",
    );
  }
  const slots = heldSlots(p);
  if (!p.twoHanded && !slots.toLowerCase().includes(preview.hand + "hand"))
    notes.push("当前 XML slots 不允许此手；这是对照预览，导出前请调整槽位。");
  const hands: HandResult[] = [];
  if (!followHand)
    for (const side of activeSides) {
      const target = itemPointToWorld(
        markerInItem(p, side === "right" ? "handle1" : "handle2"),
        at,
        rotation,
      );
      const solved = solveArm(ref, rig, side, target);
      if (solved) hands.push(solved);
      else
        notes.push(
          `${side === "right" ? "右" : "左"}臂关节不完整，无法求解 IK。`,
        );
    }
  if (melee) {
    notes.push(
      "近战按 MeleeWeapon 准备/挥击分支预览，不追踪枪械准星；显示关节目标姿态，不模拟物理惯性/受力/碰撞。",
    );
    // The engine places the item at the actual primary-hand anchor, not at an
    // unreachable SwingPos target. Keep the weapon in the hand when IK saturates.
    const primaryHand = hands.find((h) => h.side === primary);
    if (primaryHand && primaryHand.error > 0.01) {
      at = sub(
        primaryHand.actual,
        rotate(
          markerInItem(p, primary === "right" ? "handle1" : "handle2"),
          rotation,
        ),
      );
      for (const side of activeSides.filter((s) => s !== primary)) {
        const solved = solveArm(
          ref,
          rig,
          side,
          itemPointToWorld(
            markerInItem(p, side === "right" ? "handle1" : "handle2"),
            at,
            rotation,
          ),
        );
        const index = hands.findIndex((h) => h.side === side);
        if (solved && index >= 0) hands[index] = solved;
      }
    }
  }
  return {
    rig,
    at,
    rotation,
    positionRotation,
    shoulder,
    key,
    aim,
    followHand,
    hands,
    notes,
    melee,
    frame,
  };
}
