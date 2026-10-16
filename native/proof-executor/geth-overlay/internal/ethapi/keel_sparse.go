// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
// Pinned-version bridge to Geth's unchanged eth_simulateV1 engine.
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
	"github.com/ethereum/go-ethereum/consensus"
	"github.com/ethereum/go-ethereum/consensus/beacon"
	"github.com/ethereum/go-ethereum/consensus/ethash"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/params"
	"github.com/ethereum/go-ethereum/rpc"
)

type KeelSparseBackend struct {
	// Unused Backend methods are deliberately unavailable. Only this exported
	// bridge, not the general RPC API, is callable; an unexpected use fails closed.
	Backend
	Base          *types.Header
	FetchAncestor func(context.Context, common.Hash) (*types.Header, error)
	Headers       map[uint64]*types.Header
	Timeout       time.Duration
	engine        consensus.Engine
	err           error
}

func (b *KeelSparseBackend) RPCEVMTimeout() time.Duration     { return b.Timeout }
func (b *KeelSparseBackend) ChainConfig() *params.ChainConfig { return params.SepoliaChainConfig }
func (b *KeelSparseBackend) CurrentHeader() *types.Header     { return types.CopyHeader(b.Base) }
func (b *KeelSparseBackend) Engine() consensus.Engine         { return b.engine }
func (b *KeelSparseBackend) HeaderByNumber(ctx context.Context, n rpc.BlockNumber) (*types.Header, error) {
	if n < 0 || uint64(n) > b.Base.Number.Uint64() || b.Base.Number.Uint64()-uint64(n) > 256 {
		b.err = errors.New("ancestor outside pinned block window")
		return nil, b.err
	}
	parent := b.Base
	for parent.Number.Uint64() > uint64(n) {
		number := parent.Number.Uint64() - 1
		child, ok := b.Headers[number]
		if !ok {
			var err error
			child, err = b.FetchAncestor(ctx, parent.ParentHash)
			if err != nil {
				b.err = err
				return nil, err
			}
			if child == nil || child.Hash() != parent.ParentHash || child.Number.Uint64() != number {
				b.err = errors.New("ancestor header mismatch")
				return nil, b.err
			}
			b.Headers[number] = child
		}
		parent = child
	}
	return types.CopyHeader(parent), nil
}
func (b *KeelSparseBackend) HeaderByHash(_ context.Context, h common.Hash) (*types.Header, error) {
	if b.Base.Hash() == h {
		return types.CopyHeader(b.Base), nil
	}
	for _, header := range b.Headers {
		if header.Hash() == h {
			return types.CopyHeader(header), nil
		}
	}
	// Never transmit counterfactual simulated hashes upstream.
	return nil, errors.New("hash is not an authenticated cached ancestor")
}
func KeelSparseSimulate(ctx context.Context, base *types.Header, s *state.StateDB, raw json.RawMessage, budget uint64, timeout time.Duration, ancestor func(context.Context, common.Hash) (*types.Header, error)) (json.RawMessage, error) {
	if base == nil || base.Number == nil || base.Difficulty == nil || base.Difficulty.Sign() != 0 || base.Root == (common.Hash{}) || base.GasLimit == 0 || !params.SepoliaChainConfig.IsAmsterdam(base.Number, base.Time) {
		return nil, errors.New("unsupported pinned chain/fork/header")
	}
	// Reject overrides and unexpected envelope extensions before typed decoding.
	var envelope struct {
		BlockStateCalls []struct {
			Calls []json.RawMessage `json:"calls"`
		} `json:"blockStateCalls"`
		Validation             bool `json:"validation"`
		TraceTransfers         bool `json:"traceTransfers"`
		ReturnFullTransactions bool `json:"returnFullTransactions"`
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&envelope); err != nil {
		return nil, err
	}
	if len(envelope.BlockStateCalls) == 0 || len(envelope.BlockStateCalls) > 256 || envelope.TraceTransfers || !envelope.ReturnFullTransactions {
		return nil, errors.New("unsupported simulation shape")
	}
	var opts simOpts
	if err := json.Unmarshal(raw, &opts); err != nil {
		return nil, err
	}
	for i, block := range opts.BlockStateCalls {
		if len(block.Calls) != 1 || block.StateOverrides != nil || block.BlockOverrides != nil {
			return nil, errors.New("exact one-call blocks without overrides required")
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(envelope.BlockStateCalls[i].Calls[0], &fields); err != nil {
			return nil, err
		}
		for key := range fields {
			switch key {
			case "from", "to", "data", "value", "gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas":
			default:
				return nil, errors.New("unsupported transaction field")
			}
		}
		call := block.Calls[0]
		if call.From == nil || call.To == nil || call.Gas == nil || uint64(*call.Gas) == 0 || uint64(*call.Gas) > base.GasLimit || uint64(*call.Gas) > budget || call.Value == nil || call.Value.ToInt().Sign() < 0 || call.Value.ToInt().Cmp(new(big.Int).Lsh(big.NewInt(1), 256)) >= 0 {
			return nil, errors.New("invalid original transaction envelope")
		}
	}
	b := &KeelSparseBackend{Base: types.CopyHeader(base), FetchAncestor: ancestor, Headers: make(map[uint64]*types.Header), Timeout: timeout, engine: beacon.New(ethash.NewFaker())}
	sim := &simulator{b: b, state: s, base: types.CopyHeader(base), chainConfig: params.SepoliaChainConfig, budget: newGasBudget(budget), validate: opts.Validation, fullTx: true}
	result, err := sim.execute(ctx, opts.BlockStateCalls)
	if err != nil {
		return nil, err
	}
	if b.err != nil {
		return nil, fmt.Errorf("missing authenticated ancestor: %w", b.err)
	}
	if err := s.Error(); err != nil {
		return nil, fmt.Errorf("incomplete authenticated witness: %w", err)
	}
	for i, block := range result {
		if block.Block.Root() == (common.Hash{}) || len(block.Block.Transactions()) != 1 || block.Block.Transactions()[0].Gas() != uint64(*opts.BlockStateCalls[i].Calls[0].Gas) {
			return nil, errors.New("local resource cap changed an original envelope or root is absent")
		}
	}
	return json.Marshal(result)
}
