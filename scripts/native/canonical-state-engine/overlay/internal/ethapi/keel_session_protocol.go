package ethapi

// This private diagnostic protocol never installs an RPC API or commits blocks.
// It only retains the pinned sparse StateDB for one immutable simulator program.
import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sync"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const keelMaximumProgramBytes = 8 * 1024 * 1024

var keelSessionID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

type KeelSessionCommand struct {
	ID                 string       `json:"id"`
	Type               string       `json:"type"`
	SessionID          string       `json:"sessionId"`
	ProgramDigest      common.Hash  `json:"programDigest"`
	CanonicalHash      common.Hash  `json:"canonicalHash"`
	ProgramJSON        string       `json:"programJSON,omitempty"`
	Index              *int         `json:"index,omitempty"`
	ExpectedCheckpoint *common.Hash `json:"expectedCheckpoint,omitempty"`
}

type KeelSessionResponse struct {
	ID     string            `json:"id"`
	Result any               `json:"result,omitempty"`
	Error  *KeelSessionError `json:"error,omitempty"`
}
type KeelSessionError struct {
	Code       string            `json:"code"`
	Message    string            `json:"message"`
	Diagnostic *KeelWitnessError `json:"diagnostic,omitempty"`
}
type keelStageReceipt struct {
	SessionID          string            `json:"sessionId"`
	ProgramDigest      common.Hash       `json:"programDigest"`
	CanonicalHash      common.Hash       `json:"canonicalHash"`
	Index              int               `json:"index"`
	PreviousCheckpoint common.Hash       `json:"previousCheckpoint"`
	Checkpoint         common.Hash       `json:"checkpoint"`
	Result             json.RawMessage   `json:"result"`
	Accesses           []KeelStateAccess `json:"accesses"`
}

type KeelSessionProtocol struct {
	mu         sync.Mutex
	input      KeelSparseInput
	engine     *KeelSparseSession
	id         string
	digest     common.Hash
	checkpoint common.Hash
	count      int
	stages     []keelStageReceipt
	seen       map[string]struct{}
	status     string
	final      any
}

func NewKeelSessionProtocol(input KeelSparseInput) (*KeelSessionProtocol, error) {
	// Program is supplied once by begin, never loaded from an unrelated fixture.
	input.Program = nil
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var copied KeelSparseInput
	if err := json.Unmarshal(encoded, &copied); err != nil {
		return nil, err
	}
	return &KeelSessionProtocol{input: copied, seen: make(map[string]struct{}), status: "idle"}, nil
}

func (p *KeelSessionProtocol) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.engine != nil {
		p.engine.Close()
		p.engine = nil
	}
	if p.status == "open" {
		p.status = "aborted"
	}
}

