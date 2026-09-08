const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sourceExtensions = new Set([".js", ".json", ".wxml", ".wxss"]);
const fontExtensions = new Set([".ttf", ".otf", ".woff", ".woff2", ".eot", ".ttc"]);

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "tests") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

test("runtime UI uses the host system font without bundled or named font overrides", () => {
  const files = walk(root);
  const fontFiles = files.filter((file) => fontExtensions.has(path.extname(file).toLowerCase()));
  assert.deepEqual(fontFiles, []);

  for (const file of files.filter((item) => sourceExtensions.has(path.extname(item).toLowerCase()))) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /@font-face|font-family\s*:|(?:^|[;{]\s*)font\s*:|loadFontFace|fontFamily\s*[:=]|(?:ctx|context)\.font\s*=/im,
      file
    );
  }
});
