import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log(
  JSON.stringify(
    {
      mcpServers: {
        "abyss-sprite-lab": {
          command: process.execPath,
          args: [path.join(root, "server/mcp.mjs")],
          env: { SPRITE_LAB_PORT: process.env.SPRITE_LAB_PORT || "4317" },
        },
      },
    },
    null,
    2,
  ),
);
