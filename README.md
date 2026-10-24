# Astral Atlas

Astral Atlas is a backend-first repository analysis platform that turns a GitHub repository or ZIP archive into a structured dependency and code-analysis map.

It analyzes source files without executing repository code and produces:

- repository dependency graphs
- file and symbol search
- source-code details
- import relationships
- complexity and structural metrics
- dependency-cycle detection
- blast-radius analysis
- architectural health scoring
- explainable findings and hotspots
- onboarding/pathfinder recommendations

The current implementation focuses on the production backend. The frontend visualization layer is not yet included.

---

## Architecture

```text
Client
  |
  | REST + SSE
  v
Fastify API
  |
  | BullMQ
  v
Redis Queue
  |
  v
Analysis Worker
  |
  | worker_threads + Tree-sitter
  |
  +--> Repository scan
  +--> Parsing
  +--> Import resolution
  +--> Dependency graph
  +--> Metrics
  +--> Deep analysis
  +--> Health scoring
  +--> Onboarding pathfinder
  |
  v
PostgreSQL
```

Main workspace packages:

```text
apps/
  api/       Fastify REST/SSE API
  worker/    repository analysis workers
  web/       frontend workspace

packages/
  shared/    shared contracts and types
  database/  Drizzle/PostgreSQL schema and database utilities
```

---

## Supported Analysis Inputs

Astral Atlas currently supports:

### GitHub repositories

A public GitHub repository can be submitted by URL.

The API resolves the repository revision and avoids unnecessary repeated analysis when a completed result already exists.

### ZIP archives

Repository ZIP files can be uploaded directly.

ZIP staging is shared between the API and worker containers so that queued worker jobs can access uploaded archives safely.

---

## Supported Languages

Primary analysis currently supports:

- JavaScript
- TypeScript
- Python

Unsupported files remain visible as repository metadata instead of silently disappearing from results.

---

## Requirements

Use the versions pinned by the project:

```text
Node.js: 22.23.3
pnpm:    12.14.0
Docker + Docker Compose
```

The root package requires Node:

```text
>=22.23.3 <23
```

---

## Local Setup

Install dependencies:

```bash
pnpm install --frozen-lockfile
```

Create the local environment file:

```bash
cp .env.example .env
```

Default development configuration:

```env
NODE_ENV=development

POSTGRES_DB=astral_atlas
POSTGRES_USER=astral
POSTGRES_PASSWORD=astral_local_dev_only
POSTGRES_PORT=5432
DATABASE_URL=postgresql://astral:astral_local_dev_only@127.0.0.1:5432/astral_atlas

REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379

API_HOST=127.0.0.1
API_PORT=3000

LOG_LEVEL=info

CORS_ORIGINS=http://localhost:5173
RATE_LIMIT_MAX=120
TRUST_PROXY=false

GITHUB_TOKEN=
```

`GITHUB_TOKEN` is optional for local development. Never commit a real token.

---

## Docker Development Stack

Start the stack:

```bash
pnpm infra:up
```

Equivalent Docker Compose command:

```bash
docker compose up -d --wait
```

Show running containers:

```bash
docker compose ps
```

Follow logs:

```bash
pnpm infra:logs
```

Stop the stack:

```bash
pnpm infra:down
```

To remove containers and volumes:

```bash
docker compose down --volumes --remove-orphans
```

---

## Production Docker Images

Validate the Compose configuration:

```bash
docker compose config --quiet
```

Build the migration image:

```bash
docker compose build migrate
```

Build the API:

```bash
docker compose build api
```

Build the worker:

```bash
docker compose build worker
```

Start the production backend:

```bash
docker compose up -d api worker
```

The Compose startup flow also handles database migrations and ZIP staging initialization.

---

## Health Checks

### Liveness

```bash
curl --fail \
  http://127.0.0.1:3000/health
```

Example:

```json
{
  "status": "ok",
  "timestamp": "..."
}
```

### Readiness

```bash
curl --fail \
  http://127.0.0.1:3000/ready
```