func (p *KeelSessionProtocol) Handle(ctx context.Context, raw []byte) KeelSessionResponse {
	p.mu.Lock()
	defer p.mu.Unlock()
	response := KeelSessionResponse{}
	reject := func(code, message string) KeelSessionResponse {
		response.Error = &KeelSessionError{Code: code, Message: message}
		return response
	}
	if len(raw) > 2*keelMaximumProgramBytes+4096 {
		return reject("configuration-invalid", "Command exceeds the local protocol bound")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var cmd KeelSessionCommand
	if err := decoder.Decode(&cmd); err != nil {
		return reject("configuration-invalid", "Malformed or unsupported local command")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return reject("configuration-invalid", "Trailing command data")
	}
	response.ID = cmd.ID
	if !keelSessionID.MatchString(cmd.ID) || !keelSessionID.MatchString(cmd.SessionID) {
		return reject("configuration-invalid", "Invalid command or session identity")
	}
	if cmd.CanonicalHash != p.input.HeaderHash {
		return reject("session-stale", "Canonical header binding changed")
	}
	if ctx.Err() != nil {
		if p.engine != nil {
			p.engine.Close()
			p.engine = nil
		}
		p.status = "aborted"
		return reject("session-closed", "The local session was cancelled")
	}
	if cmd.Type == "begin" {
		if cmd.Index != nil || cmd.ExpectedCheckpoint != nil || len(cmd.ProgramJSON) == 0 || len(cmd.ProgramJSON) > keelMaximumProgramBytes {
			return reject("configuration-invalid", "Invalid begin command")
		}
		if p.status == "open" {
			return reject("session-stale", "A local session is already active")
		}
		if _, exists := p.seen[cmd.SessionID]; exists {
			return reject("session-stale", "Session identifiers cannot be reused")
		}
		if len(p.seen) >= 64 {
			return reject("session-closed", "Local process session bound reached")
		}
		if crypto.Keccak256Hash([]byte(cmd.ProgramJSON)) != cmd.ProgramDigest {
			return reject("configuration-invalid", "Complete program digest differs")
		}
		var program struct {
			BlockStateCalls []json.RawMessage `json:"blockStateCalls"`
		}
		if err := json.Unmarshal([]byte(cmd.ProgramJSON), &program); err != nil || len(program.BlockStateCalls) == 0 || len(program.BlockStateCalls) > 256 {
			return reject("configuration-invalid", "Complete original program is required")
		}
		input := p.input
		input.Program = json.RawMessage(cmd.ProgramJSON)
		engine, err := NewKeelSparseSession(input)
		if err != nil {
			return reject("native-initialization-failed", fmt.Sprintf("Native canonical-state initialization failed: %.512s", err))
		}
		p.seen[cmd.SessionID] = struct{}{}
		p.id = cmd.SessionID
		p.digest = cmd.ProgramDigest
		p.engine = engine
		p.count = len(program.BlockStateCalls)
		p.stages = nil
		p.final = nil
		p.status = "open"
		p.checkpoint = engine.InitialCheckpoint()
		response.Result = map[string]any{"sessionId": p.id, "programDigest": p.digest, "canonicalHash": p.input.HeaderHash, "checkpoint": p.checkpoint, "nextIndex": 0, "stageCount": p.count, "status": p.status, "acceptance": false}
		return response
	}
	if cmd.SessionID != p.id || cmd.ProgramDigest != p.digest {
		return reject("session-stale", "Session or complete program binding differs")
	}
	if cmd.ProgramJSON != "" {
		return reject("configuration-invalid", "Calls may only be supplied by begin")
	}
	if cmd.Type == "abort" {
		if cmd.Index != nil || cmd.ExpectedCheckpoint != nil {
			return reject("configuration-invalid", "Invalid abort command")
		}
		if p.engine != nil {
			p.engine.Close()
			p.engine = nil
		}
		p.status = "aborted"
		p.final = nil
		response.Result = map[string]any{"sessionId": p.id, "programDigest": p.digest, "canonicalHash": p.input.HeaderHash, "status": p.status, "acceptance": false}
		return response
	}
	if cmd.Type == "status" {
		if cmd.Index != nil || cmd.ExpectedCheckpoint != nil {
			return reject("configuration-invalid", "Invalid status command")
		}
		response.Result = map[string]any{"sessionId": p.id, "programDigest": p.digest, "canonicalHash": p.input.HeaderHash, "status": p.status, "checkpoint": p.checkpoint, "nextIndex": len(p.stages), "stageCount": p.count, "acceptance": false}
		return response
	}
	if p.status != "open" {
		if cmd.Type == "finish" && p.status == "completed" && cmd.Index == nil && cmd.ExpectedCheckpoint == nil {
			response.Result = p.final
			return response
		}
		return reject("session-closed", "The local session is no longer active")
	}
	switch cmd.Type {
	case "stage":
		if cmd.Index == nil || *cmd.Index < 0 || cmd.ExpectedCheckpoint == nil {
			return reject("configuration-invalid", "Stage index and checkpoint are required")
		}
		index := *cmd.Index
		if index < len(p.stages) {
			cached := p.stages[index]
			if *cmd.ExpectedCheckpoint != cached.PreviousCheckpoint {
				return reject("session-stale", "Cached stage parent checkpoint differs")
			}
			response.Result = cached
			return response // Exact lost-response retry; no native execution.
		}
		if index != len(p.stages) || index >= p.count || *cmd.ExpectedCheckpoint != p.checkpoint {
			return reject("session-stale", "Stage cursor or checkpoint differs")
		}
		previous := p.checkpoint
		stage, err := p.engine.Step(ctx)
		if err != nil {
			p.engine.Close()
			p.engine = nil
			p.status = "failed"
			denied := reject("native-stage-failed", fmt.Sprintf("Native stage rolled back: %.512s", err))
			var diagnostic *KeelWitnessError
			if errors.As(err, &diagnostic) {
				copy := *diagnostic
				if len(copy.Cause) > 1024 {
					copy.Cause = copy.Cause[:1024]
				}
				denied.Error.Diagnostic = &copy
			}
			return denied
		}
		if stage.Index != index {
			p.engine.Close()
			p.engine = nil
			p.status = "failed"
			return reject("native-stage-failed", "Native stage index differs")
		}
		receipt := keelStageReceipt{SessionID: p.id, ProgramDigest: p.digest, CanonicalHash: p.input.HeaderHash, Index: index, PreviousCheckpoint: previous, Checkpoint: stage.Checkpoint, Result: append(json.RawMessage(nil), stage.Result...), Accesses: stage.Accesses}
		p.stages = append(p.stages, receipt)
		p.checkpoint = stage.Checkpoint
		response.Result = receipt
		return response
	case "finish":
		if cmd.Index != nil || cmd.ExpectedCheckpoint != nil {
			return reject("configuration-invalid", "Invalid finish command")
		}
		if len(p.stages) != p.count {
			return reject("session-incomplete", "Every original stage must execute before finish")
		}
		results, err := p.engine.Results()
		if err != nil {
			p.engine.Close()
			p.engine = nil
			p.status = "failed"
			return reject("native-stage-failed", "Native complete result unavailable")
		}
		evidence := p.engine.Evidence()
		if !evidence.FullWitnessComplete || !evidence.HeaderHistoryComplete || evidence.StickyStateError || evidence.CanonicalHeaderHash != p.input.HeaderHash || evidence.CompletedStages != p.count || evidence.TotalStages != p.count {
			p.engine.Close()
			p.engine = nil
			p.status = "failed"
			return reject("native-stage-failed", "Complete native witness and header coverage was not established")
		}
		p.final = map[string]any{"sessionId": p.id, "programDigest": p.digest, "canonicalHash": p.input.HeaderHash, "checkpoint": p.checkpoint, "stageCount": p.count, "results": json.RawMessage(append([]byte(nil), results...)), "status": "completed", "acceptance": false,
			"fullWitnessComplete": evidence.FullWitnessComplete, "headerHistoryComplete": evidence.HeaderHistoryComplete, "stickyStateError": evidence.StickyStateError, "nativeEvidence": evidence}
		p.engine.Close()
		p.engine = nil
		p.status = "completed"
		response.Result = p.final
		return response
	default:
		return reject("configuration-invalid", "Unsupported local command")
	}
}
