# TBG Communications Architecture v0.1

Status: **approved groundwork; no production schema change yet**  
Authority: Information, Media & Communication Constitution v1.3 and Communications & Social Layer Appendix v0.1

## Purpose

This document defines how The Beautiful Game grows from its current World Feed, manager system inbox, notifications and structured bilateral workflows into an integrated communications layer.

It deliberately does not start implementation. Its job is to preserve the correct boundaries before schema, API and UI work begins.

> **Conversation describes, accompanies and connects the football world. Structured actions change it.**

## Current platform assets

TBG already contains most of the non-conversational plumbing required by the social layer.

### Public social state

The current application already has world feed items, world feed comments, manager-authored comments, and manager-scoped social notifications for replies and related activity.

These are the natural starting point for world, competition and object-attached discussion.

### Private manager-facing state

The current application already has manager_messages as the private dashboard inbox, read_at state on manager messages, manager_notifications as the bell/attention channel, notification classes and preferences, notification email delivery, and appointment-scoped authenticated access.

These records are presently system/game-to-manager delivery, not human direct messaging.

### Authoritative bilateral workflows

The transfer implementation already separates a manager-facing workflow from canonical game state.

manager_world_commands owns formal transfer proposals and responses. get_manager_transfer_inbox(...) exposes pending offers to the receiving manager, while submit_manager_transfer_response(...) records the authoritative response and later projects the outcome back into manager_messages.

That pattern is the model for future Comms integration:

1. social conversation may surround a transfer;
2. the transfer action remains a structured TBG command;
3. the canonical result may be rendered back into the conversation.

## Lessons from private Top 100 Chat

Private Top 100 Chat is useful reference architecture but should not become a TBG dependency.

It has proven:

- Supabase-backed manager identity;
- stable manager-linked chat identity;
- short-lived SSO handoff;
- server-side private-community access control;
- isolated chat storage;
- PWA installation;
- opt-in Web Push;
- manager-bound subscription ownership;
- session-expiry and logout revocation;
- limits and account-switch protection for push endpoints;
- object/context binding into conversations;
- reproducible overlays rather than undocumented production edits.

It has not implemented private manager-to-manager conversations, conversation membership, per-conversation unread state, or direct-message participant permissions.

Upstream rss.chat also remains fundamentally a public-post/reply/feed model. Its feed architecture is excellent for Commons Chat and useful for Top 100, but TBG already has a stronger native event, identity and privacy model.

> **TBG Comms extends TBG. It does not embed rss.chat as the source of truth.**

## Target domain

The intended communications domain has four cooperating surfaces.

### 1. World/social discussion

Existing World Feed capabilities evolve into World, competition/division, club, news, player, fixture, transfer-market and recruitment/vacancy discussion.

These surfaces may share one canonical discussion model rather than maintaining separate comment systems.

### 2. Private conversation

New private manager-to-manager conversations add the missing human communication capability.

Minimum conceptual model:

    conversations
      id
      world_id
      conversation_type
      object_type?
      object_id?
      created_at
      closed_at?

    conversation_members
      conversation_id
      manager_id
      joined_at
      last_read_message_seq
      muted_at?
      left_at?

    conversation_messages
      id
      conversation_id
      message_seq
      sender_manager_id?
      sender_appointment_id?
      sender_club_id?
      actor_type
      actor_id?
      body
      metadata
      created_at
      edited_at?
      deleted_at?

This is a design contract, not final SQL.

### 3. Manager inbox and notifications

manager_messages and manager_notifications remain valuable and should not be blindly replaced by chat tables.

The working distinction is:

- conversation_messages — human or explicitly conversational actor dialogue;
- manager_messages — private system/game delivery and durable inbox records;
- manager_notifications — attention routing and unread/action indicators;
- manager_world_commands — authoritative game actions.

A future unified Comms UI may present all four together while preserving their different authority.

### 4. Listings

Transfer and recruitment adverts should be structured objects, not merely prose posts.

Examples include player available, player wanted, loan available/wanted, managerial vacancy, and manager available.

A listing may create or link to public discussion and private contact, but it never equals a formal offer, application or transfer command.

## Authority model

The most important implementation distinction is between conversation and state transition.

Example:

    Manager A: "Would you take £20m?"
    Manager B: "I'd probably accept £22m."

Those records are conversational only.

When Manager A presses **Submit Offer £22m**, TBG creates the existing authoritative command.

The conversation may then display:

    SYSTEM: Hamburg formally offered £22m.

That system line is a projection of canonical state, not the source transaction.

The same rule must hold for accept/reject/counter, contract promises, manager approaches, registrations, board choices, press stances, and any future structured action.

## Identity model

TBG manager identity is canonical. No communications account or username is created separately.

A conversation member references the TBG manager profile/identity. The manager's current appointment determines present-day eligibility and contact permissions, but each message also persists the sender's appointment and/or club affiliation at send time. Historical messages therefore continue to show the club context in which they were written even after the manager changes or leaves a club.

System actors must carry explicit actor types such as manager, agent, board, journalist, club, competition and system. Generated actors must never masquerade as humans.

## Object binding

Every discussion or conversation may optionally bind to a canonical object.

Preferred shape:

    object_type = "player"
    object_id   = "<canonical id>"

Supported types can include player, manager, club, fixture, competition, world-feed/news item, transfer listing, recruitment listing, vacancy and transfer command.

