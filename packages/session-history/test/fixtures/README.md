# Session fixtures

The integration tests create controlled JSONL sessions in temporary directories.

Runtime-generated paths keep scope and symbolic-link tests independent from the local machine.

`heap-worker.ts` creates isolated short-block and large-payload corpora. `heap.test.ts` launches it through Node with explicit garbage collection.

Run the opt-in heap evaluation through Vite+:

```sh
SESSION_HISTORY_HEAP=1 bun run --cwd packages/session-history test -- test/heap.test.ts
```

The worker removes its temporary corpus after measurement. It never reads production histories.
