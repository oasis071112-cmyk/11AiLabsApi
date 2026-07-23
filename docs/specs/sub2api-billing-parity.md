# Sub2API balance-billing parity

Reference: `Wei-Shaw/sub2api@cb24522dd53f8f363d008e3afdc8e4baf9788cab`

## Goal

Match Sub2API's billing-rule semantics for the OpenAI-compatible endpoints already supported by 11AiLabs, while retaining the existing point wallet, gift-first deduction, reservation/settlement transaction, and one point = one CNY conversion.

## Required behavior

1. Billing remains balance-only. Do not add subscriptions, plans, renewals, or subscription quotas.
2. Wallet behavior remains unchanged: reserve before forwarding, settle from actual usage, spend gift points before purchased points, and write the wallet settlement and success usage log atomically.
3. Each upstream request produces at most one successful usage log and one wallet charge.
4. Token billing uses mutually exclusive usage buckets:
   - ordinary input excludes cache-read and cache-creation tokens;
   - cache-read and cache-creation are priced independently;
   - image input/output token buckets use their configured prices and otherwise fall back to ordinary input/output prices.
5. OpenAI service tiers match Sub2API fallback behavior when no explicit tier prices exist: `priority` is 2x, `flex` is 0.5x, and other tiers are 1x.
6. OpenAI GPT-5.4, GPT-5.5 and GPT-5.6 families use Sub2API's session long-context threshold and multipliers: above 272,000 total input/cache tokens, input/cache cost is 2x and output cost is 1.5x.
7. Image billing matches Sub2API:
   - classify sizes into `1K`, `2K`, and `4K`;
   - unknown or `auto` defaults to `2K`;
   - confirmed output dimensions take precedence over requested input size;
   - multiple outputs use the highest confirmed tier for the request;
   - explicit configured tier prices take priority;
   - otherwise use the Sub2API fallback of USD 0.134 for 1K, 1.5x for 2K, and 2x for 4K.
8. Image requests use image billing by default. If a selected channel-model mapping explicitly chooses `token`, use returned token usage instead. `per_request` and `image` mappings use their configured per-request/tier price, falling back to model/default image pricing when omitted.
9. Billing-model source supports `requested`, `channel_mapped` (default), and `upstream`. The chosen billing model and billing mode are snapshotted in the usage log, while the user-facing model remains the originally requested model.
10. Missing image model price must no longer block requests when the Sub2API fallback image price can be used.
11. Existing endpoint scope remains unchanged: this work does not add subscription mode, new upstream protocols, video billing, web-search billing, or general/streaming Responses support.

## Public test seams

- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `POST /v1/images/generations`
- non-streaming image `POST /v1/responses`
- admin channel-model mapping API
- user wallet balance/transactions and user-visible usage logs
