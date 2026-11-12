# GTDo as a Telegram Mini App — design

Date: 2026-11-12. Requested as "the same as Fintrack", whose design the user
approved the same day; this records how it maps onto GTDo.

## Goal

Run GTDo inside Telegram with the same lists, rules and `data.json` as the
macOS app, with tasks synced between the user's Telegram clients.

## Approach

The web app is the Mini App. A Telegram layer switches on only when the page is
launched from Telegram; in a plain browser nothing changes and nothing is
loaded from the network. No server, no bot code.

## Units

- `src/core/cloudSync.ts` — pure. Lays the encoded document out across
  CloudStorage keys (≤4000 ASCII characters each): `ft_meta`, the document
  without its tasks (`ft_h_*`), the task ids in document order (`ft_o_*`), and
  the tasks bucketed by id hash (`ft_t_<bucket>_*`). One edit rewrites one
  bucket and the meta key. The id list makes the round trip byte-identical
  through `core/codec`. Writes are diffed against the last known cloud
  contents; the meta key carries a checksum, so a reader that catches a write
  halfway gets `CloudBusyError` and retries.
- Reconciliation is whole-document, last write wins: an empty cloud is filled
  from local; a newer cloud replaces a clean local; when both changed, the
  later timestamp wins; a device that never synced adopts the cloud.
- `StoreBase.onDocumentChange` — raised by `persist()` only when the encoded
  document actually differs, so a no-op save never looks like an edit.
- `StoreBase.adoptRemote(raw)` — replaces the document with the cloud's,
  snapshotting the replaced one first, without raising `onDocumentChange`.
  Declines under a pending undo, a failed save, or unreadable stored bytes;
  the pull is committed only once adoption succeeded, so it is offered again.
- `src/app/sync/syncRunner.ts` — when to sync: at launch, on return to the app,
  and 1.2 s after an edit. Launch housekeeping (auto-empty Trash) waits for the
  first sync, so purging a stale copy cannot outrank the cloud.
- `src/telegram/` — wrapper over `window.Telegram.WebApp`, loaded before React
  renders because the hash router would otherwise overwrite the launch
  parameters. Theme ("System" = Telegram's scheme), chrome colours from the
  paper token, Back button stack, haptics, CloudStorage as promises. A
  dev-only mock (`?tgmock`).
- UI: Settings gains a "Telegram sync" section; inside Telegram, Export becomes
  "Copy data.json". The Back button closes Settings, the detail sheet, then the
  lists pane.

## Errors

A failed sync leaves local data untouched and is retried on the next edit, on
return to the app, or by "Sync now". A cloud copy that stays unreadable offers
"Upload this device's tasks". A document too large for 1000 keys is refused
with a message.

## Out of scope

Bot commands, reminders delivered by a bot, record-level merge.
