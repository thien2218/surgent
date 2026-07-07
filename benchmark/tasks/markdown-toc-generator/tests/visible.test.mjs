import assert from 'node:assert/strict';

import { buildTableOfContents } from '../src/index.mjs';

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'builds toc for simple headings',
    run() {
      const markdownText = '# Intro\n\n## Install\n\n### Usage';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 1, text: 'Intro', slug: 'intro' },
        { level: 2, text: 'Install', slug: 'install' },
        { level: 3, text: 'Usage', slug: 'usage' }
      ]);
    }
  },
  {
    name: 'adds duplicate slug suffixes',
    run() {
      const markdownText = '## API\n\n## API\n\n## API';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 2, text: 'API', slug: 'api' },
        { level: 2, text: 'API', slug: 'api-2' },
        { level: 2, text: 'API', slug: 'api-3' }
      ]);
    }
  },
  {
    name: 'ignores invalid heading syntax',
    run() {
      const markdownText = '# Intro\n#NoSpace\nHeading\n===\n## Valid';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 1, text: 'Intro', slug: 'intro' },
        { level: 2, text: 'Valid', slug: 'valid' }
      ]);
    }
  },
  {
    name: 'collapses repeated hyphens in slug',
    run() {
      const markdownText = '## Hello -- World';
      assert.deepEqual(buildTableOfContents(markdownText), [
        { level: 2, text: 'Hello -- World', slug: 'hello-world' }
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
