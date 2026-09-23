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

The displayed source does not yet support a trustworthy AI-handled rate, first-response latency, question-category trend, conversion funnel, revenue attribution, or cost estimate. Those require a defined cohort, delivery-qualified events, and verified links from intent to order. They must not be inferred from the current counters. Comment analytics uses persisted `facebook_comments` and `comment_decisions` with separate receipt, decision, and action-success grains.

## Page comments

The client and agency comment views use the authenticated business scope. The agency view may span its Pages; the service also accepts a Page connection filter. The reporting window is a rolling 30 days ending at query time, in UTC. The open review queue is current state across all time, limited to its latest 50 decisions for display.

| Metric | Grain and formula | Source | Caveat |
| --- | --- | --- | --- |
| Comments received | Count of persisted Page comment rows created in the window | `facebook_comments` | Webhook delivery, not total Page comments; unsubscribed or rejected events are absent. |
| Decisions | Count of decision rows decided in the window, grouped by policy outcome | `comment_decisions` | A comment can have more than one decision after a policy version change. Decision is not proof of a Page write. |
| Action status | Count of those decisions by persisted action status | `comment_decisions` | `COMPLETED` covers keep/handoff as well as successful writes; inspect outcome jointly. `UNKNOWN` means an external result cannot be inferred. |
| Classification | Count of those decisions by stored classifier category | `comment_decisions.classification.category` | Rule-based categories express the classifier result, not verified intent or sentiment. |
| Open reviews | Count of decisions with `REVIEW_REQUIRED` or `UNKNOWN` status or `HANDOFF` outcome, lacking a review record | `comment_decisions` left joined to `comment_reviews` | Review acknowledgement is an operator record. It does not resend, reverse, or prove a Page action. |

No comment-to-order or revenue attribution is shown because this pipeline has no verified journey link from a comment decision to a completed order. Page impression and reach data are also unavailable in the current source.
