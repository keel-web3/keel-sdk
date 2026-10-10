// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
// A request-scoped authenticated reader. It never accepts state overrides and
// never sends EVM calldata upstream. All reads stay anchored to Base.Hash().
package keelfork

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethdb"
	"github.com/ethereum/go-ethereum/ethdb/memorydb"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
	"github.com/ethereum/go-ethereum/triedb"
)

type ReadFunc func(context.Context, string, []any, any) error

type Reader struct {
	mu                                       sync.Mutex
	ctx                                      context.Context
	read                                     ReadFunc
	base                                     *types.Header
	disk                                     ethdb.Database
	accounts                                 map[common.Address]*types.StateAccount
	slots                                    map[common.Address]map[common.Hash]common.Hash
	codes                                    map[common.Hash][]byte
	err                                      error
	bytes, maxBytes                          uint64
	AccountProofs, StorageProofs, CodeChecks uint64
}

type proofResponse struct {
	Address      common.Address  `json:"address"`
	AccountProof []hexutil.Bytes `json:"accountProof"`
	StorageProof []struct {
		Key   string          `json:"key"`
		Value *hexutil.Big    `json:"value"`
		Proof []hexutil.Bytes `json:"proof"`
	} `json:"storageProof"`
}

func NewReader(ctx context.Context, base *types.Header, read ReadFunc, maxBytes uint64) (*Reader, *state.StateDB, error) {
	disk := rawdb.NewMemoryDatabase()
	r := &Reader{ctx: ctx, read: read, base: types.CopyHeader(base), disk: disk, maxBytes: maxBytes,
		accounts: make(map[common.Address]*types.StateAccount), slots: make(map[common.Address]map[common.Hash]common.Hash), codes: make(map[common.Hash][]byte)}
	db := state.NewMPTDatabase(triedb.NewDatabase(disk, triedb.HashDefaults), state.NewCodeDB(disk))
	s, err := state.NewWithReader(base.Root, db, r)
	return r, s, err
}
func (r *Reader) Error() error         { r.mu.Lock(); defer r.mu.Unlock(); return r.err }
func (r *Reader) WitnessBytes() uint64 { r.mu.Lock(); defer r.mu.Unlock(); return r.bytes }
func (r *Reader) fail(err error) error {
	if r.err == nil {
		r.err = err
	}
	return r.err
}
func (r *Reader) anchor() map[string]any {
	return map[string]any{"blockHash": r.base.Hash().Hex(), "requireCanonical": true}
}
func (r *Reader) verify(root common.Hash, key []byte, nodes []hexutil.Bytes) ([]byte, error) {
	if len(nodes) > 128 {
		return nil, errors.New("proof node count exceeded")
	}
	if root == types.EmptyRootHash {
		if len(nodes) != 0 {
			return nil, errors.New("nonempty proof for empty trie")
		}
		return nil, nil
	}
	proof := memorydb.New()
	for _, node := range nodes {
		if len(node) == 0 || len(node) > 64*1024 || r.bytes+uint64(len(node)) > r.maxBytes {
			return nil, errors.New("witness byte budget exceeded")
		}
		r.bytes += uint64(len(node))
		if err := proof.Put(crypto.Keccak256(node), node); err != nil {
			return nil, err
		}
	}
	value, err := trie.VerifyProof(root, key, proof)
	if err != nil {
		return nil, fmt.Errorf("invalid Merkle proof: %w", err)
	}
	// Nodes enter the sparse database only after a successful anchored proof.
	for _, node := range nodes {
		rawdb.WriteLegacyTrieNode(r.disk, crypto.Keccak256Hash(node), node)
	}
	return value, nil
}
func cloneAccount(a *types.StateAccount) *types.StateAccount {
	if a == nil {
		return nil
	}
	copy := *a
	copy.Balance = a.Balance.Clone()
	copy.CodeHash = common.CopyBytes(a.CodeHash)
	return &copy
}
func (r *Reader) proof(addr common.Address, keys []common.Hash) (*types.StateAccount, error) {
	var response proofResponse
	slots := make([]string, len(keys))
	for i, key := range keys {
		slots[i] = key.Hex()
	}
	if err := r.read(r.ctx, "eth_getProof", []any{addr.Hex(), slots, r.anchor()}, &response); err != nil {
		return nil, r.fail(err)
	}
	if response.Address != addr || len(response.StorageProof) != len(keys) {
		return nil, r.fail(errors.New("proof response identity mismatch"))
	}
	encoded, err := r.verify(r.base.Root, crypto.Keccak256(addr[:]), response.AccountProof)
	if err != nil {
		return nil, r.fail(err)
	}
	var account *types.StateAccount
	if encoded != nil {
		account = new(types.StateAccount)
		if err := rlp.DecodeBytes(encoded, account); err != nil {
			return nil, r.fail(err)
		}
		if account.Balance == nil || len(account.CodeHash) != 32 {
			return nil, r.fail(errors.New("invalid proven account"))
		}
	}
	r.AccountProofs++
	if old, ok := r.accounts[addr]; ok {
		a, _ := rlp.EncodeToBytes(old)
		b, _ := rlp.EncodeToBytes(account)
		if !bytes.Equal(a, b) {
			return nil, r.fail(errors.New("inconsistent pinned account proof"))
		}
	}
	r.accounts[addr] = cloneAccount(account)
	root := types.EmptyRootHash
	if account != nil {
		root = account.Root
	}
	if r.slots[addr] == nil {
		r.slots[addr] = make(map[common.Hash]common.Hash)
	}
	for i, item := range response.StorageProof {
		keyBytes, err := hexutil.Decode(item.Key)
		if err != nil || len(keyBytes) > 32 || common.BytesToHash(keyBytes) != keys[i] {
			return nil, r.fail(errors.New("storage proof key mismatch"))
		}
		encoded, err := r.verify(root, crypto.Keccak256(keys[i][:]), item.Proof)
		if err != nil {
			return nil, r.fail(err)
		}
		var raw []byte
		if encoded != nil {
			if err := rlp.DecodeBytes(encoded, &raw); err != nil {
				return nil, r.fail(err)
			}
			if len(raw) > 32 {
				return nil, r.fail(errors.New("oversized proven storage value"))
			}
		}
		value := common.BytesToHash(raw)
		if item.Value == nil || item.Value.ToInt().Sign() < 0 || item.Value.ToInt().BitLen() > 256 || common.BigToHash(item.Value.ToInt()) != value {
			return nil, r.fail(errors.New("storage proof value mismatch"))
		}
		r.slots[addr][keys[i]] = value
		r.StorageProofs++
	}
	return cloneAccount(account), nil
}
func (r *Reader) Account(addr common.Address) (*types.StateAccount, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return nil, r.err
	}
	if err := r.ctx.Err(); err != nil {
		return nil, r.fail(err)
	}
	if a, ok := r.accounts[addr]; ok {
		return cloneAccount(a), nil
	}
	return r.proof(addr, nil)
}
func (r *Reader) Storage(addr common.Address, key common.Hash) (common.Hash, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return common.Hash{}, r.err
	}
	if err := r.ctx.Err(); err != nil {
		return common.Hash{}, r.fail(err)
	}
	if value, ok := r.slots[addr][key]; ok {
		return value, nil
	}
	account, known := r.accounts[addr]
	if !known {
		var err error
		account, err = r.proof(addr, nil)
		if err != nil {
			return common.Hash{}, err
		}
	}
	// A verified absent account or EmptyRootHash authenticates every base-state
	// slot as zero. Do not query the provider once per fresh write to that trie.
	// StateDB still carries subsequent writes; this Reader describes only Base.
	if account == nil || account.Root == types.EmptyRootHash {
		r.slots[addr][key] = common.Hash{}
		return common.Hash{}, nil
	}
	if _, err := r.proof(addr, []common.Hash{key}); err != nil {
		return common.Hash{}, err
	}
	return r.slots[addr][key], nil
}
func (r *Reader) Code(addr common.Address, hash common.Hash) []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return nil
	}
	if hash == types.EmptyCodeHash {
		return nil
	}
	account, ok := r.accounts[addr]
	if !ok {
		var err error
		account, err = r.proof(addr, nil)
		if err != nil {
			return nil
		}
	}
	if account == nil || common.BytesToHash(account.CodeHash) != hash {
		r.fail(errors.New("code request does not match proven account"))
		return nil
	}
	if code, ok := r.codes[hash]; ok {
		return common.CopyBytes(code)
	}
	var code hexutil.Bytes
	if err := r.read(r.ctx, "eth_getCode", []any{addr.Hex(), r.anchor()}, &code); err != nil {
		r.fail(err)
		return nil
	}
	if len(code) > 24576 || crypto.Keccak256Hash(code) != hash {
		r.fail(errors.New("code hash mismatch or unsupported code size"))
		return nil
	}
	if r.bytes+uint64(len(code)) > r.maxBytes {
		r.fail(errors.New("witness byte budget exceeded"))
		return nil
	}
	r.bytes += uint64(len(code))
	r.codes[hash] = common.CopyBytes(code)
	r.CodeChecks++
	return common.CopyBytes(code)
}
func (r *Reader) Has(addr common.Address, hash common.Hash) bool     { return len(r.Code(addr, hash)) > 0 }
func (r *Reader) CodeSize(addr common.Address, hash common.Hash) int { return len(r.Code(addr, hash)) }

// DecodeResult allows the stdio transport to decode only the result payload.
func DecodeResult(raw json.RawMessage, out any) error { return json.Unmarshal(raw, out) }
