import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getConfig } = require("@vercel/static-config");
const { Project } = require("ts-morph");

test("Vercel's static-config compiler fallback works with the patched parser dependency", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "programmable-static-config-"));
  try {
    const source = path.join(directory, "handler.ts");
    // Oxc rejects the method; Vercel's established compiler fallback ignores it
    // while retaining the ordinary exported configuration properties.
    await writeFile(source, 'export const config = { runtime: "nodejs20.x", maxDuration: 60, helper() {} };\n');
    const project = new Project();
    assert.deepEqual(getConfig(project, source), { runtime: "nodejs20.x", maxDuration: 60 });
    assert.ok(project.getSourceFile(source), "compiler fallback was exercised");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
