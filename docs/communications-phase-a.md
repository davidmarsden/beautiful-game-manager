# TBG Comms Phase A — schema and security proof

Status: **implementation branch; not yet applied to production**

Authority:
- Information, Media & Communication Constitution v1.3
- Communications & Social Layer Appendix v0.1
- TBG Communications Architecture v0.1

## Purpose

Phase A creates the minimum private-conversation domain and proves the access boundary before any messaging UI exists.

It deliberately does not add:
- a Comms screen;
- manager directory buttons;
- notification fan-out;
- Web Push;
- transfer listings;
- object-attached discussion;
- game-actor conversations;
- any parsing of free text into game actions.

## Database model

Phase A adds three tables:

- `conversations`
- `conversation_members`
- `conversation_messages`

Only `direct` conversations are valid in this phase.

Direct threads are unique per manager pair and world. The pair key is derived server-side from the two canonical manager IDs, so reversed initiation cannot create a duplicate thread.

Messages carry:
- a per-conversation monotonic `message_seq`;
- canonical sender manager ID;
- sender appointment and club snapshots at send time;
- sender display-name snapshot;
- an idempotency key;
- body and metadata;
- creation/edit/delete timestamps.

## Read model and RLS

Authenticated clients receive SELECT only on conversations and messages.

Membership rows are not directly exposed because they contain private per-user state such as read cursors and mute/leave state. Phase B must expose a sanitized participant projection separately from the caller's own private membership state.

RLS permits a manager to read a conversation and its messages only when:
- the authenticated user maps to the member's TBG manager profile;
- that profile is active;
- that manager has an active membership row for the conversation;
- that manager still holds an active human appointment in the conversation's world.

The membership lookup is implemented by a narrowly scoped helper in the non-exposed `private` schema.

There are no authenticated direct INSERT, UPDATE or DELETE grants on the three conversation tables.

## Write API

All mutation happens through three authenticated RPCs:

### `start_direct_conversation(world_id, other_manager_id)`

Checks:
- authenticated caller;
- active TBG manager profile;
- active human appointment in the requested world;
- active human target appointment in the same world;
- target is not the caller.

The function creates or returns the unique direct thread and inserts both membership rows.

### `send_conversation_message(conversation_id, body, request_key)`

Checks:
- authenticated caller;
- existing open conversation;
- caller is an active member;
- caller currently has an active human appointment in that conversation's world;
- bounded non-empty body and idempotency key.

The function locks the parent conversation row before allocating the next message sequence. It snapshots the caller's appointment, club and display name, inserts the message, then advances the sender's own read cursor to the sequence they just sent.

Free text has no side effects outside the conversation tables.

### `mark_conversation_read(conversation_id, message_seq)`

Checks:
- authenticated active manager;
- active membership;
- supplied sequence is not beyond the conversation's committed sequence;
- positive supplied sequence corresponds to an existing message.

It locks the same conversation row used by message sends before advancing the member cursor.

That shared lock is the concurrency boundary: a send cannot commit an older logical message behind a newer read watermark.

## Security properties proved by contract tests

The repository test contract checks that:

1. only the three bounded Phase A tables are introduced;
2. all three have RLS enabled;
3. anonymous and broad public privileges are revoked;
4. authenticated reads are limited to conversations/messages, while raw membership state remains private;
5. all exposed reads require both membership and current active-human eligibility in the conversation's world;
6. manager identity comes from `auth.uid()`, never caller-supplied sender IDs;
7. direct conversations are same-world and human-manager only;
8. sender appointment/club identity is captured at send time;
9. send and read operations serialize on the same parent row;
10. request keys make retries idempotent;
11. free text does not write transfer, professionalism, rumour or other football state.

## Deferred to Phase B

Phase B may add:
- the first manager-to-manager UI;
- conversation listing/inbox projection;
- social `manager_notifications` fan-out;
- mute/block/report behaviour;
- pagination UX;
- notification preferences.

Those features must consume the Phase A boundary rather than weakening it.
