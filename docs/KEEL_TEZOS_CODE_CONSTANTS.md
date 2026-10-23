# Native code constants in deployment preparation

`planKeelTezosCodeConstants` reduces the serialized size of an existing compiled
Micheline script by replacing exact AST subtrees with immutable, content-addressed
Tezos global constants. It does not modify the contract's logic or NFT viewer.
The caller supplies the selected protocol's existing Micheline encoder.

The planner returns the original and packed byte counts, each constant's exact
value, expression hash, byte length and SHA-256, unsigned registration operations,
and the packed script. `expandKeelTezosCodeConstants` checks every commitment and
expands the packed script back to the compiler output. Unknown, changed, or
cyclic constants are rejected. No operation is signed or submitted.

Reuse a constant only after its inclusion receipt and exact selected-chain bytes
have been verified. A missing RPC route is not proof that a constant is absent.
Group registrations with `groupKeelTezosOperations`; dependencies must be included
before a packed origination can simulate. Measure the complete forged manager
group, counters, fees and signature against the current protocol limit. One
constant registration is not an extra deployment shell.

Before accepting an origination, expand its public script and compare its bytes
with the protocol-normalized compiler output. Octez may normalize timestamp
literals from strings to integers; normalize both sides using the protocol,
never silently ignore structural differences. Run the normal contract behavior,
custody, payment and permission checks as well.

These helpers are preparation capabilities, not selected-chain deployment or
behavioral-parity claims. Global constant storage fees are separate from the
expanded originated contract's storage fees; packing solves an operation-size
limit and does not make those bytes free.

Reference: https://octez.tezos.com/docs/alpha/global_constants.html
