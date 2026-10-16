// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
// Synthetic offline fixture only: four empty canonical blocks, no transactions.
package main

import (
	"encoding/json"
	"io"
	"os"

	"github.com/ethereum/go-ethereum/consensus/beacon"
	"github.com/ethereum/go-ethereum/consensus/ethash"
	"github.com/ethereum/go-ethereum/core"
	"github.com/ethereum/go-ethereum/rlp"
)

func main() {
	var genesis core.Genesis
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 32*1024*1024)).Decode(&genesis); err != nil {
		panic(err)
	}
	if genesis.Config == nil || genesis.Config.ChainID.Uint64() != 11155111 {
		panic("synthetic Sepolia fixture required")
	}
	db, blocks, _ := core.GenerateChainWithGenesis(&genesis, beacon.New(ethash.NewFaker()), 4, func(_ int, b *core.BlockGen) { b.SetPoS() })
	defer db.Close()
	for _, block := range blocks {
		if len(block.Transactions()) != 0 {
			panic("fixture must contain no transactions")
		}
		if err := rlp.Encode(os.Stdout, block); err != nil {
			panic(err)
		}
	}
}
