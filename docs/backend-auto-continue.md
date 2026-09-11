# Backend automatic continuation

Automatic tool approval and the next model request are now owned by the API.
The browser only sends user commands and renders the existing runtime events.
Closing or suspending every browser tab does not stop automatic continuation.

## Behavior

- Read the existing `tool_call_auto_approve` setting from the database. Approval
  remains all-or-none for the pending tools in the latest assistant response.
- Wait for every unresolved tool in the thread, including child-agent work.
  Applied and failed tool results allow the next response; rejection, pause,
  cancellation and errors stop automatic continuation.
- `submit_image_prompt` still follows approval settings but never starts another
  model request. A response without tools ends the turn.
- Explicit user resume sends `source: "user"`. Unmarked resume requests from an
  older frontend only wake the coordinator, preventing two automatic owners.

## Persistence and recovery

`run_continuations` is written in the transaction that finalizes an assistant
response. One row per response, a database lease and a locked eligibility check
prevent the same response being automatically resumed twice. The coordinator
waits for the previous runtime task's final events before reusing its run ID.
Tool application only executes rows claimed by that invocation, including when
manual approval races with automatic approval.

Pending jobs survive coordinator restarts. A model request or tool execution
interrupted after it was claimed is not blindly retried: its external outcome
may be unknown. Recovery reports an error through the existing UI; interrupted
processing tools become failed with `outcome_unknown: true`, allowing the user
to inspect the result and choose how to proceed.

User SSE events are journaled in PostgreSQL, with per-user commit ordering.
Snapshots contain a consistent event cursor and the active message's stream
prefix. The client buffers events during hydration, replays only the newer tail,
and rejects older run versions. A fresh or expired cursor triggers hydration
from a cursor captured before the fetch. The cursor advances only after an
event or reset has been applied successfully.

Completed event history is retained for one day; active message history is kept
until completion. Cleanup runs on subscription activity, at most every five
minutes. Monitor event-table size and database write latency: token events now
require durable writes. This change uses the existing API process, without a
new Redis or worker deployment.

## Rollout

1. Finish active generations and stop the old backend before schema migration.
2. Run `alembic upgrade head` from `App/backend`. The existing Docker backend
   entrypoint already does this. Revision `0027_backend_continuations` backfills
   the latest waiting, processing and ready responses.
3. Deploy the matching backend and frontend together; reload any old cached
   frontend tabs so their explicit resume commands carry the new source field.

Keep the current single API execution process for this rollout. Continuation
claims and event history are shared through PostgreSQL, but the existing model,
child-agent and image tasks still execute in process; this is not a full
distributed task runtime or transparent recovery of in-flight provider calls.

Rollback requires stopping the new backend, deploying the previous frontend and
backend, and downgrading to `0026_image_prompt_formats`. Downgrade removes the
continuation queue and event journal; persisted conversation content remains.

## Verification

Run the policy and lifecycle regression tests with pytest and the frontend suite
with `npm test -- --run`; `npm run build` checks TypeScript and the production
bundle. Database integration tests use a disposable schema:

```sh
TEST_DATABASE_URL=postgresql+psycopg2://postgres:password@localhost/test_db \
  python -m pytest App/backend/tests/test_continuation_database.py -q
```

The database user needs permission to create and drop schemas. The suite covers
browser-free continuation, two coordinators claiming one response, settings,
pause and terminal-image behavior, abandoned work, event replay and migration
backfill/downgrade. Local validation used PGlite through the PostgreSQL protocol
with a single connection; native PostgreSQL multi-connection locking and live
provider/browser end-to-end behavior remain staging checks.
