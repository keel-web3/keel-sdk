// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
// One request per process; stdio only. No sockets, datadir, credentials or signer.
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"sync"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/internal/ethapi"
	"github.com/ethereum/go-ethereum/internal/keelfork"
)

const gethCommit = "a579077007b98217c3e253a66e4b452ca0c32b96"
const maxFrameBytes = 40 * 1024 * 1024

type limits struct {
	GasBudget     uint64 `json:"gasBudget"`
	Requests      uint64 `json:"requests"`
	WitnessBytes  uint64 `json:"witnessBytes"`
	ResponseBytes uint64 `json:"responseBytes"`
	WallTimeMs    uint64 `json:"wallTimeMs"`
}
type input struct {
	Schema    string          `json:"schema"`
	ChainID   uint64          `json:"chainId"`
	BlockHash common.Hash     `json:"blockHash"`
	Header    *types.Header   `json:"header"`
	Payload   json.RawMessage `json:"payload"`
	Limits    limits          `json:"limits"`
}
type wire struct {
	mu              sync.Mutex
	scanner         *bufio.Scanner
	out             *json.Encoder
	requests, bytes uint64
	limits          limits
}

func (w *wire) read(ctx context.Context, method string, params []any, out any) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	switch method {
	case "eth_getProof", "eth_getCode", "eth_getBlockByHash":
	default:
		return errors.New("unapproved state-read method")
	}
	if w.requests >= w.limits.Requests {
		return errors.New("state-read request budget exceeded")
	}
	w.requests++
	if err := w.out.Encode(map[string]any{"type": "read", "id": w.requests, "method": method, "params": params}); err != nil {
		return err
	}
	if !w.scanner.Scan() {
		return errors.New("state-read channel closed")
	}
	raw := w.scanner.Bytes()
	w.bytes += uint64(len(raw))
	if w.bytes > w.limits.ResponseBytes {
		return errors.New("state-read response byte budget exceeded")
	}
	var response struct {
		ID     uint64          `json:"id"`
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Category string `json:"category"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return errors.New("invalid state-read response")
	}
	if response.ID != w.requests {
		return errors.New("state-read response id mismatch")
	}
	if response.Error != nil {
		return errors.New("upstream state read unavailable")
	}
	if len(response.Result) == 0 || string(response.Result) == "null" {
		return errors.New("missing pinned state read")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return json.Unmarshal(response.Result, out)
}
func run() error {
	started := time.Now()
	scanner := bufio.NewScanner(io.LimitReader(os.Stdin, 512*1024*1024))
	scanner.Buffer(make([]byte, 64*1024), maxFrameBytes)
	encoder := json.NewEncoder(os.Stdout)
	if !scanner.Scan() {
		return errors.New("missing simulation input")
	}
	requestDigest := fmt.Sprintf("%x", sha256.Sum256(scanner.Bytes()))
	var in input
	if err := json.Unmarshal(scanner.Bytes(), &in); err != nil {
		return errors.New("invalid simulation input")
	}
	l := in.Limits
	if in.Schema != "keel-proof-executor@1" || in.ChainID != 11155111 || in.Header == nil || in.Header.Hash() != in.BlockHash || in.BlockHash == (common.Hash{}) || len(in.Payload) > 32*1024*1024 || l.GasBudget == 0 || l.GasBudget > 10_000_000_000 || l.Requests == 0 || l.Requests > 10000 || l.WitnessBytes == 0 || l.WitnessBytes > 64*1024*1024 || l.ResponseBytes == 0 || l.ResponseBytes > 256*1024*1024 || l.WallTimeMs == 0 || l.WallTimeMs > 180000 {
		return errors.New("unsupported identity or resource limits")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(l.WallTimeMs)*time.Millisecond)
	defer cancel()
	// Unblock a stalled pipe at the deadline; the parent also kills on cancellation.
	go func() { <-ctx.Done(); os.Stdin.Close() }()
	w := &wire{scanner: scanner, out: encoder, limits: l}
	reader, s, err := keelfork.NewReader(ctx, in.Header, w.read, l.WitnessBytes)
	if err != nil {
		return err
	}
	fetch := func(ctx context.Context, hash common.Hash) (*types.Header, error) {
		var header types.Header
		if err := w.read(ctx, "eth_getBlockByHash", []any{hash.Hex(), false}, &header); err != nil {
			return nil, err
		}
		if header.Hash() != hash {
			return nil, errors.New("ancestor hash mismatch")
		}
		return &header, nil
	}
	result, err := ethapi.KeelSparseSimulate(ctx, in.Header, s, in.Payload, l.GasBudget, time.Duration(l.WallTimeMs)*time.Millisecond, fetch)
	if err != nil {
		return err
	}
	if err := reader.Error(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(result) > 32*1024*1024 {
		return errors.New("simulation output budget exceeded")
	}
	// The qualified artifact targets Linux. These are process high-water/cumulative
	// measurements, not estimates derived from transaction gas envelopes.
	if runtime.GOOS != "linux" {
		return errors.New("unsupported measurement platform")
	}
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return err
	}
	return encoder.Encode(map[string]any{"type": "result", "result": result, "evidence": map[string]any{
		"schema": "keel-proof-executor-evidence@1", "gethCommit": gethCommit, "requestSha256": requestDigest, "chainId": in.ChainID, "blockHash": in.BlockHash, "baseStateRoot": in.Header.Root,
		"accountProofs": reader.AccountProofs, "storageProofs": reader.StorageProofs, "codeHashChecks": reader.CodeChecks, "witnessBytes": reader.WitnessBytes(), "readRequests": w.requests, "responseBytes": w.bytes,
		"processPeakRSSBytes": usage.Maxrss * 1024, "processCPUMicroseconds": usage.Utime.Sec*1000000 + usage.Utime.Usec + usage.Stime.Sec*1000000 + usage.Stime.Usec, "nativeWallTimeMs": time.Since(started).Milliseconds(),
		"gasBudget": l.GasBudget, "signing": "not-performed", "submission": "not-performed", "state": "ephemeral-proof-backed"}})
}
func main() {
	// Any panic (including an unexpected Geth backend call) produces no result.
	defer func() {
		if recover() != nil {
			json.NewEncoder(os.Stdout).Encode(map[string]any{"type": "error", "category": "native-execution-failed"})
			os.Exit(1)
		}
	}()
	if err := run(); err != nil {
		code := 0
		if e, ok := err.(interface{ ErrorCode() int }); ok {
			code = e.ErrorCode()
		}
		// No calldata, provider text, credential or underlying proof bytes in errors.
		json.NewEncoder(os.Stdout).Encode(map[string]any{"type": "error", "category": "native-execution-failed", "rpcCode": code})
		fmt.Fprintln(os.Stderr, err.Error()) // Parent never forwards stderr to user-facing diagnostics.
		os.Exit(1)
	}
}
