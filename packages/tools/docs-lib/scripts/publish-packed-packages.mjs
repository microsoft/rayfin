import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const requireCommon = createRequire(
  resolve(scriptDir, "../../common/package.json"),
);
const tar = requireCommon("tar");

async function readPackageManifest(tarball, temporaryRoot) {
  const directory = mkdtempSync(join(temporaryRoot, "manifest-"));
  try {
    await tar.x({
      file: tarball,
      cwd: directory,
      strict: true,
      filter: (path) => path === "package/package.json",
    });
    return JSON.parse(
      readFileSync(join(directory, "package", "package.json"), "utf8"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const releaseDirectory = resolve(process.argv[2] ?? "");
const tag = process.argv[3];
if (!process.argv[2] || !tag) {
  throw new Error(
    "Usage: node publish-packed-packages.mjs <release-directory> <npm-tag>",
  );
}

const tarballs = readdirSync(releaseDirectory)
  .filter((name) => name.endsWith(".tgz"))
  .map((name) => join(releaseDirectory, name));
if (tarballs.length === 0) {
  throw new Error(`No npm tarballs found in ${releaseDirectory}.`);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "rayfin-publish-"));
try {
  const packages = [];
  for (const tarball of tarballs) {
    const manifest = await readPackageManifest(tarball, temporaryRoot);
    if (
      typeof manifest.name !== "string" ||
      typeof manifest.version !== "string"
    ) {
      throw new Error(`Invalid package manifest in ${tarball}.`);
    }
    packages.push({ name: manifest.name, tarball });
  }

  packages.sort((left, right) => left.name.localeCompare(right.name));
  for (const { name, tarball } of packages) {
    console.log(`Publishing ${name} from sanitized package artifact.`);
    execFileSync(
      "npm",
      [
        "publish",
        tarball,
        "--ignore-scripts",
        "--access",
        "restricted",
        "--tag",
        tag,
        "--registry",
        "https://npm.pkg.github.com",
      ],
      { stdio: "inherit", env: process.env },
    );
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
