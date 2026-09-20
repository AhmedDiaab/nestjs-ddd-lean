# Operations

## Build and run

```bash
pnpm install
pnpm build                          # → dist/
NODE_ENV=production node dist/main  # or: pnpm start:prod with NODE_ENV set in the environment
```

- Requires Node.js ≥ 22.18.
- The working directory must contain the `.env.<NODE_ENV>` file; environment variables override file values.
- Non-TypeScript runtime files (templates, SQL files) must be listed in `nest-cli.json` → `compilerOptions.assets` or they won't be copied to `dist`.

| Script             | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `pnpm start:dev`   | watch mode, `NODE_ENV=development`            |
| `pnpm start:debug` | watch + inspector                             |
| `pnpm start:repl`  | Nest REPL with history (`.nest_repl_history`) |
| `pnpm start:prod`  | `node dist/main` (no forced `NODE_ENV`)       |

## Health endpoints

For uptime monitors, load balancers and orchestrators. No auth, not rate limited, version neutral, successful polls not logged.

| Endpoint            | 200 when                                                                                                           | Failure                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /health`       | the process accepts HTTP                                                                                           | no response                                                                                            |
| `GET /health/ready` | every implemented DB source answers a ping within `DATABASE_PING_TIMEOUT_MS`, and the process is not shutting down | **503** with per-source `details` (error text hidden in production), or `SHUTTING_DOWN` while draining |

Monitoring tools should check the **status code**. Pick the endpoint by what "down" means for you:

- "API process down": `/health`
- "API down or its database unreachable": `/health/ready`

A load balancer pool member should be checked with `/health/ready`, so a draining instance is taken out before it stops listening. A container **liveness** probe should use `/health`, so a brief database blip — or a shutdown in progress — doesn't get the process restarted.

Response (`/health/ready`):

```json
{
    "success": true,
    "data": {
        "status": "ok",
        "sources": [
            {
                "sourceKey": "main",
                "dialect": "oracle",
                "implemented": true,
                "ok": true,
                "latencyMs": 4,
                "pool": { "connectionsOpen": 2, "connectionsInUse": 0, "poolMin": 2, "poolMax": 10 }
            }
        ]
    },
    "meta": { "timestamp": "...", "path": "/health/ready", "requestId": "..." }
}
```

## Startup failures

| Symptom                                                 | Cause                                                     |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `❌ Invalid configuration:` + paths, exit 1             | env missing/invalid (values not printed)                  |
| `AggregateDbHealthError` at boot                        | a required DB source failed its pings                     |
| `DatabaseConnectionError ... Failed to acquire` at boot | pool creation failed (credentials, network, service name) |

## TLS

**Default: terminate TLS in front of the app** — a load balancer, VIP, ingress or reverse proxy — and let the app speak plain HTTP behind it. This is what [Migrate a legacy service](../guides/migrate-a-legacy-service.md) assumes, and it stays the right choice whenever such a terminator exists: certificate rotation, ALPN/HTTP2 negotiation and TLS version policy all become the terminator's job instead of this app's.

Set `TLS_ENABLED=true` only when no terminator sits in front of this process — chiefly the [Windows service](#windows-service-nssm) install, which drops `node dist/main.js` straight onto a host with nothing in front of it by default. With it on, `main.ts` reads `TLS_KEY_FILE`/`TLS_CERT_FILE` (and optionally `TLS_CA_FILE`, `TLS_PASSPHRASE`, `TLS_MIN_VERSION`) once at bootstrap, before Nest starts, and passes them to `NestFactory.create` as `httpsOptions`; the server then listens for HTTPS directly, and the startup log line prints `https://` instead of `http://` so which mode is live is obvious at a glance. See [decision 0011](../decisions/0011-tls-optional-in-process.md).

