package main

// Private JSON-lines process, not a network RPC server. No signer or submission.
import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/ethereum/go-ethereum/internal/ethapi"
)

func run() error {
	inputPath := flag.String("input", "", "Absolute immutable canonical witness JSON file")
	flag.Parse()
	if !filepath.IsAbs(*inputPath) || flag.NArg() != 0 {
		return fmt.Errorf("use --input /absolute/canonical-witness.json")
	}
	info, err := os.Lstat(*inputPath)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > 256*1024*1024 {
		return fmt.Errorf("bounded regular witness file required")
	}
	file, err := os.Open(*inputPath)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 256*1024*1024+1))
	decoder.DisallowUnknownFields()
	var input ethapi.KeelSparseInput
	if err := decoder.Decode(&input); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("trailing witness data")
	}
	protocol, err := ethapi.NewKeelSessionProtocol(input)
	if err != nil {
		return err
	}
	defer protocol.Close()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 65536), 16*1024*1024+4096)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := encoder.Encode(protocol.Handle(ctx, scanner.Bytes())); err != nil {
			return err
		}
	}
	return scanner.Err()
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Local sparse session refused:", err)
		os.Exit(1)
	}
}
