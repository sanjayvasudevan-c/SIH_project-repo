# Local setup and verification

The demo stack uses Docker Compose for PostgreSQL, the API, two scheduler replicas, the Python form-check service, and the web application.

## Requirements

- Docker Engine or Docker Desktop with the Compose plugin
- Node.js 22.12 or newer for local npm commands
- Python 3.11 or newer for local form-check development and tests
- Git

Ports 5432, 4000, and 8080 must be available. Default local credentials are for the demo only.

## Fresh checkout

```bash
git clone https://github.com/sanjayvasudevan-c/SIH_project-repo.git
cd SIH_project-repo
git switch main
cp .env.example .env
npm run setup
```

`npm run setup` installs dependencies, starts PostgreSQL, builds the form-check service for seeding, recreates the `aicte` demo database, migrates and seeds it, then creates the reset template. **It discards the existing `aicte` database.** Use it only for a new demo database or when you intend to replace the demo data.

Build services sequentially, then start the stack:

```bash
docker compose build api
docker compose build scheduler
docker compose build web
docker compose build formcheck
docker compose up -d
```

Sequential builds work with Docker installations that do not have the Buildx plugin. Open <http://localhost:8080> and sign in with a demo account. The default password for the fictional demo users is `demo1234`.

## Common commands

| Command | Purpose |
|---|---|
| `docker compose ps` | Show service status |
| `docker compose logs -f api scheduler` | Follow API and scheduler logs |
| `docker compose down` | Stop services; keep the database volume |
| `npm run demo:reset` | Restore the seeded demo template; discards demo changes |
| `npm test` | Run API integration tests; requires PostgreSQL test setup |
| `npm run test:web` | Run frontend unit tests |
| `npm run test:formcheck` | Run Python form-check tests |
| `npm --workspace api run typecheck` | Type-check the API |
| `npm --workspace web run build` | Type-check and build the web application |
| `node --test scripts/*.test.mjs` | Run chart generator tests |
| `npm run evidence:verify` | Compare verification API aggregates against independent SQL; needs a seeded database |

The former Evidence Center page is not part of the application navigation. The retained `/api/evidence/*` endpoints are ADMIN-only and can be inspected through the API tests and `npm run evidence:verify`, which independently compares aggregates with SQL.

## Development without Docker

Install PostgreSQL 16 and configure the local credentials in `.env`. Generate and train the synthetic form-check model before seeding if you want the model-backed path:

```bash
cd formcheck
python3 -m training.generate
python3 -m training.train
python3 -m training.evaluate
cd ..
SETUP_NO_DOCKER=1 npm run setup
npm run dev
```

On Windows PowerShell, set `$env:SETUP_NO_DOCKER=1` before running setup. `npm run dev` starts the API, one scheduler, Vite, and the form-check service. See the root [package scripts](../../package.json) for additional commands.

## Data safety

Do not run `npm run setup`, `npm run demo:reset`, or the load test against a database containing data you want to keep; these commands rebuild or reset demo data. The seed and benchmark data are synthetic.

## Troubleshooting

- **Port is already allocated:** stop the service using 5432, 4000, or 8080, or change the Compose port mapping and matching URLs.
- **Database is not ready:** check `docker compose logs db` and `docker compose ps`.
- **Migration credentials fail:** ensure `.env` values match `db/init/00_roles.sql`. Existing named Docker volumes retain the credentials from their first initialization.
- **Demo users are missing:** the API must be healthy and `DEMO_MODE` must be `true`.
- **Form check falls back to rules:** check `docker compose logs formcheck`; filing remains available without the model service.
- **The web app returns a proxy error:** check `docker compose logs api web` and confirm all services are on the same Compose project.
