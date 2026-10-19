// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
package keelfork

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"os"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rlp"
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
