// Copyright 2026 KEEL contributors. SPDX-License-Identifier: MIT
//go:build linux

package main

import (
	"context"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

const maxWall = 180 * time.Second
const maxInput = 320 * 1024 * 1024
const maxOutput = 64 * 1024 * 1024

type executor struct {
	file   *os.File
	digest string
	uid    uint32
	active chan struct{}
	wall   time.Duration
}

func canonicalPath(path string) bool {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return false
	}
	for current := path; current != "/"; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return false
		}
	}
	return true
}

func openExecutor(path, expected string) (*os.File, error) {
	if !canonicalPath(path) || len(expected) != 64 {
		return nil, errors.New("invalid binary identity")
	}
	if _, err := hex.DecodeString(expected); err != nil {
		return nil, errors.New("invalid binary identity")
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, errors.New("executor unavailable")
	}
	f := os.NewFile(uintptr(fd), "verified-executor")
	ok := false
	defer func() {
		if !ok {
			f.Close()
		}
	}()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("executor must be regular")
	}
	var fs syscall.Statfs_t
	if err := syscall.Fstatfs(fd, &fs); err != nil || fs.Flags&1 == 0 {
		return nil, errors.New("executor must be on a read-only mount")
	}
	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(f, 64*1024*1024+1)); err != nil || info.Size() > 64*1024*1024 || hex.EncodeToString(h.Sum(nil)) != expected {
		return nil, errors.New("executor checksum mismatch")
	}
	if _, err := f.Seek(0, 0); err != nil {
		return nil, err
	}
	magic := make([]byte, 4)
	if _, err := f.ReadAt(magic, 0); err != nil || string(magic) != "\x7fELF" {
		return nil, errors.New("static ELF executor required")
	}
	program, err := elf.NewFile(f)
	if err != nil {
		return nil, errors.New("invalid executable")
	}
	for _, segment := range program.Progs {
		if segment.Type == elf.PT_INTERP {
			return nil, errors.New("dynamic executor refused")
		}
	}
	ok = true
	return f, nil
}

func peerUID(connection *net.UnixConn) (uint32, error) {
	raw, err := connection.SyscallConn()
	if err != nil {
		return 0, err
	}
	var uid uint32
	var peerErr error
	err = raw.Control(func(fd uintptr) {
		credential, e := syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
		peerErr = e
		if e == nil {
			uid = credential.Uid
		}
	})
	if err != nil {
		return 0, err
	}
	return uid, peerErr
}

func copyBounded(dst io.Writer, src io.Reader, limit int64) error {
	n, err := io.Copy(dst, io.LimitReader(src, limit+1))
	if n > limit {
		return errors.New("byte quota exceeded")
	}
	return err
}

func (e *executor) serve(connection *net.UnixConn) {
	defer connection.Close()
	connection.SetDeadline(time.Now().Add(e.wall))
	uid, err := peerUID(connection)
	if err != nil || uid != e.uid {
		return
	}
	select {
	case e.active <- struct{}{}:
		defer func() { <-e.active }()
	default:
		json.NewEncoder(connection).Encode(map[string]any{"type": "error", "category": "runner-busy"})
		return
	}
	if err := json.NewEncoder(connection).Encode(map[string]any{"type": "runner", "schema": "keel-proof-runner@1", "binarySha256": e.digest, "maximumWallTimeMs": e.wall.Milliseconds(), "maximumConcurrency": 1}); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), e.wall)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/proc/self/fd/3")
	cmd.Args = []string{"keel-proof-executor"}
	cmd.ExtraFiles = []*os.File{e.file}
	cmd.Env = []string{"GOMEMLIMIT=512MiB", "GOMAXPROCS=2"}
	cmd.Dir = "/"
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	input, inputWriter, err := os.Pipe()
	if err != nil {
		return
	}
	defer inputWriter.Close()
	output, outputWriter, err := os.Pipe()
	if err != nil {
		input.Close()
		return
	}
	defer output.Close()
	diagnostics, diagnosticWriter, err := os.Pipe()
	if err != nil {
		input.Close()
		outputWriter.Close()
		return
	}
	defer diagnostics.Close()
	cmd.Stdin = input
	cmd.Stdout = outputWriter
	cmd.Stderr = diagnosticWriter
	err = cmd.Start()
	input.Close()
	outputWriter.Close()
	diagnosticWriter.Close()
	if err != nil {
		return
	}
	var streams sync.WaitGroup
	var failed, childDone atomic.Bool
	stopIO := context.AfterFunc(ctx, func() { connection.Close(); inputWriter.Close(); output.Close(); diagnostics.Close() })
	defer stopIO()
	streams.Add(3)
	go func() {
		defer streams.Done()
		_ = copyBounded(inputWriter, connection, maxInput)
		inputWriter.Close()
		if !childDone.Load() {
			failed.Store(true)
			cancel()
		}
	}()
	go func() {
		defer streams.Done()
		if copyBounded(connection, output, maxOutput) != nil {
			failed.Store(true)
			cancel()
		}
	}()
	go func() {
		defer streams.Done()
		if copyBounded(io.Discard, diagnostics, 64*1024) != nil {
			failed.Store(true)
			cancel()
		}
	}()
	err = cmd.Wait()
	childDone.Store(true)
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	connection.CloseRead()
	streams.Wait()
	code := 0
	if err != nil || failed.Load() || ctx.Err() != nil {
		code = 1
	}
	stopIO()

	json.NewEncoder(connection).Encode(map[string]any{"type": "runner-exit", "code": code})
}

func main() {
	binary := flag.String("binary", "/executor", "immutable executor path")
	digest := flag.String("sha256", "", "expected executor SHA-256")
	socket := flag.String("socket", "/run/keel-proof/runner.sock", "local Unix socket")
	wall := flag.Duration("wall-time", maxWall, "bounded request deadline")
	uid := flag.Uint("uid", uint(os.Getuid()), "approved local application UID")
	flag.Parse()
	if flag.NArg() != 0 || *uid > uint(^uint32(0)) || !filepath.IsAbs(*socket) || filepath.Clean(*socket) != *socket || filepath.Base(*socket) != "runner.sock" || *wall <= 0 || *wall > maxWall || os.Getuid() == 0 {
		fmt.Fprintln(os.Stderr, "invalid unprivileged runner configuration")
		os.Exit(1)
	}
	file, err := openExecutor(*binary, *digest)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	defer file.Close()
	if info, err := os.Lstat(filepath.Dir(*socket)); err != nil || !canonicalPath(filepath.Dir(*socket)) || !info.IsDir() || info.Mode().Perm() != 0700 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		fmt.Fprintln(os.Stderr, "private socket directory required")
		os.Exit(1)
	}
	lock, err := prepareSocket(*socket)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	defer lock.Close()

	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: *socket, Net: "unix"})
	if err != nil {
		fmt.Fprintln(os.Stderr, "socket unavailable")
		os.Exit(1)
	}
	defer listener.Close()
	if err := os.Chmod(*socket, 0600); err != nil {
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() { <-ctx.Done(); listener.Close() }()
	e := &executor{file: file, digest: *digest, uid: uint32(*uid), active: make(chan struct{}, 1), wall: *wall}
	connections := make(chan struct{}, 8)
	for {
		connection, err := listener.AcceptUnix()
		if err != nil {
			return
		}
		select {
		case connections <- struct{}{}:
			go func() { defer func() { <-connections }(); e.serve(connection) }()
		default:
			connection.Close()
		}
	}
}
