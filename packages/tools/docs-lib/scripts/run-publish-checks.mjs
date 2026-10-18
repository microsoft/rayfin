import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../../..');
const rushJson = readFileSync(join(repoRoot, 'rush.json'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const projects = JSON.parse(rushJson).projects ?? [];

for (const project of projects) {
  const projectRoot = resolve(repoRoot, project.projectFolder);
  const manifestPath = join(projectRoot, 'package.json');
  if (!existsSync(manifestPath)) {
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.scripts?.prepublishOnly !== 'string') {
    continue;
  }
  console.log(`Running prepublishOnly for ${manifest.name}.`);
  execFileSync('npm', ['run', 'prepublishOnly'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}
