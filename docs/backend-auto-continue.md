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

Streaming and reconnection use the existing `run_event_bus`, SSE client and
thread snapshot fetch behavior. Token deltas and reconnect cursors are not
written to the database. There is no additional stream journal, snapshot replay
layer or reconnect-wide refetch of cached threads. The in-memory bus keeps
bounded, lossy queues for content/thinking/tool-argument deltas and separate
non-evicting delivery queues for state events. State replay history is retained
for the channel TTL, so delta volume cannot evict message, tool-call or run
transitions. The browser advances its reconnect cursor only after the event
consumer completes.

The coordinator's eligibility checks and resume transactions run in DB worker
threads. Their synchronous SQL and lock waits do not block the API event loop.
Sessions are created, used and closed in the worker; existing runtime events and
model tasks stay on the API loop. A busy thread is skipped during polling.

## Rollout

1. Finish active generations and stop the old backend before schema migration.
2. Run `alembic upgrade head` from `App/backend`. The existing Docker backend
   entrypoint already does this. Revision `0027_backend_continuations` backfills
   the latest waiting, processing and ready responses. Revision
   `0028_remove_runtime_journal` drops the obsolete `runtime_events` table and
   `run_messages.is_streaming` column; messages and continuation jobs remain.
3. Deploy the matching backend and frontend together; reload any old cached
   frontend tabs so their explicit resume commands carry the new source field.

Keep the current single API execution process for this rollout. Continuation
claims are shared through PostgreSQL. Existing model, child-agent and image
tasks still execute in process and retain their current restart behavior.

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
pause and terminal-image behavior, abandoned work, migration backfill/downgrade
and the absence of coordinator/resume SQL on the API event loop. Local validation
used PGlite through the PostgreSQL protocol with a single connection; native PostgreSQL multi-connection locking and live
provider/browser end-to-end behavior remain staging checks.
