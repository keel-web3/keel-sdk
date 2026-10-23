# Public cache cleanup5ada: blocked

Two independent no-host controls fail: a missing cwd/exe target skips reference checks for an otherwise live PID with a cache FD, and an error after a successful quarantine rename loses move tracking/restoration. Source and exact plan/transfer hashes are bound in review.json.

The controls use a synthetic proc fixture and real test-owned directory rename with injected post-mutation failure. They do not claim actual Linux or production-host qualification. Author29 Linux controls are separate and were not independently rerun before reporting these blockers.

No cleanup or import admission is granted. The plan's888 file metadata rows match its qualified evidence, but actual remote cache contents were not rehashed by this reviewer. The discovery-fixed final image needs a new import tuple and budget;494d remains held. No production action was performed.
