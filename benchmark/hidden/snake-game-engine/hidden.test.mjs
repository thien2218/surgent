import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const benchmarkWorkspacePath = process.env.BENCHMARK_WORKSPACE;
if (!benchmarkWorkspacePath) {
  throw new Error('Missing BENCHMARK_WORKSPACE');
}

const moduleUrl = pathToFileURL(path.join(benchmarkWorkspacePath, 'src', 'index.mjs')).href;
const { createGameState, setDirection, tickGame } = await import(moduleUrl);

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'rejects opposite direction when snake has body',
    run() {
      const gameState = createGameState({
        boardWidth: 5,
        boardHeight: 5,
        snake: [
          { x: 2, y: 2 },
          { x: 1, y: 2 }
        ],
        direction: 'right',
        food: { x: 4, y: 4 }
      });
      const changedGameState = setDirection(gameState, 'left');
      const nextGameState = tickGame(changedGameState);
      assert.deepEqual(nextGameState.snake[0], { x: 3, y: 2 });
    }
  },
  {
    name: 'marks game over on wall collision',
    run() {
      const gameState = createGameState({
        boardWidth: 3,
        boardHeight: 3,
        snake: [{ x: 2, y: 1 }],
        direction: 'right',
        food: { x: 0, y: 0 }
      });
      const nextGameState = tickGame(gameState);
      assert.equal(nextGameState.isGameOver, true);
    }
  },
  {
    name: 'spawns next food on first free cell',
    run() {
      const gameState = createGameState({
        boardWidth: 3,
        boardHeight: 2,
        snake: [
          { x: 1, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 }
        ],
        direction: 'right',
        food: { x: 2, y: 0 }
      });
      const nextGameState = tickGame(gameState);
      assert.deepEqual(nextGameState.food, { x: 2, y: 1 });
    }
  },
  {
    name: 'food becomes null when board full',
    run() {
      const gameState = createGameState({
        boardWidth: 2,
        boardHeight: 1,
        snake: [{ x: 0, y: 0 }],
        direction: 'right',
        food: { x: 1, y: 0 }
      });
      const nextGameState = tickGame(gameState);
      assert.equal(nextGameState.food, null);
      assert.equal(nextGameState.isGameOver, false);
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
