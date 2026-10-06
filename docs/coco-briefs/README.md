# CoCo briefs

Every Snowflake work package (Track B) is built in **Cortex Code (CoCo)** from a brief in this folder.

## How a work package runs
1. **Claude writes the brief.** It lists the exact files to run, the objects to create, the expected results and the validation queries. Briefs are written the day before the work is needed.
2. **You run it in Cortex Code** with the repo open, in **Plan Mode**. CoCo validates every statement against the live account before running it.
   - If CoCo has to change a statement, for example because a syntax detail differs on this account, **the fix goes back into the `.sql` file in the repo**, so the repo always matches the account.
3. **You paste the outputs** the brief asks for into the result section of the brief, or into the ADR it names.
4. **Claude validates independently** with read-only `snow sql` and `bbc test sql`, then marks the work package done.

## Rules
- **Secrets never pass through a chat session.** PAT secrets are created in a Snowsight worksheet or with `snow sql`, and go straight into the gitignored `.env`.
- **The `.sql` files under `snowflake/` are the source of truth.** Ad-hoc DDL typed into CoCo that isn't written back to the repo doesn't count.
- **Use the right role.** Each brief states which role to use. BBC_OS objects are created as `BBC_OWNER`; only account-level steps use `ACCOUNTADMIN`.

| Work package | Brief | Status |
|---|---|---|
| WP1 Foundation + capability spikes | [WP1-foundation-spikes.md](WP1-foundation-spikes.md) | Ready to run |
| WP2 RAW, REF, GOV, ledger | [WP2-raw-ref-gov-ledger.md](WP2-raw-ref-gov-ledger.md) | Ready once WP1 is validated |
| WP3 Ingest path + OPS Dynamic Tables | [WP3-ingest-ops-dynamic-tables.md](WP3-ingest-ops-dynamic-tables.md) | Ready once WP2 is validated |
| WP5 World in Snowflake + semantic view | [WP5-semantic-view.md](WP5-semantic-view.md) | Ready once WP3 is validated |
