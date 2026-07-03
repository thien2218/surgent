import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const benchmarkWorkspacePath = process.env.BENCHMARK_WORKSPACE;
if (!benchmarkWorkspacePath) {
  throw new Error('Missing BENCHMARK_WORKSPACE');
}

const moduleUrl = pathToFileURL(path.join(benchmarkWorkspacePath, 'src', 'index.mjs')).href;
const { matchBestRoute } = await import(moduleUrl);

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'captures wildcard remainder',
    run() {
      const matchedRoute = matchBestRoute(['/files/*'], '/files/docs/readme');
      assert.deepEqual(matchedRoute, { pattern: '/files/*', params: { splat: 'docs/readme' } });
    }
  },
  {
    name: 'normalizes repeated slashes and trailing slash',
    run() {
      const matchedRoute = matchBestRoute(['/files/:name'], '//files//readme//');
      assert.deepEqual(matchedRoute, { pattern: '/files/:name', params: { name: 'readme' } });
    }
  },
  {
    name: 'decodes encoded segment and returns null for no match',
    run() {
      const matchedRoute = matchBestRoute(['/search/:query'], '/search/hello%20world');
      assert.deepEqual(matchedRoute, { pattern: '/search/:query', params: { query: 'hello world' } });
      assert.equal(matchBestRoute(['/users/:id'], '/teams/core'), null);
    }
  }
]) {
  totalCount += 1;
  try {
    testCase.run();
    passedCount += 1;
  } catch (error) {
    console.error(`${testCase.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({ passed: passedCount, total: totalCount }));
