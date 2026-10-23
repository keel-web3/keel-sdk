// Copyright 2026 The go-ethereum Authors
// SPDX-License-Identifier: LGPL-3.0-or-later
// Private diagnostic adapter. It changes no opcode, gas, fork or consensus rule.
package ethapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/consensus/beacon"
	"github.com/ethereum/go-ethereum/consensus/ethash"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethdb"
	"github.com/ethereum/go-ethereum/ethdb/memorydb"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/rpc"
	"github.com/ethereum/go-ethereum/trie"
	"github.com/ethereum/go-ethereum/triedb"
)

type KeelStorageProof struct {
	Key   common.Hash     `json:"key"`
	Value *hexutil.Big    `json:"value"`
	Proof []hexutil.Bytes `json:"proof"`
}
type KeelProofAccount struct {
	Address      common.Address     `json:"address"`
	Code         hexutil.Bytes      `json:"code"`
	CodeHash     common.Hash        `json:"codeHash"`
	Balance      *hexutil.Big       `json:"balance"`
	Nonce        hexutil.Uint64     `json:"nonce"`
	StorageHash  common.Hash        `json:"storageHash"`
	AccountProof []hexutil.Bytes    `json:"accountProof"`
	StorageProof []KeelStorageProof `json:"storageProof"`
}
type KeelSparseInput struct {
	ChainID         uint64             `json:"chainId"`
	HeaderRLP       hexutil.Bytes      `json:"headerRlp"`
	HeaderHash      common.Hash        `json:"headerHash"`
	AncestorHeaders []hexutil.Bytes    `json:"ancestorHeaders"`
	Accounts        []KeelProofAccount `json:"accounts"`
	Program         json.RawMessage    `json:"program"`
	StageGasCap     uint64             `json:"stageGasCap"`
}
type KeelStateAccess struct {
	Kind    string         `json:"kind"`
	Address common.Address `json:"address"`
	Slot    *common.Hash   `json:"slot,omitempty"`
}
type KeelSparseStageResult struct {
	Index      int               `json:"index"`
	Checkpoint common.Hash       `json:"checkpoint"`
	Result     json.RawMessage   `json:"result"`
	Accesses   []KeelStateAccess `json:"accesses"`
}
type KeelWitnessError struct {
	Stage          int              `json:"stage"`
	Kind           string           `json:"kind"`
	Access         *KeelStateAccess `json:"access,omitempty"`
	Cause          string           `json:"cause"`
	AncestorNumber *hexutil.Uint64  `json:"ancestorNumber,omitempty"`
	AncestorHash   *common.Hash     `json:"ancestorHash,omitempty"`
}

func (e *KeelWitnessError) Error() string {
	return fmt.Sprintf("%s at stage %d: %s", e.Kind, e.Stage, e.Cause)
}

type keelSparseBackend struct {
	Backend
	base      *types.Header
	ancestors map[uint64]*types.Header
	config    *params.ChainConfig
	engine    consensus.Engine
}

func (b *keelSparseBackend) ChainConfig() *params.ChainConfig { return b.config }
func (b *keelSparseBackend) Engine() consensus.Engine         { return b.engine }
func (b *keelSparseBackend) CurrentHeader() *types.Header     { return types.CopyHeader(b.base) }
func (b *keelSparseBackend) RPCEVMTimeout() time.Duration     { return 30 * time.Second }
func (b *keelSparseBackend) HeaderByNumber(_ context.Context, n rpc.BlockNumber) (*types.Header, error) {
	if n < 0 {
		panic(&KeelWitnessError{Stage: -1, Kind: "missing-header", Cause: "Noncanonical relative header request"})
	}
	if h := b.ancestors[uint64(n)]; h != nil {
		return types.CopyHeader(h), nil
	}
	number := hexutil.Uint64(n)
	panic(&KeelWitnessError{Stage: -1, Kind: "missing-header", AncestorNumber: &number, Cause: fmt.Sprintf("Canonical ancestor %d was not supplied", n)})
}
func (b *keelSparseBackend) HeaderByHash(_ context.Context, hash common.Hash) (*types.Header, error) {
	for _, h := range b.ancestors {
		if h.Hash() == hash {
			return types.CopyHeader(h), nil
		}
	}
	panic(&KeelWitnessError{Stage: -1, Kind: "missing-header", AncestorHash: &hash, Cause: "Canonical ancestor hash was not supplied: " + hash.Hex()})
}

