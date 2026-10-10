//go:build linux

package main

import (
	"bytes"
	"net"
	"os"
	"path/filepath"
	"testing"
)

func privateDir(t *testing.T) string {
	t.Helper()
	p := t.TempDir()
	if err := os.Chmod(p, 0700); err != nil {
		t.Fatal(err)
	}
	return p
}
func TestSocketLockAndLiveOwner(t *testing.T) {
	p := filepath.Join(privateDir(t), "runner.sock")
	lock, err := prepareSocket(p)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if other, err := prepareSocket(p); err == nil {
		other.Close()
		t.Fatal("concurrent owner acquired the lock")
	}
	lock.Close()
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: p, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if other, err := prepareSocket(p); err == nil {
		other.Close()
		t.Fatal("live listener was replaced")
	}
	if _, err := os.Lstat(p); err != nil {
		t.Fatal("live socket removed")
	}
}
func TestRecoverOwnedStaleSocket(t *testing.T) {
	p := filepath.Join(privateDir(t), "runner.sock")
	l, err := net.ListenUnix("unix", &net.UnixAddr{Name: p, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	l.SetUnlinkOnClose(false)
	l.Close()
	lock, err := prepareSocket(p)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if _, err := os.Lstat(p); !os.IsNotExist(err) {
		t.Fatal("stale socket was not recovered")
	}
}
func TestDoNotRemoveSymlinkOrRegularFile(t *testing.T) {
	for _, symlink := range []bool{false, true} {
		dir := privateDir(t)
		p := filepath.Join(dir, "runner.sock")
		target := filepath.Join(dir, "protected")
		os.WriteFile(target, []byte("keep"), 0600)
		if symlink {
			os.Symlink(target, p)
		} else {
			os.WriteFile(p, []byte("keep"), 0600)
		}
		if lock, err := prepareSocket(p); err == nil {
			lock.Close()
			t.Fatal("non-socket accepted")
		}
		if data, err := os.ReadFile(target); err != nil || string(data) != "keep" {
			t.Fatal("target changed")
		}
	}
}
func TestSymlinkedLockAndNoncanonicalPaths(t *testing.T) {
	dir := privateDir(t)
	target := filepath.Join(dir, "protected")
	os.WriteFile(target, []byte("keep"), 0600)
	os.Symlink(target, filepath.Join(dir, ".runner.lock"))
	if lock, err := prepareSocket(filepath.Join(dir, "runner.sock")); err == nil {
		lock.Close()
		t.Fatal("symlink lock accepted")
	}
	os.Symlink(dir, filepath.Join(dir, "alias"))
	if canonicalPath(filepath.Join(dir, "alias")) {
		t.Fatal("symlink path accepted")
	}
}
func TestCopyBudgetFailsInsteadOfSilentlyTruncating(t *testing.T) {
	var target bytes.Buffer
	if err := copyBounded(&target, bytes.NewBufferString("abcd"), 3); err == nil {
		t.Fatal("oversized stream accepted")
	}
}
