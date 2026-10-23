// Copyright 2026 KEEL contributors. SPDX-License-Identifier: MIT
//go:build linux

package main

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// The private directory is writable only by the trusted broker UID. Studio mounts
// it read-only. A process-held lock serializes every cooperating broker start;
// SIGKILL releases the lock, so a refused, owned stale socket is recoverable.
func prepareSocket(path string) (*os.File, error) {
	parent, err := os.Lstat(filepath.Dir(path))
	if err != nil || !canonicalPath(filepath.Dir(path)) || filepath.Clean(path) != path || filepath.Base(path) != "runner.sock" || !parent.IsDir() || parent.Mode().Perm() != 0700 || parent.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		return nil, errors.New("private canonical socket directory required")
	}
	fd, err := syscall.Open(filepath.Join(filepath.Dir(path), ".runner.lock"), syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, errors.New("runner lock unavailable")
	}
	lock := os.NewFile(uintptr(fd), "runner-lock")
	fail := func(message string) (*os.File, error) { lock.Close(); return nil, errors.New(message) }
	info, err := lock.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		return fail("runner lock ownership mismatch")
	}
	if syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return fail("another runner owns this socket directory")
	}
	before, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return lock, nil
	}
	if err != nil || before.Mode()&os.ModeSocket == 0 || before.Sys().(*syscall.Stat_t).Uid != uint32(os.Getuid()) {
		return fail("socket path is not an owned socket")
	}
	connection, err := net.DialTimeout("unix", path, 250*time.Millisecond)
	if err == nil {
		connection.Close()
		return fail("another live listener owns the socket")
	}
	if !errors.Is(err, syscall.ECONNREFUSED) {
		return fail("socket liveness is uncertain")
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) {
		return fail("socket changed during recovery")
	}
	if err := os.Remove(path); err != nil {
		return fail("stale socket could not be removed")
	}
	return lock, nil
}
