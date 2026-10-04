export type Vec = [number, number];
export type Rect = [number, number, number, number];
export type Role = "item" | "wearable" | "decorative" | "contained" | "icon";
export interface Texture {
  uri: string;
  xmlPath: string;
  name: string;
  relative?: string;
}
export interface SpriteLayer {
  id: string;
  name: string;
  role: Role;
  texture: Texture;
  rect: Rect;
  origin: Vec;
  scale: number;
  rotation: number;
  depth: number;
  offset: Vec;
  limb: string;
  depthLimb: string;
  inheritScale: boolean;
  ignoreLimbScale: boolean;
  ignoreTextureScale: boolean;
  ignoreRagdollScale: boolean;
  inheritOrigin: boolean;
  inheritSourceRect: boolean;
  inheritLimbDepth: boolean;
  hideLimb: boolean;
  hideOtherWearables: boolean;
  canBeHidden: boolean;
  visible: boolean;
  opacity: number;
  export: boolean;
  extra?: Record<string, string>;
  sourceAttributes?: Record<string, string>;
  sourcePath?: string;
}
export interface Socket {
  id: string;
  name: string;
  position: Vec;
  rotation: number;
  depth: number;
  items: string;
  source: string;
  sourcePath?: string;
  containerPath?: string;
  slotGroup?: string;
  depthEditable?: boolean;
  declaredPosition?: boolean;
  excludedIdentifiers?: string;
  containerRotation?: number;
  filterAttribute?: "items" | "tags";
  hidden?: boolean;
  sourceAttributes?: Record<string, string>;
  preview?: {
    identifier: string;
    scale: number;
    layers: SpriteLayer[];
    selected: string;
  };
}
export interface Project {
  schemaVersion: 1;
  name: string;
  identifier: string;
  kind: "weapon" | "tool" | "clothing";
  itemScale: number;
  slots: string;
  twoHanded: boolean;
  holdableType: string;
  holdableSlots?: string;
  weaponComponent?: "RangedWeapon" | "SwitchableRangedWeapon";
  handle1: Vec;
  handle2: Vec;
  barrel: Vec;
  hasBarrel: boolean;
  barrelRotation: number;
  pose: Record<string, string | undefined>;
  melee?: {
    swing: boolean;
    swingPos: Vec;
    swingForce: Vec;
    reload: number;
    requireAim: boolean;
  };
  body?: { width: number; height: number; radius: number };
  tags?: string;
  posePresets?: {
    name: string;
    source: string;
    values: Record<string, string>;
  }[];
  layers: SpriteLayer[];
  sockets: Socket[];
  warnings: string[];
  source?: {
    file: string;
    mod: string;
    workshopId: string;
    rootId?: string;
    originalId?: string;
    token?: string;
    fingerprint?: string;
    writable?: boolean;
    reason?: string;
  };
}
export interface Limb extends Omit<SpriteLayer, "id" | "role"> {
  id: number;
  limbScale: number;
  pullPos?: Vec;
  spriteOrientation?: number;
}
export interface Reference {
  name: string;
  workshopId: string;
  file: string;
  gender: string;
  limbScale: number;
  jointScale: number;
  textureScale: number;
  limbs: Limb[];
  joints: { a: number; b: number; anchorA: Vec; anchorB: Vec; scale: number }[];
  hair: (SpriteLayer & { group: string })[];
  heads: { name: string; index: Vec }[];
}
export interface Root {
  id: string;
  path: string;
  name: string;
  workshopId: string;
  writable?: boolean;
  reason?: string;
}
export interface Library {
  textures: Texture[];
  items: {
    id: string;
    name: string;
    file: string;
    relative: string;
    kind: string;
    tags?: string;
  }[];
  errors: { file: string; message: string }[];
}
export const limbNames = [
  "Head",
  "Torso",
  "Waist",
  "RightArm",
  "RightForearm",
  "RightHand",
  "LeftArm",
  "LeftForearm",
  "LeftHand",
  "RightThigh",
  "RightLeg",
  "RightFoot",
  "LeftThigh",
  "LeftLeg",
  "LeftFoot",
];
export const limbLabels: Record<string, string> = {
  Head: "头部",
  Torso: "躯干",
  Waist: "腰部",
  RightArm: "右上臂",
  RightForearm: "右前臂",
  RightHand: "右手",
  LeftArm: "左上臂",
  LeftForearm: "左前臂",
  LeftHand: "左手",
  RightThigh: "右大腿",
  RightLeg: "右小腿",
  RightFoot: "右脚",
  LeftThigh: "左大腿",
  LeftLeg: "左小腿",
  LeftFoot: "左脚",
};
export const roleLabels: Record<Role, string> = {
  item: "物品主贴图",
  wearable: "穿戴贴图",
  decorative: "装饰 / 配件",
  contained: "收纳贴图",
  icon: "物品栏图标",
};
export function newLayer(
  role: Role = "wearable",
  texture?: Texture,
): SpriteLayer {
  return {
    id: crypto.randomUUID(),
    name: roleLabels[role],
    role,
    texture: texture || {
      uri: "",
      xmlPath: "%ModDir%/gears/texture.png",
      name: "选择贴图",
    },
    rect: [0, 0, 128, 128],
    origin: [0.5, 0.5],
    scale: role === "wearable" ? 0.5 : 1,
    rotation: 0,
    depth: 0.55,
    offset: [0, 0],
    limb: "Torso",
    depthLimb: "None",
    inheritScale: false,
    ignoreLimbScale: false,
    ignoreTextureScale: false,
    ignoreRagdollScale: false,
    inheritOrigin: false,
    inheritSourceRect: false,
    inheritLimbDepth: true,
    hideLimb: false,
    hideOtherWearables: false,
    canBeHidden: false,
    visible: true,
    opacity: 1,
    export: true,
  };
}
export function newProject(kind: Project["kind"] = "clothing"): Project {
  return {
    schemaVersion: 1,
    name: "未命名标定",
    identifier: "calibrated_item",
    kind,
    itemScale: 0.5,
    slots: "OuterClothes",
    twoHanded: kind !== "tool",
    holdableType: "Holdable",
    handle1: [-20, -10],
    handle2: [20, 0],
    barrel: [60, 0],
    hasBarrel: kind !== "clothing",
    barrelRotation: 0,
    pose:
      kind === "clothing"
        ? {}
        : {
            holdpos: "40,-15",
            aimpos: "45,0",
            holdangle: "-25",
            aimangle: "0",
            aimable: "true",
            controlpose: "true",
            usehandrotationforholdangle: "false",
          },
    layers: [newLayer(kind === "clothing" ? "wearable" : "item")],
    sockets: [],
    warnings: [],
  };
}
export const round = (n: number, digits = 4) => Number(n.toFixed(digits));
