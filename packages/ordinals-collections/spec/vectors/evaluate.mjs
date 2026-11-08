import * as M from "./model.mjs";
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
  if (kind === "challenge") {
    const valid = M.challengeCheck(
        input.challenge,
        input.cache,
        input.entries,
        input.hostHashes,
      ),
      rows = valid
        ? M.patch(input.cache, input.challenge, input.entries)
        : input.cache.entries;
    const s = M.rootFromEntries(
      input.recipe.id,
      input.cache.h,
      input.cache.hash,
      rows,
      input.recipe.end.max ?? null,
    );
    const before = input.cache.entries.map((x) => x.txid);
    return {
      valid,
      orderedIds: rows.map((x) => x.id),
      positions: rows.map((x, i) => ({
        id: x.id,
        n: i + 1,
        shift: before.includes(x.txid) ? i - before.indexOf(x.txid) : null,
      })),
      patchedRoot: s.indexRoot,
      count: s.count,
      over: s.over,
      canonicalMatch: s.indexRoot === input.canonicalRoot,
    };
  }
  if (kind === "writers") {
    const originals = input.writers.map((w, i) =>
      M.writerChain(w.updates, {
        authority: w.authority,
        recipe: input.recipe,
        hostHashes: input.hostHashes,
        pins: input.pins.filter((p) => p.writerIndex === i),
        cap: input.cap,
        corrections: input.corrections,
      }),
    );
    return {
      chains: originals.map(({ entries, ...rest }) => rest),
      merged: M.merge({
        originals,
        registry: input.registry,
        self: input.self,
        challenges: input.challenges,
        ch: input.ch,
        q: input.q,
        W: input.W,
        unresolved: input.unresolved,
      }),
    };
  }
  if (kind === "registry")
    return M.registryRead(input.children, input.originals, input.burnHeight);
  if (kind === "escrow-policy") return M.escrowPolicy(input);
  if (kind === "shell") {
    const incomplete = input.challenges > 32 || input.pageEntries > 1000;
    const depth = M.confirmations(input.height, input.tip),
      member = input.recipeValid && input.inIndex && !input.burned,
      verified = member && depth >= input.F && !incomplete,
      final =
        verified &&
        input.C !== null &&
        input.height + input.W <= input.C &&
        !input.unresolved;
    return {
      depth,
      verified,
      final,
      current: member,
      artVerified: !!(
        input.artBytes && M.hex(M.sha(M.b(input.artBytes))) === input.artHash
      ),
      metadataVerified: !!(
        input.leaf && M.verifyProof(input.leaf, input.path, input.root)
      ),
      entryAssurance: input.count <= 1000 ? "exhaustive" : "sampled",
      challengeBudget: Math.min(32, input.challenges),
      incomplete,
      followNextAsAuthority: false,
      bridgeAccepted: !input.bridged || input.existingGroth16Verified === true,
      spentKnown: input.spenderResponse !== undefined,
      scanStopped:
        input.endHeight !== null &&
        input.C !== null &&
        input.endHeight + input.F <= input.C,
      cancelReservesSupply: false,
      directOptInRequired: input.paymentMode === "direct",
    };
  }
  if (kind === "headers")
    return { valid: M.headerCheck(input.headers, input.hostHashes) };
  if (kind === "block") return M.parseBlock(input.raw);
  if (kind === "numbers")
    return {
      ord: [...input.entries]
        .sort((a, b) => a.ordNumber - b.ordNumber)
        .map((x) => x.id),
      rpc: [...input.entries]
        .sort((a, b) => a.rpcNumber - b.rpcNumber)
        .map((x) => x.id),
      chain: [...input.entries]
        .sort((a, b) => a.txIndex - b.txIndex)
        .map((x) => x.id),
    };
  if (kind === "witness-boundary") {
    const a = M.parseTx(input.a),
      b = M.parseTx(input.b);
    return {
      sameTxid: a.txid === b.txid,
      sameStripped: a.strippedHex === b.strippedHex,
      sameWitness:
        JSON.stringify(a.inputs.map((v) => v.witness)) ===
        JSON.stringify(b.inputs.map((v) => v.witness)),
      s2AloneAuthenticatesEnvelope: false,
    };
  }
  if (kind === "light-switch")
    return {
      switchAllowed:
        input.challengeValid && input.patchedRoot === input.nextRoot,
      completenessProven: false,
      fullRejectsCache: input.computedRoot !== input.cacheRoot,
    };
  if (kind === "tags")
    return {
      valid:
        input.tag7 === "koc1" &&
        input.metadata.p === "koc1" &&
        [
          "recipe",
          "mint",
          "index",
          "challenge",
          "control",
          "writer",
          "koc1-pin",
          "koc1-number",
        ].includes(input.metadata.op),
      cbor: M.hex(M.cbor(input.metadata)),
    };
  throw Error("Unknown vector kind: " + kind);
}
