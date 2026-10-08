/**
 * release.test.mjs
 *
 * v2.0.0, Project Step 5 — packaging sanity checks, run before building the
 * .mcpack/.mcaddon files:
 *   - both manifests parse and every version field is the same as
 *     ADDON.VERSION (config/Constants.js), including BP's dependency on RP
 *   - pack UUIDs are unchanged from v1.0.0, so v2 upgrades v1 in place
 *   - each pack has its own pack.name / pack.description text
 *   - every script file parses (node --check)
 *
 * Run: node tests/release.test.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ADDON } from "../BP/scripts/config/Constants.js";

let passed = 0;
let failed = 0;
const failures = [];
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else {
    failed += 1;
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const root = new URL("..", import.meta.url).pathname;
const bp = JSON.parse(readFileSync(join(root, "BP/manifest.json"), "utf8"));
const rp = JSON.parse(readFileSync(join(root, "RP/manifest.json"), "utf8"));
const version = ADDON.VERSION.split(".").map(Number);

assertEqual(ADDON.VERSION, "2.0.0", "Constants VERSION is 2.0.0");
assertEqual(bp.header.version, version, "BP header version");
assertEqual(bp.modules.map((m) => m.version), [version], "BP script module version");
assertEqual(rp.header.version, version, "RP header version");
assertEqual(rp.modules.map((m) => m.version), [version], "RP resources module version");
const rpDependency = bp.dependencies.find((d) => d.uuid === rp.header.uuid);
assertEqual(rpDependency?.version, rp.header.version, "BP depends on this exact RP version");

// v1.0.0 UUIDs (docs/UUID_REGISTRY.md) — must never change, or worlds get a second copy instead of an upgrade.
assertEqual(bp.header.uuid, "27195d03-43f3-479d-8548-9ff1c6464b88", "BP header UUID unchanged");
assertEqual(bp.modules[0].uuid, "a3163b2c-46b4-4f88-8a3d-d6c4e2a5326b", "BP module UUID unchanged");
assertEqual(rp.header.uuid, "fa25588d-d4e5-4b3f-acec-d3103b1799a9", "RP header UUID unchanged");
assertEqual(rp.modules[0].uuid, "237e6561-9efc-4cf2-a14f-e37885e37835", "RP module UUID unchanged");

for (const pack of ["BP", "RP"]) {
  const lang = readFileSync(join(root, pack, "texts/en_US.lang"), "utf8");
  assertEqual(/^pack\.name=Smart Rail Builder$/m.test(lang), true, `${pack} has pack.name text`);
  assertEqual(/^pack\.description=.+$/m.test(lang), true, `${pack} has pack.description text`);
  assertEqual(JSON.parse(readFileSync(join(root, pack, "texts/languages.json"), "utf8")), ["en_US"], `${pack} languages.json`);
  assertEqual(statSync(join(root, pack, "pack_icon.png")).size > 0, true, `${pack} has a pack icon`);
}

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsFiles(join(dir, e.name)) : e.name.endsWith(".js") ? [join(dir, e.name)] : []
  );
}
const scripts = jsFiles(join(root, "BP/scripts"));
for (const file of scripts) {
  let ok = true;
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch {
    ok = false;
  }
  assertEqual(ok, true, `parses: ${file.slice(root.length)}`);
}

if (failures.length > 0) {
  console.log("FAILURES:");
  for (const failure of failures) console.log(`  - ${failure}`);
}
console.log(`${passed} passed, ${failed} failed (${passed + failed} assertions total).`);
process.exitCode = failed > 0 ? 1 : 0;
