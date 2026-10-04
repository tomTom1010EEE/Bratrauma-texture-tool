// Holdable.Equip keeps Wearable active only for equal AllowedSlots sequences.
// '+' is one simultaneous slot set; ',' separates alternative sets.
const slotSets = (value) =>
  typeof value === "string" && value.trim()
    ? value
        .toLowerCase()
        .split(",")
        .map((group) =>
          [...new Set(group.split("+").map((slot) => slot.trim()))].sort(),
        )
    : [];

export function combinedSlots(wearableSlots, holdableSlots) {
  const worn = slotSets(wearableSlots),
    held = slotSets(holdableSlots);
  return (
    worn.length > 0 &&
    JSON.stringify(worn) === JSON.stringify(held) &&
    worn.some(
      (set) =>
        set.some((slot) => slot === "righthand" || slot === "lefthand") &&
        set.some((slot) =>
          ["outerclothes", "innerclothes", "head", "headset", "bag"].includes(
            slot,
          ),
        ),
    )
  );
}

export function twoHandedSlots(slots) {
  return slotSets(slots).some(
    (set) => set.includes("righthand") && set.includes("lefthand"),
  );
}

// Derive from schema-1 fields so already-imported projects also gain the fix.
export function isCombinedEquipment(project) {
  return (
    project.layers.some((layer) => layer.role === "wearable") &&
    combinedSlots(project.slots, project.holdableSlots)
  );
}

export function hasHolding(project) {
  return project.kind !== "clothing" || isCombinedEquipment(project);
}

export function equipmentPreview(project, itemOnly = false) {
  const combined = isCombinedEquipment(project);
  return {
    combined,
    holding: hasHolding(project) && !itemOnly,
    // Item.Draw does not draw the in-hand Item when its Wearable is active.
    itemSprite: hasHolding(project) && (itemOnly || !combined),
    wearables: !itemOnly && (project.kind === "clothing" || combined),
  };
}