Example:

```json
{
  "status": "ready",
  "checks": {
    "database": "up",
    "redis": "up"
  },
  "timestamp": "..."
}
```

Readiness requires both PostgreSQL and Redis to be available.

---

## Quality Checks

Run the complete local quality gate:

```bash
pnpm check
```

This runs:

```text
TypeScript typechecking
ESLint
Prettier formatting check
Vitest unit tests
```

Individual commands:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Apply formatting:

```bash
pnpm format
```

---

## Integration Tests

Start PostgreSQL and Redis before running integration tests.

Example local configuration:

```bash
DATABASE_URL='postgresql://astral:astral_local_dev_only@127.0.0.1:5432/astral_atlas' \
RUN_DB_INTEGRATION_TESTS=true \
REDIS_HOST=127.0.0.1 \
REDIS_PORT=6379 \
REDIS_DATABASE=0 \
REDIS_TLS=false \
pnpm test:integration
```

Integration coverage includes real PostgreSQL, Redis, parser worker threads, repository graph generation, metrics, health scoring, onboarding, Git history, and worker queue behavior.

---

## Database

Apply migrations:

```bash
pnpm db:migrate
```

Generate Drizzle migrations:

```bash
pnpm db:generate
```

Open Drizzle Studio:

```bash
pnpm db:studio
```

---

## API Development

Start the API in development mode:

```bash
pnpm api:dev
```

Default API address:

```text
http://127.0.0.1:3000
```

---

## Main Analysis Endpoints

### Submit ZIP

```http
POST /api/analyses/zip
```

Multipart field:

```text
file
```

Example:

```bash
curl \
  -X POST \
  -F 'file=@repository.zip;type=application/zip' \
  http://127.0.0.1:3000/api/analyses/zip
```

### Repository graph

```http
GET /api/analyses/:analysisId/graph
```

### File details

```http
GET /api/analyses/:analysisId/files/:fileId
```

Includes:

- source content
- file metrics
- extracted symbols
- export metadata
- incoming edges
- outgoing edges
- findings

### Search

```http
GET /api/analyses/:analysisId/search?q=<query>
```

Searches files and symbols.

### Onboarding pathfinder

```http
GET /api/analyses/:analysisId/pathfinder
```

Returns a deterministic recommended reading order based on repository structure and dependency context.

### Analysis events

```http
GET /api/analyses/:analysisId/events
```

Uses Server-Sent Events for analysis progress.

---

## Analysis Pipeline

A production worker processes a repository through roughly the following stages:

```text
1. Validate job
2. Acquire revision lock
3. Prepare GitHub checkout or ZIP source
4. Scan repository files
5. Parse supported files with Tree-sitter worker threads
6. Load source snapshots
7. Resolve imports
8. Build dependency graph
9. Detect dependency cycles
10. Calculate structural and graph metrics
11. Load bounded Git history when available
12. Calculate churn
13. Run deep analysis
14. Calculate repository health score
15. Build onboarding path
16. Create persistence payload
17. Verify distributed lock ownership
18. Persist the completed result transactionally
19. Close parser workers
20. Clean temporary repository data
```

Completed analysis data is written transactionally so partially persisted results are not exposed as completed analyses.

---

## Retry and Deduplication

Analysis jobs are designed to be retry-safe.

Important behavior includes:

- immutable source revisions
- revision-level distributed locking
- completed-analysis retry shortcut
- submission deduplication
- cached completed results
- safe BullMQ requeue behavior

Repeated requests for the same completed revision can reuse existing analysis rather than repeating expensive work.

---

## Repository Safety

The analysis system does not execute repository source code.

Backend protections include:

- GitHub URL validation
- ZIP path traversal protection
- ZIP archive limits
- repository file-count limits
- per-file size limits
- unsupported-language handling
- parser failure isolation
- temporary-directory cleanup
- rate limiting
- validated environment variables
- bounded heavy worker concurrency

---

## Worker Analysis Benchmark

Run the worker benchmark:

