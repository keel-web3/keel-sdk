// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
package ethapi

// Real EVM and whole-block simulation over explicitly synthetic, locally allocated
// state. No public proof acquisition, transaction signature or deployment occurs.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/params"
	"github.com/holiman/uint256"
)

var syntheticCreateOwner = common.HexToAddress("0x764E3EE7A844d9165937c41fd08086e43b997149")

func syntheticCreateState(t *testing.T, balance *big.Int) (*state.StateDB, *types.Header) {
	t.Helper()
	s, err := state.New(types.EmptyRootHash, state.NewDatabaseForTesting())
	if err != nil {
		t.Fatal(err)
	}
	s.SetBalance(syntheticCreateOwner, uint256.MustFromBig(balance), tracing.BalanceChangeUnspecified)
	s.SetNonce(syntheticCreateOwner, 296, tracing.NonceChangeUnspecified)
	for address, account := range core.SystemContractAllocs() {
		s.SetNonce(address, account.Nonce, tracing.NonceChangeUnspecified)
		s.SetCode(address, account.Code, tracing.CodeChangeUnspecified)
		for key, value := range account.Storage {
			s.SetState(address, key, value)
		}
	}
	h := &types.Header{Number: big.NewInt(11953490), Time: *params.SepoliaChainConfig.AmsterdamTime + 3600, Difficulty: big.NewInt(0), GasLimit: 199609569, GasUsed: 199609569 / 2, BaseFee: big.NewInt(15), ParentHash: common.HexToHash("0x1234"), Coinbase: common.HexToAddress("0x9876"), UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: types.EmptyReceiptsHash}
	root := common.HexToHash("0xbeac")
	h.ParentBeaconRoot = &root
	zero := uint64(0)
	h.ExcessBlobGas = &zero
	h.BlobGasUsed = &zero
	slot := uint64(9000)
	h.SlotNumber = &slot
	h.Root = s.IntermediateRoot(params.SepoliaChainConfig.Rules(h.Number, true, h.Time))
	return s, h
}
func executeSyntheticCreates(t *testing.T, raw json.RawMessage, balance *big.Int) (*state.StateDB, *types.Header, []map[string]json.RawMessage, error) {
	t.Helper()
	s, h := syntheticCreateState(t, balance)
	output, err := KeelSparseSimulate(context.Background(), h, s, raw, 10_000_000_000, 10*time.Second, func(context.Context, common.Hash) (*types.Header, error) {
		t.Fatal("unexpected ancestor request")
		return nil, nil
	})
	if err != nil {
		return s, h, nil, err
	}
	var blocks []map[string]json.RawMessage
	if err = json.Unmarshal(output, &blocks); err != nil {
		t.Fatal(err)
	}
	return s, h, blocks, nil
}
func syntheticFunds() *big.Int { return new(big.Int).Mul(big.NewInt(100), big.NewInt(params.Ether)) }
func successfulCalls(t *testing.T, blocks []map[string]json.RawMessage, count int) []simCallResult {
	t.Helper()
	if len(blocks) != 1 {
		t.Fatalf("blocks=%d", len(blocks))
	}
	var calls []simCallResult
	if err := json.Unmarshal(blocks[0]["calls"], &calls); err != nil {
		t.Fatal(err)
	}
	if len(calls) != count {
		t.Fatalf("calls=%d", len(calls))
	}
	return calls
}
func TestKeelSparseEVMCurrent49dThreeCreateWholeBlock(t *testing.T) {
	raw := currentThreeCreate(t)
	before := bytes.Clone(raw)
	s, h, blocks, err := executeSyntheticCreates(t, raw, syntheticFunds())
	if err != nil {
		t.Fatal(err)
	}
	calls := successfulCalls(t, blocks, 3)
	runtimes := []struct {
		address string
		size    int
		sha     string
	}{
		{"0x368c3d58D4409774ba6014C97778F22E3cffaC35", 4683, "0c0378cd53af45c0b9a0df29db7615bf122fc0ac68cc59918efcb98593293584"},
		{"0xa1496dCEe98FCF986Bee0e105439E684D79e37FD", 4563, "526bdb9a141827bd0fc1223c4c614fc2365c92e3e6d1dd2d077349d29738016a"},
		{"0x924c5fA733CF9eF24dc7b355261660dddb24cb1D", 16911, "df1aeac604199ff6dc48a35e49986cfa040f168ec752508ab47fbc06a23e6420"},
	}
	for i, want := range runtimes {
		if calls[i].Status != 1 || calls[i].Error != nil {
			t.Fatalf("constructor %d failed: %+v", i, calls[i])
		}
		address := crypto.CreateAddress(syntheticCreateOwner, uint64(296+i))
		if address != common.HexToAddress(want.address) {
			t.Fatal("CREATE address changed")
		}
		code := s.GetCode(address)
		sum := sha256.Sum256(code)
		if len(code) != want.size || hex.EncodeToString(sum[:]) != want.sha || !bytes.Equal(code, calls[i].ReturnValue) {
			t.Fatalf("constructor %d exact runtime mismatch", i)
		}
	}
	children := []struct {
		address string
		size    int
		sha     string
	}{
		{"0xC92a327def73Ef466A259B71f400c454f7d0cCCC", 1203, "f19bff41330fc4a2662d21f843846fa15db87d64430a84d1461b0e31ecb8e9de"},
		{"0xe47A237B3eEd893C22137656eE94fB6Dc6290c8A", 13182, "9a8bb30facfef12d7fb7361d6c88220f5855485e57d01c39e36c46f7d464a364"},
		{"0x00dCb304b099CcBd95f280C17210eC54E90DC39C", 13182, "c682f73d50bcf59d556f4b22e8d57ba1772ed8dfdd267757c03f7ec8c4add983"},
	}
	for _, want := range children {
		code := s.GetCode(common.HexToAddress(want.address))
		sum := sha256.Sum256(code)
		if len(code) != want.size || hex.EncodeToString(sum[:]) != want.sha {
			t.Fatalf("child %s exact runtime mismatch", want.address)
		}
	}
	if s.GetNonce(syntheticCreateOwner) != 299 || s.GetBalance(syntheticCreateOwner).Cmp(uint256.MustFromBig(syntheticFunds())) >= 0 {
		t.Fatal("real nonce/charged balance transition missing")
	}
	// Actual pre-execution protocol contracts must update inside this simulated block.
	historySlot := common.BigToHash(new(big.Int).Mod(h.Number, big.NewInt(8191)))
	if s.GetState(params.HistoryStorageAddress, historySlot) != h.Hash() {
		t.Fatal("whole-block history pre-processing omitted")
	}
	beaconSlot := common.BigToHash(new(big.Int).SetUint64((h.Time + 12) % 8191))
	if s.GetState(params.BeaconRootsAddress, beaconSlot) != common.BigToHash(new(big.Int).SetUint64(h.Time+12)) {
		t.Fatal("whole-block beacon pre-processing omitted")
	}
	var requestsHash common.Hash
	if err := json.Unmarshal(blocks[0]["requestsHash"], &requestsHash); err != nil || requestsHash != types.EmptyRequestsHash {
		t.Fatalf("whole-block request post-processing missing: %v", err)
	}
	var txs []common.Hash
	if err := json.Unmarshal(blocks[0]["transactions"], &txs); err != nil || len(txs) != 3 {
		t.Fatal("omitted response flag did not return three transaction hashes")
	}
	if !bytes.Equal(raw, before) {
		t.Fatal("actual constructor request was changed")
	}
	t.Logf("synthetic current49d whole block: real six runtimes, nonce299, charged balance, pre/post processing; gasUsed=[%d %d %d]", calls[0].GasUsed, calls[1].GasUsed, calls[2].GasUsed)
}
func TestKeelSparseEVMResponseFormatPreservesRootAndCalls(t *testing.T) {
	raw := currentThreeCreate(t)
	_, _, hashed, err := executeSyntheticCreates(t, raw, syntheticFunds())
	if err != nil {
		t.Fatal(err)
	}
	full := reshape(t, raw, func(p map[string]any) { p["returnFullTransactions"] = true })
	_, _, objects, err := executeSyntheticCreates(t, full, syntheticFunds())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"stateRoot", "hash", "gasUsed", "calls", "requestsHash"} {
		if !bytes.Equal(hashed[0][key], objects[0][key]) {
			t.Fatalf("response format changed execution %s", key)
		}
	}
	var txs []map[string]json.RawMessage
	if err := json.Unmarshal(objects[0]["transactions"], &txs); err != nil || len(txs) != 3 {
		t.Fatal("full transaction format missing")
	}
}
func syntheticProgram(t *testing.T, initcode string, withCall bool) json.RawMessage {
	t.Helper()
	raw := currentThreeCreate(t)
	return reshape(t, raw, func(p map[string]any) {
		call := firstCall(p)
		call["data"] = initcode
		call["gas"] = "0x989680"
		calls := []any{call}
		if withCall {
			copy := make(map[string]any)
			for key, value := range call {
				copy[key] = value
			}
			copy["nonce"] = "0x129"
			copy["to"] = crypto.CreateAddress(syntheticCreateOwner, 296).Hex()
			copy["data"] = "0x"
			calls = append(calls, copy)
		}
		firstBlock(p)["calls"] = calls
	})
}
func TestKeelSparseEVMMixedCreateAndCallUsesSameBlockState(t *testing.T) {
	// Constructor returns a runtime that returns uint256(42).
	raw := syntheticProgram(t, "0x600a600c600039600a6000f3602a60005260206000f3", true)
	s, _, blocks, err := executeSyntheticCreates(t, raw, syntheticFunds())
	if err != nil {
		t.Fatal(err)
	}
	calls := successfulCalls(t, blocks, 2)
	if calls[0].Status != 1 || calls[1].Status != 1 || new(big.Int).SetBytes(calls[1].ReturnValue).Cmp(big.NewInt(42)) != 0 || s.GetNonce(syntheticCreateOwner) != 298 {
		t.Fatal("later call did not execute the freshly created runtime")
	}
}
func TestKeelSparseEVMConstructorRevertAndCodeSizeRemainFailures(t *testing.T) {
	for name, init := range map[string]string{"revert": "0x60006000fd", "code-size": "0x620100016000f3"} {
		t.Run(name, func(t *testing.T) {
			s, _, blocks, err := executeSyntheticCreates(t, syntheticProgram(t, init, false), syntheticFunds())
			if err != nil {
				t.Fatal(err)
			}
			calls := successfulCalls(t, blocks, 1)
			if calls[0].Status != 0 || calls[0].Error == nil || len(s.GetCode(crypto.CreateAddress(syntheticCreateOwner, 296))) != 0 {
				t.Fatal("constructor failure produced successful code")
			}
			if name == "revert" && calls[0].Error.Code != 3 {
				t.Fatal("genuine revert lost its RPC error code")
			}
			if name == "code-size" && !strings.Contains(calls[0].Error.Message, "max code size exceeded") {
				t.Fatalf("unexpected code-size failure: %+v", calls[0].Error)
			}
		})
	}
}
func TestKeelSparseEVMValidationRejectsWrongNonceFeesBalanceAndIntrinsicGas(t *testing.T) {
	raw := syntheticProgram(t, "0x60006000f3", false)
	cases := map[string]struct {
		change  func(map[string]any)
		balance *big.Int
	}{
		"nonce": {func(p map[string]any) { firstCall(p)["nonce"] = "0x129" }, syntheticFunds()},
		"fee": {func(p map[string]any) {
			firstCall(p)["maxFeePerGas"] = "0x1"
			firstCall(p)["maxPriorityFeePerGas"] = "0x1"
		}, syntheticFunds()},
		"balance":   {func(p map[string]any) {}, big.NewInt(0)},
		"intrinsic": {func(p map[string]any) { firstCall(p)["gas"] = "0x5208" }, syntheticFunds()},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, _, err := executeSyntheticCreates(t, reshape(t, raw, tc.change), tc.balance)
			if err == nil {
				t.Fatal("invalid real transaction admitted")
			}
		})
	}
}
func TestKeelSparseEVMWholeBlockCancellation(t *testing.T) {
	s, h := syntheticCreateState(t, syntheticFunds())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := KeelSparseSimulate(ctx, h, s, currentThreeCreate(t), 10_000_000_000, time.Second, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled execution returned %v", err)
	}
}
