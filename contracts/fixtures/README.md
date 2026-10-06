# Contract fixtures

There is one file per schema: `<schema-path>.json`, where tool schemas live under `tools/`.

```json
{
  "schema": "option.json",
  "valid":   [ { ... }, { ... } ],
  "invalid": [ { "why": "...", "base": 0, "set": { "/json/pointer": value }, "delete": ["/json/pointer"] } ]
}
```

- **`valid` instances must pass.** They are realistic, drawn from the demo scenarios in `docs/demo/scenarios.md`. Numbers follow the Phase 11 worked example and are illustrative only; the engine computes the real ones.
- **`invalid` entries must fail.** Each one starts from `valid[base]`, applies `set` (JSON Pointer → new value) and `delete` (JSON Pointers), and states `why` it must be rejected.
- **Both languages run the same fixtures:** `python/bbc_toolkit/tests/test_contracts.py` and `packages/shared/src/contracts.test.ts`. A schema change that breaks a fixture fails both test suites.
