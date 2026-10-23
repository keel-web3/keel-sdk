# Exact configured-reader physical batching

Baseline: Site3df02f2cdd2cc3e98c65a6409a385468435f6e77 / SDKedaa7446c2cfcec6eee27ca13d3f0cc4718822f7, actual consumed namespace2bf6d394. No native or hosted execution is performed by this author.

Measured: 1329 physical HTTP200 requests; max3991 UTF8 bytes, no access denial. 35 repeated canonical registry groups, 86 chainId calls, 621 latest-tag eth_call members. These are not admissible as indefinitely cached values. Native227 proof requests are unique. Per-logical-read single-slot250ms admission defeats the existing viem batch transport.

Reserved ownership requested: SDK public-simulation-pool.ts, provider-request-scheduler.ts and additive tests; Site server/chain/public-client.ts and additive real-loopback tests. No catalog, immutable proof cache, native executor, media or release state machine changes.

A wrapper can explicitly opt into a maximum16-member,64KiB synchronous read batch when its existing transport proves support. All inputs preserve exact method/params and recipient; no response cache. One physical batch consumes one existing scheduler slot and250ms interval. Same owner/phase wrapper only; distinct signals/recipients never combine. Underlying viem HTTP batch sends exact members and preserves ID association even for out-of-order responses. Per-member reverts, malformed output and unsupported methods remain original errors. All outcomes are inspected before delivering any result; any access denial wins and closes the provider, including HTTP200 JSON-RPC401403. No retry, provider, timeout, native cap, calldata or transaction changes.

Scheduler support records availability for actual member methods, not a fictitious batch method. Unsupported members restrict only their observed method; access denial remains provider-wide, rate-limit observes unchanged cooldown, a genuine revert is not retried or hidden. Aborted queued batch never dispatches; noncooperative in-flight work retains the physical slot until settlement. Bounded queue and aggregate body limits are explicit; oversized individual reads retain ordinary singleton behavior within their unchanged existing request limit.

Acceptance: unchanged Gatorrr/GIF normal review then full simulation and unsigned funding boundary under existing180s phase caps, measured by lead after independent approval. Local batch success is not that acceptance proof.
