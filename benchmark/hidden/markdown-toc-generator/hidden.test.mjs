import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const benchmarkWorkspacePath = process.env.BENCHMARK_WORKSPACE;
if (!benchmarkWorkspacePath) {
  throw new Error('Missing BENCHMARK_WORKSPACE');
}

const moduleUrl = pathToFileURL(path.join(benchmarkWorkspacePath, 'src', 'index.mjs')).href;
const { buildTableOfContents } = await import(moduleUrl);

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'ignores fenced code blocks',
    run() {
      const markdownText = '# Real\n```md\n## Fake\n```\n## After';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 1, text: 'Real', slug: 'real' },
        { level: 2, text: 'After', slug: 'after' }
      ]);
    }
  },
  {
    name: 'filters levels with options',
    run() {
      const markdownText = '# Top\n## Mid\n### Low';
      assert.deepEqual(buildTableOfContents(markdownText, { minLevel: 2, maxLevel: 2 }), [
        { level: 2, text: 'Mid', slug: 'mid' }
      ]);
    }
  },
  {
    name: 'slug removes punctuation and normalizes spaces',
    run() {
      const markdownText = '# Hello,   World!';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 1, text: 'Hello,   World!', slug: 'hello-world' }
      ]);
    }
  },
  {
    name: 'resumes parsing after multiple fenced code blocks',
    run() {
      const markdownText = '```js\n# Fake\n```\n## Real\n```txt\n### Also Fake\n```\n### After';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 2, text: 'Real', slug: 'real' },
        { level: 3, text: 'After', slug: 'after' }
      ]);
    }
  },
  {
    name: 'applies duplicate suffixes after slug normalization',
    run() {
      const markdownText = '# Hello, World!\n# Hello World\n# hello-world';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 1, text: 'Hello, World!', slug: 'hello-world' },
        { level: 1, text: 'Hello World', slug: 'hello-world-2' },
        { level: 1, text: 'hello-world', slug: 'hello-world-3' }
      ]);
    }
  },
  {
    name: 'parses heading levels one through six only',
    run() {
      const markdownText = '# One\n###### Six\n####### Seven\n## Two';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 1, text: 'One', slug: 'one' },
        { level: 6, text: 'Six', slug: 'six' },
        { level: 2, text: 'Two', slug: 'two' }
      ]);
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
