# task-queue-concurrency

Implement concurrent task runner in `src/`.

Exports must stay:

- `runTasksWithConcurrency(taskFactories, concurrency)`

Rules:

- `taskFactories` must be array of functions, else throw `TypeError`.
- `concurrency` must be positive integer, else throw `TypeError`.
- Run with max active count `concurrency`.
- Start next task as soon as one settles.
- Result must match `Promise.allSettled` shape and keep input order.
- Continue processing after rejections.
- Support task factory that throws synchronously.
