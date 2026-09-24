import { cp, mkdir, readdir, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const root = new URL("../", import.meta.url);
const assets = [
  "index.html",
  "styles.css",
  "app.js",
  "components.js",
  "editor.js",
  "model.js",
  "renderer.js",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const asset of assets) {
  await cp(new URL(asset, root), new URL(asset, output));
}

const examples = new URL("examples/", root);
const outputExamples = new URL("examples/", output);
await mkdir(outputExamples);
for (const file of await readdir(examples)) {
  if (file.endsWith(".json")) {
    await cp(new URL(file, examples), new URL(file, outputExamples));
  }
}
