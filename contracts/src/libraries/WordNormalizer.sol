// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WordNormalizer
/// @notice Canonicalises a word so that global uniqueness is unambiguous.
/// @dev Prototype charset only:
///      - trim surrounding ASCII whitespace (space/tab/newline/CR)
///      - lowercase ASCII letters A-Z -> a-z
///      - allow only [a-z0-9] in the body (internal whitespace / punctuation rejected)
///      - length 1..30 after trimming
///      - any non-ASCII byte is rejected, which deliberately blocks Unicode homoglyphs.
library WordNormalizer {
    uint256 internal constant MAX_LEN = 30;

    /// @return out  the normalized word (empty string when invalid)
    /// @return ok   true when the input is a valid, normalizable word
    function normalize(string memory input) internal pure returns (string memory out, bool ok) {
        bytes memory b = bytes(input);
        uint256 len = b.length;

        // Trim leading whitespace.
        uint256 start = 0;
        while (start < len && _isWhitespace(b[start])) {
            start++;
        }
        // Trim trailing whitespace.
        uint256 end = len; // exclusive
        while (end > start && _isWhitespace(b[end - 1])) {
            end--;
        }

        uint256 n = end - start;
        if (n == 0 || n > MAX_LEN) {
            return ("", false);
        }

        bytes memory result = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            bytes1 c = b[start + i];
            if (c >= 0x41 && c <= 0x5A) {
                // A-Z -> a-z
                result[i] = bytes1(uint8(c) + 32);
            } else if ((c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39)) {
                // a-z or 0-9
                result[i] = c;
            } else {
                // whitespace inside the body, punctuation, or any non-ASCII byte.
                return ("", false);
            }
        }
        return (string(result), true);
    }

    function _isWhitespace(bytes1 c) private pure returns (bool) {
        return c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D;
    }
}
