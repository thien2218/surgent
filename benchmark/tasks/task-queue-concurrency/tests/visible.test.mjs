import assert from 'node:assert/strict';

import { runTasksWithConcurrency } from '../src/index.mjs';

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'limits active tasks and preserves order',
    async run() {
      let activeCount = 0;
      let highestActiveCount = 0;
      const taskFactories = [
        async () => {
          activeCount += 1;
          highestActiveCount = Math.max(highestActiveCount, activeCount);
          await waitFor(25);
          activeCount -= 1;
          return 'first';
        },
        async () => {
          activeCount += 1;
          highestActiveCount = Math.max(highestActiveCount, activeCount);
          await waitFor(10);
          activeCount -= 1;
          return 'second';
        },
        async () => {
          activeCount += 1;
          highestActiveCount = Math.max(highestActiveCount, activeCount);
          await waitFor(1);
          activeCount -= 1;
          return 'third';
        }
      ];

      const settledResults = await runTasksWithConcurrency(taskFactories, 2);
      assert.equal(highestActiveCount <= 2, true);
      assert.deepEqual(settledResults, [
        { status: 'fulfilled', value: 'first' },
        { status: 'fulfilled', value: 'second' },
        { status: 'fulfilled', value: 'third' }
      ]);
    }
  },
  {
    name: 'keeps running after rejection',
    async run() {
      const settledResults = await runTasksWithConcurrency([
        async () => 'ok',
        async () => {
          throw new Error('boom');
        },
        async () => 'after'
      ], 2);
      assert.equal(settledResults[0].status, 'fulfilled');
      assert.equal(settledResults[1].status, 'rejected');
      assert.equal(settledResults[2].status, 'fulfilled');
    }
  },
  {
    name: 'returns empty results for empty task list',
    async run() {
      assert.deepEqual(await runTasksWithConcurrency([], 3), []);
    }
  },
  {
    name: 'supports synchronous task results',
    async run() {
      const settledResults = await runTasksWithConcurrency([
        () => 'alpha',
        async () => 'beta',
        () => 3
      ], 2);
      assert.deepEqual(settledResults, [
        { status: 'fulfilled', value: 'alpha' },
        { status: 'fulfilled', value: 'beta' },
        { status: 'fulfilled', value: 3 }
      ]);
    }
  }
]) {
  totalCount += 1;
  try {
    await testCase.run();
    passedCount += 1;
  } catch (error) {
    console.error(`${testCase.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(JSON.stringify({ passed: passedCount, total: totalCount }));
