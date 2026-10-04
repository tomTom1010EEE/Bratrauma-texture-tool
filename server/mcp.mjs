// Protocol-only stdio process. The existing local service owns imports, editor
// sessions and save proposals; never create a second disconnected state store.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { toolDefinitions, VERSION } from "../shared/mcp-contract.mjs";

const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const port = Number(process.env.SPRITE_LAB_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid SPRITE_LAB_PORT");
const runtime =
  process.env.SPRITE_LAB_RUNTIME || path.join(workspace, ".local");
export const server = new McpServer({
  name: "abyss-sprite-lab",
  version: VERSION,
});
for (const t of toolDefinitions)
  server.registerTool(
    t.name,
    {
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: {
        readOnlyHint: t.readOnly,
        destructiveHint: !t.readOnly,
        idempotentHint:
          t.readOnly && !["preview_save", "load_item"].includes(t.name),
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        // Read on each call: service restart rotates the token without restarting MCP.
        const cfg = JSON.parse(
          await fs.readFile(path.join(runtime, `mcp-${port}.json`), "utf8"),
        );
        if (cfg.url !== `http://127.0.0.1:${port}`)
          throw new Error("Invalid local service address");
        const response = await fetch(cfg.url + "/api/mcp/call", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.token}`,
          },
          body: JSON.stringify({ name: t.name, arguments: args }),
          signal: AbortSignal.timeout(45000),
        });
        const value = await response.json();
        if (!response.ok)
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(value) }],
          };
        if (value.image) {
          const { image, ...metadata } = value;
          return {
            content: [
              { type: "image", data: image, mimeType: "image/png" },
              { type: "text", text: JSON.stringify(metadata) },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(value) }],
          structuredContent: value,
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({
                code: "SERVICE_UNAVAILABLE",
                error: "请先启动 Sprite Lab 本地服务。" + e.message,
              }),
            },
          ],
        };
      }
    },
  );
await server.connect(new StdioServerTransport());
