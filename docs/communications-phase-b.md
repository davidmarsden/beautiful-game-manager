# TBG Comms Phase B — usable direct messaging

Status: **implementation branch**

Phase B turns the Phase A security boundary into the first usable manager-to-manager communication experience.

## Included

- Messages as a first-class Manager Portal view.
- Conversation list ordered by latest activity.
- One-to-one direct threads.
- Manager-directory **Message** action.
- Sending through the authenticated Phase A RPC.
- Monotonic unread counts and automatic read-cursor advancement on opening a thread.
- Existing manager notification fan-out for new private messages.
- Existing social-email preference routing for direct-message notifications.
- Per-conversation mute.
- Manager-to-manager social block.
- Message reporting foundation.
- Responsive tablet/mobile layout.

## Still separate

The existing dashboard Inbox remains the durable system/game inbox. Phase B does not merge it with Messages.

Formal transfer enquiries, offers, counters, accept/reject actions, board notices and other governed obligations remain in their existing authoritative systems.

A free-text message never creates or resolves a game action.

## Read privacy

The browser does not receive raw `conversation_members` rows.

Two service-only projection RPCs return only the data the caller needs:

- conversation list: other manager identity/current club, last-message preview, caller unread count, caller mute state and caller-created block state;
- thread: sanitized participant identity, message history and the caller's own read/mute state.

Other participants' read cursors, mute state and leave state are never projected.

## Notifications

A newly committed DM creates an ordinary `info` manager notification with `notification_type = direct_message`.

The notification does not contain the private message body. It says only that the named manager sent a private message and links to the thread.

Muted conversations suppress DM notification creation.

The existing notification delivery categorizer treats `direct_message` as social, so the existing **News/social** email preference controls DM email delivery without widening the notification-class enum.

## Blocking

A social block is deliberately narrow.

If either manager has blocked the other:

- a new direct conversation cannot be started;
- ordinary new messages cannot be sent.

A block does not alter or suppress `manager_messages`, transfer commands, deadlines, sanctions or other authoritative game obligations.

The UI only exposes whether **you** blocked the other manager. It does not expose the other manager's private block state.

## Reporting

Managers may report another manager's message as harassment, spam, abuse or other, with an optional short note.

Reports are private moderation records and create no automatic gameplay effect. Moderator review tooling is deferred.

## Deferred

Phase C still owns canonical object binding and object-attached discussion.

Transfer/recruitment listings remain Phase D.

Action bridges from conversation into formal transfer workflows remain Phase E.

Full Comms/Inbox/News presentation unification remains Phase F.
