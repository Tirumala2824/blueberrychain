# Contributing

## Ground rules
1. **Contracts first.** A change that crosses a boundary (app ↔ Snowflake, engine ↔ agent, connector ↔ RAW) starts in `contracts/`. Code is generated from, or validated against, those schemas.
2. **No numbers from LLMs.** Every financial or physical quantity is computed by `bbc_engine` (versioned, seeded, unit-tested). Agents choose and explain; they don't calculate.
3. **One write path.** Operational state changes go only through the mutation gateway (`DECISION.MUTATE`). Don't add a procedure or role that writes around it.
4. **Snowflake DDL lives in `snowflake/`.** It's built through a CoCo brief (`docs/coco-briefs/`). If CoCo has to change a statement, the change goes back into the repo file.
5. **Tests prove behavior, not effort.**
   - Engine changes need unit tests.
   - Governance changes need SQL invariant tests (`snowflake/tests`; a test passes when its last statement returns zero rows).
   - Lifecycle changes need an end-to-end scenario.
6. **No secrets in git.** Tokens live in `.env`, which is gitignored. Never paste a secret into an issue, PR, or chat transcript.
7. **No pinned demo state.** Scenarios choose faults; outcomes must emerge from the system.

## Workflow
- Branch from `main`. Keep PRs small and focused.
- Before pushing, run:
  ```bash
  corepack pnpm -r test && uv run pytest && uv run ruff check python
  ```
- Record architectural decisions as ADRs (`docs/adr/0000-template.md`).

## License
By contributing, you agree that your contributions are licensed under the Apache License 2.0.
