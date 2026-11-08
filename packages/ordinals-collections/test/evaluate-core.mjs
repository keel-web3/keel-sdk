import * as M from "../src/core.ts";
export const summarize = (s) => ({
  count: s.count,
  over: s.over,
  cap: s.cap,
  endHeight: s.endHeight,
  sold: s.sold,
  members: s.members.map((x) => ({ id: x.id, n: x.n })),
  refund: s.refund.map((x) => ({ id: x.id, reason: x.reason })),
  rejected: s.rejected,
  pending: s.pending,
  acceptedControls: s.controls.accepted.map((x) => x.id),
  ignoredControls: s.controls.ignored,
  membersRoot: s.membersRoot,
  overRoot: s.overRoot,
  indexRoot: s.indexRoot,
});
export function evaluate(kind, input) {
  if (kind === "metadata") {
    const leaves = input.messages.map((m, i) => M.metadataLeaf(i + 1, m));
    return {
      messageHashes: input.messages.map((x) => M.hex(M.sha(M.utf(x)))),
      leaves: leaves.map(M.hex),
      node12: M.hex(M.sha(M.b("01"), leaves[0], leaves[1])),
      root: M.hex(M.merkle(leaves)),
      proof2: M.proof(leaves, 1),
      proof3: M.proof(leaves, 2),
      proofsValid: leaves.every((x, i) =>
        M.verifyProof(x, M.proof(leaves, i), M.merkle(leaves)),
      ),
      emptyRoot: M.hex(M.merkle([])),
      singletonRoot: M.hex(M.merkle([leaves[0]])),
      cycle: input.positions.map((n) => ((n - 1) % leaves.length) + 1),
    };
  }
  if (kind === "permutation")
    return M.permutation(input.recipe, input.blockhash, input.max);
  if (kind === "wire")
    return {
      outpoint: M.hex(M.outpoint(input.displayTxid, input.index)),
      recipeMarker: M.marker("00".repeat(36)),
      mintMarker: M.marker(input.recipe),
      markerBytes: M.b(M.marker(input.recipe)).length,
      ordDelegateValue: M.hex(
        M.ordIdValue(M.outpoint(input.displayTxid, input.index)),
      ),
      ordDelegateRoundtrip: M.hex(
        M.ordIdFromValue(
          M.ordIdValue(M.outpoint(input.displayTxid, input.index)),
        ),
      ),
    };
  if (kind === "escrow") return M.escrow(input.payment, input.minter);
  if (kind === "mint") {
    const form = M.formCheck(input);
    if (form.error) return { status: "ignored", reason: form.error };
    if (input.height === null) return { status: "pending", position: null };
    if (
      M.recipeCheck(input.recipe, input.refs).length ||
      input.recipe.height >= input.recipe.end.open
    )
      return { status: "ignored", reason: "recipe" };
    if (
      input.height < input.recipe.end.open ||
      (input.recipe.end.close !== undefined &&
        input.height > input.recipe.end.close)
    )
      return { status: "refund", reason: "window" };
    const n = (input.earlierValid || 0) + 1;
    return {
      status:
        input.recipe.end.max !== undefined && n > input.recipe.end.max
          ? "over-cap"
          : "member",
      position: n,
      txid: form.txid,
    };
  }
  if (kind === "recipe")
    return { errors: M.recipeCheck(input.recipe, input.refs) };
  if (kind === "state")
    return input.heights.map((x) =>
      summarize(
        M.indexState(
          input.recipe,
          input.refs,
          input.candidates,
          x.height,
          x.hash,
          input.controls,
        ),
      ),
    );
  if (kind === "escrow-policy") return M.escrowPolicy(input);
  if (kind === "commit-auth") return { authenticated: M.authenticateCommit(input.rawTx, input.commitTx) };
  throw Error("Unknown vector kind: " + kind);
}
