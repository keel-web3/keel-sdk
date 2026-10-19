// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
package keelfork

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
	"github.com/ethereum/go-ethereum/triedb"
)

type publicFixture struct {
	Header  json.RawMessage `json:"header"`
	Proof   json.RawMessage `json:"proof"`
	Code    hexutil.Bytes   `json:"code"`
	Address common.Address  `json:"address"`
	Slot    common.Hash     `json:"slot"`
}

func loadPublicFixture(t *testing.T) publicFixture {
	t.Helper()
	path := os.Getenv("KEEL_PUBLIC_PROOF_FIXTURE")
	if path == "" {
		t.Fatal("KEEL_PUBLIC_PROOF_FIXTURE is required; never fetch a fixture from the network")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var f publicFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func fixtureHeader(t *testing.T, f publicFixture) *types.Header {
	t.Helper()
	var h types.Header
	if err := json.Unmarshal(f.Header, &h); err != nil {
		t.Fatal(err)
	}
	return &h
}

func TestPublicAmsterdamHeaderIdentityAndRules(t *testing.T) {
	h := fixtureHeader(t, loadPublicFixture(t))
	want := common.HexToHash("0x92bf518d1ab755e0cea8dfb898646dba2f011b42cd6cc78eacf2df674ac03f6d")
	if h.Hash() != want || h.Number.Uint64() != 11886703 || h.Time != 1791661428 {
		t.Fatal("captured header identity changed")
	}
	if h.BlockAccessListHash == nil || h.SlotNumber == nil || *h.SlotNumber != 11327319 {
		t.Fatal("Amsterdam fields were lost")
	}
	raw, err := rlp.EncodeToBytes(h)
	if err != nil {
		t.Fatal(err)
	}
	var fields []rlp.RawValue
	if err := rlp.DecodeBytes(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(raw) != 672 || len(fields) != 23 {
		t.Fatalf("unexpected canonical header shape: %d bytes, %d fields", len(raw), len(fields))
	}
	config := params.SepoliaChainConfig
	if config.ChainID.Cmp(big.NewInt(11155111)) != 0 || config.AmsterdamTime == nil || *config.AmsterdamTime != 1791294816 {
		t.Fatal("unexpected pinned Sepolia configuration")
	}
	if !config.Rules(h.Number, true, h.Time).IsAmsterdam || config.IsAmsterdam(h.Number, *config.AmsterdamTime-1) {
		t.Fatal("wrong active fork or transition boundary")
	}
	for _, mutate := range []func(*types.Header){
		func(x *types.Header) { x.Root[0] ^= 1 },
		func(x *types.Header) { x.BlockAccessListHash = nil },
		func(x *types.Header) { x.SlotNumber = nil },
		func(x *types.Header) { *x.SlotNumber++ },
	} {
		x := types.CopyHeader(h)
		mutate(x)
		if x.Hash() == want {
			t.Fatal("altered header retained the captured identity")
		}
	}
}

// Select only the requested captured witness. Account-only requests reuse the
// real account proof and omit the storage proof; no trie nodes are invented.
func fixtureReader(t *testing.T, f publicFixture, h *types.Header, change func(string, map[string]any), corruptCode bool) *Reader {
	t.Helper()
	read := func(_ context.Context, method string, p []any, out any) error {
		if p[0] != f.Address.Hex() {
			return errors.New("uncaptured public account")
		}
		anchor := p[len(p)-1].(map[string]any)
		if anchor["blockHash"] != h.Hash().Hex() || anchor["requireCanonical"] != true {
			return errors.New("unpinned fixture read")
		}
		var raw []byte
		if method == "eth_getProof" {
			var proof map[string]any
			if err := json.Unmarshal(f.Proof, &proof); err != nil {
				return err
			}
			keys := p[1].([]string)
			if len(keys) == 0 {
				proof["storageProof"] = []any{}
			} else if len(keys) != 1 || keys[0] != f.Slot.Hex() {
				return errors.New("uncaptured public slot")
			}
			if change != nil {
				change(method, proof)
			}
			raw, _ = json.Marshal(proof)
		} else if method == "eth_getCode" {
			code := append(hexutil.Bytes(nil), f.Code...)
			if corruptCode {
				code[0] ^= 1
			}
			raw, _ = json.Marshal(code)
		} else {
			return errors.New("unapproved fixture read")
		}
		return json.Unmarshal(raw, out)
	}
	r, _, err := NewReader(context.Background(), h, read, 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestCapturedPublicAccountStorageAndCode(t *testing.T) {
	f := loadPublicFixture(t)
	h := fixtureHeader(t, f)
	r := fixtureReader(t, f, h, nil, false)
	a, err := r.Account(f.Address)
	if err != nil || a == nil {
		t.Fatalf("account proof: %v", err)
	}
	if a.Nonce != 1 || !a.Balance.IsZero() || a.Root != common.HexToHash("0x026891c2ea7440fc572166aa1dfa6f0833b3222149c8141bbf1d41686dacfa3e") {
		t.Fatal("wrong proven account")
	}
	code := r.Code(f.Address, common.BytesToHash(a.CodeHash))
	if hexutil.Encode(code) != hexutil.Encode(f.Code) || r.Error() != nil {
		t.Fatal("code hash verification failed")
	}
	value, err := r.Storage(f.Address, f.Slot)
	if err != nil || value != common.HexToHash("0x6ac9299c") {
		t.Fatalf("storage proof: %v", err)
	}
	if r.AccountProofs != 2 || r.StorageProofs != 1 || r.CodeChecks != 1 {
		t.Fatal("unexpected verification counters")
	}
}

func TestCapturedPublicWitnessTampering(t *testing.T) {
	for _, kind := range []string{"state-root", "missing-account-node", "missing-storage-node", "storage-value", "code"} {
		t.Run(kind, func(t *testing.T) {
			f := loadPublicFixture(t)
			h := fixtureHeader(t, f)
			if kind == "state-root" {
				h.Root[0] ^= 1
			}
			change := func(_ string, p map[string]any) {
				if kind == "missing-account-node" {
					p["accountProof"] = p["accountProof"].([]any)[1:]
				}
				storage := p["storageProof"].([]any)
				if len(storage) > 0 {
					s := storage[0].(map[string]any)
					if kind == "missing-storage-node" {
						s["proof"] = s["proof"].([]any)[1:]
					}
					if kind == "storage-value" {
						s["value"] = "0x1"
					}
				}
			}
			r := fixtureReader(t, f, h, change, kind == "code")
			a, err := r.Account(f.Address)
			if err == nil && a != nil {
				r.Code(f.Address, common.BytesToHash(a.CodeHash))
				_, _ = r.Storage(f.Address, f.Slot)
			}
			if r.Error() == nil {
				t.Fatal("altered witness was accepted")
			}
		})
	}
}

func TestUntrustedAccountSummaryCannotOverrideProvenBalance(t *testing.T) {
	f := loadPublicFixture(t)
	r := fixtureReader(t, f, fixtureHeader(t, f), func(_ string, p map[string]any) { p["balance"] = "0xffff"; p["nonce"] = "0x99" }, false)
	a, err := r.Account(f.Address)
	if err != nil || a == nil || !a.Balance.IsZero() || a.Nonce != 1 {
		t.Fatal("untrusted RPC summary changed proven state")
	}
}

func TestCapturedPublicZeroSlotQuantityKey(t *testing.T) {
	f := loadPublicFixture(t)
	if f.Slot != (common.Hash{}) {
		t.Fatal("the unchanged historical public fixture must authenticate slot zero")
	}
	// EthPandaOps returns QUANTITY 0x0 even when the requested slot is DATA32.
	// Preserve every authenticated proof node and value from the real snapshot.
	r := fixtureReader(t, f, fixtureHeader(t, f), func(_ string, p map[string]any) {
		for _, item := range p["storageProof"].([]any) {
			item.(map[string]any)["key"] = "0x0"
		}
	}, false)
	value, err := r.Storage(f.Address, f.Slot)
	if err != nil || r.Error() != nil {
		t.Fatalf("valid quantity key rejected before authenticating its original proof: %v", err)
	}
	var original proofResponse
	if err := json.Unmarshal(f.Proof, &original); err != nil {
		t.Fatal(err)
	}
	if len(original.StorageProof) != 1 || original.StorageProof[0].Value == nil || value != common.BigToHash(original.StorageProof[0].Value.ToInt()) {
		t.Fatal("quantity key changed the proven storage value")
	}
	if r.StorageProofs != 1 {
		t.Fatal("the storage proof was not authenticated")
	}
}

func TestStorageProofKeyEncodings(t *testing.T) {
	for _, encoded := range []string{"0x0", "0x00", "0x" + strings.Repeat("0", 64)} {
		key, err := decodeStorageProofKey(encoded)
		if err != nil || key != (common.Hash{}) {
			t.Fatalf("zero key %q: %v", encoded, err)
		}
	}
	for _, encoded := range []string{"0xabc", "0x0abc", "0x" + strings.Repeat("0", 61) + "abc"} {
		key, err := decodeStorageProofKey(encoded)
		if err != nil || key != common.HexToHash("0x0abc") {
			t.Fatalf("nonzero key %q: %v", encoded, err)
		}
	}
	for _, encoded := range []string{"", "0x", "0x-1", "-0x1", "0xg", "0x1z", "abc", " 0x0", "0x1" + strings.Repeat("0", 64)} {
		if _, err := decodeStorageProofKey(encoded); err == nil {
			t.Fatalf("invalid or overflowing key %q accepted", encoded)
		}
	}
}

func TestCapturedQuantityProofStillRejectsInvalidEvidence(t *testing.T) {
	for _, kind := range []string{"empty-key", "overflow-key", "negative-key", "nonhex-key", "foreign-slot", "duplicate-slot", "missing-proof-node", "invalid-value"} {
		t.Run(kind, func(t *testing.T) {
			f := loadPublicFixture(t)
			r := fixtureReader(t, f, fixtureHeader(t, f), func(_ string, p map[string]any) {
				proofs := p["storageProof"].([]any)
				if len(proofs) == 0 {
					return
				}
				item := proofs[0].(map[string]any)
				item["key"] = "0x0"
				switch kind {
				case "empty-key":
					item["key"] = "0x"
				case "overflow-key":
					item["key"] = "0x1" + strings.Repeat("0", 64)
				case "negative-key":
					item["key"] = "0x-1"
				case "nonhex-key":
					item["key"] = "0xg"
				case "foreign-slot":
					item["key"] = "0x1"
				case "duplicate-slot":
					p["storageProof"] = append(proofs, item)
				case "missing-proof-node":
					item["proof"] = item["proof"].([]any)[1:]
				case "invalid-value":
					item["value"] = "0xffffffffffffffff"
				}
			}, false)
			if _, err := r.Storage(f.Address, f.Slot); err == nil || r.Error() == nil {
				t.Fatal("invalid quantity-key proof was accepted")
			}
		})
	}
}

// Actual public-chain witness; no publication source or program is included.
type beaconDeletionFixture struct {
	Header        json.RawMessage `json:"header"`
	BlockHash     common.Hash     `json:"blockHash"`
	Address       common.Address  `json:"address"`
	DeleteSlot    common.Hash     `json:"deleteSlot"`
	SiblingSlot   common.Hash     `json:"siblingSlot"`
	DeletionProof json.RawMessage `json:"deletionProof"`
	SiblingProof  json.RawMessage `json:"siblingProof"`
	MissingNode   common.Hash     `json:"missingNode"`
	MissingOwner  common.Hash     `json:"missingOwner"`
	MissingPath   hexutil.Bytes   `json:"missingPath"`
}

func loadBeaconDeletionFixture(t *testing.T) (beaconDeletionFixture, *types.Header) {
	t.Helper()
	path := os.Getenv("KEEL_PUBLIC_PROOF_FIXTURE")
	if path == "" {
		t.Fatal("KEEL_PUBLIC_PROOF_FIXTURE is required")
	}
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(path), "../../native/proof-executor/fixtures/sepolia-beacon-deletion-20261019.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f beaconDeletionFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	var h types.Header
	if err := json.Unmarshal(f.Header, &h); err != nil {
		t.Fatal(err)
	}
	if h.Hash() != f.BlockHash || f.BlockHash != common.HexToHash("0xba9aff4bb893ca2894304cb807e5e45d324f1033998dcc8fdf0d6dfe8de6ed45") || h.Number.Uint64() != 11948749 || f.Address != params.BeaconRootsAddress {
		t.Fatal("actual canonical beacon fixture identity changed")
	}
	return f, &h
}
func beaconFixtureReader(t *testing.T, ctx context.Context, f beaconDeletionFixture, h *types.Header, change func(map[string]any), failure error) (*Reader, *state.StateDB, *int) {
	t.Helper()
	reads := new(int)
	read := func(ctx context.Context, method string, p []any, out any) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if method != "eth_getProof" || p[0] != f.Address.Hex() {
			return errors.New("uncaptured beacon read")
		}
		anchor := p[2].(map[string]any)
		if anchor["blockHash"] != h.Hash().Hex() || anchor["requireCanonical"] != true {
			return errors.New("unpinned beacon proof")
		}
		keys := p[1].([]string)
		raw := f.DeletionProof
		extra := len(keys) == 1 && keys[0] == f.SiblingSlot.Hex()
		if extra {
			*reads++
			if failure != nil {
				return failure
			}
			raw = f.SiblingProof
		}
		if len(keys) > 1 || (len(keys) == 1 && !extra && keys[0] != f.DeleteSlot.Hex()) {
			return errors.New("uncaptured beacon slot")
		}
		var proof map[string]any
		if err := json.Unmarshal(raw, &proof); err != nil {
			return err
		}
		if len(keys) == 0 {
			proof["storageProof"] = []any{}
		}
		if extra && change != nil {
			change(proof)
		}
		raw, _ = json.Marshal(proof)
		return json.Unmarshal(raw, out)
	}
	r, s, err := NewReader(ctx, h, read, 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	return r, s, reads
}
func plainFixtureState(t *testing.T, r *Reader) *state.StateDB {
	t.Helper()
	db := state.NewMPTDatabase(triedb.NewDatabase(r.disk, triedb.HashDefaults), state.NewCodeDB(r.disk))
	s, err := state.NewWithReader(r.base.Root, db, r)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func deleteBeaconSlot(s *state.StateDB, f beaconDeletionFixture, h *types.Header) common.Hash {
	s.SetState(f.Address, f.DeleteSlot, common.Hash{})
	return s.IntermediateRoot(params.SepoliaChainConfig.Rules(h.Number, true, h.Time))
}
func TestActualBeaconDeletionBaselineAndAuthenticatedClosure(t *testing.T) {
	f, h := loadBeaconDeletionFixture(t)
	baseline, _, baselineReads := beaconFixtureReader(t, context.Background(), f, h, nil, nil)
	old := plainFixtureState(t, baseline)
	deleteBeaconSlot(old, f, h)
	var missing *trie.MissingNodeError
	if !errors.As(old.Error(), &missing) || missing.NodeHash != f.MissingNode || missing.Owner != f.MissingOwner || !bytes.Equal(missing.Path, f.MissingPath) || *baselineReads != 0 {
		t.Fatalf("exact retained failure not reproduced: %v", old.Error())
	}
	reference, _, _ := beaconFixtureReader(t, context.Background(), f, h, nil, nil)
	if _, err := reference.Storage(f.Address, f.SiblingSlot); err != nil {
		t.Fatal(err)
	}
	refState := plainFixtureState(t, reference)
	want := deleteBeaconSlot(refState, f, h)
	if refState.Error() != nil || reference.Error() != nil {
		t.Fatalf("authenticated union failed: %v/%v", refState.Error(), reference.Error())
	}
	candidate, s, reads := beaconFixtureReader(t, context.Background(), f, h, nil, nil)
	got := deleteBeaconSlot(s, f, h)
	if common.BytesToHash(candidate.accounts[f.Address].CodeHash) != crypto.Keccak256Hash(params.BeaconRootsCode) {
		t.Fatal("actual authenticated beacon code hash differs")
	}
	if s.Error() != nil || candidate.Error() != nil || got != want || *reads != 1 || candidate.closureProofs != 1 {
		t.Fatalf("closure diverged: got=%s want=%s state=%v reader=%v reads=%d", got, want, s.Error(), candidate.Error(), *reads)
	}
	if s.GetState(f.Address, f.DeleteSlot) != (common.Hash{}) || s.GetState(f.Address, f.SiblingSlot) == (common.Hash{}) {
		t.Fatal("deletion or untouched sibling output changed")
	}
	copied := s.Copy() // Must retain a genuine Geth trie, never a state.Trie wrapper.
	if copied.IntermediateRoot(params.SepoliaChainConfig.Rules(h.Number, true, h.Time)) != want || copied.Error() != nil {
		t.Fatal("copied trie diverged")
	}
	t.Logf("exact baseline missing=%s; closure root=%s equals verified union; additional proofs=%d; no EVM/state replay", f.MissingNode, got, *reads)
}
func TestBeaconClosureIdentityAndResourceFailures(t *testing.T) {
	for _, kind := range []string{"owner", "code", "unproven-account", "empty-path", "invalid-path", "long-path", "wide-prefix", "unknown-path", "zero-hash", "foreign-hash", "repeated-hash", "proof-budget", "witness-budget", "cancel", "deadline", "401", "403", "no-progress", "foreign-root", "foreign-slot", "foreign-value", "invalid-proof", "node-hash"} {
		t.Run(kind, func(t *testing.T) {
			f, h := loadBeaconDeletionFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var failure error
			if kind == "deadline" {
				failure = context.DeadlineExceeded
			}
			if kind == "401" || kind == "403" {
				failure = fmt.Errorf("HTTP %s access denied", kind)
			}
			change := func(p map[string]any) {
				storage := p["storageProof"].([]any)[0].(map[string]any)
				switch kind {
				case "foreign-root":
					var foreign map[string]any
					if err := json.Unmarshal(loadPublicFixture(t).Proof, &foreign); err != nil {
						t.Fatal(err)
					}
					p["accountProof"] = foreign["accountProof"]
				case "invalid-proof":
					storage["proof"].([]any)[0] = "0xc0"
				case "foreign-slot":
					storage["key"] = "0x1234"
				case "foreign-value":
					storage["value"] = "0x1"
				}
			}
			r, _, reads := beaconFixtureReader(t, ctx, f, h, change, failure)
			if _, err := r.Storage(f.Address, f.DeleteSlot); err != nil {
				t.Fatal(err)
			}
			owner, path, hash := f.MissingOwner, []byte(f.MissingPath), f.MissingNode
			switch kind {
			case "owner":
				owner[0] ^= 1
			case "code":
				r.accounts[f.Address].CodeHash = make([]byte, 32)
			case "unproven-account":
				delete(r.accounts, f.Address)
			case "empty-path":
				path = nil
			case "invalid-path":
				path = []byte{16}
			case "long-path":
				path = make([]byte, 65)
			case "wide-prefix":
				path = []byte{6}
			case "unknown-path":
				path = make([]byte, 64)
			case "zero-hash":
				hash = common.Hash{}
			case "foreign-hash":
				hash[0] ^= 1
			case "node-hash":
				hash[0] ^= 1
				rawdb.WriteLegacyTrieNode(r.disk, hash, []byte{0xc0})
			case "repeated-hash":
				r.closureSeen[hash] = true
			case "proof-budget":
				r.closureProofs = maxClosureProofs
			case "witness-budget":
				r.maxBytes = r.bytes
			case "cancel":
				cancel()
			case "no-progress":
				hashed := crypto.Keccak256(f.DeleteSlot[:])
				path = make([]byte, 64)
				for i, b := range hashed {
					path[2*i] = b >> 4
					path[2*i+1] = b & 15
				}
			}
			_, err := r.completeBeaconWitness(owner, path, hash)
			if err == nil {
				t.Fatal("invalid/incomplete closure accepted")
			}
			if kind == "401" || kind == "403" || kind == "deadline" {
				_, again := r.completeBeaconWitness(owner, path, hash)
				if !errors.Is(again, failure) || *reads != 1 {
					t.Fatal("denial/timeout issued another request")
				}
			}
			if kind == "no-progress" && !strings.Contains(err.Error(), "no progress") {
				t.Fatalf("expected actual no-progress failure: %v", err)
			}
			if *reads > 1 || r.closureProofs > maxClosureProofs {
				t.Fatal("unbounded or alternate recipient read")
			}
			requiresRead := map[string]bool{"foreign-hash": true, "witness-budget": true, "deadline": true, "401": true, "403": true, "foreign-root": true, "foreign-slot": true, "foreign-value": true, "invalid-proof": true, "node-hash": true}
			if requiresRead[kind] && (*reads != 1 || r.closureProofs != 1) {
				t.Fatalf("failed proof not counted once: reads=%d proofs=%d", *reads, r.closureProofs)
			}
		})
	}
}

func TestBeaconClosureCumulativeAttemptBudgetAndCycles(t *testing.T) {
	f, h := loadBeaconDeletionFixture(t)
	r, _, reads := beaconFixtureReader(t, context.Background(), f, h, nil, nil)
	if _, err := r.Storage(f.Address, f.DeleteSlot); err != nil {
		t.Fatal(err)
	}
	for i := uint64(1); i <= maxClosureProofs; i++ {
		hash := common.BigToHash(new(big.Int).SetUint64(i))
		if _, err := r.completeBeaconWitness(f.MissingOwner, f.MissingPath, hash); err == nil || !strings.Contains(err.Error(), "no progress") {
			t.Fatalf("foreign hash was accepted: %v", err)
		}
	}
	if *reads != maxClosureProofs || r.WitnessClosureProofs() != maxClosureProofs {
		t.Fatal("failed attempts were not counted cumulatively")
	}
	if _, err := r.completeBeaconWitness(f.MissingOwner, f.MissingPath, f.MissingNode); err == nil || !strings.Contains(err.Error(), "budget") || *reads != maxClosureProofs {
		t.Fatal("cumulative proof budget exceeded")
	}
	if _, err := r.completeBeaconWitness(f.MissingOwner, f.MissingPath, common.BigToHash(big.NewInt(1))); err == nil || !strings.Contains(err.Error(), "repeated") || *reads != maxClosureProofs {
		t.Fatal("repeated hash cycle dispatched another read")
	}
}

type fixedWitnessNodeReader struct {
	blob []byte
	err  error
}

func (n fixedWitnessNodeReader) Node(common.Hash, []byte, common.Hash) ([]byte, error) {
	return n.blob, n.err
}
func TestBeaconClosureDoesNotRetryExistingNodesOrDatabaseErrors(t *testing.T) {
	f, h := loadBeaconDeletionFixture(t)
	r, _, reads := beaconFixtureReader(t, context.Background(), f, h, nil, nil)
	failure := errors.New("unrelated database error")
	for _, base := range []fixedWitnessNodeReader{{blob: []byte{1, 2}}, {err: failure}} {
		wrapped := &witnessNodeReader{NodeReader: base, reader: r}
		got, err := wrapped.Node(f.MissingOwner, f.MissingPath, f.MissingNode)
		if !bytes.Equal(got, base.blob) || err != base.err || *reads != 0 || r.WitnessClosureProofs() != 0 {
			t.Fatal("non-missing result triggered witness completion")
		}
	}
}
