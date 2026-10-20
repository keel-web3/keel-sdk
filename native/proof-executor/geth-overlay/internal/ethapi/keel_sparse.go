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
	opts, err := keelSparseOptions(raw, base.GasLimit, budget)
	if err != nil {
		return nil, err
	}
	b := &KeelSparseBackend{Base: types.CopyHeader(base), FetchAncestor: ancestor, Headers: make(map[uint64]*types.Header), Timeout: timeout, engine: beacon.New(ethash.NewFaker())}
	sim := &simulator{b: b, state: s, base: types.CopyHeader(base), chainConfig: params.SepoliaChainConfig, budget: newGasBudget(budget), validate: opts.Validation, fullTx: opts.ReturnFullTransactions}
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
	if err := verifyKeelSparseEnvelopes(raw, result); err != nil {
		return nil, err
	}
	return json.Marshal(result)
}

func keelSparseOptions(raw json.RawMessage, gasLimit, budget uint64) (simOpts, error) {
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
		return simOpts{}, err
	}
	if len(envelope.BlockStateCalls) == 0 || len(envelope.BlockStateCalls) > 256 || envelope.TraceTransfers {
		return simOpts{}, errors.New("unsupported simulation shape")
	}
	var opts simOpts
	if err := json.Unmarshal(raw, &opts); err != nil {
		return simOpts{}, err
	}
	totalCalls := 0
	for i, block := range opts.BlockStateCalls {
		if len(block.Calls) == 0 || block.StateOverrides != nil || block.BlockOverrides != nil {
			return simOpts{}, errors.New("nonempty call blocks without overrides required")
		}
		totalCalls += len(block.Calls)
		// The direct simulator entry must retain the unchanged public RPC bounds.
		if len(block.Calls) > maxSimulateCallsPerBlock || totalCalls > maxSimulateTotalCalls {
			return simOpts{}, errors.New("simulation call count limit exceeded")
		}
		for j, call := range block.Calls {
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(envelope.BlockStateCalls[i].Calls[j], &fields); err != nil {
				return simOpts{}, err
			}
			for key := range fields {
				switch key {
				case "from", "to", "data", "value", "gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas":
				default:
					return simOpts{}, errors.New("unsupported transaction field")
				}
			}
			if call.From == nil || call.Gas == nil || uint64(*call.Gas) == 0 || uint64(*call.Gas) > gasLimit || uint64(*call.Gas) > budget || call.Value == nil || call.Value.ToInt().Sign() < 0 || call.Value.ToInt().Cmp(new(big.Int).Lsh(big.NewInt(1), 256)) >= 0 {
				return simOpts{}, errors.New("invalid original transaction envelope")
			}
		}
	}
	return opts, nil
}

// Compare every executed envelope to a fresh decode of the original bytes. The
// simulator may populate local defaults; those defaults are never proof authority.
func verifyKeelSparseEnvelopes(raw json.RawMessage, result []*simBlockResult) error {
	var original simOpts
	if err := json.Unmarshal(raw, &original); err != nil {
		return err
	}
	if len(result) != len(original.BlockStateCalls) {
		return errors.New("simulation block count changed")
	}
	for i, block := range result {
		calls := original.BlockStateCalls[i].Calls
		if block == nil || block.Block == nil || block.Block.Root() == (common.Hash{}) || len(block.Block.Transactions()) != len(calls) || len(block.Calls) != len(calls) {
			return errors.New("simulation result count or authenticated root mismatch")
		}
		for j, transaction := range block.Block.Transactions() {
			if transaction == nil {
				return errors.New("simulation omitted an original transaction")
			}
			call := calls[j]
			sender, present := block.senders[transaction.Hash()]
			to := transaction.To()
			if call.From == nil || !present || sender != *call.From || call.Gas == nil || transaction.Gas() != uint64(*call.Gas) || call.Value == nil || transaction.Value().Cmp(call.Value.ToInt()) != 0 || !bytes.Equal(transaction.Data(), call.data()) || (to == nil) != (call.To == nil) || to != nil && *to != *call.To {
				return errors.New("local simulation changed an original execution envelope")
			}
			if call.Nonce != nil && transaction.Nonce() != uint64(*call.Nonce) || call.GasPrice != nil && transaction.GasPrice().Cmp(call.GasPrice.ToInt()) != 0 || call.MaxFeePerGas != nil && transaction.GasFeeCap().Cmp(call.MaxFeePerGas.ToInt()) != 0 || call.MaxPriorityFeePerGas != nil && transaction.GasTipCap().Cmp(call.MaxPriorityFeePerGas.ToInt()) != 0 {
				return errors.New("local simulation changed an original nonce or fee envelope")
			}
		}
	}
	return nil
}