`TLS_ENABLED` and `TRUST_PROXY` ([Configuration → HTTP](configuration.md#http)) answer two different questions and are normally opposites of each other:

| Variable      | Question it answers                                                  | Behind a load balancer | No terminator (e.g. Windows service) |
| ------------- | -------------------------------------------------------------------- | ---------------------- | ------------------------------------ |
| `TRUST_PROXY` | Did an upstream already terminate TLS and forward `X-Forwarded-For`? | `true`                 | `false`                              |
| `TLS_ENABLED` | Does _this process_ need to terminate TLS itself?                    | `false`                | `true`                               |

File permissions: `TLS_KEY_FILE` must be readable only by the account the process runs as — the same account NSSM (or systemd) runs the service under. Treat it like any other secret: not group- or world-readable, never committed (`.gitignore` excludes `*.pem`, `*.key`, `*.crt`, `*.cer`, `*.pfx`, `*.p12`), rotated the way `JWT_SECRET` or a database password would be.

A bad path or an empty file fails at boot, not on the first HTTPS request — the same `❌ Invalid configuration:` line as any other invalid config ([Startup failures](#startup-failures)), naming the path and never the file's contents.

**HSTS is already on.** `helmet()` sends `Strict-Transport-Security: max-age=31536000; includeSubDomains` on every response, with or without `TLS_ENABLED` — verified against the installed helmet rather than read from its docs. Over plain HTTP behind a terminator the header is simply ignored by browsers, which is why it has never mattered here. Once this process serves HTTPS itself, it binds: a browser that sees it will refuse plain HTTP to that host, **and to every subdomain**, for a year. Two consequences worth knowing before you enable TLS — test in a private window or on a throwaway hostname, because a browser pinned by a self-signed localhost experiment stays pinned; and if any subdomain must stay HTTP, override helmet's `hsts` option rather than discovering it in production.

### Manual verification

No e2e test generates a certificate in-process — that would need a dependency this template doesn't otherwise carry, just to exercise a Node built-in. Check it by hand instead, with a throwaway self-signed pair generated **outside the repo**:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 1 -subj "/CN=localhost"
TLS_ENABLED=true TLS_KEY_FILE=$(pwd)/key.pem TLS_CERT_FILE=$(pwd)/cert.pem pnpm start:dev
```

Then, from another terminal:

```bash
curl -k https://localhost:3000/health   # -k: self-signed cert, not in curl's trust store
```

A plain `curl http://localhost:3000/health` fails (connection reset) once TLS is enabled — there is no plain-HTTP listener alongside it. Delete the throwaway key/cert afterwards.

## Process model

**One process is the default**, and cluster mode existing in the codebase changes nothing about it: `NODE_ENV=production node dist/main` and [the Windows service](#windows-service-nssm) both start exactly one Node process, which builds the Nest application, opens the database pools, and serves HTTP — byte-for-byte the same as before this feature existed.

Set `CLUSTER_ENABLED=true` to run a primary plus `CLUSTER_WORKERS` worker processes instead, using Node's built-in `cluster` module — no external process manager (no PM2). This is a single-box, multi-core optimisation, not a replacement for running more than one container: it helps most exactly where scaling out is hardest — the Windows service install. See [decision 0012](../decisions/0012-cluster-primary-owns-forking.md).

| Owns                                          | Primary |       Worker       |
| --------------------------------------------- | :-----: | :----------------: |
| Forking, respawning, leader election, signals |   yes   |         –          |
| Nest application (HTTP server, Swagger)       |    –    |        yes         |
| Database pools                                |    –    |        yes         |
| Scheduled jobs (`SCHEDULER_ENABLED`)          |    –    | leader worker only |

The primary **never builds a Nest application** — no database pools, no HTTP server, no Swagger — so a crash in a worker (an unhandled exception in a request handler, for instance) never takes the whole process down: the primary respawns the worker (`CLUSTER_RESPAWN`, default on, rate-capped by `CLUSTER_RESPAWN_MAX_PER_MINUTE`) and the others keep serving.

**Leader election.** Exactly one worker is marked the scheduler leader, via an internal env var (`CLUSTER_LEADER`) the primary sets only at fork time — never set this by hand. `JobScheduler` only registers cron jobs on that worker ([Scheduled jobs](#scheduled-jobs)), so `SCHEDULER_ENABLED=true` clusters correctly with no extra configuration: N workers no longer each run every job. When the leader exits and is respawned, its replacement is forked with the same env var and inherits leadership; if respawn is off (`CLUSTER_RESPAWN=false`) or shutdown has begun, leadership is not reassigned.

**Boot-time safety rail**, checked once in the primary before any worker is forked (`runClusterBootRails`, [Configuration → Cluster](configuration.md#cluster)): the pool arithmetic (`poolMax × workers`) is logged for every configured database source, the same number [Migrate a legacy service](../guides/migrate-a-legacy-service.md) already warns about for several separate instances — check it against what the DBA allows. Full's version of this rail also fails boot for `IDEMPOTENCY_STORE=memory` with more than one worker and warns for `THROTTLE_STORAGE=memory`; lean has neither an idempotency store nor throttling, so neither check exists here.

### Windows scheduling caveat

Node's cluster module round-robins connections across workers (`SCHED_RR`) on every platform **except Windows**, which uses the operating system's own scheduling instead — in practice, whichever worker's `accept()` call the OS wakes first tends to get more connections, especially under light load. This is a Node/libuv limitation, not something this template works around. If even request distribution matters more than raw throughput on Windows, `CLUSTER_WORKERS=1` still gets a supervising primary and automatic respawn; otherwise, scale with more containers instead.

### Windows service stop path

`stop-service.ps1` still sends its stop signal to the single process NSSM manages — but with cluster mode on, that process is now the **primary**, not a worker serving requests. The primary is responsible for forwarding the signal on: on `SIGTERM`/`SIGINT` it calls `worker.process.kill(signal)` on every live worker explicitly, rather than counting on the OS to propagate the signal to child processes — Windows in particular does not do this reliably. Only once every worker has exited (or been force-killed past the wait below) does the primary itself exit, which is what lets NSSM consider the service stopped.

This adds one hop to the shutdown sequence from [Graceful shutdown](#graceful-shutdown), so the same rule applies with one more term added:

```
StopTimeoutMs ≥ SHUTDOWN_DRAIN_DELAY_MS + SHUTDOWN_FORCE_AFTER_MS + SHUTDOWN_JOB_DRAIN_MS + slack
```

`start-service.ps1`'s `$StopTimeoutMs` default (30000) is unchanged by cluster mode — it already needs headroom above the full drain sequence including the job drain, and a worker's own drain sequence is exactly what it was in a single process. The primary adds only the time it takes to notice every worker has exited, bounded by that same total plus a small fixed slack, before it `SIGKILL`s stragglers and exits itself. Set it generously either way.

A worker exits on its own as soon as its drain finishes: once `app.close()` returns, it closes its IPC channel to the primary, because that channel is an active handle that would otherwise keep the event loop alive with nothing left to do. Without that step every clustered shutdown would sit until the bounded wait expired and then be force-killed — a clean restart would be indistinguishable from a stuck one, and `cluster.drain.timeout` would fire every time. It is logged at `warn` precisely because it should be rare: seeing it means a worker really is stuck, not that shutdown is working normally.

## Graceful shutdown

On `SIGTERM`/`SIGINT` (Ctrl+C) the process shuts down in the order a load balancer expects. This describes a single worker's sequence; in [cluster mode](#process-model) the primary forwards the signal to every worker and adds one more hop before it exits itself.

| Step | What happens                                                                                      | Why                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | `/health/ready` starts answering **503 `SHUTTING_DOWN`**                                          | the load balancer stops routing here while the instance can still serve                    |
| 2    | it keeps serving for `SHUTDOWN_DRAIN_DELAY_MS` (default 5s)                                       | a monitor needs a poll or two to notice; closing the port first turns requests into errors |
| 3    | the server stops accepting connections; in-flight requests finish                                 | idle keep-alive sockets are closed so they don't hold the server open                      |
| 4    | after `SHUTDOWN_FORCE_AFTER_MS` (default 10s), remaining connections are cut                      | one stuck request must not keep the process alive forever                                  |
| 5    | `JobScheduler.stop()` waits up to `SHUTDOWN_JOB_DRAIN_MS` (default 10s) for an in-flight cron job | it still needs the database pools the next step closes                                     |
| 6    | the application closes: database pools drain with `drainTimeSec`                                  | pools outlive the requests and jobs using them                                             |

`GET /health` stays **200** the whole time: a liveness probe that fails during shutdown gets the process killed in the middle of the requests it is trying to finish.

Set the stop grace period of whatever runs the process (Kubernetes `terminationGracePeriodSeconds`, Docker `--stop-timeout`, NSSM) **above** `SHUTDOWN_DRAIN_DELAY_MS + SHUTDOWN_FORCE_AFTER_MS + SHUTDOWN_JOB_DRAIN_MS + drainTimeSec`, or it will `SIGKILL` in the middle of the sequence.

Sizing the drain delay: it must exceed the load balancer's health-check interval × unhealthy threshold. A monitor polling every 5 seconds needing 2 failures needs more than 10 seconds, not the 5 second default.

This is deliberately **not** `app.enableShutdownHooks()`: Nest's own handler runs the destroy hooks — which close the database pools — before the HTTP server stops, so requests still in flight lose their connection.

## Scheduled jobs

Cron jobs live in `src/interface/scheduler` and run inside the API process, off unless `SCHEDULER_ENABLED=true`, with cron expressions read in `SCHEDULER_TIMEZONE` (default UTC).

- **Every instance with the switch on runs every job** — unless it's clustered: in [cluster mode](#process-model) only the elected leader worker registers jobs automatically, no extra configuration needed. Outside cluster mode (several separate containers/VMs behind a load balancer), run one instance with `SCHEDULER_ENABLED=true` (the "worker") and leave it off on the others, or make the jobs safe to run several times.
- The worker can stay in the pool (it still serves HTTP) or be taken out of it; either way its `/health` must answer for the monitor.
- Failures are logged as `scheduler.job.failed` and never stop the process; overlapping runs are skipped (`scheduler.job.skipped`). Alert on those two events.
- Startup logs one `scheduler.job.scheduled` per job with its next run; `scheduler.disabled` means the switch is off.
- On shutdown, `JobScheduler.stop()` stops new runs immediately and waits up to `SHUTDOWN_JOB_DRAIN_MS` (default 10s) for one already in flight. Past that it logs `scheduler.drain.timeout` and the process keeps closing, so jobs must still be safe to repeat.
- Writing one: [Add a scheduled job](../guides/add-a-scheduled-job.md).

## Windows service (NSSM)

`start-service.ps1` / `stop-service.ps1` at the repository root. Run as Administrator.

Prerequisites: [NSSM](https://nssm.cc) on PATH, Node.js ≥ 22.18, `pnpm install && pnpm build`, `.env.<environment>` in the app directory.

```powershell
.\start-service.ps1                                    # NestjsDddLeanApiService, NODE_ENV=production
.\start-service.ps1 -ServiceName MyApi -Environment staging -NodePath "E:\node\node.exe" -StopTimeoutMs 20000
.\stop-service.ps1 -ServiceName MyApi                  # stop, keep registered
.\stop-service.ps1 -ServiceName MyApi -Remove          # stop and unregister
```

Checked without Windows by `pnpm test:service-scripts` (Docker): both scripts parse, and they run in the PowerShell container against recorders for `nssm`, `node` and `Get-Service` (fresh install, reinstall, Node too old, missing build, failing NSSM call, stop, stop + remove, already stopped, missing service). Registering a real service is still verified on Windows.

What `start-service.ps1` does:

1. Checks nssm, node version, `dist\main.js`, and the env file (warns if missing).
2. Removes an existing service with the same name, then installs `node dist\main.js` with `AppDirectory` = the repo.
3. Sets **only** `NODE_ENV` on the service. dotenv-flow reads `.env.<env>` at startup, so secrets never land in the service registry.
4. Configures graceful stop (Ctrl+C, then wait `StopTimeoutMs`), restart on crash after 5 s, auto start.
5. Writes service stdout/stderr to `logs\service-stdout.log` / `service-stderr.log`, rotated at 10 MB. Application logs still go to `logs\app.log` via pino-roll.

Re-run `start-service.ps1` after changing its parameters. After changing only `.env.<env>` or `dist`, restarting the service is enough.

## Logs

See [Logging](logging.md).
