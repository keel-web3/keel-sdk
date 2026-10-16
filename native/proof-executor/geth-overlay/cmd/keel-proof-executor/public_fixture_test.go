// Copyright 2026 KEEL contributors. SPDX-License-Identifier: LGPL-3.0-or-later
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestNullPinnedStateResponsesFailClosed(t *testing.T) {
	for _, method := range []string{"eth_getProof", "eth_getCode", "eth_getBlockByHash"} {
		t.Run(method, func(t *testing.T) {
			for _, response := range []string{`{"id":1,"result":null}`, `{"id":1,"result": null }`, `{"id":1}`} {
				w := &wire{scanner: bufio.NewScanner(strings.NewReader(response + "\n")), out: json.NewEncoder(io.Discard), limits: limits{Requests: 1, ResponseBytes: 1024}}
				var result any
				if err := w.read(context.Background(), method, nil, &result); err == nil {
					t.Fatal("missing pinned state returned as a value")
				}
			}
		})
	}
}
