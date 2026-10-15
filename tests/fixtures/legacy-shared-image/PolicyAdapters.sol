// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;
/// Synthetic governance/treasury only. The Hold implementation and all policy checks are real.
contract PolicyManager {
    address public immutable governor = msg.sender;
    function executionMode() external pure returns (uint256) { return 1; }
    function requireSystemsActive(uint192) external pure {}
    function govern(address target, bytes calldata data) external {
        require(msg.sender == governor);
        (bool ok,bytes memory result) = target.call(data);
        if (!ok) assembly ("memory-safe") { revert(add(result,32),mload(result)) }
    }
}
contract PolicyTreasury {
    uint256 public received;
    receive() external payable { received += msg.value; }
}
/// Missing policy APIs never confer modern Hold authorization.
contract MissingPolicyAPIs {}
