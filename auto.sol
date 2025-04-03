// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Token {
    string public name;
    string public symbol;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply, address _owner) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply * 10 ** 18; // Giả sử 18 decimals
        balanceOf[_owner] = totalSupply;
    }
}