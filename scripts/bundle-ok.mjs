import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const outDir = path.join(root, "ok-build");

if (existsSync(outDir)) {
  await rm(outDir, { recursive: true, force: true });
}
await mkdir(outDir, { recursive: true });

const toCopy = ["index.html", "styles.css", "game.js", "game-config.js", "ok-ads.js"];
for (const file of toCopy) {
  await cp(path.join(root, file), path.join(outDir, file));
}

console.log(`\nOK: ok-build prepared for Odnoklassniki (FAPI ads)\n- ${outDir}\n`);
