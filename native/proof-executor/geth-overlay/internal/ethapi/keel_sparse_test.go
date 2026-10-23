// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
package ethapi

// Parser and result-envelope controls only. These tests do not execute CREATEs,
// authenticate live state, or qualify the actual public prerequisite deployment.
import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
)

func currentThreeCreate(t *testing.T) json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(os.Getenv("KEEL_NATIVE_PUBLIC3_PAYLOAD"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != "de76973a117dbe9aba405f4753baf6d8e81e424fa0d2c1d196c064cb0effcbeb" {
		t.Fatal("exact retained public three-CREATE fixture changed")
	}
	return raw
}
func reshape(t *testing.T, raw []byte, change func(map[string]any)) []byte {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	change(value)
	result, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func firstBlock(p map[string]any) map[string]any {
	return p["blockStateCalls"].([]any)[0].(map[string]any)
}
func firstCall(p map[string]any) map[string]any {
	return firstBlock(p)["calls"].([]any)[0].(map[string]any)
}

func TestKeelSparseCurrentThreeCreateAdmission(t *testing.T) {
	raw := currentThreeCreate(t)
	before := string(raw)
	opts, err := keelSparseOptions(raw, 199609569, 10_000_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if len(opts.BlockStateCalls) != 1 || len(opts.BlockStateCalls[0].Calls) != 3 || opts.ReturnFullTransactions || !opts.Validation || opts.TraceTransfers {
		t.Fatal("original shape or flags changed")
	}
	for i, c := range opts.BlockStateCalls[0].Calls {
		if c.To != nil || c.Nonce == nil || uint64(*c.Nonce) != uint64(296+i) {
			t.Fatal("original CREATE target or nonce changed")
		}
	}
	if string(raw) != before {
		t.Fatal("original public bytes changed")
	}
}
func TestKeelSparseBothResponseFormatsAndLegacyShape(t *testing.T) {
	raw := currentThreeCreate(t)
	for _, full := range []bool{false, true} {
		t.Run(map[bool]string{false: "hashes", true: "full"}[full], func(t *testing.T) {
			input := reshape(t, raw, func(p map[string]any) { p["returnFullTransactions"] = full })
			opts, err := keelSparseOptions(input, 199609569, 10_000_000_000)
			if err != nil || opts.ReturnFullTransactions != full {
				t.Fatalf("format changed: %v", err)
			}
		})
	}
	input := reshape(t, raw, func(p map[string]any) {
		calls := firstBlock(p)["calls"].([]any)
		blocks := make([]any, len(calls))
		for i, call := range calls {
			call.(map[string]any)["to"] = "0x1111111111111111111111111111111111111111"
			blocks[i] = map[string]any{"calls": []any{call}}
		}
		p["blockStateCalls"] = blocks
		p["returnFullTransactions"] = true
	})
	opts, err := keelSparseOptions(input, 199609569, 10_000_000_000)
	if err != nil || len(opts.BlockStateCalls) != 3 {
		t.Fatalf("existing one-target-per-block route changed: %v", err)
	}
}
func TestKeelSparseStillRejectsOverridesAndExtensions(t *testing.T) {
	raw := currentThreeCreate(t)
	cases := map[string]func(map[string]any){
		"state-override":        func(p map[string]any) { firstBlock(p)["stateOverrides"] = map[string]any{} },
		"block-override":        func(p map[string]any) { firstBlock(p)["blockOverrides"] = map[string]any{} },
		"trace":                 func(p map[string]any) { p["traceTransfers"] = true },
		"transaction-extension": func(p map[string]any) { firstCall(p)["authorizationList"] = []any{} },
		"top-extension":         func(p map[string]any) { p["unreviewed"] = true },
		"empty-block":           func(p map[string]any) { firstBlock(p)["calls"] = []any{} },
		"empty-program":         func(p map[string]any) { p["blockStateCalls"] = []any{} },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := keelSparseOptions(reshape(t, raw, change), 199609569, 10_000_000_000); err == nil {
				t.Fatal("unsafe input accepted")
			}
		})
	}
}
func TestKeelSparseEveryCallRetainsGasAndFieldGuards(t *testing.T) {
	raw := currentThreeCreate(t)
	for _, field := range []string{"from", "gas", "value", "unreviewed"} {
		t.Run(field, func(t *testing.T) {
			input := reshape(t, raw, func(p map[string]any) {
				call := firstBlock(p)["calls"].([]any)[2].(map[string]any)
				if field == "unreviewed" {
					call[field] = true
				} else {
					delete(call, field)
				}
			})
			if _, err := keelSparseOptions(input, 199609569, 10_000_000_000); err == nil {
				t.Fatal("later call guard skipped")
			}
		})
	}
	for _, gas := range []string{"0x0", "0xbe5cce2"} {
		input := reshape(t, raw, func(p map[string]any) { firstCall(p)["gas"] = gas })
		if _, err := keelSparseOptions(input, 199609569, 10_000_000_000); err == nil {
			t.Fatal("gas bound changed")
		}
	}
	if _, err := keelSparseOptions(raw, 199609569, 1); err == nil {
		t.Fatal("request budget ignored")
	}
}
func TestKeelSparseUpstreamCallBounds(t *testing.T) {
	raw := currentThreeCreate(t)
	for _, count := range []int{maxSimulateCallsPerBlock, maxSimulateCallsPerBlock + 1} {
		input := reshape(t, raw, func(p map[string]any) {
			call := firstCall(p)
			calls := make([]any, count)
			for i := range calls {
				calls[i] = call
			}
			firstBlock(p)["calls"] = calls
		})
		_, err := keelSparseOptions(input, 199609569, 10_000_000_000)
		if (err != nil) != (count > maxSimulateCallsPerBlock) {
			t.Fatalf("per-block count %d: %v", count, err)
		}
	}
	input := reshape(t, raw, func(p map[string]any) {
		call := firstCall(p)
		calls := make([]any, maxSimulateCallsPerBlock)
		for i := range calls {
			calls[i] = call
		}
		p["blockStateCalls"] = []any{map[string]any{"calls": calls}, map[string]any{"calls": calls}, map[string]any{"calls": []any{call}}}
	})
	if _, err := keelSparseOptions(input, 199609569, 10_000_000_000); err == nil {
		t.Fatal("total upstream call limit ignored")
	}
}
func resultFor(t *testing.T, raw json.RawMessage, change func(int, *types.DynamicFeeTx)) []*simBlockResult {
	t.Helper()
	var input simOpts
	if err := json.Unmarshal(raw, &input); err != nil {
		t.Fatal(err)
	}
	results := make([]*simBlockResult, len(input.BlockStateCalls))
	for i, b := range input.BlockStateCalls {
		txs := make([]*types.Transaction, len(b.Calls))
		senders := make(map[common.Hash]common.Address)
		for j, c := range b.Calls {
			tx := &types.DynamicFeeTx{ChainID: big.NewInt(11155111), Nonce: uint64(*c.Nonce), To: c.To, Gas: uint64(*c.Gas), GasFeeCap: new(big.Int).Set(c.MaxFeePerGas.ToInt()), GasTipCap: new(big.Int).Set(c.MaxPriorityFeePerGas.ToInt()), Value: new(big.Int).Set(c.Value.ToInt()), Data: common.CopyBytes(c.data())}
			if change != nil {
				change(j, tx)
			}
			txs[j] = types.NewTx(tx)
			senders[txs[j].Hash()] = *c.From
		}
		results[i] = &simBlockResult{Block: types.NewBlockWithHeader(&types.Header{Root: common.HexToHash("0x01")}).WithBody(types.Body{Transactions: txs}), Calls: make([]simCallResult, len(txs)), senders: senders}
	}
	return results
}
func TestKeelSparseResultChecksEveryOriginalEnvelope(t *testing.T) {
	raw := currentThreeCreate(t)
	if err := verifyKeelSparseEnvelopes(raw, resultFor(t, raw, nil)); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(int, *types.DynamicFeeTx){
		"later-gas": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				tx.Gas--
			}
		},
		"later-nonce": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				tx.Nonce++
			}
		},
		"later-target": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				a := common.HexToAddress("0x01")
				tx.To = &a
			}
		},
		"later-data": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				tx.Data = []byte{0}
			}
		},
		"later-value": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				tx.Value = big.NewInt(1)
			}
		},
		"later-fee": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				tx.GasFeeCap.Add(tx.GasFeeCap, big.NewInt(1))
			}
		},
		"later-priority": func(j int, tx *types.DynamicFeeTx) {
			if j == 2 {
				tx.GasTipCap.Add(tx.GasTipCap, big.NewInt(1))
			}
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			if err := verifyKeelSparseEnvelopes(raw, resultFor(t, raw, change)); err == nil {
				t.Fatal("later original envelope changed")
			}
		})
	}
	for _, change := range []func([]*simBlockResult){func(r []*simBlockResult) {
		r[0].Block = types.NewBlockWithHeader(&types.Header{}).WithBody(types.Body{Transactions: r[0].Block.Transactions()})
	}, func(r []*simBlockResult) { r[0].Calls = r[0].Calls[:2] }, func(r []*simBlockResult) { clear(r[0].senders) }} {
		r := resultFor(t, raw, nil)
		change(r)
		if err := verifyKeelSparseEnvelopes(raw, r); err == nil {
			t.Fatal("result integrity guard skipped")
		}
	}
	if err := verifyKeelSparseEnvelopes(raw, nil); err == nil {
		t.Fatal("missing block accepted")
	}
}
