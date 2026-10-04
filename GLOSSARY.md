# Liberal Page

The website of the Liberals in Likud cell: it presents the cell, follows Knesset legislation that
matters to it, and lets people send letters to public officials. This file fixes the meaning of
the project's own words. It is a glossary only — how anything is built belongs in `docs/`.

## Language

### People

**Cell**:
The Liberals in Likud group whose site this is.
_Avoid_: party, organisation, movement

**User**:
A person with an account on the site.
_Avoid_: account, login

**Member**:
A User who is signed in without administrative rights. It is a role, not a claim about belonging
to the Cell.
_Avoid_: supporter, subscriber

**Admin**:
A User who can manage letters, contacts, invites, flags and other Users.
_Avoid_: editor, moderator

**Visitor**:
A person using the public site without signing in.
_Avoid_: guest, anonymous user

**Invite**:
Permission for one email address to become a User. Without one, sign-in is refused.
_Avoid_: allowlist entry, whitelist

**Sender**:
A person who sends a Letter from their own mail, SMS or WhatsApp app. A Sender may be a Member or
a Visitor who arrived by a Share Page.
_Avoid_: supporter, member (when the point is the act of sending)

### Parliament

**Knesset**:
The Israeli parliament in one numbered term (the 25th Knesset, the 26th). "The current Knesset"
is the one sitting now.
_Avoid_: parliament, term (on its own)

**MK**:
A member of the Knesset.
_Avoid_: Knesset member, legislator, representative

**Faction**:
The parliamentary group an MK sits with in a given Knesset. An MK's Faction can change between
Knessets and, by defection, within one.
_Avoid_: party

**Liberal MK**:
An MK the Cell counts as one of its own.
_Avoid_: liberal (as a bare noun)

**Supporter MK**:
An MK who is not a Liberal MK but backs the Cell's positions.
_Avoid_: supporter (on its own), ally

**Bill**:
A proposed law moving through the Knesset.
_Avoid_: law, legislation, proposal

**Committee**:
A Knesset committee.

**Committee Session**:
One meeting of a Committee on a given date.
_Avoid_: session (on its own — it also means a sign-in session), meeting, hearing

**MK Role**:
An office an MK holds, such as a ministry, a committee seat or a faction post.
_Avoid_: position, role (on its own — Users also have roles)

**MK Activity**:
A dated action by an MK: initiating a Bill, a vote, a change of MK Role, or a parliamentary
question.

**Knesset Transition**:
The moment one Knesset ends and the next begins, after which MKs and Committees are re-evaluated
against the new Knesset.
_Avoid_: dispersal, election, rollover

### Tracking

**Tracking**:
The Cell's decision to follow a specific Bill, Committee or MK on the site.
_Avoid_: watching, following, subscribing

**Tracked Bill**, **Tracked Committee**, **Tracked MK**:
A Bill, Committee or MK that is under Tracking. A Tracked MK carries MK Roles, MK Activity and
votes; an MK that is not tracked is known only by name, Faction and photo.
_Avoid_: entity (outside technical writing), watched item

**Stance**:
The Cell's declared attitude to a Tracked Bill: supporting, opposing, or following without a view.
_Avoid_: position (it collides with an MK's office), vote

**Inactive**:
No longer part of the current Knesset: a Bill or Committee from an earlier Knesset, or a Tracked
MK with no seat in the current one. Inactive things keep their history and stay tracked until
explicitly removed.
_Avoid_: archived, historical, closed, deleted

**New Data**:
The mark on a tracked item showing that something about it changed since it was last looked at.
_Avoid_: update, notification, unread

**Document Summary**:
A short AI-written account of an official Knesset document, such as a Committee Session protocol.
_Avoid_: summary (on its own), abstract, digest

**Trending Bill**:
A Bill the Cell has hand-picked as noteworthy, with a stated reason.
_Avoid_: popular bill, hot bill

**Policy-Aligned Bill**:
A Bill surfaced because its subject matches the Cell's policy interests.

### Letters

**Letter**:
A published call to action that Senders send to public officials over one or more Channels.
_Avoid_: campaign, petition, message

**Channel**:
One way a Letter goes out: email, SMS or WhatsApp. Each Channel has its own text and its own
Recipients.
_Avoid_: medium, method

**Contact**:
A public official or body in the address book who can be written to.
_Avoid_: address, addressee, recipient (when meaning the address-book record)

**Recipient**:
A Contact chosen to receive a particular Letter on a particular Channel.
_Avoid_: contact (when meaning the choice for one Letter), target

**Reachable**:
Of a Contact on a Channel: having the detail that Channel needs. A Recipient who is not Reachable
on a Channel is skipped there.

**Template**:
A reusable visual frame that a Letter's email content is placed into.
_Avoid_: layout, theme

**Draft**, **Published**:
The two states of a Letter. Only a Published Letter can be seen and sent by anyone but an Admin.

**Send**:
One recorded act of a Sender opening a Letter in their own app in order to send it. It counts
intent: the site never sends the Letter itself and cannot know whether it was delivered.
_Avoid_: delivery, submission, click

**Share Page**:
The public page for one Published Letter that anyone can open and send from without signing in.
_Avoid_: share link (that is the Share Page's address), landing page, public letter

**Issue Tag**:
A topic label on a Letter, used to group and filter Letters.
_Avoid_: category, topic, label

**Pinned Letter**:
A Letter an Admin has placed at the top of the list and announced to Members.
_Avoid_: featured, promoted

### Notifications

**Alert Digest**:
An email telling Users which Tracked Bills changed status.
_Avoid_: notification, newsletter

**Join Click**:
One recorded act of a Visitor following a link to join the Cell.
_Avoid_: signup, conversion
