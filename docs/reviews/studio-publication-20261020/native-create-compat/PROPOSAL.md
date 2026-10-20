This is an isolated, unapproved source proposal based on SDK b524. The current
running/qualified Node cache candidate and d97/8a native artifacts are unchanged.
No actual CREATE, original GIF program, public RPC simulation, host action,
signature, spend, catalog activation or deployment occurred in this wave.

The frozen native shim rejected the retained public three-CREATE input because
it required full transaction output, exactly one call per block, and a non-null
target. The proposal accepts standard eth_simulateV1 response-format selection,
sequential calls in the original block, and ordinary CREATE with an omitted
recipient. The actual request is not split, renumbered or rewritten. The original
one-target-per-block SDK route remains supported.

Only `geth-overlay/internal/ethapi/keel_sparse.go` changes runtime source. Strict
unknown-field/override rejection, 256-block ceiling, pinned Sepolia/Amsterdam
header, gas envelopes and 10-billion request budget remain. The direct entry now
also applies the existing upstream public API count bounds (5,000 calls per
block and 10,000 total); those checks otherwise live outside simulator.execute.
Every input call is checked, including calls after the first. Geth performs its
normal state transitions and whole-block pre/post processing unchanged. Output
format uses the exact requested returnFullTransactions value.

The final verifier independently decodes the original raw payload after execution
and checks every returned block/call/transaction count, nonzero authenticated
root, sender, CREATE-versus-target identity, calldata, value, exact gas and each
explicit nonce/fee field. A cap or modified later transaction cannot be hidden by
checking only the first transaction. Genuine contract reverts retain Geth's
ordinary result/error path; the prerequisite qualification still requires three
successful statuses and exact compiled runtime bytes.

`current49d-public-three-create.json` is the exact payload from the retained
native-current-amd64-04 attempt (not the distinct earlier public-RPC timeout).
Its payload excluding newline is 112,110 bytes, SHA256
f6d790394223566f9b9f63a5729162f0fb273898099752647ddc2f301156aebf.
Including the retained newline it is 112,111 bytes, SHA256
de76973a117dbe9aba405f4753baf6d8e81e424fa0d2c1d196c064cb0effcbeb.
That attempt's full request was 112,184 bytes, request SHA256
dfd69c6aadba146408bad682285bdf1f602f58ed62a7b982796966af3fe78e4c.
The recorded header gas limit used by controls is exactly 199,609,569. This stale
public fixture is used only for parser and result-envelope tests, never replayed.
The historical 05:02 public attempt, its consumed global claim and READ_TIMEOUT
remain distinct and must not be reset or retried unchanged.

Own controls compile the proposed shim against the actual pinned Geth checkout
using Go's read-only overlay. They exercise admission/format/unknown-field and
gas guards, count boundaries, every later transaction field, missing roots,
counts and sender provenance. All 26 tests/subtests passed, with zero skips.
These are pure parser/result-envelope controls, not EVM execution or native
integration proof. The host was darwin/arm64, Go 1.25.8. No executor or runner
binary/image was rebuilt. The initial checksum-disabled toolchain setup error
and subsequent wrong-working-directory setup error are retained separately.

Before any new runtime use, independent review must approve this exact diff and
controls; actual official Linux builds need fresh executor/broker/image receipts;
existing successful publication/native controls must run without weakened
assertions; and a separately admitted fresh current49d three-CREATE qualification
must verify actual statuses, gas dimensions, runtime identities and whole-block
semantics. No old receipt can be relabeled with the new source.

The persistent counterfactual compiler interface is a separate proposal in
DERIVED-STATE-INTERFACE.md. This shim deliberately does not pretend that the
stateless public SDK transport already supplies that interface. Actual GIF live
proof still requires either receipt-backed prerequisite deployment followed by
fresh normal compilation, or explicitly labeled preapproval capacity evidence
followed by the same mandatory live receipt/read-back path.
