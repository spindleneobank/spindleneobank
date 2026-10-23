#!/bin/sh
# Prints the dstack compose hash (sha256 of the exact app-compose.json bytes) that ends up in the RTMR3
# `compose-hash` event, i.e. the value for attest/allowlist.json `composes[].composeHash`.
# Check against the value the dstack VMM prints when you deploy; dstack is the authority.
set -eu
sha256sum "$(dirname "$0")/app-compose.json" | cut -d' ' -f1