URLs and titles are presentation metadata, not identity. This is deliberately stronger than Top 100 Chat's URL-based source binding.

## Visibility and RLS

All privacy enforcement must be server-side.

Private-conversation read/write permission derives from conversation membership, active world eligibility and any explicit system-actor rule.

A hidden link, client filter or opaque ID is never a privacy control.

RLS/API tests must prove at minimum:

- non-member cannot read private conversation metadata;
- non-member cannot read messages;
- non-member cannot infer membership through obvious count/error differences where practical;
- member cannot impersonate another sender;
- manager from another world cannot participate unless explicitly authorised;
- removed/suspended managers follow the published retention/access policy;
- service-role/system insertion cannot silently bypass actor attribution.

## Read and unread state

Unread state is convenience, not game performance.

For ordinary conversations, unread state uses a per-conversation monotonic message cursor rather than timestamps. Each committed message receives an ordering value such as message_seq, allocated so that message insertion and read advancement cannot race past one another. Each member stores the highest message sequence they have read. Unread counts are derived from messages whose sequence is greater than that cursor, without writing one receipt per message.

Do not add visible read receipts, online-now status, typing indicators, streaks or response-speed rewards.

Authoritative obligations keep their existing deadline/state model and may be surfaced alongside conversation without becoming social read receipts.

## Notifications

The existing manager_notifications system should remain the canonical attention router.

Potential classes include social, info, action_required, reward and system.

A social message must never become action_required merely because another manager sent it.

Top 100 Chat's Web Push implementation is a strong extraction candidate. Reusable design features include opt-in per device, manager ownership of endpoints, expiry tied to authenticated access, logout revocation, account-switch protection, device/global limits, and no caching of private content in the service worker.

For TBG, push delivery should ultimately consume manager notifications rather than listen directly to a chat datastore.

## Public feeds

TBG does not need RSS for Comms.

Public RSS/Atom/JSON Feed endpoints may later project public canonical information such as world news, division/competition news, public club news and public transfer/recruitment listings.

They must be downstream publication adapters.

Never expose private conversations, conversation membership, read state, private manager inbox records, transfer command payloads or unrevealed/private world state.

## Relationship to existing World Feed

The long-term UI should avoid treating News, comments, messages and notifications as four unrelated products.

A plausible presentation model is:

    Comms
      For You
      Inbox
      World
      League
      Market

Those are views over different authoritative sources, not evidence that everything belongs in one database table.

Migration should be incremental:

1. preserve the current World Feed;
2. introduce the private-conversation domain;
3. bind conversations/discussions to canonical objects;
4. add listings;
5. unify navigation/presentation only after the source boundaries are tested.

## Privacy contract additions

The existing TBG data/privacy contract continues to govern public projection.

The communications layer adds additional never-public state:

- private conversation rows;
- membership lists;
- message bodies;
- read/mute state;
- private system inbox items;
- notification subscription endpoints;
- private conversation-derived metadata.

Private message content must not feed rumours, scouting, player AI, generated media or other game state.

If an enquiry or bid creates a rumour, the rumour derives from the authoritative enquiry/bid event already covered by constitutional leakage rules.

## Moderation

Implementation must include a moderation path before broad release.

Minimum requirements:

- report content;
- block ordinary direct social messages;
- preserve delivery of authoritative game/system obligations despite a social block;
- authenticated moderator actions;
- audit trail for restrictive/destructive actions;
- explicit retention/deletion policy.

## Delivery phases

### Phase A — schema and security proof

- finalise conversation schema;
- implement RLS/API functions;
- add security tests;
- no broad UI.

### Phase B — one-to-one manager conversation

- manager directory/contact action;
- private thread;
- unread state;
- notifications;
- mute/block/report foundation.

### Phase C — canonical object conversation

- bind player/club/fixture/news objects;
- open discussion/contact from game pages;
- preserve source authority.

### Phase D — market and recruitment listings

- structured AVAILABLE/WANTED listings;
- search/filter/expiry;
- public/scoped discussion;
- private contact.

### Phase E — authoritative action bridges

- transfer enquiry/offer/counter buttons inside relevant context;
- canonical command rendered back into conversation;
- no free-text parsing into game actions.

### Phase F — presentation unification

- Comms navigation;
- For You / Inbox / World / League / Market;
- retire duplicated UI only after parity.

### Phase G — optional interoperability

- public RSS/Atom/JSON Feed outputs;
- PWA push refinement;
- game-actor conversations where constitutionally authorised.

## Non-goals for the first implementation

Do not build voice/video, arbitrary file transfer, end-to-end encryption, presence/online status, typing indicators, public server/channel administration, Discord-style roles, engagement scoring, AI analysis of private manager conversation, a second identity provider, or an RSS dependency.

## Decision summary

1. TBG owns its communication data.
2. Existing TBG inbox, notifications, World Feed and commands remain authoritative in their domains.
3. Add only the missing private-conversation domain.
4. Reuse Top 100 Chat patterns for privacy, identity-linked delivery, PWA and push.
5. Do not make rss.chat a TBG dependency.
6. RSS may be emitted later as a public adapter.
7. Free text never changes game state.
8. Social activity never becomes a performance metric.

This architecture is intentionally conservative underneath and transformative at the UI level: managers should experience one living football world, while the code continues to know exactly which records are conversation, notification, public information and authoritative action.
