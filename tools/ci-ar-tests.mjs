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
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/'], {
  cwd: arDir,
  encoding: 'utf8',
  env: process.env,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error('Failed to start Singh AR test suite:', result.error);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  const all = `${result.stdout || ''}\n${result.stderr || ''}`;
  const useful = all.split('\n').filter((line) =>
    /not ok|AssertionError|ERR_ASSERTION|error:|expected:|actual:|test at|location:/i.test(line));
  const summary = (useful.length ? useful.join(' | ') : all.slice(-3500))
    .slice(0, 6000)
    .replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=Singh AR tests failed::${summary}`);
}

process.exit(result.status ?? 1);
