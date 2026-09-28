# Phase 7 metric definitions

## Agency overview

The agency home page refreshes current PostgreSQL aggregates per request. All timestamps and rolling windows use UTC.

| Metric | Grain and formula | Source | Caveat |
| --- | --- | --- | --- |
| Businesses | Count of all registered business rows | `businesses` | Includes paused, expired, and disabled records. |
| Unread | Count of unread conversations with `is_test = false` | `conversations` | Current state; each conversation counts once. |
| Open handoffs | Count of handoff requests in `HANDOFF_REQUESTED`, `HUMAN_ACTIVE`, or `PAUSED`, joined to non-test conversations | `handoffs`, `conversations` | Request count; multiple requests for one conversation can count more than once. |
| Failed runs · 7 days | Count of `FAILED` runs started in the rolling preceding seven days | `agent_runs` | Includes all run kinds and does not imply a customer-facing reply failed. |

The current client overview is an operational snapshot from PostgreSQL, queried when the server renders the page. Every query uses the authenticated business ID; there is no cross-business aggregation in client views. Timestamps shown in this view use UTC. Values are not a historical report or a real-time push feed; reload to refresh them.

| Metric | Grain and formula | Source | Window/filter | Caveat |
| --- | --- | --- | --- | --- |
| Unread conversations | Count of conversation rows whose `unread` flag is true | `conversations` | Current state, selected business, `is_test = false` | A conversation counts once regardless of unread message volume. |
| Unresolved handoffs | Count of handoff rows in `HANDOFF_REQUESTED`, `HUMAN_ACTIVE`, or `PAUSED` | `handoffs` joined to `conversations` | Current state, selected business, excluding test conversations | More than one handoff on a conversation can count more than once. It is a request count, not a unique conversation count. |
| Failed runs · 7 days | Count of agent-run rows with `FAILED` status and `started_at` in the rolling preceding seven days | `agent_runs` | Selected business, UTC instant at query time | This includes all run kinds, including runs without a conversation; it does not prove a customer-facing reply failed. |
| Urgent conversations | Count of conversation rows whose `urgent` flag is true | `conversations` | Current state, selected business, `is_test = false` | Priority is the stored operational flag, not model-derived sentiment. |
| Recent conversations | Latest 25 conversation rows by `updated_at`, then ID | `conversations` joined to `customers` | Selected business, excluding tests; optional unread/urgent and ownership filters | Bounded list, not a total. Customer names may be absent. |
| Recent agent runs | Latest 25 runs by `started_at`, then ID | `agent_runs` joined to `agents` | Selected business; failed filter uses the same rolling seven-day window as the card | Status and timing only; prompts, traces, unsafe tool details, and provider errors are omitted. |
| AI first-response rate · 30 days | Conversations whose first successful outbound message was from `AGENT` divided by all conversations with a customer message in the window | `messages`, `conversations` | First customer message in the rolling 30-day UTC window; excludes test conversations | Unanswered conversations stay in the denominator. `AGENT` messages are recorded only after successful adapter delivery. |
| Handoff rate · 30 days | Distinct inbound-cohort conversations with a handoff created in the window divided by all conversations with a customer message in the window | `handoffs`, `messages`, `conversations` | Same rolling 30-day UTC inbound cohort | Handoff initiation is not a completed sale or proof that a human replied. |
| Customers helped · 30 days | Distinct non-null customer records from inbound-cohort conversations with a successful outbound response | `messages`, `conversations` | Same rolling 30-day UTC inbound cohort | Counts database customer records; merged identity links are not deduplicated into one person. |
| Median first-response time · 30 days | Median time from a conversation’s first inbound customer message to its first successful `AGENT` or `HUMAN` outbound message | `messages`, `conversations` | Same rolling 30-day UTC inbound cohort; UTC timestamps | Only conversations with a successful response are included. This is message-to-first-reply time, not platform webhook arrival latency. |

The overview performance card runs only on the overview page, uses a business-scoped database aggregate, and refreshes on page load. The first-response cohort starts with each conversation’s first customer message in the window. Successful outbound messages are identified by a persisted external message ID or `lifecycle.status = SENT`; adapters persist these after accepting delivery. The rates use the full inbound cohort denominator, while latency uses only conversations with a response.

The agency Usage page reports persisted run token totals by business and agent, completed model-call tokens by business/agent/provider/model, and tool/browser activity grouped by business, agent, and operation. Its rolling 30-day window uses UTC. Recent-run rows provide run-level totals. These are provider-reported token counts and AgentOS action counts, not invoices. Dollar cost is unavailable without a verified price schedule or invoice feed. Optional comment-classifier model usage is not included in these aggregates.

Top question categories, customer objections, and an attributable conversion funnel remain unavailable for conversation messages because they do not have a validated persisted classifier or journey link. Revenue attribution and cost estimates are also unavailable. Do not infer those values from comment categories, run activity, or unrelated order records. Comment analytics uses persisted `facebook_comments` and `comment_decisions` with separate receipt, decision, and action-success grains.

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
