# task-queue-concurrency

## Conventions

- Public API lives in `src/index.mjs`.
- Export name and signature are fixed:
  - `runTasksWithConcurrency(taskFactories, concurrency)`

## Runtime rules

- `taskFactories` is array of functions, otherwise `TypeError`.
- `concurrency` is positive integer, otherwise `TypeError`.
- Active task count never exceeds `concurrency`.
- Next task starts when one settles.
- Result shape matches `Promise.allSettled` and keeps input order.
- Queue continues after rejections.
- Synchronous throws from task factory are handled as rejected results.
