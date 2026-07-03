# snake-game-engine

## Conventions

- Public API lives in `src/index.mjs`.
- Export names and signatures are fixed:
  - `createGameState(config)`
  - `setDirection(gameState, nextDirection)`
  - `tickGame(gameState)`

## Domain rules

- Coordinates are zero-based.
- `gameState.snake` is array of segments with head at index `0`.
- For snake length greater than `1`, opposite direction change is ignored.
- `tickGame` advances snake by one step using current direction.
- Wall collision or self collision sets `isGameOver: true`.
- Eating food increments `score` by `1` and grows snake.
- Next food uses first free cell in row-major order (top-to-bottom, left-to-right).
- If board is full after eating, `food` is `null`.
- State updates are immutable.
