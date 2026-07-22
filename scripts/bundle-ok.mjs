import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "ok-build");

if (existsSync(outDir)) {
  await rm(outDir, { recursive: true, force: true });
}
await mkdir(outDir, { recursive: true });

const toCopy = [
  "index.html",
  "styles.css",
  "game.js",
  "game-config.js",
  "vk-bridge.js",
  "vk-ads-entry.js",
];
for (const file of toCopy) {
  await cp(path.join(root, file), path.join(outDir, file));
}

const vendorDir = path.join(outDir, "vendor");
await mkdir(vendorDir, { recursive: true });
const bridgeCandidates = [
  path.join(root, "vendor", "vk-bridge.min.js"),
  path.join(root, "node_modules", "@vkontakte", "vk-bridge", "dist", "browser.min.js"),
];
const bridgeSrc = bridgeCandidates.find((p) => existsSync(p));
if (!bridgeSrc) {
  throw new Error("vk-bridge not found: run npm install @vkontakte/vk-bridge");
}
await cp(bridgeSrc, path.join(vendorDir, "vk-bridge.min.js"));

console.log(`\nOK: ok-build prepared (VK Bridge)\n- ${outDir}\n`);
