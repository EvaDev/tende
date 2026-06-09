// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IConsumer} from "../../src/interfaces/IConsumer.sol";

/// @dev Configurable IConsumer stub for Vault unit tests.
contract MockConsumer is IConsumer {
    struct ConsumerStub {
        bool    active;
        bytes32 country;
        uint8   kyc;
    }

    mapping(address => ConsumerStub) public stubs;

    function setConsumer(address wallet, bytes32 country, uint8 kyc) external {
        stubs[wallet] = ConsumerStub({active: true, country: country, kyc: kyc});
    }

    function isRegistered(address wallet) external view returns (bool) {
        return stubs[wallet].active;
    }

    function getCountryCode(address wallet) external view returns (bytes32) {
        return stubs[wallet].country;
    }

    function getKycLevel(address wallet) external view returns (uint8) {
        return stubs[wallet].kyc;
    }
}
