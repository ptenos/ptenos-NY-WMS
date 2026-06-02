import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(rootDir, "cloudflare-dist");
const files = [
  ["wms-lite.html", "index.html"],
  ["app.js", "app.js"],
  ["app.js", "runtime.js"],
  ["styles.css", "styles.css"],
  ["manifest.webmanifest", "manifest.webmanifest"],
  ["sw.js", "sw.js"],
  ["assets/icon-192.png", "assets/icon-192.png"],
  ["assets/icon-512.png", "assets/icon-512.png"]
];

await rm(outDir, { recursive: true, force: true });

for (const [source, destination] of files) {
  const target = join(outDir, destination);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(rootDir, source), target);
}
