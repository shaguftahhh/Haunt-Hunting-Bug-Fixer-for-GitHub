# Moonlit Mailroom (sample repo)

A tiny, deliberately buggy order-tracking service used by BugBanisher's
**Demo Mode** so the full flow works offline.

There are four planted bugs:

1. `src/pagination.js` — an off-by-one loop (`<=`) reads past the end of the array.
2. `src/render.js` — user data is written with `innerHTML` (cross-site scripting).
3. `src/config.js` — an API key is committed in source.
4. `src/api.js` — `JSON.parse` runs without a `try/catch`, so bad input crashes the request.

Plus one open bug issue (`#42`) that explains the user-visible symptom.

> These bugs are intentional. Do not deploy this sample, and do not copy the
> "API key" anywhere — it is fake.
