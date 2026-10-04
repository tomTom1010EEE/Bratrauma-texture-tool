import type { Project, Socket, SpriteLayer, Vec } from "./model";
export function attachmentMatches(
  s: Socket,
  item: { id: string; tags?: string },
) {
  const tokens = s.items
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const values = [
    item.id.toLowerCase(),
    ...(item.tags || "")
      .toLowerCase()
      .split(",")
      .map((t) => t.trim()),
  ];
  return (
    !s.excludedIdentifiers
      ?.toLowerCase()
      .split(",")
      .map((v) => v.trim())
      .includes(item.id.toLowerCase()) &&
    (!tokens.length || tokens.some((t) => values.includes(t)))
  );
}
export function attachmentPosition(s: Socket, p: Project): Vec {
  return [
    s.position[0] * (s.source === "container" ? p.itemScale : 1),
    -s.position[1] * (s.source === "container" ? p.itemScale : 1),
  ];
}
export const attachmentRotation = (s: Socket) =>
  s.rotation || s.containerRotation || 0;
export function chooseAttachmentLayer(layers: SpriteLayer[], p: Project) {
  const tags = (p.tags || "")
    .toLowerCase()
    .split(",")
    .map((v) => v.trim());
  const id = (p.source?.originalId || p.identifier).toLowerCase();
  return (
    layers.find(
      (l) =>
        l.role === "contained" &&
        (l.extra?.allowedcontaineridentifiers
          ?.toLowerCase()
          .split(",")
          .includes(id) ||
          l.extra?.allowedcontainertags
            ?.toLowerCase()
            .split(",")
            .some((v) => tags.includes(v))),
    ) ||
    layers.find((l) => l.role === "item") ||
    layers[0]
  );
}
