# Logging

`src/infrastructure/logging`: [nestjs-pino](https://github.com/iamolegga/nestjs-pino) with structured JSON.

## Using the logger

Inject the port, never pino directly:

```ts
constructor(@Inject(LoggerPortToken) private readonly logger: LoggerPort) {}

this.logger.warn('db.rollback.failed', { sourceKey: 'main', tag: 'tickets.save', error });
```

- **Messages:** short dotted event names (`db.pool.created`, `ticket.close.rejected`); put details in the meta object. Field names are typed in `src/application/shared/logging.ts` (`LogMeta`: `correlationId`, `useCase`, `aggregate`, `aggregateId`, `http`, `integration`, `error`, …).
- **Never log** secrets, tokens, passwords, bind values, or personal data you don't need (e.g. email addresses).
- **Request context:** `PinoLoggerAdapter` is a singleton, but nestjs-pino resolves the request-bound logger through `AsyncLocalStorage` on every call, so logs written during a request carry its `requestId` automatically.

## What gets logged automatically

| Event                                          | Level                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Every HTTP request (pino-http access log)      | `info`; `warn` for 4xx; `error` for 5xx                                                                                            |
| Successful `/health` and `/health/ready` polls | not logged (monitoring noise)                                                                                                      |
| Exceptions handled by `GlobalExceptionFilter`  | `warn` 4xx, `error` 5xx, with cause and origin; trimmed stack when `SHOW_STACK_TRACES=true`                                        |
| Pool created/closed, boot pings                | `info` / `warn` / `error`                                                                                                          |
| Slow queries (`slowQueryMs`)                   | `warn` `db.query.slow`                                                                                                             |
| Context clear failure (connection dropped)     | `warn` `db.context.clear.failed`                                                                                                   |
| Requests forwarded to a legacy service         | `info` `legacy.forward.completed`; `warn` `legacy.forward.aborted`; `error` `legacy.forward.failed` — in their own file, see below |

Request logs include method, URL, request id, client IP, user agent, status and `latencyMs`. The `authorization`, `cookie` and `set-cookie` headers are removed.

## The `error` field: origin instead of a stack trace

Any `meta.error` value — an `Error`, or anything else thrown — goes through a pino serializer (`src/infrastructure/logging/pino.options.ts`) that replaces pino's default handling (which serializes the FULL, untrimmed stack, unconditionally) with:

```json
{
    "type": "DatabaseExecutionError",
    "message": "DB execution failed for \"main\" (tickets.findById)",
    "origin": "src/infrastructure/database/clients/oracle.client.ts:80 (OracleClient.release)",
    "causeOrigin": "src/infrastructure/database/clients/oracle.client.ts:77 (OracleClient.release)"
}
```

- **`origin`** is the one frame of OUR code (never `node_modules`, never a `node:` internal) that created the error — computed by `errorOrigin`/`resolveErrorOrigin` (`src/common/utils/error-origin.util.ts`), which scans the whole stack top-down instead of trusting the top frame, since a driver/library error's top frames are almost always dependency frames.
- **`causeOrigin`** appears only when the error's `cause` chain (`DatabaseExecutionError`, `InfrastructureError`, `UnexpectedError`, …) has a _different_ app frame than `origin` — e.g. the line that wrapped a driver error, vs. the line inside the driver call that actually failed.
- Both are **always on**, independent of `SHOW_STACK_TRACES` — they never carry more than a file, line and function name, so they are safe to leave on in production. The full `stack` stays behind `SHOW_STACK_TRACES=true` and is only ever written to logs, never returned to a client.
- `AppError`/`DomainError` call `Error.captureStackTrace(this, new.target)` in their base constructors, so an error's own creation site is captured with the constructor frames removed — this is what keeps `origin` pointing at the real call site even after the error crosses an `await` boundary.
- This one serializer covers every call site that logs `{ error }` (the connection pool, the Oracle client, `GlobalExceptionFilter`), plus pino-http's own automatic access-log line, which builds its error object under the literal key `err` (a key this template does not control) — the same serializer is registered there too.
- **`--enable-source-maps`** (passed to `node` in `start:prod` and `start-service.ps1`) is what makes `origin`/`causeOrigin` name the `.ts` file and line in a production build, instead of the compiled `.js` line under `dist/`.

See [decision 0010](../decisions/0010-error-origin.md) for why this is one frame and not a stack, and why it stays on.

## Outputs

| Output                                                                              | When                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `logs/app.log` (pino-roll: daily + `LOGGING_MAX_SIZE`, keeps `LOGGING_FILES_LIMIT`) | `LOGGING_TO_FILE=true` (default)                                   |
| `logs/legacy-forward.log` (same rotation, `LEGACY_LOG_FILE_NAME`)                   | `LEGACY_FORWARD_ENABLED=true` and `LOGGING_TO_FILE=true`           |
| stdout, pretty                                                                      | `LOGGING_PRETTY=true`, or development, and `pino-pretty` installed |
| stdout, JSON                                                                        | otherwise                                                          |

Transport targets run in worker threads, so logging doesn't block requests.

### The legacy forwarding log

Forwarded requests ([Legacy forwarding](configuration.md#legacy-forwarding)) are answered by
`LegacyForwarder` before Nest's router, so pino-http's access log never sees them: without this
file they leave no trace at all. They get one of their own instead of a share of `app.log` — same
directory, level and rotation, different file name — so the migration's own traffic is readable
without filtering this service's requests out of it. `PinoFileLogger`
(`src/infrastructure/logging/pino-file-logger.ts`) is built directly in `src/main.ts`, like
`PinoProcessLogger`, because the forwarder is wired with `app.use()` outside DI and request
context.

| Event                      | Level   | When                                                                                      |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `legacy.forward.completed` | `info`  | the legacy service answered; carries its status, 2xx through 5xx alike                    |
| `legacy.forward.aborted`   | `warn`  | the client hung up before the response was complete                                       |
| `legacy.forward.failed`    | `error` | this hop itself failed: 502 (connection refused, DNS, reset) or 504 (`LEGACY_TIMEOUT_MS`) |

Every line carries the method, path, `requestId` (from `REQUEST_ID_HEADER`, or generated) and
`latencyMs` — and nothing else: no body, header or query string, which can carry tokens, cookies
or PII ([decision 0013](../decisions/0013-legacy-forwarder-is-dumb-transport.md)). Set
`LEGACY_LOG_REQUESTS=false` to keep only the failures. With `LOGGING_TO_FILE=false` there is no
file to separate from, so these lines go to the console with everything else.

Configuration: [Configuration → Logging](configuration.md#logging).
