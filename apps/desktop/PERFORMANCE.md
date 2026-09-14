# Desktop optimization pass — September 7, 2026

The editor now prepares verification previews in one background worker, shares
validated workspace snapshots, and avoids serializing source files on each
keystroke. Existing creator data and the registered canonical shell are preserved.

## Measured result

The local sample uses 24 projects with 128 KiB of extra source each, 50 workspace
reads, and a 4 MiB GIF fixture with random trailing bytes. The before measurement
ran the previous implementation. The after measurement uses the built preview
worker, including its cold startup. Both produced a 5,672,622-byte preview graph.

| Measurement | Before | After |
| --- | ---: | ---: |
| 50 workspace reads | 351.00 ms | 0.09 ms |
| Longest main event-loop delay during preview | 185.86 ms | 11.35 ms |
| First preview build, including worker startup | 347.33 ms | 282.81 ms |
| Repeated preview from cache | Not measured | 0.17 ms |

These are individual local observations, not an FPS guarantee or a prediction
for every file or computer. The baseline used an in-memory SQLite store; the
after sample uses a temporary disk-backed store so the worker can read original
bytes. Random trailing bytes differ between runs. UI responsiveness is the main
purpose of the worker; cold worker startup can add time under load.

Run `pnpm --filter @keel/desktop benchmark` after building. The sample creates
and removes its own temporary workspace and writes `artifacts/performance-after.json`.
The original observation is retained in `artifacts/performance-before.json`.
The approach follows [Electron's performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance).

## Changes

- **Preview work:** original-byte reads, integrity checks, compression and graph
  assembly run outside the main process's event loop. The worker invokes the
  canonical SDK builders and never executes creator code.
- **Bounded reuse:** identical pending previews share one job. Completed graphs
  use an LRU cache capped at eight entries and 64 MiB, with conservative string
  accounting. At most four distinct jobs are pending; oversized graphs are
  served without retention. Failures are retriable and quitting stops the worker.
- **Content identity:** notes, wallets, target networks and delivery preferences
  do not invalidate an unchanged graph. Delivery warnings are recalculated from
  its measured resource sizes. Source and asset changes trigger a new build.
- **Workspace reads:** one immutable, validated snapshot is reused until SQLite's
  revision changes. Other writers and transaction rollbacks are still detected.
  Saves validate once and retain compare-and-swap protection.
- **Editing:** dirty-state comparison exits on unchanged references and changed
  primitives. The release planner and ABI controls are memoized. Project saves
  share one path; duplicate actions are ignored, and new edits made during a
  pending save remain unsaved rather than being overwritten.
- **Requests:** local queries do not refetch on every focus or retry deterministic
  IPC errors. Catalogs load when needed. Live network polling remains explicit,
  with refresh on focus when stale. Shared request tracking discards results
  from contract and gas forms whose inputs changed while awaiting a response.
- **Lifetime:** optional wallet restoration no longer delays the first editor
  paint; extension actions still wait for integrity verification. Dismissed
  backup reviews release their retained bytes. Unused source-import, planner
  and Base64 media-preview IPC routes were removed.

## Acceptance

The TypeScript check and desktop build pass. All 29 desktop tests pass, including
new snapshot, worker, cache, failure recovery and stale-request coverage. Native
Electron checks pass for duplicate saves, edits during a pending save, late
contract/gas responses, dismissed backup reviews, large GIF import and exact
export, canonical shell/direct display, isolated previews, extension profiles
and a complete process restart. Desktop and compact screenshots retain the
existing layout without horizontal overflow.

This pass changes the local desktop runtime. It does not establish new wallet
compatibility, signing support or live-chain publication evidence. The broader
remaining work is recorded in [the readiness audit](../../docs/KEEL_ENGINE_READINESS.md).
