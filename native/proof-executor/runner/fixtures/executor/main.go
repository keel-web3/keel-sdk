// Synthetic process fixture only; never included in a deployment image.
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"os"
	"os/exec"
	"runtime"
	"syscall"
	"time"
)

var marker = "original"

func main() {
	if os.Args[0] == "grandchild" {
		time.Sleep(time.Hour)
		return
	}
	var request struct {
		Mode string `json:"mode"`
	}
	if json.NewDecoder(os.Stdin).Decode(&request) != nil {
		os.Exit(2)
	}
	if request.Mode == "hang" {
		time.Sleep(time.Hour)
		return
	}
	if request.Mode == "fail" {
		os.Exit(7)
	}
	if request.Mode == "input" {
		io.Copy(io.Discard, os.Stdin)
		return
	}
	if request.Mode == "memory" {
		var blocks [][]byte
		for i := 0; i < 64; i++ {
			block := make([]byte, 16*1024*1024)
			for j := 0; j < len(block); j += 4096 {
				block[j] = 1
			}
			blocks = append(blocks, block)
		}
		time.Sleep(time.Hour)
		runtime.KeepAlive(blocks)
		return
	}
	if request.Mode == "stderr" {
		os.Stderr.Write(bytes.Repeat([]byte("X"), 65537))
	}
	if request.Mode == "output" {
		for i := 0; i < 1025; i++ {
			os.Stdout.Write(bytes.Repeat([]byte("X"), 65536))
		}
		return
	}
	interfaces, _ := net.Interfaces()
	names := make([]string, 0, len(interfaces))
	for _, i := range interfaces {
		names = append(names, i.Name)
	}
	result := map[string]any{"type": "result", "marker": marker, "pid": os.Getpid(), "uid": os.Getuid(), "environment": os.Environ(), "interfaces": names,
		"rootWriteRefused": os.WriteFile("/keel-write-test", []byte("no"), 0600) != nil, "rootEscalationRefused": syscall.Setuid(0) != nil}
	for _, name := range []string{"memory.max", "cpu.max", "pids.max"} {
		value, _ := os.ReadFile("/sys/fs/cgroup/" + name)
		result[name] = string(bytes.TrimSpace(value))
	}
	if request.Mode == "pids" {
		count := 0
		for ; count < 128; count++ {
			child := exec.Command("/bin/sleep", "60")
			child.Args[0] = "grandchild"
			if child.Start() != nil {
				break
			}
		}
		result["spawned"] = count
		result["pidLimitEnforced"] = count > 0 && count < 64
	}
	if request.Mode == "descendant" {
		child := exec.Command("/proc/self/exe")
		child.Args = []string{"grandchild"}
		if child.Start() != nil {
			os.Exit(3)
		}
		result["descendant"] = child.Process.Pid
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
