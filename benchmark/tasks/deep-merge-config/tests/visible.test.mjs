import assert from 'node:assert/strict';

import { deepMergeConfig } from '../src/index.mjs';

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'merges nested objects and replaces arrays',
    run() {
      const mergedConfig = deepMergeConfig(
        {
          feature: {
            flags: { alpha: true, beta: true },
            list: [1, 2],
            keep: 'yes'
          }
        },
        {
          feature: {
            flags: { beta: false, gamma: true },
            list: [9],
            keep: null
          }
        }
      );

      assert.deepEqual(mergedConfig, {
        feature: {
          flags: { alpha: true, beta: false, gamma: true },
          list: [9],
          keep: null
        }
      });
    }
  },
  {
    name: 'keeps base value when override is undefined',
    run() {
      assert.deepEqual(
        deepMergeConfig({ retries: 3 }, { retries: undefined }),
        { retries: 3 }
      );
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
