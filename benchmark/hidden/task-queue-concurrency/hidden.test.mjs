import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const benchmarkWorkspacePath = process.env.BENCHMARK_WORKSPACE;
if (!benchmarkWorkspacePath) {
  throw new Error('Missing BENCHMARK_WORKSPACE');
}

const moduleUrl = pathToFileURL(path.join(benchmarkWorkspacePath, 'src', 'index.mjs')).href;
const { runTasksWithConcurrency } = await import(moduleUrl);

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'supports synchronous throw in task factory',
    async run() {
      const settledResults = await runTasksWithConcurrency([
        () => 'alpha',
        () => {
          throw new Error('sync-fail');
        },
        async () => 'omega'
      ], 2);

      assert.equal(settledResults[0].status, 'fulfilled');
      assert.equal(settledResults[1].status, 'rejected');
      assert.equal(settledResults[2].status, 'fulfilled');
    }
  },
  {
    name: 'handles concurrency larger than task count',
    async run() {
      const settledResults = await runTasksWithConcurrency([
        async () => 1,
        async () => 2
      ], 10);
      assert.deepEqual(settledResults, [
        { status: 'fulfilled', value: 1 },
        { status: 'fulfilled', value: 2 }
      ]);
    }
  },
  {
    name: 'throws for invalid input types',
    async run() {
      await assert.rejects(() => runTasksWithConcurrency('bad', 2), TypeError);
      await assert.rejects(() => runTasksWithConcurrency([async () => 1], 0), TypeError);
      await assert.rejects(() => runTasksWithConcurrency([async () => 1], 1.5), TypeError);
    }
  },
  {
    name: 'throws when task list contains non functions',
    async run() {
      await assert.rejects(() => runTasksWithConcurrency([async () => 1, 2], 1), TypeError);
    }
  },
  {
    name: 'starts next task as soon as one settles',
    async run() {
      const startOrder = [];
      let resolveFirstTask;
      let resolveSecondTask;
      let resolveThirdTask;

      const pendingResults = runTasksWithConcurrency([
        () => new Promise((resolve) => {
          startOrder.push('first');
          resolveFirstTask = () => resolve('first');
        }),
        () => new Promise((resolve) => {
          startOrder.push('second');
          resolveSecondTask = () => resolve('second');
        }),
        () => new Promise((resolve) => {
          startOrder.push('third');
          resolveThirdTask = () => resolve('third');
        })
      ], 2);

      await Promise.resolve();
      assert.deepEqual(startOrder, ['first', 'second']);

      resolveFirstTask();
      await Promise.resolve();
      await Promise.resolve();
      assert.deepEqual(startOrder, ['first', 'second', 'third']);

      resolveSecondTask();
      resolveThirdTask();
      assert.deepEqual(await pendingResults, [
        { status: 'fulfilled', value: 'first' },
        { status: 'fulfilled', value: 'second' },
        { status: 'fulfilled', value: 'third' }
      ]);
    }
  },
  {
    name: 'keeps rejection reason in settled result',
    async run() {
      const rejectionError = new Error('async-fail');
      const settledResults = await runTasksWithConcurrency([
        async () => {
          throw rejectionError;
        }
      ], 1);

      assert.equal(settledResults[0].status, 'rejected');
      assert.equal(settledResults[0].reason, rejectionError);
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
