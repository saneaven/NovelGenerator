# Tool Call Code Flow

## Overview

Single code path for both manual accept and auto-approve. The frontend always drives decisions — the backend never auto-approves.

```
dispatch → SSE → tool_calls → "waiting" → SSE closes
PATCH /tool-decisions → JSON {tool_calls}
POST /resume → SSE → LLM continues
```

---

## 1. Dispatch

```
Frontend                              Backend
────────                              ───────
threadOrchestrator.dispatch()
  → POST /threads/dispatch
  → SSE opens                         run_pipeline.dispatch()
                                        create Run + user message
                                        emit thread:status "running"
                                        emit thread:user_message_created
                                        _run_loop() → _execute_step()
                                          LLM streaming
  ← thread:llm_delta (N times)           emit thread:llm_delta
  ← thread:llm_final                     save assistant message
                                          emit thread:llm_final
                                          _handle_tool_calls()
                                            stage tool call rows
  ← thread:tool_calls                     emit thread:tool_calls
                                            return StepResult(waiting=True)
                                          set run.status = "waiting"
  ← thread:status "waiting"              emit thread:status "waiting"
  SSE closes (on "waiting")
```

**If no tool calls:** LLM output is final → `thread:complete` → SSE closes.

---

## 2. Tool Decisions (Manual Accept)

```
Frontend                              Backend
────────                              ───────
User clicks Accept/Reject
threadOrchestrator.toolDecisions()
  → PATCH /tool-decisions             run_pipeline.apply_decisions()
    {message_id, decisions}             executor.apply_tool_calls()
                                        build tool result message
                                        commit
                                        emit thread:tool_calls_executed
                                        launch children (if call_sub_agent)
                                        emit thread:tools_all_terminal (if all done)
  ← JSON {tool_calls: [...]}           return {tool_calls: [...]}

  Update store from response
  Register child threads
  Store child→parent mapping

  All terminal?
    YES → autoResumeIfReady() → resume()
    NO (children running) → subscribe to child SSE
```

---

## 3. Tool Decisions (Auto-Approve)

```
Frontend                              Backend
────────                              ───────
thread:tool_calls arrives in handleEvent
  Check useSettingsStore.toolCallAutoApprove
  For each pending call:
    toAutoApproveCategory(toolName) → category
    autoApprove[category] enabled?
  All approved? (all-or-none policy)
    YES → void this.toolDecisions({decisions})
    NO  → show manual UI, wait for user

  (same PATCH flow as manual accept above)
```

**All-or-none policy:** If ANY pending tool call's category is not auto-approved, ALL wait for manual decision.

---

## 4. Resume

```
Frontend                              Backend
────────                              ───────
threadOrchestrator.resume()
  → POST /threads/{id}/resume
  → SSE opens                         run_pipeline.resume()
                                        check: running children? → no-op
                                        set run.status = "running"
                                        _run_loop() → _execute_step()
                                          LLM streaming (with tool results in history)
  ← thread:llm_delta (N times)
  ← thread:llm_final
  ← thread:tool_calls OR thread:complete
  SSE closes
```

**If run is already "running":** Route subscribes to event bus without triggering pipeline. Used for child thread event subscription.

---

## 5. Sub-Agent Flow

```
Frontend                              Backend
────────                              ───────
PATCH /tool-decisions (accept call_sub_agent)
  ← {tool_calls: [{status:"running", child_thread_id:"X"}]}

  Store child→parent mapping:
    childToParentThread.set("X", {parentThreadId, projectId, messageId})

  Open resume SSE for child X           Child pipeline runs independently
  (already running → streams events)    _run_loop() on child run
  ← child thread:llm_delta
  ← child thread:llm_final
  ← child thread:tool_calls             (child may have its own tool calls)
  ...
  ← child thread:complete               _handle_child_terminal()
                                           update parent tool call → "accepted"
                                           add tool result message to parent
                                           emit thread:tool_calls_executed (parent bus)
                                           emit thread:tools_all_terminal (parent bus)

  handleEvent(childThreadId, thread:complete):
    Optimistic update: parent tool call → "accepted"
    autoResumeIfReady(parentThreadId)
      All parent tool calls terminal?
        YES → resume(parentThreadId)     run_pipeline.resume()
          SSE replays buffered events      _run_loop() → LLM continues
          (tool_calls_executed overwrites
           optimistic with real data)
        NO → wait for other children
```

**Multiple children:**
- Each child gets its own resume SSE
- As each child completes, its parent tool call is optimistically updated
- Only when the LAST child completes does `autoResumeIfReady` find all terminal → fires resume

**Child error:**
- `thread:error` on child SSE → parent tool call set to "cancelled"
- `autoResumeIfReady` checks → resumes if all terminal

---

## 6. Page Refresh Recovery

```
Frontend                              Backend
────────                              ───────
threadOrchestrator.recover(threadId)
  → GET /threads/{id}/state           Load thread + messages + tool_calls from DB
  ← {thread, messages, tool_calls,
     last_error, last_event_seq}

  Replace store state
  Set lastEventSeqByThread

  If thread.status == "waiting_tools"
    and all tool calls terminal:
      autoResumeIfReady() → resume
```

---

## 7. Event Bus & after_seq

Events are stored in an in-memory buffer (max 512 events, 15 min TTL per thread channel).

When subscribing with `after_seq=N`, all events with `event_seq > N` are replayed from the buffer before streaming live events.

This enables:
- **Resume SSE** to pick up events emitted while no SSE was open (e.g. `thread:tool_calls_executed` from `_handle_child_terminal`)
- **Deduplication** in frontend: `handleEvent` skips events where `eventSeq <= lastEventSeqByThread`

---

## Key Files

| File | Role |
|---|---|
| `backend/services/run_pipeline.py` | Core orchestration: dispatch, resume, apply_decisions, run loop |
| `backend/routes/thread_routes.py` | HTTP endpoints: dispatch (SSE), tool-decisions (PATCH), resume (SSE) |
| `backend/services/run_event_bus.py` | In-memory event bus with history replay |
| `backend/services/run_event_emitter.py` | Emit typed events to the bus |
| `backend/services/tool_call_executor.py` | Stage and apply tool calls |
| `frontend/src/api/threadService.ts` | API client: dispatch/resume (SSE), toolDecisions (PATCH) |
| `frontend/src/runtime/ThreadOrchestrator.ts` | Frontend orchestrator: event handling, auto-approve, child tracking |
| `frontend/src/runtime/store/threadStore.ts` | Zustand store for threads, messages, tool calls |
| `frontend/src/toolCall/runtime/engine.ts` | Auto-approve category mapping, decision building |
