// Copyright 2026 The go-ethereum Authors
// SPDX-License-Identifier: LGPL-3.0-or-later
package ethapi

import (
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/state"
	"github.com/ethereum/go-ethereum/core/tracing"
	"github.com/ethereum/go-ethereum/core/vm"
	"github.com/holiman/uint256"
)

type keelGuardState struct {
	vm.StateDB
	raw      *state.StateDB
	stage    int
	accesses *[]KeelStateAccess
	seen     map[string]bool
}

func (g *keelGuardState) check(kind string, address common.Address, slot *common.Hash) {
	access := KeelStateAccess{Kind: kind, Address: address, Slot: slot}
	if err := g.raw.Error(); err != nil {
		panic(&KeelWitnessError{Stage: g.stage, Kind: "missing-witness", Access: &access, Cause: err.Error()})
	}
	key := kind + address.Hex()
	if slot != nil {
		key += slot.Hex()
	}
	if !g.seen[key] {
		if len(g.seen) >= 100000 {
			panic(&KeelWitnessError{Stage: g.stage, Kind: "access-budget", Cause: "Native dependency inventory exceeds bound"})
		}
		g.seen[key] = true
		*g.accesses = append(*g.accesses, access)
	}
}
func (g *keelGuardState) CreateAccount(a common.Address) {
	g.StateDB.CreateAccount(a)
	g.check("CreateAccount", a, nil)
}
func (g *keelGuardState) CreateContract(a common.Address) {
	g.StateDB.CreateContract(a)
	g.check("CreateContract", a, nil)
}
func (g *keelGuardState) SubBalance(a common.Address, v *uint256.Int, r tracing.BalanceChangeReason) uint256.Int {
	vout := g.StateDB.SubBalance(a, v, r)
	g.check("SubBalance", a, nil)
	return vout
}
func (g *keelGuardState) AddBalance(a common.Address, v *uint256.Int, r tracing.BalanceChangeReason) uint256.Int {
	vout := g.StateDB.AddBalance(a, v, r)
	g.check("AddBalance", a, nil)
	return vout
}
func (g *keelGuardState) GetBalance(a common.Address) *uint256.Int {
	vout := g.StateDB.GetBalance(a)
	g.check("GetBalance", a, nil)
	return vout
}
func (g *keelGuardState) GetNonce(a common.Address) uint64 {
	vout := g.StateDB.GetNonce(a)
	g.check("GetNonce", a, nil)
	return vout
}
func (g *keelGuardState) SetNonce(a common.Address, n uint64, r tracing.NonceChangeReason) {
	g.StateDB.SetNonce(a, n, r)
	g.check("SetNonce", a, nil)
}
func (g *keelGuardState) GetCodeHash(a common.Address) common.Hash {
	vout := g.StateDB.GetCodeHash(a)
	g.check("GetCodeHash", a, nil)
	return vout
}
func (g *keelGuardState) GetCode(a common.Address) []byte {
	vout := g.StateDB.GetCode(a)
	g.check("GetCode", a, nil)
	return vout
}
func (g *keelGuardState) SetCode(a common.Address, c []byte, r tracing.CodeChangeReason) []byte {
	vout := g.StateDB.SetCode(a, c, r)
	g.check("SetCode", a, nil)
	return vout
}
func (g *keelGuardState) GetCodeSize(a common.Address) int {
	vout := g.StateDB.GetCodeSize(a)
	g.check("GetCodeSize", a, nil)
	return vout
}
func (g *keelGuardState) GetState(a common.Address, k common.Hash) common.Hash {
	vout := g.StateDB.GetState(a, k)
	g.check("GetState", a, &k)
	return vout
}
func (g *keelGuardState) SetState(a common.Address, k, v common.Hash) common.Hash {
	vout := g.StateDB.SetState(a, k, v)
	g.check("SetState", a, &k)
	return vout
}
func (g *keelGuardState) GetTransientState(a common.Address, k common.Hash) common.Hash {
	vout := g.StateDB.GetTransientState(a, k)
	g.check("GetTransientState", a, &k)
	return vout
}
func (g *keelGuardState) SetTransientState(a common.Address, k, v common.Hash) {
	g.StateDB.SetTransientState(a, k, v)
	g.check("SetTransientState", a, &k)
}
func (g *keelGuardState) SelfDestruct(a common.Address) {
	g.StateDB.SelfDestruct(a)
	g.check("SelfDestruct", a, nil)
}
func (g *keelGuardState) HasSelfDestructed(a common.Address) bool {
	vout := g.StateDB.HasSelfDestructed(a)
	g.check("HasSelfDestructed", a, nil)
	return vout
}
func (g *keelGuardState) Exist(a common.Address) bool {
	vout := g.StateDB.Exist(a)
	g.check("Exist", a, nil)
	return vout
}
func (g *keelGuardState) Touch(a common.Address) { g.StateDB.Touch(a); g.check("Touch", a, nil) }
func (g *keelGuardState) IsNewContract(a common.Address) bool {
	vout := g.StateDB.IsNewContract(a)
	g.check("IsNewContract", a, nil)
	return vout
}
func (g *keelGuardState) Empty(a common.Address) bool {
	vout := g.StateDB.Empty(a)
	g.check("Empty", a, nil)
	return vout
}
func (g *keelGuardState) GetStateAndCommittedState(a common.Address, k common.Hash) (common.Hash, common.Hash) {
	v, o := g.StateDB.GetStateAndCommittedState(a, k)
	g.check("GetStateAndCommittedState", a, &k)
	return v, o
}