```bash
pnpm --filter @astral-atlas/worker benchmark:analysis
```

Custom fixture size and rounds:

```bash
BENCHMARK_FILES=500 \
BENCHMARK_ROUNDS=3 \
BENCHMARK_WARMUP_ROUNDS=1 \
pnpm --filter @astral-atlas/worker benchmark:analysis
```

The benchmark exercises:

```text
repository scan
Tree-sitter parsing through worker_threads
dependency graph construction
repository metrics
deep analysis
health scoring
onboarding pathfinder
```

It intentionally excludes Redis queue latency and PostgreSQL persistence so that the measurement focuses on the CPU-heavy repository-analysis pipeline.

### Verified 500-file benchmark

A local 500-file deterministic TypeScript benchmark produced:

```text
Analyzed files:       500
Graph edges:          548
Median total:         749.43 ms
p95 total:            822.02 ms
Average total:        747.00 ms
Median throughput:    667.18 files/s
Maximum observed RSS: 287.43 MiB
Maximum RSS delta:    31.77 MiB
```

Median phase timings:

```text
Scan              106.00 ms
Tree-sitter parse 363.22 ms
Source load        52.86 ms
Graph               5.14 ms
Metrics           163.54 ms
Deep analysis       1.76 ms
Health score        0.30 ms
Onboarding          5.89 ms
Parser close       12.60 ms
```

Benchmark results depend on hardware, operating system, filesystem performance, available CPU resources, Node.js version, and repository structure. They should be treated as development baselines rather than universal production guarantees.

---

## API Submission Benchmark

The backend admission path has also been benchmarked with batches of 100 analysis-submission requests.

Observed local baseline:

```text
Median 100-request batch: 17.87 ms
Median throughput:        5,596.04 requests/s
p50:                      13.76 ms
p95:                      20.14 ms
p99:                      21.66 ms
Peak RSS:                 124.20 MiB
Maximum observed RSS +:     3.00 MiB
```

This benchmark measures the API admission path with expensive external/deep dependencies mocked. It does not represent full repository-analysis throughput.

---

## PostgreSQL Search Benchmark

A PostgreSQL-backed search benchmark using:

```text
1,000 files
5,000 symbols
```

produced the following local baseline:

```text
p50:                  19.49 ms
p95:                  26.86 ms
p99:                  31.44 ms
Average:              19.70 ms
Minimum:              12.04 ms
Maximum:              39.93 ms
Sequential throughput: 50.74 requests/s
```

These numbers are environment-specific and should be used for regression tracking rather than as a deployment SLA.

---

## Continuous Integration

GitHub Actions runs three backend stages.

### Quality

```text
install
build shared package
build database package
typecheck
lint
format check
unit tests
API production build
worker production build
```

### Integration

Runs tests against real:

```text
PostgreSQL
Redis
```

### Docker runtime smoke

The production Docker stage:

```text
validates Compose
builds migration image
builds API image
builds worker image
starts the production stack
waits for /health
checks /ready
verifies the worker is running
prints diagnostics on failure
cleans up containers and volumes
```

This verifies more than successful image compilation: it checks that the production containers can actually boot together.

---

## Current Backend Verification

The backend has been exercised with both real GitHub and real ZIP submissions.

Verified behavior includes:

```text
repository analysis completion
dependency graph persistence/readback
source-content persistence
function and class symbol extraction
export metadata persistence
file-detail API
search API
pathfinder API
GitHub cache reuse
ZIP cache reuse
PostgreSQL readiness
Redis readiness
production Docker startup
worker runtime
```

---

## Development Principles

Astral Atlas follows these backend rules:

```text
strict TypeScript
no implicit any
validated runtime inputs
structured logging
typed error handling
transactional completed-analysis persistence
retry-safe jobs
distributed deduplication
bounded background analysis
graceful shutdown
health/readiness endpoints
unit and integration tests
production Docker builds
```

Heavy repository analysis is never performed directly inside an HTTP request handler.

---

## License

A project license has not yet been defined.
