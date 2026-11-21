import { generateKey, listKeys, revokeKey, KEY_FILE } from "./keys.mjs";

const args = process.argv.slice(2);
const flagValue = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("--list")) {
  const keys = listKeys();
  if (!keys.length) console.log("No API keys yet. Create one: npm run mcp:keygen");
  for (const k of keys) console.log(`${k.id}  ${k.label}  created ${k.createdAt}`);
} else if (args.includes("--revoke")) {
  const id = flagValue("--revoke");
  if (!id) { console.error("usage: npm run mcp:keygen -- --revoke <id|label>"); process.exit(1); }
  if (revokeKey(id)) console.log(`Revoked ${id}`);
  else { console.error(`No key found for "${id}". Use --list to see keys.`); process.exit(1); }
} else {
  const { key, entry } = generateKey(flagValue("--label") || "");
  console.log(`API key created (${entry.id}, ${entry.label})`);
  console.log("");
  console.log(`  ${key}`);
  console.log("");
  console.log("Store it now — only a hash is kept, so it cannot be shown again.");
  console.log("");
  console.log("Use it:");
  console.log(`  stdio MCP : set env LUCKYDRAW_API_KEY=${key} when launching "npm run mcp"`);
  console.log("  HTTP MCP  : POST /mcp with header  Authorization: Bearer <key>");
  console.log(`Key file: ${KEY_FILE}`);
}