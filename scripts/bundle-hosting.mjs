import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "hosting-build");

// Recreate a clean hosting-build/
if (existsSync(outDir)) {
  await rm(outDir, { recursive: true, force: true });
}
await mkdir(outDir, { recursive: true });

// Copy only static game files (works in older WebViews, e.g. OK)
const toCopy = ["index-vk.html", "styles.css", "game.js", "game-config.js", "vk-bridge.js", "vk-ads-entry.js"];
for (const file of toCopy) {
  const destName = file === "index-vk.html" ? "index.html" : file;
  await cp(path.join(root, file), path.join(outDir, destName));
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

console.log(`\nOK: hosting-build prepared from static files\n- ${outDir}\n`);

