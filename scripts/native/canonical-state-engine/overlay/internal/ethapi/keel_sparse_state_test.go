package ethapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/core/rawdb"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethdb/memorydb"
	"github.com/ethereum/go-ethereum/rlp"
	"github.com/ethereum/go-ethereum/trie"
	"github.com/ethereum/go-ethereum/triedb"
	"github.com/holiman/uint256"
)

var keelTestOwner = common.HexToAddress("0x1111111111111111111111111111111111111111")
var keelTestContract = common.HexToAddress("0x2222222222222222222222222222222222222222")

func keelTestProof(t *testing.T, tr *trie.Trie, key []byte) []hexutil.Bytes {
	t.Helper()
	db := memorydb.New()
	if err := tr.Prove(key, db); err != nil {
		t.Fatal(err)
	}
	var nodes []hexutil.Bytes
	it := db.NewIterator(nil, nil)
	defer it.Release()
	for it.Next() {
		nodes = append(nodes, common.CopyBytes(it.Value()))
	}
	return nodes
}
func keelSyntheticInput(t *testing.T, code string, program json.RawMessage, extras ...func(types.GenesisAlloc)) KeelSparseInput {
	t.Helper()
	db := triedb.NewDatabase(rawdb.NewMemoryDatabase(), triedb.HashDefaults)
	tr := trie.NewEmpty(db)
	alloc := core.SystemContractAllocs()
	alloc[keelTestOwner] = types.Account{Balance: new(big.Int).Exp(big.NewInt(10), big.NewInt(24), nil)}
	alloc[keelTestContract] = types.Account{Nonce: 1, Balance: new(big.Int), Code: common.FromHex(code), Storage: map[common.Hash]common.Hash{{}: common.HexToHash("0x2a")}}
	for _, extra := range extras {
		extra(alloc)
	}
	var accounts []KeelProofAccount
	for address, a := range alloc {
		storage := trie.NewEmpty(db)
		for key, value := range a.Storage {
			v, _ := rlp.EncodeToBytes(bytes.TrimLeft(value[:], "\x00"))
			if err := storage.Update(crypto.Keccak256(key[:]), v); err != nil {
				t.Fatal(err)
			}
		}
		leaf := types.StateAccount{Nonce: a.Nonce, Balance: uint256.MustFromBig(a.Balance), Root: storage.Hash(), CodeHash: crypto.Keccak256(a.Code)}
		encoded, _ := rlp.EncodeToBytes(&leaf)
		if err := tr.Update(crypto.Keccak256(address[:]), encoded); err != nil {
			t.Fatal(err)
		}
		account := KeelProofAccount{Address: address, Code: a.Code, CodeHash: common.BytesToHash(leaf.CodeHash), Balance: (*hexutil.Big)(a.Balance), Nonce: hexutil.Uint64(a.Nonce), StorageHash: leaf.Root}
		for key, value := range a.Storage {
			account.StorageProof = append(account.StorageProof, KeelStorageProof{Key: key, Value: (*hexutil.Big)(value.Big()), Proof: keelTestProof(t, storage, crypto.Keccak256(key[:]))})
		}
		accounts = append(accounts, account)
	}
	for i := range accounts {
		accounts[i].AccountProof = keelTestProof(t, tr, crypto.Keccak256(accounts[i].Address[:]))
	}
	parent := &types.Header{Number: big.NewInt(11895347), Root: types.EmptyRootHash, GasLimit: 200_000_000, Time: 1791765396, Difficulty: big.NewInt(0), BaseFee: big.NewInt(1), UncleHash: types.EmptyUncleHash, TxHash: types.EmptyTxsHash, ReceiptHash: types.EmptyReceiptsHash}
	header := types.CopyHeader(parent)
	header.Number = big.NewInt(11895348)
	header.Time += 12
	header.Root = tr.Hash()
	header.ParentHash = parent.Hash()
	root := common.Hash{}
	header.ParentBeaconRoot = &root
	header.WithdrawalsHash = &root
	header.RequestsHash = &root
	header.BlockAccessListHash = &root
	blob := uint64(0)
	header.ExcessBlobGas = &blob
	header.BlobGasUsed = &blob
	slot := uint64(1000)
	header.SlotNumber = &slot
	h, _ := rlp.EncodeToBytes(header)
	p, _ := rlp.EncodeToBytes(parent)
	return KeelSparseInput{ChainID: 11155111, HeaderRLP: h, HeaderHash: header.Hash(), AncestorHeaders: []hexutil.Bytes{p}, Accounts: accounts, Program: program, StageGasCap: 200_000_000}
}
func keelProgram(data ...string) json.RawMessage {
	blocks := []any{}
	for _, value := range data {
		blocks = append(blocks, map[string]any{"calls": []any{map[string]any{"from": keelTestOwner, "to": keelTestContract, "gas": "0x7a120", "data": value, "value": "0x0"}}})
	}
	b, _ := json.Marshal(map[string]any{"blockStateCalls": blocks, "validation": false, "returnFullTransactions": true})
	return b
}
func keelReturned(t *testing.T, result json.RawMessage) []byte {
	var got struct {
		Calls []struct {
			Status string        `json:"status"`
			Return hexutil.Bytes `json:"returnData"`
			Error  any           `json:"error"`
		}
	}
	if err := json.Unmarshal(result, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Calls) != 1 || got.Calls[0].Status != "0x1" {
		t.Fatalf("Native call failed: %s", result)
	}
	return got.Calls[0].Return
}
func TestKeelSparseSequentialStorageAndFullResults(t *testing.T) {
	input := keelSyntheticInput(t, "0x36156009575f355f555b5f545f5260205ff3", keelProgram(common.HexToHash("0x7").Hex(), "0x"))
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Results(); err == nil {
		t.Fatal("Partial results accepted")
	}
	for i := 0; i < 2; i++ {
		r, err := s.Step(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if r.Index != i || len(r.Accesses) == 0 {
			t.Fatal("Missing native access inventory")
		}
		if new(big.Int).SetBytes(keelReturned(t, r.Result)).Uint64() != 7 {
			t.Fatal("Stage did not retain previous state")
		}
	}
	result, err := s.Results()
	if err != nil {
		t.Fatal(err)
	}
	var blocks []any
	if err := json.Unmarshal(result, &blocks); err != nil || len(blocks) != 2 {
		t.Fatal("Incomplete full result")
	}
}
func TestKeelSparsePreservesRealNumberAndBlockhash(t *testing.T) {
	for _, which := range []string{"number", "blockhash"} {
		t.Run(which, func(t *testing.T) {
			code := "0x435f5260205ff3"
			if which == "blockhash" {
				code = fmt.Sprintf("0x63%08x405f5260205ff3", 11895347)
			}
			input := keelSyntheticInput(t, code, keelProgram("0x"))
			s, err := NewKeelSparseSession(input)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			r, err := s.Step(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			returned := keelReturned(t, r.Result)
			if which == "number" {
				if new(big.Int).SetBytes(returned).Uint64() != 11895349 {
					t.Fatal("NUMBER changed")
				}
			} else {
				if common.BytesToHash(returned) != crypto.Keccak256Hash(input.AncestorHeaders[0]) {
					t.Fatal("BLOCKHASH changed")
				}
			}
		})
	}
}
func TestKeelSparseMissingHeaderRollsBackStage(t *testing.T) {
	input := keelSyntheticInput(t, fmt.Sprintf("0x63%08x405f5260205ff3", 11895345), keelProgram("0x"))
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	before := s.sim.state.GetNonce(keelTestOwner)
	if _, err = s.Step(context.Background()); err == nil {
		t.Fatal("Missing ancestor was silently zero")
	}
	if diagnostic, ok := err.(*KeelWitnessError); !ok || diagnostic.Kind != "missing-header" || (diagnostic.AncestorNumber == nil && diagnostic.AncestorHash == nil) {
		t.Fatalf("Missing structured ancestor dependency: %#v", err)
	}
	if s.next != 0 || s.sim.state.GetNonce(keelTestOwner) != before || s.sim.state.Error() != nil {
		t.Fatal("Failed stage mutated retained state")
	}
}
func TestKeelSparseMissingCodeIsFatal(t *testing.T) {
	input := keelSyntheticInput(t, "0x00", keelProgram("0x"))
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	codeHash := crypto.Keccak256Hash(common.FromHex("0x00"))
	rawdb.DeleteCode(s.disk, codeHash)
	if _, err = s.Step(context.Background()); err == nil {
		t.Fatal("Missing code was silently empty")
	}
	if s.next != 0 {
		t.Fatal("Failed stage committed")
	}
}
func TestKeelSparseProofAndHeaderTamperingRejected(t *testing.T) {
	mutations := []func(*KeelSparseInput){func(i *KeelSparseInput) { i.HeaderHash[0] ^= 1 }, func(i *KeelSparseInput) { i.Accounts[0].Code = append(i.Accounts[0].Code, 0) }, func(i *KeelSparseInput) { i.Accounts[0].Nonce++ }, func(i *KeelSparseInput) { i.Accounts[0].AccountProof = nil }, func(i *KeelSparseInput) { i.AncestorHeaders[0][len(i.AncestorHeaders[0])-1] ^= 1 }, func(i *KeelSparseInput) { i.StageGasCap = 200_000_001 }}
	for n, mutate := range mutations {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			input := keelSyntheticInput(t, "0x00", keelProgram("0x"))
			mutate(&input)
			if s, err := NewKeelSparseSession(input); err == nil {
				s.Close()
				t.Fatal("Tampering accepted")
			}
		})
	}
}
func TestKeelSparseRealFreshFactoryProofImport(t *testing.T) {
	path := os.Getenv("KEEL_PUBLIC_FACTORY_PROOF_FIXTURE")
	if path == "" {
		t.Skip("Explicit real public proof fixture not supplied")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprintf("%x", sha256.Sum256(data)) != "437dcba4eeb265bac7a1429f968b8aeb117b363ed3c6f924a8d622d2485171eb" {
		t.Fatal("Actual fixture byte digest differs")
	}
	var capture struct {
		HeaderRLP hexutil.Bytes `json:"headerRlp"`
		Pin       struct {
			Hash common.Hash `json:"hash"`
		}
		Witness struct {
			Accounts []KeelProofAccount `json:"accounts"`
		}
	}
	if err := json.Unmarshal(data, &capture); err != nil {
		t.Fatal(err)
	}
	var header types.Header
	if err := rlp.DecodeBytes(capture.HeaderRLP, &header); err != nil {
		t.Fatal(err)
	}
	if header.Hash() != capture.Pin.Hash {
		t.Fatal("Real header hash differs")
	}
	_, st, err := importKeelWitness(&header, capture.Witness.Accounts)
	if err != nil {
		t.Fatal(err)
	}
	a := capture.Witness.Accounts[0]
	if st.GetNonce(a.Address) != 2 || st.Error() != nil {
		t.Fatal("Actual authenticated factory nonce failed")
	}
	if crypto.Keccak256Hash(st.GetCode(a.Address)) != a.CodeHash {
		t.Fatal("Actual runtime mismatch")
	}
	if st.GetState(a.Address, common.HexToHash("0x2")) != (common.Hash{}) || st.Error() != nil {
		t.Fatal("Actual proved zero failed")
	}
	// A random key may have a proved absence using already-loaded nodes. Search
	// boundedly for a path requiring a genuinely unavailable trie node instead.
	found := false
	for n := uint64(1); n <= 128; n++ {
		st.GetNonce(common.BigToAddress(new(big.Int).SetUint64(n)))
		if st.Error() != nil {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("Expected sparse missing-node dependency was not found")
	}
	t.Logf("Actual proof imported at %d/%s; unknown path rejected: %v", header.Number.Uint64(), header.Hash(), st.Error())
}

func TestKeelSparseMissingStorageRollsBackNativeSystemWrites(t *testing.T) {
	input := keelSyntheticInput(t, "0x5f545f5260205ff3", keelProgram("0x"))
	for i := range input.Accounts {
		if input.Accounts[i].Address == keelTestContract {
			input.Accounts[i].StorageProof = nil
		}
	}
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	before := s.sim.state.GetNonce(keelTestOwner)
	if _, err = s.Step(context.Background()); err == nil {
		t.Fatal("Missing storage was silently zero")
	}
	if s.next != 0 || s.sim.state.GetNonce(keelTestOwner) != before || s.sim.state.Error() != nil {
		t.Fatal("Missing storage changed retained state")
	}
	if e, ok := err.(*KeelWitnessError); !ok || e.Kind != "missing-witness" || e.Access == nil || e.Access.Address != keelTestContract || e.Access.Slot == nil || *e.Access.Slot != (common.Hash{}) {
		t.Fatalf("Incorrect missing-access diagnostic: %#v", err)
	}
	evidence := s.Evidence()
	if evidence.FullWitnessComplete || evidence.HeaderHistoryComplete {
		t.Fatal("Incomplete closure accepted")
	}
}
func TestKeelSparseRevertRemainsRealEVMResult(t *testing.T) {
	input := keelSyntheticInput(t, "0x5f5ffd", keelProgram("0x"))
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err := s.Step(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Calls []struct {
			Status string `json:"status"`
			Error  any    `json:"error"`
		}
	}
	if err := json.Unmarshal(r.Result, &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Calls) != 1 || result.Calls[0].Status != "0x0" || result.Calls[0].Error == nil {
		t.Fatal("Native contract revert hidden")
	}
	if s.sim.state.GetNonce(keelTestOwner) != 1 {
		t.Fatal("Native reverted-transaction nonce semantics changed")
	}
	if !s.Evidence().FullWitnessComplete {
		t.Fatal("Executed revert closure not recorded")
	}
}

func TestKeelSparseCreateAbsentAndPrefundedTargets(t *testing.T) {
	target := crypto.CreateAddress(keelTestContract, 1)
	for _, mode := range []string{"proved-absent", "proved-prefunded", "missing-target-proof", "proved-collision"} {
		t.Run(mode, func(t *testing.T) {
			input := keelSyntheticInput(t, "0x600760115f3960075f5ff05f5260205ff35f5f5360015ff3", keelProgram("0x"), func(alloc types.GenesisAlloc) {
				if mode != "proved-absent" {
					nonce := uint64(0)
					if mode == "proved-collision" {
						nonce = 1
					}
					alloc[target] = types.Account{Balance: big.NewInt(123), Nonce: nonce}
				}
			})
			if mode == "missing-target-proof" {
				filtered := []KeelProofAccount{}
				for _, a := range input.Accounts {
					if a.Address != target {
						filtered = append(filtered, a)
					}
				}
				input.Accounts = filtered
			}
			s, err := NewKeelSparseSession(input)
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			result, err := s.Step(context.Background())
			if mode == "missing-target-proof" {
				if err == nil {
					t.Fatal("Unproved CREATE target was treated as absent")
				}
				if s.next != 0 || s.sim.state.GetNonce(keelTestOwner) != 0 {
					t.Fatal("Missing CREATE target failed rollback")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			address := common.BytesToAddress(keelReturned(t, result.Result))
			if mode == "proved-collision" {
				if address != (common.Address{}) || s.sim.state.GetNonce(target) != 1 || s.sim.state.GetBalance(target).Uint64() != 123 {
					t.Fatal("Creation collision state changed")
				}
				return
			}
			if address != target || !bytes.Equal(s.sim.state.GetCode(target), []byte{0}) {
				t.Fatal("Native CREATE output differs")
			}
			if mode == "proved-prefunded" && s.sim.state.GetBalance(target).Uint64() != 123 {
				t.Fatal("CREATE destroyed proved prefunding")
			}
		})
	}
}
func TestKeelSparseDescendantMissingStorageCannotBeCaughtAsContractRevert(t *testing.T) {
	child := common.HexToAddress("0x3333333333333333333333333333333333333333")
	parent := "0x60205f5f5f73" + common.Bytes2Hex(child[:]) + "61c350fa505f5160005260206000f3"
	input := keelSyntheticInput(t, parent, keelProgram("0x"), func(a types.GenesisAlloc) {
		a[child] = types.Account{Nonce: 1, Balance: new(big.Int), Code: common.FromHex("0x5f545f5260205ff3"), Storage: map[common.Hash]common.Hash{{}: common.HexToHash("0x33")}}
	})
	for i := range input.Accounts {
		if input.Accounts[i].Address == child {
			input.Accounts[i].StorageProof = nil
		}
	}
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.Step(context.Background())
	if e, ok := err.(*KeelWitnessError); !ok || e.Access == nil || e.Access.Address != child || e.Access.Slot == nil {
		t.Fatalf("Expected descendant missing slot, got %#v", err)
	}
	if s.next != 0 || s.sim.state.GetNonce(keelTestOwner) != 0 {
		t.Fatal("Descendant missing witness committed stage")
	}
}
func TestKeelSparseNativeOutOfGasRollsBackContractStorage(t *testing.T) {
	input := keelSyntheticInput(t, "0x60075f555b600456", keelProgram("0x"))
	s, err := NewKeelSparseSession(input)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	result, err := s.Step(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var r struct {
		Calls []struct {
			Status string     `json:"status"`
			Error  *callError `json:"error"`
		}
	}
	if err := json.Unmarshal(result.Result, &r); err != nil {
		t.Fatal(err)
	}
	if len(r.Calls) != 1 || r.Calls[0].Status != "0x0" || r.Calls[0].Error == nil {
		t.Fatal("Out-of-gas became success")
	}
	if s.sim.state.GetState(keelTestContract, common.Hash{}) != common.HexToHash("0x2a") {
		t.Fatal("Out-of-gas retained failed contract write")
	}
	if s.sim.state.GetNonce(keelTestOwner) != 1 {
		t.Fatal("Native reverted-transaction nonce incorrectly undone")
	}
}
func TestKeelExportSyntheticFixture(t *testing.T) {
	output := os.Getenv("KEEL_SYNTHETIC_FIXTURE_OUTPUT")
	if output == "" {
		t.Skip("No synthetic export requested")
	}
	code, err := os.ReadFile(os.Getenv("KEEL_SYNTHETIC_RUNTIME"))
	if err != nil {
		t.Fatal(err)
	}
	program, err := os.ReadFile(os.Getenv("KEEL_SYNTHETIC_PROGRAM"))
	if err != nil {
		t.Fatal(err)
	}
	var extras []func(types.GenesisAlloc)
	if delegatePath := os.Getenv("KEEL_SYNTHETIC_DELEGATE_RUNTIME"); delegatePath != "" {
		data, err := os.ReadFile(delegatePath)
		if err != nil {
			t.Fatal(err)
		}
		delegateCode, err := hexutil.Decode(string(bytes.TrimSpace(data)))
		if err != nil || len(delegateCode) == 0 || len(delegateCode) > 24576 {
			t.Fatal("Bounded synthetic delegate runtime required", err)
		}
		extras = append(extras, func(alloc types.GenesisAlloc) {
			delegate := common.HexToAddress("0x3333333333333333333333333333333333333333")
			owner := alloc[keelTestOwner]
			owner.Code = append([]byte{0xef, 0x01, 0x00}, delegate[:]...)
			alloc[keelTestOwner] = owner
			alloc[delegate] = types.Account{Nonce: 1, Balance: new(big.Int), Code: delegateCode}
		})
	}
	input := keelSyntheticInput(t, string(bytes.TrimSpace(code)), json.RawMessage(program), extras...)
	encoded, err := json.MarshalIndent(input, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(encoded); err != nil {
		t.Fatal(err)
	}
	var header types.Header
	if err := rlp.DecodeBytes(input.HeaderRLP, &header); err != nil {
		t.Fatal(err)
	}
	hb, err := json.MarshalIndent(&header, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output+".header.json", hb, 0600); err != nil {
		t.Fatal(err)
	}
}
