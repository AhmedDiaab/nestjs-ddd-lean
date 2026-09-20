# 0012. Cluster primary owns forking

- Status: Accepted
- Date: 2026-09-20

## Context

Until now this template has been one process: `node dist/main` in production, one NSSM service
on Windows. Scaling meant more containers or more VMs — except this template ships no Docker
setup to begin with, and its one deployment target with no orchestrator to add more instances to
is exactly the Windows service install (`start-service.ps1`). A single Node process uses one
core; the rest of the box sits idle.

Node's built-in `cluster` module (`node:cluster`) forks N worker processes that share listen
sockets, giving the multi-core win without a second dependency. The alternative — a process
manager like PM2 — is explicitly out of scope (see Consequences). Nothing named `cluster` existed
in the codebase before this decision; `CLUSTER_ENABLED` defaults to `false`, and the
single-process path is unchanged, byte-for-byte, when it is off.

This decision, and its number, are shared with the full template
([`nestjs-ddd`](https://github.com/AhmedDiaab/nestjs-ddd)), which ported cluster mode first — see
[decision 0015](0015-shared-files-between-the-two-templates.md). Forking more than one worker on
one box is not free of new failure modes there either, and the whole point of doing this
"properly" rather than as a thin wrapper around `cluster.fork()` is to make those failure modes
either impossible or loud. Full's version of this feature guards against three: a memory-backed
idempotency store whose claims would be invisible across workers, memory-backed throttling whose
counters would multiply per worker, and `prom-client`'s `AggregatorRegistry` only aggregating
from the primary process. **None of the three apply here**: lean has no idempotency store, no
throttling and no metrics subsystem at all. What full and lean share is the part that has nothing
to do with those subsystems:

- `SCHEDULER_ENABLED=true` (`src/interface/scheduler/job-scheduler.ts`) makes **every** instance
  that has it on run every job. That was already true across separate containers, and forking
  turns it from "an operator's checklist item" into something that happens automatically on every
  boot unless the code itself picks one worker.
- On Windows, the NSSM service now manages the primary, not a worker. Signal delivery to child
  processes is unreliable there, so the primary must forward `SIGTERM`/`SIGINT` itself rather than
  count on the OS.
- A worker's own database pool capacity (`poolMax`) is sized for one process; forking N of them
  multiplies the sessions actually opened against the database without changing a single
  connection string.

## Decision

- **The primary never builds a Nest application.** `src/main.ts` branches on
  `cluster.enabled && cluster.isPrimary` **before** `NestFactory.create` runs, and calls
  `startPrimary()` (`src/infrastructure/cluster/cluster-primary.ts`) instead — no database pools,
  no HTTP server, no Swagger, no DI container. A worker (`cluster.isWorker`) and the
  single-process default (`cluster.enabled` false) both fall through to the bootstrap that
  already existed. This keeps the primary small and hard to crash: the process responsible for
  respawning workers and forwarding shutdown signals should not itself depend on the database
  being reachable or Nest finishing its module graph. It also means the primary's own logger
  cannot come from Nest DI — `PinoProcessLogger` (`src/infrastructure/logging/pino-process-logger.ts`)
  builds a plain `pino` instance from the same transport configuration
  (`createTransportTargets`, `src/infrastructure/logging/pino.options.ts`) the in-app logger
  uses, so a primary's logs land in the same place as its workers' without going through
  `nestjs-pino`.
- **The one boot-time rail lean keeps is pool capacity, logged, never a throw.**
  `runClusterBootRails` (`src/infrastructure/cluster/cluster-boot-rails.ts`) logs
  `cluster.pool.capacity` (`poolMax × workers` sessions) for every configured database source,
  before a single worker is forked — an operator checks that against what the DBA allows. This is
  lean's whole boot-rail surface: full's version of this function also fails boot for
  `IDEMPOTENCY_STORE=memory` with more than one worker (`InvalidConfigError`) and warns for
  `THROTTLE_STORAGE=memory`; **neither applies here** — lean has no idempotency store and no
  throttling to guard, so `ClusterBootRailsConfig` here has no `idempotency`/`http` fields at all,
  and there is nothing for the primary to refuse to boot into.
- **The scheduler runs on exactly one worker, elected by the primary, not decided by the
  workers.** `JobScheduler.onApplicationBootstrap()` (`src/interface/scheduler/job-scheduler.ts`)
  checks `cluster.enabled && !cluster.isLeader` beside its existing `scheduler.enabled` check,
  before registering any cron job. Which worker is the leader is not negotiated among workers (no
  election protocol, no leader lease in a shared store) — the primary marks exactly one worker via
  a `CLUSTER_LEADER` environment variable set only at fork time, because the primary already
  knows the full worker set and is the only process that can make that call once, cheaply. When
  the leader worker exits and is respawned, the replacement is forked with the same variable and
  inherits leadership; if respawn is off, or shutdown has begun, leadership is not reassigned
  rather than triggering a fresh election — simpler, and correct for what this template needs
  (jobs resume on the next deploy or restart). This is also why the scheduler was ported first
  (see the CHANGELOG): the leader check has nothing to gate on until `SCHEDULER_ENABLED` exists.
- **No aggregated metrics endpoint, because lean has no metrics endpoint at all.** Full's version
  of this decision runs a small plain `node:http` server on `CLUSTER_METRICS_PORT` in the primary,
  because `prom-client`'s `AggregatorRegistry` only aggregates from the primary process. Lean's
  `cluster.schema.ts` has no `metricsPort` field, `cluster-primary.ts` has no metrics-server
  dependency to start or close, and `cluster-metrics-server.ts` was not ported — there is nothing
  in lean for a worker's `/metrics` to answer in the first place.
- **Shutdown fans out explicitly, never by relying on signal propagation.** On `SIGTERM`/`SIGINT`
  the primary calls `worker.process.kill(signal)` on every live worker itself, waits up to
  `drainDelayMs + forceAfterMs + jobDrainMs` plus a small fixed slack, then `SIGKILL`s whatever is
  still alive and exits. Windows in particular does not reliably deliver a console signal to child
  processes, so "the OS will forward it" is not a safe assumption on the one platform this feature
  exists for.
- **A worker closes its IPC channel once its drain finishes**, so it exits voluntarily instead of
  waiting to be killed. The channel is an active handle: a worker that has closed its server and
  its pools still has a live event loop while it stays connected. Measured before the fix (in
  full, where this was found first), a clustered shutdown took the entire bounded wait and ended
  in `SIGKILL` every single time — at default timings that is 27 seconds per restart, with
  `cluster.drain.timeout` logged at `warn` on every clean shutdown, which would train anyone
  reading the logs to ignore the one line that means a worker is genuinely stuck. Afterwards the
  same shutdown finished in about half the budget with no timeout logged. `releaseWorkerChannel`
  (`src/infrastructure/cluster/release-worker-channel.util.ts`) is ported unchanged and wired into
  `main.ts`'s shutdown handler the same way.

## Consequences

- Cluster mode costs one env var (`CLUSTER_ENABLED`); leaving it off changes no other code path —
  verified by running the full single-process test suite and the manual boot/shutdown checks with
  it unset.
- `JobScheduler`'s class doc comment ("enable it on exactly one instance") now describes the
  cluster case too, since the code enforces it automatically there.
- `docs/architecture/operations.md` § Process model, § Graceful shutdown and § Scheduled jobs, and
  `docs/architecture/configuration.md` § Cluster now document what the primary owns versus a
  worker, the Windows scheduling caveat, and the extra shutdown hop.
- `CLUSTER_LEADER` is real config (`clusterSchema`, `cluster.isLeader`), read through the same
  `ConfigPort` pipeline as everything else, but it is not in `.env.example`: operators never set
  it, the primary does, at fork time, the same way NSSM sets only `NODE_ENV` on the service and
  leaves the rest to `.env.<environment>`.
- `start-service.ps1`'s `$StopTimeoutMs` default rose from 15000 to 30000 when the scheduler was
  ported (job drain alone needed the headroom); cluster mode adds no further term to that budget
  because a worker's own drain sequence is unchanged from the single-process case, and the
  primary's extra wait is bounded by the same total plus a small fixed slack.
- Rejected: **PM2, or another external process manager.** It solves forking and respawning, but
  brings its own configuration format, its own log handling, and a dependency this template would
  need to document, install and keep compatible with the Windows service scripts — for
  functionality `node:cluster` already provides.
- Rejected: **porting full's idempotency/throttle boot rails as dead code, or as TODO
  placeholders.** Lean's decision to omit those subsystems ([decision
  0015](0015-shared-files-between-the-two-templates.md)) means there is nothing for those checks
  to guard; carrying disabled branches for a store that doesn't exist would be exactly the kind of
  conditional-import dead weight lean is meant to avoid.
- Rejected: **porting the aggregated-metrics primary server behind a future metrics flag.** Lean
  has no metrics subsystem at all today; adding a metrics-shaped hole in the cluster primary ahead
  of the subsystem it would serve is speculative work with nothing to verify it against.
- Not done here, same as full: no leader **election protocol** (no lease, no heartbeat, no
  renegotiation among live workers). The primary's fork-time assignment is sufficient for a single
  box it already supervises; a distributed leader election would be solving a problem this
  deployment shape doesn't have.
