# TBG Comms Phase C — canonical object discussion

Status: **implementation branch**

Phase C attaches manager discussion to the football world without changing the authority model established in Phases A and B.

## Supported canonical objects

The first supported object types are:

- player;
- club;
- fixture;
- news / World Feed item.

Each discussion is keyed by:

```text
world_id + object_type + object_id
```

The object title is presentation metadata only. URLs and labels never define identity.

## Reusing the World Feed social model

Phase C deliberately does not create a second public-comment system.

A canonical object gets one hidden `world_feed_items` anchor with `item_type = object_discussion`. The existing `world_feed_comments` table then stores the public manager discussion and reply tree.

Object-discussion anchors are explicitly filtered out of the normal News feed. They are infrastructure attached to an object, not news stories.

This preserves the existing comment identity, club-at-comment-time context, moderation fields and notification model.

## Source authority

The server validates every requested object before an anchor can exist:

- club → `clubs` in the manager's world;
- fixture → either the live `fixtures` table or the persisted `canonical_match_archives` record for a completed match;
- news → an existing visible non-discussion `world_feed_items` row, whose existing comments are the discussion itself;
- player → the canonical world's `squad_cycle.players` object.

The browser cannot create an arbitrary discussion simply by supplying a plausible ID or title.

## User surfaces

A **Discuss** action is added to:

- TBG player profiles;
- read-only club inspection;
- fixture / match-centre links.

News is deliberately different: a News item already owns its canonical public discussion through the existing comment/reply thread, so Phase C does **not** add a second Discuss control or hidden parallel thread to News cards.

Player, club and fixture surfaces open the same responsive public discussion modal.

Replies are supported. A reply creates an ordinary manager notification to the manager being replied to, with a deep link back to the canonical object discussion.

## Authority boundary

Object discussion is explicitly marked `discussion_only`.

It does not:

- create transfer offers or enquiries;
- mutate canonical world saves;
- affect Professionalism;
- create player reactions;
- change scouting knowledge;
- create rumours merely from free text;
- alter match or club state.

If a later formal action is added beside a discussion, that action must remain a structured TBG command and may only be projected back into discussion after the canonical state transition succeeds.

## Relationship to private Messages

Phase B private manager conversations remain separate.

Phase C discussion is public to eligible managers in the world and attached to a football object. It does not expose private DM content or membership/read state.

## Deferred

Phase D adds structured market/recruitment listings.

Phase E adds explicit bridges from relevant context into authoritative transfer or recruitment actions.

Phase F can unify presentation once News, Inbox, private Messages and object discussion have proved their source boundaries.
