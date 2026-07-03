import assert from 'node:assert/strict';

import { matchBestRoute } from '../src/index.mjs';

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'prefers static route over param route',
    run() {
      const matchedRoute = matchBestRoute(['/users/:id', '/users/me'], '/users/me');
      assert.deepEqual(matchedRoute, { pattern: '/users/me', params: {} });
    }
  },
  {
    name: 'extracts params for param route',
    run() {
      const matchedRoute = matchBestRoute(['/teams/:teamId/members/:memberId'], '/teams/core/members/42');
      assert.deepEqual(matchedRoute, {
        pattern: '/teams/:teamId/members/:memberId',
        params: { teamId: 'core', memberId: '42' }
      });
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
