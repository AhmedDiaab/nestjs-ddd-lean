# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Every branch
that changes behaviour, configuration or conventions appends an entry here under `## [Unreleased]`;
keep the skeleton (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`) so entries
stay easy to scan.

## [Unreleased]

### Added

- Error logs now carry `origin` (and `causeOrigin`, when the error's `cause` chain has a
  different app frame) — the one line of OUR code that created the error, e.g.
  `src/infrastructure/database/clients/oracle.client.ts:80 (OracleClient.release)` — computed
  by the new framework-free `errorOrigin`/`resolveErrorOrigin`
  (`src/common/utils/error-origin.util.ts`), which scans a stack top-down for the first frame
  that isn't `node_modules` or a `node:` internal instead of trusting the top frame. Always on,
  independent of `SHOW_STACK_TRACES`; the response body sent to clients is unchanged. See
  [decision 0010](docs/decisions/0010-error-origin.md).
- `node --enable-source-maps` (`start:prod`, `start-service.ps1`) so `origin`/`causeOrigin` name
  the `.ts` file and line in a production build.
- Optional in-process TLS termination (`TLS_ENABLED`, default `false`) for deployments with no
  reverse proxy or load balancer in front of the app — the Windows service install in particular.
  `src/infrastructure/tls/load-tls-options.ts` reads `TLS_KEY_FILE`/`TLS_CERT_FILE` (and
  optionally `TLS_CA_FILE`, `TLS_PASSPHRASE`, `TLS_MIN_VERSION`) once at bootstrap, before Nest
  starts; a bad or missing path fails at boot with the path named and never the file's contents
  (`InvalidConfigError`, same as any other invalid config), and the startup log line prints
  `https://` instead of `http://` when it's on. Terminating TLS at the proxy stays the default.
  `.gitignore` now excludes `*.pem`, `*.key`, `*.crt`, `*.cer`, `*.pfx`, `*.p12` so a local
  development certificate can't be committed by accident. See [decision
  0011](docs/decisions/0011-tls-optional-in-process.md) and `docs/architecture/operations.md` §
  TLS.
- `docs/decisions/0015-shared-files-between-the-two-templates.md`: the manual diff discipline
  between this repo and its upstream sibling, `nestjs-ddd`.
- Cron scheduler (`SCHEDULER_ENABLED`, default `false`): `src/interface/scheduler/` runs jobs on
  a schedule as a delivery mechanism, like a controller — it only calls a use case. `JobRunner`
  catches a throwing job and logs `scheduler.job.failed` instead of crashing the process, and
  skips a run while the previous one is still going (`scheduler.job.skipped`); `JobScheduler`
  registers every job with `@nestjs/schedule`'s `SchedulerRegistry` in `SCHEDULER_TIMEZONE`
  (default UTC) and, on shutdown, stops new runs immediately and waits up to
  `SHUTDOWN_JOB_DRAIN_MS` (default 10s, new `shutdownSchema` field) for one already in flight
  before logging `scheduler.drain.timeout` and letting the pools close anyway. Every instance
  with the switch on runs every job — with several instances behind a load balancer, enable it on
  exactly one. `runGracefulShutdown` (`src/infrastructure/lifecycle/graceful-shutdown.ts`) gained
  an optional `drainJobs` hook, called after the HTTP server closes and before the application
  (database pools) closes, since a job still needs the database. `start-service.ps1`'s
  `$StopTimeoutMs` default rose from 15000 to 30000 to keep headroom above the now-longer drain
  sequence. See [Add a scheduled job](docs/guides/add-a-scheduled-job.md) and
  `docs/architecture/operations.md` § Scheduled jobs.
- Cluster mode (`CLUSTER_ENABLED`, default `false`): multi-core scaling on a single box via
  Node's built-in `cluster` module — no external process manager. `src/infrastructure/cluster/`
  forks `CLUSTER_WORKERS` workers (0 = one per CPU core), respawns one that exits unexpectedly
  (rate-capped by `CLUSTER_RESPAWN_MAX_PER_MINUTE`, off via `CLUSTER_RESPAWN=false`), elects one
  worker as the scheduler leader, and — on `SIGTERM`/`SIGINT` — forwards the signal to every
  worker explicitly (`worker.process.kill(signal)`, not relying on the OS, since Windows does not
  propagate it reliably) before a bounded wait and `SIGKILL` for stragglers. A worker closes its
  IPC channel to the primary once its own drain finishes, so it exits voluntarily rather than
  waiting to be killed — measured before this fix at 27 seconds per clustered restart and a
  `cluster.drain.timeout` warning on every clean shutdown, both gone afterwards. The primary never
  builds a Nest application: no database pools, no HTTP server, no Swagger. `PinoProcessLogger`
  (`src/infrastructure/logging/pino-process-logger.ts`) gives it a logger built from the same
  transport configuration as the in-app one, without going through Nest DI. A boot-time rail
  (`runClusterBootRails`) logs `poolMax × workers` session capacity for every configured database
  source before any worker is forked. Reduced from full's version of this feature: no
  `IDEMPOTENCY_STORE=memory`/`THROTTLE_STORAGE=memory` boot rails (lean has neither subsystem) and
  no aggregated-metrics primary server or `CLUSTER_METRICS_PORT` (lean has no metrics subsystem at
  all) — see [decision 0012](docs/decisions/0012-cluster-primary-owns-forking.md) and
  `docs/architecture/operations.md` § Process model.

### Changed

- `EnvConfigAdapter`'s constructor now optionally accepts an already-loaded `AppConfig`, so
  `main.ts`'s early TLS config read (needed before Nest — and DI — exists) reuses it instead of
  parsing `process.env` a second time to build the `ConfigPort` that `loadTlsOptions` needs.