type KeelSparseSession struct {
	sim       *simulator
	backend   *keelSparseBackend
	blocks    []simBlock
	headers   []*types.Header
	completed []*types.Header
	results   []json.RawMessage
	next      int
	stageCap  uint64
	closed    bool
	disk      ethdb.Database
}

func proofDB(nodes []hexutil.Bytes) (*memorydb.Database, error) {
	db := memorydb.New()
	for _, node := range nodes {
		if len(node) == 0 || len(node) > 1<<20 {
			return nil, errors.New("Invalid proof node length")
		}
		if err := db.Put(crypto.Keccak256(node), node); err != nil {
			return nil, err
		}
	}
	return db, nil
}
func verifyKeelProof(root common.Hash, key []byte, nodes []hexutil.Bytes) ([]byte, error) {
	if root == types.EmptyRootHash {
		if len(nodes) != 0 {
			return nil, errors.New("Empty root has extraneous proof")
		}
		return nil, nil
	}
	db, err := proofDB(nodes)
	if err != nil {
		return nil, err
	}
	return trie.VerifyProof(root, key, db)
}
func importKeelWitness(header *types.Header, accounts []KeelProofAccount) (ethdb.Database, *state.StateDB, error) {
	disk := rawdb.NewMemoryDatabase()
	seen := map[common.Address]bool{}
	witnessBytes := 0
	for _, a := range accounts {
		witnessBytes += len(a.Code)
		for _, n := range a.AccountProof {
			witnessBytes += len(n)
		}
		for _, sp := range a.StorageProof {
			for _, n := range sp.Proof {
				witnessBytes += len(n)
			}
		}
		if witnessBytes > 128<<20 {
			return nil, nil, errors.New("Witness byte budget exceeded")
		}
	}
	for _, a := range accounts {
		if seen[a.Address] {
			return nil, nil, errors.New("Duplicate account proof")
		}
		seen[a.Address] = true
		encoded, err := verifyKeelProof(header.Root, crypto.Keccak256(a.Address[:]), a.AccountProof)
		if err != nil {
			return nil, nil, fmt.Errorf("Account %s proof: %w", a.Address, err)
		}
		storageRoot := types.EmptyRootHash
		codeHash := types.EmptyCodeHash
		nonce := uint64(0)
		balance := new(big.Int)
		if encoded != nil {
			var account types.StateAccount
			if err := rlp.DecodeBytes(encoded, &account); err != nil {
				return nil, nil, err
			}
			storageRoot = account.Root
			codeHash = common.BytesToHash(account.CodeHash)
			nonce = account.Nonce
			balance = account.Balance.ToBig()
		}
		if a.Balance == nil || a.Balance.ToInt().Sign() < 0 || balance.Cmp(a.Balance.ToInt()) != 0 || nonce != uint64(a.Nonce) || storageRoot != a.StorageHash || codeHash != a.CodeHash || crypto.Keccak256Hash(a.Code) != codeHash {
			return nil, nil, fmt.Errorf("Account %s fields/code differ from proved leaf", a.Address)
		}
		for _, node := range a.AccountProof {
			rawdb.WriteLegacyTrieNode(disk, crypto.Keccak256Hash(node), node)
		}
		rawdb.WriteCode(disk, codeHash, a.Code)
		seenSlots := map[common.Hash]bool{}
		for _, slot := range a.StorageProof {
			if seenSlots[slot.Key] {
				return nil, nil, errors.New("Duplicate storage proof")
			}
			seenSlots[slot.Key] = true
			value, err := verifyKeelProof(storageRoot, crypto.Keccak256(slot.Key[:]), slot.Proof)
			if err != nil {
				return nil, nil, fmt.Errorf("Storage %s/%s: %w", a.Address, slot.Key, err)
			}
			var decoded []byte
			if value != nil {
				if err := rlp.DecodeBytes(value, &decoded); err != nil {
					return nil, nil, err
				}
			}
			if slot.Value == nil || slot.Value.ToInt().Sign() < 0 || slot.Value.ToInt().BitLen() > 256 || new(big.Int).SetBytes(decoded).Cmp(slot.Value.ToInt()) != 0 {
				return nil, nil, errors.New("Storage field differs from proved value")
			}
			for _, node := range slot.Proof {
				rawdb.WriteLegacyTrieNode(disk, crypto.Keccak256Hash(node), node)
			}
		}
	}
	statedb, err := state.New(header.Root, state.NewDatabase(triedb.NewDatabase(disk, triedb.HashDefaults), nil))
	if err != nil {
		return nil, nil, err
	}
	return disk, statedb, nil
}
func NewKeelSparseSession(input KeelSparseInput) (*KeelSparseSession, error) {
	if input.ChainID != 11155111 {
		return nil, errors.New("Explicit Sepolia chain identity required")
	}
	if len(input.HeaderRLP) == 0 || len(input.HeaderRLP) > 16384 || len(input.AncestorHeaders) > 256 || len(input.Accounts) > 4096 || len(input.Program) == 0 || len(input.Program) > 32<<20 {
		return nil, errors.New("Input limits exceeded")
	}
	var header types.Header
	if err := rlp.DecodeBytes(input.HeaderRLP, &header); err != nil {
		return nil, err
	}
	if header.Hash() != input.HeaderHash || header.Number == nil || header.Number.Sign() < 0 || !header.Number.IsUint64() || header.Difficulty == nil || header.Difficulty.Sign() != 0 || header.BaseFee == nil {
		return nil, errors.New("Canonical post-merge header commitment invalid")
	}
	if input.StageGasCap == 0 || input.StageGasCap > header.GasLimit {
		return nil, errors.New("Stage gas budget must be explicit and at most canonical block limit")
	}
	ancestors := map[uint64]*types.Header{header.Number.Uint64(): types.CopyHeader(&header)}
	child := &header
	for _, encoded := range input.AncestorHeaders {
		if len(encoded) > 16384 {
			return nil, errors.New("Ancestor length exceeded")
		}
		var h types.Header
		if err := rlp.DecodeBytes(encoded, &h); err != nil {
			return nil, err
		}
		if h.Number == nil || !h.Number.IsUint64() || child.Number.Uint64() == 0 || h.Number.Uint64()+1 != child.Number.Uint64() || h.Hash() != child.ParentHash {
			return nil, errors.New("Ancestor header chain mismatch")
		}
		ancestors[h.Number.Uint64()] = types.CopyHeader(&h)
		child = &h
	}
	var opts simOpts
	decoder := json.NewDecoder(bytes.NewReader(input.Program))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&opts); err != nil {
		return nil, err
	}
	if len(opts.BlockStateCalls) == 0 || len(opts.BlockStateCalls) > 256 {
		return nil, errors.New("Explicit nonempty bounded complete program required")
	}
	total := 0
	for _, block := range opts.BlockStateCalls {
		if block.StateOverrides != nil || block.BlockOverrides != nil {
			return nil, errors.New("Diagnostic runner forbids state/header overrides")
		}
		if len(block.Calls) == 0 || len(block.Calls) > 5000 {
			return nil, errors.New("Call count bound")
		}
		total += len(block.Calls)
		for _, call := range block.Calls {
			if call.From == nil || call.To == nil || call.Gas == nil || uint64(*call.Gas) == 0 || uint64(*call.Gas) > input.StageGasCap || len(call.AuthorizationList) > 0 {
				return nil, errors.New("Explicit unsigned call identity/gas required; gas clipping and authorization lists forbidden")
			}
		}
	}
	if total > 10000 {
		return nil, errors.New("Total call count exceeds bound")
	}
	disk, statedb, err := importKeelWitness(&header, input.Accounts)
	if err != nil {
		return nil, err
	}
	backend := &keelSparseBackend{base: types.CopyHeader(&header), ancestors: ancestors, config: params.SepoliaChainConfig, engine: beacon.New(ethash.NewFaker())}
	sim := &simulator{b: backend, state: statedb, base: types.CopyHeader(&header), chainConfig: backend.config, budget: newGasBudget(input.StageGasCap), traceTransfers: opts.TraceTransfers, validate: opts.Validation, fullTx: opts.ReturnFullTransactions}
	blocks, err := sim.sanitizeChain(opts.BlockStateCalls)
	if err != nil {
		return nil, err
	}
	headers, err := sim.makeHeaders(blocks)
	if err != nil {
		return nil, err
	}
	return &KeelSparseSession{sim: sim, backend: backend, blocks: blocks, headers: headers, stageCap: input.StageGasCap, disk: disk}, nil
}
func (s *KeelSparseSession) InitialCheckpoint() common.Hash { return s.backend.base.Hash() }
func (s *KeelSparseSession) Close() {
	s.closed = true
	s.sim.state = nil
	s.results = nil
	s.completed = nil
}
func (s *KeelSparseSession) Results() (json.RawMessage, error) {
	if s.closed || s.next != len(s.blocks) {
		return nil, errors.New("Complete unclosed session required")
	}
	return json.Marshal(s.results)
}
func (s *KeelSparseSession) Step(ctx context.Context) (receipt *KeelSparseStageResult, err error) {
	if s.closed || s.next >= len(s.blocks) {
		return nil, errors.New("No next stage in active session")
	}
	i := s.next
	original := s.sim.state
	s.sim.state = original.Copy()
	s.sim.budget = newGasBudget(s.stageCap)
	var accesses []KeelStateAccess
	defer func() {
		s.sim.keelGuard = nil
		if failure := recover(); failure != nil {
			if e, ok := failure.(error); ok {
				err = e
			} else {
				err = fmt.Errorf("Native stage panic: %v", failure)
			}
		}
		if err != nil {
			if e, ok := err.(*KeelWitnessError); ok {
				e.Stage = i
			}
			s.sim.state = original
			receipt = nil
		}
	}()
	s.sim.keelGuard = func(base vm.StateDB) vm.StateDB {
		return &keelGuardState{StateDB: base, raw: s.sim.state, stage: i, accesses: &accesses, seen: map[string]bool{}}
	}
	parent := s.backend.base
	if i > 0 {
		parent = s.completed[i-1]
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// All prior successful stages remain ephemeral. No chain database commit occurs.
	result, calls, senders, err := s.sim.processBlock(ctx, &s.blocks[i], types.CopyHeader(s.headers[i]), parent, s.completed, 30*time.Second)
	if err != nil {
		return nil, err
	}
	if e := s.sim.state.Error(); e != nil {
		return nil, &KeelWitnessError{Stage: i, Kind: "missing-witness", Cause: e.Error()}
	}
	encoded, err := json.Marshal(&simBlockResult{fullTx: s.sim.fullTx, chainConfig: s.sim.chainConfig, Block: result, Calls: calls, senders: senders})
	if err != nil {
		return nil, err
	}
	s.results = append(s.results, encoded)
	s.completed = append(s.completed, result.Header())
	s.next++
	return &KeelSparseStageResult{Index: i, Checkpoint: result.Hash(), Result: encoded, Accesses: accesses}, nil
}

// Evidence certifies access closure for this complete executed program, not a
// full-chain snapshot or live-provider acceptance. Missing history/trie/code is
// fatal before a stage commits. Ancestors that were not accessed need not be
// fetched; the base header cryptographically commits to its parent's hash.
type KeelSparseEvidence struct {
	FullWitnessComplete   bool        `json:"fullWitnessComplete"`
	HeaderHistoryComplete bool        `json:"headerHistoryComplete"`
	StickyStateError      bool        `json:"stickyStateError"`
	CanonicalHeaderHash   common.Hash `json:"canonicalHeaderHash"`
	CanonicalStateRoot    common.Hash `json:"canonicalStateRoot"`
	CanonicalBlockNumber  string      `json:"canonicalBlockNumber"`
	CompletedStages       int         `json:"completedStages"`
	TotalStages           int         `json:"totalStages"`
	Validation            bool        `json:"validation"`
	Scope                 string      `json:"scope"`
}

func (s *KeelSparseSession) Evidence() KeelSparseEvidence {
	sticky := s.sim.state == nil || s.sim.state.Error() != nil
	complete := !s.closed && !sticky && s.next == len(s.blocks)
	return KeelSparseEvidence{FullWitnessComplete: complete, HeaderHistoryComplete: complete, StickyStateError: sticky, CanonicalHeaderHash: s.backend.base.Hash(), CanonicalStateRoot: s.backend.base.Root, CanonicalBlockNumber: s.backend.base.Number.String(), CompletedStages: s.next, TotalStages: len(s.blocks), Validation: s.sim.validate, Scope: "complete-executed-program-access-closure; not whole-chain snapshot, consensus proof, live provider, or publication acceptance"}
}
