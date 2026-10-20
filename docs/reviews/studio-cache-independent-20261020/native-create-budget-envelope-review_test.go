package ethapi

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Exercise Geth's genuine cross-block/request-budget sanitizer, rather than
// forging a result object. Both input gas limits individually fit the budget;
// the first transaction's real cost makes the second reservation get capped.
// The shim must reject that changed later envelope even if execution succeeds.
func TestReviewKeelSparseEVMRejectsActualLaterBudgetCap(t *testing.T) {
	s, h := syntheticCreateState(t, syntheticFunds())
	raw := syntheticProgram(t, "0x600a600c600039600a6000f3602a60005260206000f3", true)
	_, err := KeelSparseSimulate(context.Background(), h, s, raw, 10_000_000, 10*time.Second, nil)
	if err == nil || !strings.Contains(err.Error(), "local simulation changed an original execution envelope") {
		t.Fatalf("later real gas-budget cap was accepted or failed for another reason: %v", err)
	}
}
