import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const benchmarkWorkspacePath = process.env.BENCHMARK_WORKSPACE;
if (!benchmarkWorkspacePath) {
  throw new Error('Missing BENCHMARK_WORKSPACE');
}

const moduleUrl = pathToFileURL(path.join(benchmarkWorkspacePath, 'src', 'index.mjs')).href;
const { deepMergeConfig } = await import(moduleUrl);

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'does not mutate input values',
    run() {
      const baseConfig = { nested: { value: 1 }, list: [1] };
      const overrideConfig = { nested: { value: 2 }, list: [2] };
      const baseSnapshot = JSON.stringify(baseConfig);
      const overrideSnapshot = JSON.stringify(overrideConfig);

      const mergedConfig = deepMergeConfig(baseConfig, overrideConfig);
      assert.equal(JSON.stringify(baseConfig), baseSnapshot);
      assert.equal(JSON.stringify(overrideConfig), overrideSnapshot);
      assert.notEqual(mergedConfig.list, overrideConfig.list);
    }
  },
  {
    name: 'ignores unsafe keys',
    run() {
      const overrideConfig = {};
      Object.defineProperty(overrideConfig, '__proto__', {
        value: { polluted: true },
        enumerable: true,
        configurable: true
      });

      const mergedConfig = deepMergeConfig({ safe: true }, overrideConfig);
      assert.equal(Object.prototype.hasOwnProperty.call(mergedConfig, '__proto__'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
    }
  },
  {
    name: 'throws for non plain objects',
    run() {
      assert.throws(() => deepMergeConfig([], {}), TypeError);
      assert.throws(() => deepMergeConfig({}, null), TypeError);
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
