The original Gatorrr preflight spent 82,471 ms on its first native phase while
using 0.721 CPU seconds. Actual evidence recorded 327 native reads in that phase
and 666 successful HTTP responses across two phases before the unchanged snapshot
freshness check rejected the run. Repeated immutable reads are a plausible source
of avoidable network pacing; HTTP-body hashes alone do not prove semantic query
equality. A fresh actual Gatorrr run is still required to measure the benefit.

This change affects only `native/proof-executor/state-reader.mjs`. Each reader
keeps successful EIP-1898 proof/code responses for its own pinned block and fixed
approved-recipient set. The key is JSON.stringify of `[method, lowercaseAddress,
orderedLowercaseSlotsOrEmptyArray, lowercaseBlockHash]`. Each retained entry also
records its provider index, so a provider transition cannot reuse another
provider's response. No response cache is shared with another reader, even when
the existing request scheduler is shared.

The cache uses FIFO eviction, a maximum of 1,024 entries, and an inclusive
8,388,608-byte budget. Accounting is UTF-8 bytes of the normalized key plus UTF-8
bytes of JSON.stringify(result). Larger entries are returned without retention;
there is no truncated value or secondary/in-flight cache. Parameters are copied
before awaiting, stored values are deep-copied, and cache returns are deep-copied.
Valid empty code `0x` remains a cacheable exact value. Basic result-container
checks exclude malformed code/proof containers; the native executor continues to
authenticate every proof/code byte against its pinned root.

Chain, canonical-header and ancestor reads remain uncached. Any failed read
clears retained entries and increments a reader-local invalidation epoch, so an
older in-flight response cannot repopulate the cache. A caller cancellation does
not cancel another caller. Closing clears entries and aborts work; checks after
every awaited request reject late results. Observed access denial or a reorg
terminalizes the reader, including held concurrent successes. This also corrects
the previous catch-all setup-error fallback that could select another approved
recipient after an explicit HTTP 401/403. Availability/capability fallback for
429, timeout and unsupported methods remains bounded by the existing scheduler.
Current shared-pool access restrictions are checked before hits and after reads.

No public API, native Go code, clock, gas, calldata, block assumptions, resource
limits, polling interval, configured recipient, browser or deployment behavior is
changed. The public three-CREATE request remains separately unsupported and was
not rewritten or replayed.

Own validation: Node 22.22.1, pnpm 10.15.0, frozen-lockfile offline installation,
viem 2.55.19. `node scripts/build.mjs` passed. The focused unchanged reader,
transport, runner and packaging controls plus the new cache cases passed 58/58
with zero skips. The four canonical package dist trees contain 1,360 files; a
byte comparison against the frozen SDK64e outputs found exactly one changed
file: `packages/sdk/dist/proof-runtime/state-reader.js`. Raw build/test logs and
hashes accompany this report. Independent QA/review and actual candidate-image
Gatorrr execution remain separate gates; this report grants no release approval.
