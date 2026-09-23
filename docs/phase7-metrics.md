# Phase 7 metric definitions

The current client overview is an operational snapshot from PostgreSQL, queried when the server renders the page. Every query uses the authenticated business ID; there is no cross-business aggregation in client views. Timestamps shown in this view use UTC. Values are not a historical report or a real-time push feed; reload to refresh them.

| Metric | Grain and formula | Source | Window/filter | Caveat |
| --- | --- | --- | --- | --- |
| Unread conversations | Count of conversation rows whose `unread` flag is true | `conversations` | Current state, selected business, `is_test = false` | A conversation counts once regardless of unread message volume. |
| Unresolved handoffs | Count of handoff rows in `HANDOFF_REQUESTED`, `HUMAN_ACTIVE`, or `PAUSED` | `handoffs` joined to `conversations` | Current state, selected business, excluding test conversations | More than one handoff on a conversation can count more than once. It is a request count, not a unique conversation count. |
| Failed runs · 7 days | Count of agent-run rows with `FAILED` status and `started_at` in the rolling preceding seven days | `agent_runs` | Selected business, UTC instant at query time | This includes all run kinds, including runs without a conversation; it does not prove a customer-facing reply failed. |
| Urgent conversations | Count of conversation rows whose `urgent` flag is true | `conversations` | Current state, selected business, `is_test = false` | Priority is the stored operational flag, not model-derived sentiment. |
| Recent conversations | Latest 25 conversation rows by `updated_at`, then ID | `conversations` joined to `customers` | Selected business, excluding tests; optional unread/urgent and ownership filters | Bounded list, not a total. Customer names may be absent. |
| Recent agent runs | Latest 25 runs by `started_at`, then ID | `agent_runs` joined to `agents` | Selected business; failed filter uses the same rolling seven-day window as the card | Status and timing only; prompts, traces, unsafe tool details, and provider errors are omitted. |

The displayed source does not yet support a trustworthy AI-handled rate, first-response latency, question-category trend, conversion funnel, revenue attribution, or cost estimate. Those require a defined cohort, delivery-qualified events, and verified links from intent to order. They must not be inferred from the current counters. Comment analytics will use persisted `facebook_comments` and `comment_decisions` with separate receipt, decision, and action-success grains.
