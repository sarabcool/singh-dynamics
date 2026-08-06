// CI smoke tests for the deterministic website/AEO preview pipeline.
// Runs only in GitHub Actions through agent/package.json postinstall.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.env.CI !== 'true') process.exit(0);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shops = path.join(root, 'sites', 'shops');
const dist = path.join(root, 'sites', 'dist');
const tempConfig = path.join(shops, 'ci-generated.json');
const tempDist = path.join(dist, 'ci-generated');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || (result.status ?? 1) !== 0) {
    console.error(`CI website command failed: ${command} ${args.join(' ')}`);
    process.exit(1);
  }
}

function expect(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    console.error(`CI website assertion failed: ${label} (${needle})`);
    process.exit(1);
  }
}

try {
  run(process.execPath, ['--check', 'agent/discover.mjs']);
  run(process.execPath, ['--check', 'agent/publish-previews.mjs']);
  run(process.execPath, ['--check', 'agent/digest.mjs']);
  run('python3', ['-m', 'py_compile', 'sites/build.py']);

  const demo = JSON.parse(readFileSync(path.join(shops, 'demo-shop.json'), 'utf8'));
  demo._generated = 'ci';
  demo.slug = 'ci-generated';
  demo.domain = '';
  writeFileSync(tempConfig, JSON.stringify(demo, null, 2));

  run('python3', ['sites/build.py', '--generated-only', '--preview']);
  const preview = readFileSync(path.join(tempDist, 'index.html'), 'utf8');
  expect(preview, 'content="noindex,nofollow"', 'preview must be noindex');
  expect(preview, 'id="quick-answers"', 'Quick answers section must render');
  expect(preview, '"@graph"', 'JSON-LD graph must render');
  if (preview.includes('"FAQPage"')) {
    console.error('CI website assertion failed: ordinary business preview must not emit FAQPage schema');
    process.exit(1);
  }

  run('python3', ['sites/build.py', 'demo-shop']);
  const live = readFileSync(path.join(dist, 'demo-shop', 'index.html'), 'utf8');
  const robots = readFileSync(path.join(dist, 'demo-shop', 'robots.txt'), 'utf8');
  expect(live, 'content="index,follow"', 'normal build must remain indexable');
  expect(live, 'id="quick-answers"', 'normal build must include Quick answers');
  expect(robots, 'User-agent: OAI-SearchBot', 'robots must explicitly allow OAI-SearchBot');

  console.log('website/AEO smoke tests passed');
} finally {
  rmSync(tempConfig, { force: true });
  rmSync(tempDist, { recursive: true, force: true });
}
