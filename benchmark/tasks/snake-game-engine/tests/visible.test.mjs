import assert from 'node:assert/strict';

import { createGameState, tickGame } from '../src/index.mjs';

let passedCount = 0;
let totalCount = 0;

for (const testCase of [
  {
    name: 'moves snake head and tail without food',
    run() {
      const gameState = createGameState({
        boardWidth: 6,
        boardHeight: 4,
        snake: [
          { x: 2, y: 1 },
          { x: 1, y: 1 }
        ],
        direction: 'right',
        food: { x: 5, y: 3 }
      });

      const nextGameState = tickGame(gameState);
      assert.deepEqual(nextGameState.snake, [
        { x: 3, y: 1 },
        { x: 2, y: 1 }
      ]);
      assert.equal(nextGameState.score, 0);
      assert.equal(nextGameState.isGameOver, false);
      assert.deepEqual(nextGameState.food, { x: 5, y: 3 });
    }
  },
  {
    name: 'eating food increases score and grows snake',
    run() {
      const gameState = createGameState({
        boardWidth: 5,
        boardHeight: 5,
        snake: [
          { x: 1, y: 1 },
          { x: 0, y: 1 }
        ],
        direction: 'right',
        food: { x: 2, y: 1 }
      });

      const nextGameState = tickGame(gameState);
      assert.equal(nextGameState.score, 1);
      assert.equal(nextGameState.snake.length, 3);
      assert.deepEqual(nextGameState.snake[0], { x: 2, y: 1 });
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
