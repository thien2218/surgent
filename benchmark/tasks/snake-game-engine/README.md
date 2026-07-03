# snake-game-engine

Implement game engine functions in `src/`.

Exports must stay:

- `createGameState(config)`
- `setDirection(gameState, nextDirection)`
- `tickGame(gameState)`

Rules:

- Coordinates are zero-based.
- `gameState.snake` is array of segments with head at index 0.
- If snake length is greater than 1, opposite direction change is ignored.
- `tickGame` moves snake by one step using current direction.
- Wall hit or self hit sets `isGameOver: true`.
- Eating food increases `score` by 1 and grows snake.
- New food position comes from first free cell scanning rows top-to-bottom and columns left-to-right.
- If board is full after eating, set `food` to `null`.
- Do not mutate input objects or arrays.
