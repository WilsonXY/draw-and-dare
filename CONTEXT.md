# Draw and Dare

A real-time multiplayer board game where participants scan QR cards, encounter power effects and enemies, and compete for points.

## Language

**Lobby**:
A game session hosted by a user where participants join, wait, and play.
_Avoid_: Room, session, match

**Participant**:
A user registered inside an active lobby with an associated score and active power effect.
_Avoid_: Member, player (when referring to lobby record)

**Turn**:
The sequential phase where the designated participant scans a card and resolves its consequences.
_Avoid_: Move, round

**Card**:
A game card identified by a QR code value belonging to one of three types: Empty Card, Power Card, or Enemy Card.
_Avoid_: Tile, token

**Power Effect**:
A special modifier active on a participant (Double Score, Skip Enemy, Point Steal) that alters card resolution.
_Avoid_: Buff, perk, ability

**Question**:
A trivia challenge presented when a participant draws an Enemy Card without a Skip Enemy power effect.
_Avoid_: Quiz, prompt
