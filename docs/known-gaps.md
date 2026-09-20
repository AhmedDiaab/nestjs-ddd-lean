# Known gaps and open items

This is a lean template: the full layered/DDD skeleton plus what a legacy Oracle service needs when it's ported onto NestJS, and nothing else. The table below lists what it deliberately does not do, so you can decide per project — accept it, or port the piece back — rather than discover the gap in production. After it: the genuine gaps that still apply to this code, kept here so a team adopting the template inherits the list instead of rediscovering it.

Terms: [Glossary](glossary.md). Rules the template does enforce: [Architecture overview](architecture/overview.md).

- **Reviewed**: 2026-09-18, against the initial commit.
- **Scope**: the template itself. Business features built on top are out of scope.

## 1. Deliberate omissions

Removed on purpose to keep the template small. If you need one, here's the cheapest way back in.

| Omission                 | What you do instead                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Outbound HTTP client** | Write a gateway adapter with `fetch` per upstream, or port the full template's `infrastructure/http` (timeout, retries, circuit breaker, correlation id — ~520 lines)  |
| **Metrics / tracing**    | Logs + `/health/ready` are the only operational visibility; port the full template's Prometheus metrics and W3C trace propagation if you need cross-service visibility |
| **Rate limiting**        | Put it at the load balancer/proxy, or port the full template's throttler guard (in-memory or Redis-backed for multiple instances)                                      |
| **Unit of work**         | `ConnectionProvider.transaction()` covers one call; several aggregates that must succeed or fail together need a unit-of-work abstraction ported back (~90 lines)      |
| **Domain events**        | Call side effects directly from the use case, in the order it chooses, after the save succeeds — no `addEvent`/`pullEvents`, no publisher, no handlers                 |
| **CI**                   | No `.github/workflows`; run `pnpm verify`, `pnpm test:cov` and `pnpm format:check` yourself, or wire up your own pipeline's equivalent                                 |
| **Docker**               | No `Dockerfile`/`docker-compose.yml`; run the app with `pnpm start:prod` and Oracle however you like (`gvenzl/oracle-free` for local dev), or write your own image     |

## 2. Genuine gaps

Weaknesses in what the template does provide.

| #   | Gap                                                                                                                                                                                                                                                                                                      | Where                                                                      | Suggested fix                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | **The interface layer is not fenced by ESLint.** The import restrictions cover `application/**` and `domain/**` only, so `HealthController` reaches into `@infrastructure/database/*` for `ConnectionProviderToken` and the `ConnectionProvider` contract — which the docs call infrastructure-internal. | `eslint.config.mjs`, `src/interface/http/controllers/health.controller.ts` | Add a `no-restricted-imports` block for `src/interface/**`, and put health behind an application port |
| 2   | **`/health/ready` is unauthenticated and lists the configured source keys and dialects.** In production the error text is hidden, the topology isn't.                                                                                                                                                    | `src/interface/http/controllers/health.controller.ts`                      | Keep the liveness probe open; bind the detailed readiness body to an internal route or a token        |
| 3   | **No idempotency.** No idempotency keys and no dedupe store. Clients retrying through a load balancer will execute a POST twice.                                                                                                                                                                         |                                                                            | Matters with the VIP setups in the migration guide                                                    |
| 4   | **No caching.** No cache port, so repeated lookups (roles, reference data) hit the database every request.                                                                                                                                                                                               |                                                                            | A small `CachePort` + in-memory/Redis adapter                                                         |
| 5   | **No JWKS / key rotation.** Only static secrets and algorithms from config. Keycloak, Entra ID and AD FS shops need `jwks_uri` with `kid` selection and caching.                                                                                                                                         | `src/infrastructure/auth`                                                  |                                                                                                       |
| 6   | **No migrations story.** Nothing, not even a stated position for the case where you _do_ own the schema. The "database you don't own" guide covers the opposite case well.                                                                                                                               |                                                                            | Pick a tool and write one page, or say clearly it's out of scope                                      |
| 7   | **No disposable test database.** The live Oracle suite needs a database you set up by hand, so it runs rarely.                                                                                                                                                                                           |                                                                            | Testcontainers, or a documented one-command container                                                 |
| 8   | **No multi-tenancy.** No tenant concept anywhere. The Oracle context user identifies the actor, not a tenant, and is not a data-scoping mechanism.                                                                                                                                                       |                                                                            | Add deliberately if you need it; retrofitting is expensive                                            |
| 9   | **No repository hygiene files.** No LICENSE, CHANGELOG, CONTRIBUTING, pull-request template, commit linting or pre-commit hook — in a repository whose whole purpose is to be forked.                                                                                                                    |                                                                            | Conventions are currently enforced by reviewers and agents, not by tooling                            |

## 3. What I'd fix first

1. Fence the interface layer in ESLint and move health behind an application port.
2. Decide, before adopting the template, which of section 1's omissions your service actually needs and port them back deliberately rather than by accretion.

## Environment items (not code)

- The Windows service scripts are checked in a PowerShell container (`pnpm test:service-scripts`); registering the service on a real Windows machine is still unverified.
