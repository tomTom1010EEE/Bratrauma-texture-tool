import type { Project } from "../src/model";
export function combinedSlots(
  wearableSlots?: string,
  holdableSlots?: string,
): boolean;
export function twoHandedSlots(slots?: string): boolean;
export function isCombinedEquipment(project: Project): boolean;
export function hasHolding(project: Project): boolean;
export function equipmentPreview(
  project: Project,
  itemOnly?: boolean,
): {
  combined: boolean;
  holding: boolean;
  itemSprite: boolean;
  wearables: boolean;
};
