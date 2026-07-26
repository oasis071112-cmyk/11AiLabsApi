# Round 1: Schema Baseline

## Goal

Prepare the database for channel-level multipliers and protocol-aware request
logs without changing current routing, pricing, wallet settlement, or API
behavior.

## Requirements

- Add nullable input, output, and image multiplier columns to
  `upstream_channels`.
- Add nullable request-protocol and upstream-protocol snapshot columns to
  `api_request_logs`.
- Existing channel and request-log records must remain unchanged.
- Existing channels must continue to use the current
  `openai_compatible` protocol default.
- Empty channel multiplier fields must not behave like an explicit `1.0`;
  `NULL` is required so the next round can fall back to the existing rule
  chain.
- The migration must be idempotent for fresh and existing databases.
- No runtime pricing or protocol-routing code is changed in this round.

## Verification

- Start from a database containing the pre-round-1 table definitions and
  records, initialize it through the application database entry point, and
  verify the new columns and preserved values.
- Run the complete backend test suite to demonstrate no billing or API
  behavior changed.