- `AppError`/`DomainError` base constructors call `Error.captureStackTrace(this, new.target)`
  (V8-only, guarded), so an error's own creation site is captured with the constructor frames
  removed — this is what keeps `origin` accurate across `await` boundaries.
- `GlobalExceptionFilter`'s log meta gained `origin`/`causeOrigin`; the existing `stack` key and
  its `SHOW_STACK_TRACES` gate are unchanged.
- Registered a pino `error` serializer (`src/infrastructure/logging/pino.options.ts`) that
  replaces pino's default FULL, untrimmed-stack handling with
  `{ type, message, origin, causeOrigin?, stack? }` for every call site that logs `{ error }` —
  previously only `GlobalExceptionFilter` was gated by `SHOW_STACK_TRACES`; `pool.manager.ts` and
  `oracle.client.ts` passed a raw `Error` straight to the logger and leaked the full stack
  ungated. The same serializer is also registered at pino-http's own literal `err` key (its
  automatic access-log line; a key this template doesn't control) and unwraps pino-http's own
  pre-serialization to read the original error's stack.
- **Renamed the `LogMeta.err` field to `LogMeta.error`** (`src/application/shared/logging.ts`)
  for a consistent, unabbreviated field name across every call site and the serializer; updated
  `docs/architecture/logging.md` to match.
- Bumped the lint-and-format toolchain to its next major: `eslint` 9→10, `eslint-plugin-prettier`,
  `prettier` 3.4→3.9, `typescript-eslint` 8.20→8.70, plus `@eslint/js`, `jest` and `@types/*`
  within/to the full template's versions. The stricter `no-unnecessary-type-assertion` rule
  caught real, previously-harmless-but-dead casts across the codebase (`TypedToken.createToken`,
  `ProviderFactory.existing`/`ConnectionProvider`, several test doubles) and one real bug fix:
  `toString()` in `common/utils/parse-string.util.ts` now takes a `Stringifiable` union instead of
  `unknown` (a caller could previously pass a plain object and silently get `"[object Object]"`
  back), and `GlobalExceptionFilter`'s non-record `HttpException` fallback now reads a message
  only from a string or a list of strings — anything else falls back to the status name instead of
  being stringified into `"[object Object]"`.
- `JobScheduler.onApplicationBootstrap()` now also skips registering jobs when clustered and this
  worker is not the elected leader, so `SCHEDULER_ENABLED=true` clusters correctly with no extra
  configuration — its class doc comment is updated to match.
- `src/infrastructure/logging/pino.options.ts` now exports `createTransportTargets` (the console +
  optional file-rotation target list), extracted so `PinoProcessLogger` can build the same
  transport without going through `nestjs-pino`.

### Fixed

- Reading `.env.<NODE_ENV>` moved from `EnvConfigAdapter`'s constructor into `loadConfig()`. The
  TLS work added a `loadConfig()` call in `main.ts`, before Nest exists, so the earliest parse saw
  a bare environment and any deployment keeping its secrets in the file — `pnpm start:dev` and the
  Windows service setup both do — failed to boot with `jwt.secret: expected string, received
undefined`. Real environment variables still win over the file.

### Removed

- The unused `source-map-support` devDependency — `--enable-source-maps` (a native `node` flag,
  no dependency) now serves the same purpose for the built-in error `origin`/`causeOrigin`.

## [1.0.0]

Baseline: what this template ships out of the box.

### Added

- Layered/DDD architecture (`interface → application → domain`, infrastructure behind ports)
  enforced by ESLint import rules, `madge` cycle checks and typed DI tokens that make a wrong
  binding fail to compile.
- Domain building blocks (`Entity`, `ValueObject`, `AggregateRoot`, domain errors) and use cases
  that return a typed `Result` for expected failures instead of throwing.
- A multi-source database layer (Oracle implemented; other dialects as placeholders) with pool
  tuning, boot pings with retry, a readiness probe, `transaction()` per call (one connection per
  call, no unit of work spanning several repositories), and the acting user carried as Oracle's
  `CLIENT_IDENTIFIER` per query.
- Repositories for aggregates, query ports + DAOs for reads, and gateway ports for another team's
  procedures ([glossary](docs/glossary.md)).
- An HTTP interface with a consistent `{ success, data, meta }` envelope, Zod-validated
  request/response schemas, versioned routes, JWT auth enforced globally (`@Public()` opt-out,
  `@Roles()` for token-carried roles), and CSRF protection for cookie auth.
- Errors mapped to real HTTP statuses by problem kind, for both returned `Result` failures and
  thrown errors, with internals and ORA codes never reaching clients.
- Security defaults: helmet, a CORS allow-list, and body-size limits.
- Structured pino logging with request correlation, rotation, redaction and silent successful
  health polls; a graceful shutdown sequence that fails readiness first and closes database pools
  last; Windows service scripts (NSSM).
- Unit, e2e, live-Oracle and Windows-service-script test suites, in-memory fakes, and one
  `pnpm verify` gate.
- Agent-ready conventions: `AGENTS.md`, Claude Code skills, an architecture-reviewer subagent, and
  enforced patterns (AAA tests, named barrel exports, one thing per file).
- `pnpm rename-project` to set a new project's name everywhere; guides for migrating a legacy
  service and for databases owned by another team.

[Unreleased]: https://github.com/AhmedDiaab/nestjs-ddd-lean/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AhmedDiaab/nestjs-ddd-lean/releases/tag/v1.0.0
