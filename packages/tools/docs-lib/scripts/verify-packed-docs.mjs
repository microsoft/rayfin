import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { sanitizeTarball } from "./sanitize-packed-docs.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../..");
const requireCommon = createRequire(
  resolve(scriptDir, "../../common/package.json"),
);
const tar = requireCommon("tar");

function parseJsonWithComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function readDocsProjects() {
  const rushJson = JSON.parse(
    parseJsonWithComments(readFileSync(join(repoRoot, "rush.json"), "utf8")),
  );
  return (rushJson.projects ?? [])
    .map((project) => resolve(repoRoot, project.projectFolder))
    .filter((projectRoot) => {
      const manifestPath = join(projectRoot, "package.json");
      if (!existsSync(manifestPath)) {
        return false;
      }
      return !!JSON.parse(readFileSync(manifestPath, "utf8")).rayfinDocs;
    });
}

function runNpmPack(packageRoot, destination) {
  mkdirSync(destination, { recursive: true });
  const stdout = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, NPM_CONFIG_LOGLEVEL: "silent" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || typeof result[0]?.filename !== "string") {
    throw new Error(`npm pack returned invalid output for ${packageRoot}.`);
  }
  return join(destination, result[0].filename);
}

function collectMarkdown(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectMarkdown(path, result);
    } else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) {
      result.push(readFileSync(path, "utf8"));
    }
  }
  return result;
}

async function verifyFixture(tarballPath, temporaryRoot) {
  const extracted = join(temporaryRoot, "fixture-extracted");
  mkdirSync(extracted);
  await tar.x({ file: tarballPath, cwd: extracted, strict: true });
  const markdown = collectMarkdown(
    join(extracted, "package", "assets", "docs"),
  ).join("\n");
  if (markdown.includes("PRIVATE_FIXTURE_SENTINEL_6d92511a")) {
    throw new Error("Private fixture content remained in the packed artifact.");
  }
  const prebuilt = readFileSync(
    join(extracted, "package", "assets", "docs.search.json"),
    "utf8",
  );
  if (prebuilt.includes("PRIVATE_FIXTURE_SENTINEL_6d92511a")) {
    throw new Error(
      "Private fixture content remained in the packed docs index.",
    );
  }
  if (prebuilt.includes("EXPERIMENTAL_FIXTURE_CONTENT")) {
    throw new Error("Experimental content leaked into the default docs index.");
  }
  if (
    !markdown.includes(":::experimental") ||
    !markdown.includes("EXPERIMENTAL_FIXTURE_CONTENT")
  ) {
    throw new Error("Experimental content was lost from the packed artifact.");
  }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "rayfin-packed-docs-"));
try {
  const packageDirectory = join(temporaryRoot, "packages");
  const fixtureDirectory = join(temporaryRoot, "fixture");
  mkdirSync(packageDirectory, { recursive: true });
  mkdirSync(fixtureDirectory, { recursive: true });
  const fixtureRoot = resolve(
    scriptDir,
    "../test-fixtures/private-docs-package",
  );
  const docsPackages = readDocsProjects();
  if (docsPackages.length === 0) {
    throw new Error("No packages with rayfinDocs manifests were found.");
  }

  for (const [index, packageRoot] of docsPackages.entries()) {
    const destination = join(packageDirectory, String(index));
    const tarball = runNpmPack(packageRoot, destination);
    await sanitizeTarball(tarball);
  }

  const fixtureTarball = runNpmPack(fixtureRoot, fixtureDirectory);
  await sanitizeTarball(fixtureTarball);
  await verifyFixture(fixtureTarball, temporaryRoot);

  console.log(
    `Verified sanitized npm artifacts for ${docsPackages.length} docs packages and the private-content fixture.`,
  );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
