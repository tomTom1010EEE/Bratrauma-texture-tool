// Diagnostic client: exercises the real stdio MCP transport, never direct UI internals.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const client = new Client({ name: "sprite-lab-diagnostic", version: "0.4.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(workspace, "server/mcp.mjs")],
  env: {
    SPRITE_LAB_PORT: process.env.SPRITE_LAB_PORT || "4317",
    ...(process.env.SPRITE_LAB_RUNTIME
      ? { SPRITE_LAB_RUNTIME: process.env.SPRITE_LAB_RUNTIME }
      : {}),
  },
  stderr: "inherit",
});
try {
  await client.connect(transport);
  const name = process.argv[2] || "get_status";
  if (name === "--list")
    console.log(JSON.stringify(await client.listTools(), null, 2));
  else {
    let input = process.argv[3] || "{}";
    if (input === "-") {
      input = "";
      for await (const chunk of process.stdin) input += chunk;
    }
    const result = await client.callTool({
      name,
      arguments: JSON.parse(input),
    });
    for (const block of result.content) {
      if (block.type === "text") console.log(block.text);
      if (block.type === "image") {
        const target = path.join(workspace, ".local", "mcp-preview.png");
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, Buffer.from(block.data, "base64"));
        console.log(JSON.stringify({ imageSaved: target }));
      }
    }
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
