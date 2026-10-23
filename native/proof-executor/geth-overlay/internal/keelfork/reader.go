// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
// A request-scoped authenticated reader. It never accepts state overrides and
// never sends EVM calldata upstream. All reads stay anchored to Base.Hash().
package keelfork

import (
	"bytes"
	"context"
	"encoding/binary"
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
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/ethereum/go-ethereum/triedb/database"
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
	closureProofs                            uint64
	closureSeen                              map[common.Hash]bool
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
		accounts: make(map[common.Address]*types.StateAccount), slots: make(map[common.Address]map[common.Hash]common.Hash), codes: make(map[common.Hash][]byte), closureSeen: make(map[common.Hash]bool)}
	db := state.NewMPTDatabase(triedb.NewDatabase(disk, triedb.HashDefaults), state.NewCodeDB(disk))
	s, err := state.NewWithReader(base.Root, &witnessDatabase{Database: db, reader: r}, r)
	return r, s, err
}

// Keep Geth's real StateTrie and its normal mutation/copy semantics. Resolve a
// missing authenticated node at the database boundary, before Geth sees an
// error. No EVM call, state transition, or gas accounting is retried.
type witnessDatabase struct {
	state.Database
	reader *Reader
}

func (db *witnessDatabase) OpenStorageTrie(stateRoot common.Hash, address common.Address, root common.Hash, self state.Trie) (state.Trie, error) {
	if address != params.BeaconRootsAddress {
		return db.Database.OpenStorageTrie(stateRoot, address, root, self)
	}
	return trie.NewStateTrie(trie.StorageTrieID(stateRoot, crypto.Keccak256Hash(address.Bytes()), root), &witnessNodeDatabase{NodeDatabase: db.TrieDB(), reader: db.reader})
}

type witnessNodeDatabase struct {
	database.NodeDatabase
	reader *Reader
}

func (db *witnessNodeDatabase) NodeReader(root common.Hash) (database.NodeReader, error) {
	base, err := db.NodeDatabase.NodeReader(root)
	if err != nil {
		return nil, err
	}
	return &witnessNodeReader{NodeReader: base, reader: db.reader}, nil
}

type witnessNodeReader struct {
	database.NodeReader
	reader *Reader
}

func (n *witnessNodeReader) Node(owner common.Hash, path []byte, hash common.Hash) ([]byte, error) {
	blob, err := n.NodeReader.Node(owner, path, hash)
	if err != nil || len(blob) != 0 {
		return blob, err
	}
	return n.reader.completeBeaconWitness(owner, path, hash)
}

const beaconHistorySlots = 8191
const maxClosureMatches = 8
const maxClosureProofs = 32

// A finite canonical-contract key domain helps locate a proof; it is not proof
// authority. Only proofs verified against the ORIGINAL header root can add
// nodes. This remains true after the live trie has accumulated in-memory writes.
func (r *Reader) completeBeaconWitness(owner common.Hash, path []byte, hash common.Hash) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.err != nil {
		return nil, r.err
	}
	if err := r.ctx.Err(); err != nil {
		return nil, r.fail(err)
	}
	if owner != crypto.Keccak256Hash(params.BeaconRootsAddress.Bytes()) || hash == (common.Hash{}) || len(path) == 0 || len(path) > 64 {
		return nil, errors.New("unsupported missing witness identity")
	}
	for _, nibble := range path {
		if nibble > 15 {
			return nil, errors.New("invalid missing witness path")
		}
	}
	account := r.accounts[params.BeaconRootsAddress]
	if account == nil || common.BytesToHash(account.CodeHash) != crypto.Keccak256Hash(params.BeaconRootsCode) {
		return nil, errors.New("missing canonical beacon account proof")
	}
	if r.closureSeen[hash] {
		return nil, errors.New("repeated missing witness node")
	}
	r.closureSeen[hash] = true
	var candidates []common.Hash
	for i := uint64(0); i < 2*beaconHistorySlots; i++ {
		if i%128 == 0 {
			if err := r.ctx.Err(); err != nil {
				return nil, r.fail(err)
			}
		}
		var key common.Hash
		binary.BigEndian.PutUint64(key[24:], i)
		hashed := crypto.Keccak256Hash(key[:])
		matches := true
		for j, nibble := range path {
			actual := hashed[j/2] >> 4
			if j%2 != 0 {
				actual = hashed[j/2] & 15
			}
			if actual != nibble {
				matches = false
				break
			}
		}
		if matches {
			candidates = append(candidates, key)
			if len(candidates) > maxClosureMatches {
				return nil, errors.New("missing witness candidate budget exceeded")
			}
		}
	}
	if len(candidates) == 0 {
		return nil, errors.New("unknown missing witness preimage")
	}
	for _, key := range candidates {
		if r.closureProofs >= maxClosureProofs {
			return nil, errors.New("missing witness proof budget exceeded")
		}
		if err := r.ctx.Err(); err != nil {
			return nil, r.fail(err)
		}
		// Count attempted reads, including failures. The wire broker also retains its
		// existing cumulative read/response/wall limits; verify retains byte limits.
		r.closureProofs++
		if _, err := r.proof(params.BeaconRootsAddress, []common.Hash{key}); err != nil {
			return nil, err
		}
		blob := rawdb.ReadLegacyTrieNode(r.disk, hash)
		if len(blob) != 0 {
			if crypto.Keccak256Hash(blob) != hash {
				return nil, r.fail(errors.New("missing witness node hash mismatch"))
			}
			return blob, nil
		}
	}
	return nil, errors.New("authenticated witness completion made no progress")
}

func (r *Reader) Error() error         { r.mu.Lock(); defer r.mu.Unlock(); return r.err }
func (r *Reader) WitnessBytes() uint64 { r.mu.Lock(); defer r.mu.Unlock(); return r.bytes }
func (r *Reader) WitnessClosureProofs() uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.closureProofs
}
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

// EIP-1186 storage keys may use QUANTITY encoding, including odd-width 0x0.
// Preserve existing byte-padded responses too; both identify the same uint256.
func decodeStorageProofKey(encoded string) (common.Hash, error) {
	if len(encoded) < 3 || len(encoded) > 66 {
		return common.Hash{}, errors.New("storage proof key outside uint256 range")
	}
	if len(encoded)%2 != 0 {
		encoded = encoded[:2] + "0" + encoded[2:]
	}
	raw, err := hexutil.Decode(encoded)
	if err != nil {
		return common.Hash{}, err
	}
	return common.BytesToHash(raw), nil
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
		key, err := decodeStorageProofKey(item.Key)
		if err != nil || key != keys[i] {
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
