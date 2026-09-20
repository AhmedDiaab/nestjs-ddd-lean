# 0015. Shared files between the two templates

- Status: Accepted
- Date: 2026-09-20

## Context

`nestjs-ddd` and `nestjs-ddd-lean` are siblings, not one codebase with a branch: `nestjs-ddd` is
upstream (the full template — Prometheus metrics, W3C tracing, an outbound HTTP client, a cron
scheduler, rate limiting, a unit of work, domain events, Docker, `.github/`), and
`nestjs-ddd-lean` is a deliberately trimmed copy of it, kept as its own repository so it can stay
simpler on purpose instead of hiding the extra features behind flags in one codebase.

That means a change made in one repo — a bug fix, a dependency bump, a new cross-cutting
convention — does not propagate automatically. Nothing currently diffs the two repos against each
other; a person (or an agent, told explicitly to sync) has to notice a change is worth porting,
read the other repo's version, and adapt it by hand. This sync (bumping lean's toolchain to
match, porting error-origin logging and optional in-process TLS) is itself an example of that
manual process — this record exists so the next one doesn't have to rediscover which files are
worth comparing.

## Decision

**No automation.** There is no shared package, no codegen, no CI check that fails when the repos
drift. Keeping them in sync is a manual diff discipline: when either repo changes a file on the
list below, check whether the change belongs in the other one too, adapting rather than copying
blindly — lean omits whole subsystems (throttling, idempotency, metrics, domain events, the unit
of work, the outbound HTTP client, request/trace context, database health, Docker, `.github/`),
so a full-template change that touches one of those doesn't apply, and a lean-only file (its
simpler `request-id.middleware.ts`, for instance) has no upstream counterpart to diff against at
all. The scheduler and cluster mode are shared subsystems now (ported from full; see [decision
0012](0012-cluster-primary-owns-forking.md)), but cluster mode's boot rails are not identical —
lean's are reduced to the pool-capacity log, since it has no idempotency store or throttling to
guard.

Files worth diffing when either repo changes them, because both currently carry the same content
or the same shape:

- **Conventions and tooling config**: `.prettierrc`, `CLAUDE.md`, `AGENTS.md`'s conventions
  sections (wording may differ — lean's own divergences from full, like its interface-fence lint
  rule and utility file locations, are known and intentionally left alone; see
  `docs/known-gaps.md`).
- **Error origin logging**: `src/common/utils/error-origin.util.ts` (+ its spec),
  `src/common/utils/format-stack-trace.util.ts`, `src/application/errors/app.error.ts`,
  `src/domain/errors/domain.error.ts`, `src/application/shared/logging.ts` (the `LogMeta` shape),
  the error serializer in `src/infrastructure/logging/pino.options.ts` (lean's version differs in
  file shape — see [decision 0010](0010-error-origin.md) — but the serializer function itself
  should match), and `--enable-source-maps` wherever each repo starts `node` in production.
- **The HTTP error filter**: `src/interface/http/global-exception.filter.ts` and
  `src/common/utils/parse-string.util.ts` — both patched together the last time lean's toolchain
  was bumped, since a stricter lint rule flagged real bugs in both.
- **The config pipeline**: `src/infrastructure/config/load-config.ts`,
  `src/infrastructure/config/schemas/` (lean has a strict subset of full's schemas — a schema
  present in both, like `tls.schema.ts`, should stay byte-for-byte comparable),
  `src/infrastructure/config/env-config.adapter.ts`, and `.env.example`'s shared variable blocks
  (`TLS_*`, logging, HTTP).
- **TLS**: `src/infrastructure/tls/` in full, and `src/infrastructure/tls/` here once ported (this
  sync); `docs/architecture/operations.md` § TLS and `docs/architecture/configuration.md` § TLS.
- **Scheduler**: `src/interface/scheduler/` (ported here with `MetricsPort` stripped out — lean
  has no metrics subsystem to strip it into); `docs/guides/add-a-scheduled-job.md`;
  `docs/architecture/operations.md` § Scheduled jobs and `docs/architecture/configuration.md` §
  Scheduler.
- **Cluster mode**: `src/infrastructure/cluster/` (lean's `cluster-boot-rails.ts` and
  `cluster-primary.ts` are reduced — no idempotency/throttle rails, no aggregated metrics server,
  no `metricsPort` field on `cluster.schema.ts` — since lean has none of those subsystems to
  guard; `release-worker-channel.util.ts` is ported unchanged, since it is load-bearing
  regardless); `docs/architecture/operations.md` § Process model and
  `docs/architecture/configuration.md` § Cluster; decision 0012 itself.
- **Decision records**: see below — the numbering itself is shared.
- **`package.json` devDependency versions** for the tools both repos use the same way: `eslint`,
  `@eslint/js`, `prettier`, `typescript-eslint`, `eslint-plugin-prettier`, `jest`, `@types/*`.
  Runtime dependencies are not on this list — lean's dependency set is intentionally smaller.

**Decision numbers mean the same decision in both repos.** `docs/decisions/000N-*.md` in
`nestjs-ddd-lean` and the identically-numbered record in `nestjs-ddd` are either the same
decision (content adapted to what each repo actually has) or the number is simply absent from
lean's index. A gap in lean's sequence — currently 0009, 0012, 0013, 0014 — means that decision
does not apply to lean (it covers a subsystem lean doesn't have, or a change lean's dependency
versions don't need yet); it is never a missing file to chase down, and a number is never reused
for an unrelated decision later. When a decision is ported, it keeps its upstream number here,
even though lean's own sequence then has a gap where the skipped numbers would have been.

## Consequences

- Porting a change is still a real review, not a copy: every entry above says "diff and adapt",
  not "keep identical". A file can legitimately diverge in shape (`pino.options.ts`,
  `docs/known-gaps.md`) while still needing the same underlying fix ported into its own shape.
- This list is a starting point, not exhaustive — a change that touches a shared concern but isn't
  on this list is still worth checking; add it here once it's confirmed to be one both repos carry.
- The gap-means-doesn't-apply rule only holds if both repos actually follow it: reusing a decision
  number for something unrelated in either repo would break the convention for both. If a decision
  is later reversed, the usual rule applies (`docs/decisions/README.md`: add a new record, don't
  renumber or overwrite).
- Rejected: **merging the two into one repository with a feature flag or package boundary.** That
  would make "lean" a configuration of the full template rather than a genuinely simpler starting
  point, and would reintroduce the subsystems lean exists to omit as dead code or conditional
  imports instead of files that are simply absent.
- Rejected: **a script that diffs the two repos automatically.** Most of the value here is in
  adapting a change to what each repo actually has, which a mechanical diff can't do — it would
  either flag every intentional divergence as drift, or need enough repo-specific knowledge encoded
  into it that maintaining the script becomes its own manual-sync problem.
