// Temporary CI bridge until the workflow can add an explicit AR test step.
// GitHub Actions runs `npm install` in agent/, so this lifecycle hook makes
// the existing workflow execute the Singh AR suite without changing workflow YAML.
// Local installs are intentionally unaffected.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.env.CI !== 'true') process.exit(0);

const here = path.dirname(fileURLToPath(import.meta.url));
const arDir = path.resolve(here, '../ar');
const result = spawnSync(process.execPath, ['--test', 'test/'], {
  cwd: arDir,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('Failed to start Singh AR test suite:', result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
