package ethapi

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

func keelProtocol(t *testing.T, code string, program json.RawMessage) (*KeelSessionProtocol, map[string]any) {
	t.Helper()
	input := keelSyntheticInput(t, code, program)
	p, err := NewKeelSessionProtocol(input)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	command := map[string]any{"id": "test-command", "type": "begin", "sessionId": "test-session", "canonicalHash": input.HeaderHash, "programDigest": crypto.Keccak256Hash(program), "programJSON": string(program)}
	return p, command
}
func keelCommand(t *testing.T, p *KeelSessionProtocol, command map[string]any) KeelSessionResponse {
	t.Helper()
	encoded, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	return p.Handle(context.Background(), encoded)
}
func keelNext(command map[string]any, kind string) map[string]any {
	next := map[string]any{}
	for key, value := range command {
		if key != "programJSON" && key != "index" && key != "expectedCheckpoint" {
			next[key] = value
		}
	}
	next["type"] = kind
	return next
}
func keelExpectCode(t *testing.T, response KeelSessionResponse, code string) {
	t.Helper()
	if response.Error == nil || response.Error.Code != code {
		t.Fatalf("Expected %s, got %+v", code, response)
	}
}

func TestKeelSessionProtocolNativeContinuityAndExactRetry(t *testing.T) {
	p, begin := keelProtocol(t, "0x36156009575f355f555b5f545f5260205ff3", keelProgram(common.HexToHash("0x7").Hex(), "0x"))
	if got := keelCommand(t, p, begin); got.Error != nil {
		t.Fatal(got.Error)
	}
	stage := keelNext(begin, "stage")
	stage["index"] = 0
	stage["expectedCheckpoint"] = begin["canonicalHash"]
	first := keelCommand(t, p, stage)
	if first.Error != nil {
		t.Fatal(first.Error)
	}
	cached := keelCommand(t, p, stage)
	if !reflect.DeepEqual(first, cached) || p.engine.next != 1 {
		t.Fatal("Retry reexecuted or changed the committed stage")
	}
	receipt := first.Result.(keelStageReceipt)
	if common.BytesToHash(keelReturned(t, receipt.Result)) != common.HexToHash("0x7") {
		t.Fatal("Native first write missing")
	}
	stage["index"] = 1
	stage["expectedCheckpoint"] = receipt.Checkpoint
	second := keelCommand(t, p, stage)
	if second.Error != nil {
		t.Fatal(second.Error)
	}
	if common.BytesToHash(keelReturned(t, second.Result.(keelStageReceipt).Result)) != common.HexToHash("0x7") {
		t.Fatal("Native stage lost prior state")
	}
	finish := keelCommand(t, p, keelNext(begin, "finish"))
	if finish.Error != nil {
		t.Fatal(finish.Error)
	}
	fields := finish.Result.(map[string]any)
	if fields["acceptance"] != false || fields["fullWitnessComplete"] != true || fields["headerHistoryComplete"] != true || fields["stickyStateError"] != false || p.engine != nil {
		t.Fatal("Final proof or disposal incorrect")
	}
	if !reflect.DeepEqual(finish, keelCommand(t, p, keelNext(begin, "finish"))) {
		t.Fatal("Repeated finish changed result")
	}
}
func TestKeelSessionProtocolRejectsStaleProgramAndCheckpoint(t *testing.T) {
	p, begin := keelProtocol(t, "0x00", keelProgram("0x", "0x"))
	if got := keelCommand(t, p, begin); got.Error != nil {
		t.Fatal(got.Error)
	}
	for _, mutation := range []func(map[string]any){func(c map[string]any) { c["index"] = 1 }, func(c map[string]any) { c["expectedCheckpoint"] = common.HexToHash("0x123") }, func(c map[string]any) { c["programDigest"] = common.HexToHash("0x123") }, func(c map[string]any) { c["canonicalHash"] = common.HexToHash("0x123") }} {
		stage := keelNext(begin, "stage")
		stage["index"] = 0
		stage["expectedCheckpoint"] = begin["canonicalHash"]
		mutation(stage)
		keelExpectCode(t, keelCommand(t, p, stage), "session-stale")
		if p.engine.next != 0 {
			t.Fatal("Stale command executed")
		}
	}
	keelExpectCode(t, keelCommand(t, p, keelNext(begin, "finish")), "session-incomplete")
}
func TestKeelSessionProtocolAbortThenNewSessionStartsFromCanonicalState(t *testing.T) {
	p, begin := keelProtocol(t, "0x36156009575f355f555b5f545f5260205ff3", keelProgram(common.HexToHash("0x7").Hex(), "0x"))
	if got := keelCommand(t, p, begin); got.Error != nil {
		t.Fatal(got.Error)
	}
	stage := keelNext(begin, "stage")
	stage["index"] = 0
	stage["expectedCheckpoint"] = begin["canonicalHash"]
	if got := keelCommand(t, p, stage); got.Error != nil {
		t.Fatal(got.Error)
	}
	if got := keelCommand(t, p, keelNext(begin, "abort")); got.Error != nil {
		t.Fatal(got.Error)
	}
	keelExpectCode(t, keelCommand(t, p, stage), "session-closed")
	keelExpectCode(t, keelCommand(t, p, begin), "session-stale")
	fresh := keelNext(begin, "begin")
	fresh["sessionId"] = "new-session"
	fresh["programJSON"] = string(keelProgram("0x"))
	fresh["programDigest"] = crypto.Keccak256Hash([]byte(fresh["programJSON"].(string)))
	if got := keelCommand(t, p, fresh); got.Error != nil {
		t.Fatal(got.Error)
	}
	read := keelNext(fresh, "stage")
	read["index"] = 0
	read["expectedCheckpoint"] = fresh["canonicalHash"]
	got := keelCommand(t, p, read)
	if got.Error != nil {
		t.Fatal(got.Error)
	}
	if common.BytesToHash(keelReturned(t, got.Result.(keelStageReceipt).Result)) != common.HexToHash("0x2a") {
		t.Fatal("New session retained aborted writes")
	}
}
func TestKeelSessionProtocolCancellationClosesState(t *testing.T) {
	p, begin := keelProtocol(t, "0x00", keelProgram("0x"))
	if got := keelCommand(t, p, begin); got.Error != nil {
		t.Fatal(got.Error)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	command := keelNext(begin, "stage")
	command["index"] = 0
	command["expectedCheckpoint"] = begin["canonicalHash"]
	raw, _ := json.Marshal(command)
	keelExpectCode(t, p.Handle(ctx, raw), "session-closed")
	if p.engine != nil || p.status != "aborted" {
		t.Fatal("Cancelled state remained live")
	}
}
func TestKeelSessionProtocolMissingWitnessIsTerminalStructuredFailure(t *testing.T) {
	program := keelProgram("0x")
	input := keelSyntheticInput(t, "0x5f545f5260205ff3", program)
	for i := range input.Accounts {
		if input.Accounts[i].Address == keelTestContract {
			input.Accounts[i].StorageProof = nil
		}
	}
	p, err := NewKeelSessionProtocol(input)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	begin := map[string]any{"id": "missing", "type": "begin", "sessionId": "missing-session", "canonicalHash": input.HeaderHash, "programDigest": crypto.Keccak256Hash(program), "programJSON": string(program)}
	if got := keelCommand(t, p, begin); got.Error != nil {
		t.Fatal(got.Error)
	}
	stage := keelNext(begin, "stage")
	stage["index"] = 0
	stage["expectedCheckpoint"] = input.HeaderHash
	got := keelCommand(t, p, stage)
	keelExpectCode(t, got, "native-stage-failed")
	if got.Error.Diagnostic == nil || got.Error.Diagnostic.Kind != "missing-witness" || got.Error.Diagnostic.Access == nil || got.Error.Diagnostic.Access.Address != keelTestContract {
		t.Fatal("Missing witness location lost")
	}
	if p.engine != nil || p.status != "failed" || len(p.stages) != 0 {
		t.Fatal("Failed stage remained committed")
	}
	keelExpectCode(t, keelCommand(t, p, stage), "session-closed")
}
func TestKeelSessionProtocolNativeRevertIsNotSuccessOrRetry(t *testing.T) {
	p, begin := keelProtocol(t, "0x5f5ffd", keelProgram("0x"))
	if got := keelCommand(t, p, begin); got.Error != nil {
		t.Fatal(got.Error)
	}
	stage := keelNext(begin, "stage")
	stage["index"] = 0
	stage["expectedCheckpoint"] = begin["canonicalHash"]
	got := keelCommand(t, p, stage)
	if got.Error != nil {
		t.Fatal(got.Error)
	}
	var block struct {
		Calls []struct {
			Status string `json:"status"`
		}
	}
	if err := json.Unmarshal(got.Result.(keelStageReceipt).Result, &block); err != nil {
		t.Fatal(err)
	}
	if len(block.Calls) != 1 || block.Calls[0].Status != "0x0" {
		t.Fatal("Native revert masked")
	}
	if p.engine.sim.state.GetNonce(keelTestOwner) != 1 {
		t.Fatal("Native revert nonce semantics changed")
	}
	cached := keelCommand(t, p, stage)
	if !reflect.DeepEqual(cached, got) || p.engine.sim.state.GetNonce(keelTestOwner) != 1 {
		t.Fatal("Revert retried")
	}
	finish := keelCommand(t, p, keelNext(begin, "finish"))
	if finish.Error != nil {
		t.Fatal(finish.Error)
	}
	if finish.Result.(map[string]any)["acceptance"] != false {
		t.Fatal("Local execution advertised acceptance")
	}
}
func TestKeelSessionProtocolRejectsChangedBeginAndUnknownCommands(t *testing.T) {
	p, begin := keelProtocol(t, "0x00", keelProgram("0x"))
	begin["programJSON"] = string(keelProgram("0xff"))
	keelExpectCode(t, keelCommand(t, p, begin), "configuration-invalid")
	unknown, _ := json.Marshal(map[string]any{"id": "x", "type": "begin", "sessionId": "x", "canonicalHash": begin["canonicalHash"], "provider": "https://unapproved.invalid"})
	keelExpectCode(t, p.Handle(context.Background(), unknown), "configuration-invalid")
	if p.engine != nil {
		t.Fatal("Rejected command created engine")
	}
}
