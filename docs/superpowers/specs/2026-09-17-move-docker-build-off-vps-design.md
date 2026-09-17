# Move Docker Build Off VPS — Design

## Problem

Deploys currently happen by SSH-ing into the VPS, `git pull`-ing, and running
`docker build` / `docker compose up --build` directly on the VPS. Running
`next build` on the VPS consumes enough CPU/RAM to crash the instance. The
Dockerfile and docker-compose.yml only ever existed on the VPS
(`/var/www/transaksikilat`), not in this git repo.

## Goal

The VPS should only ever run:

```
docker compose pull
docker compose up -d
```

All image building happens off the VPS, in GitHub Actions, publishing to
GitHub Container Registry (GHCR).

## Non-goals

- No changes to the database (it's external/managed; the compose file has no
  DB service, and this change never touches migrations or data).
- No BullMQ worker service — it's not deployed to production yet, out of
  scope here.
- No multi-stage/`output: standalone` Dockerfile rewrite. Chosen approach
  keeps the existing single-stage Dockerfile behavior identical, to minimize
  risk. Multi-stage optimization is a possible future improvement, not part
  of this change.
- No automatic SSH deploy from CI. The user pulls and restarts manually on
  the VPS after each CI build completes.

## Design

### 1. Dockerfile (moved into git repo, minimal change)

Keep the existing single-stage structure (`npm ci` → `prisma generate` →
`npm run build` → `npm run start`). Add build `ARG`/`ENV` for the four
`NEXT_PUBLIC_*` variables the app reads at build time:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_AUTH_OTP_ENABLED`
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE`

These are needed because Next.js inlines `NEXT_PUBLIC_*` values into the
client bundle at `next build` time. Previously this worked by accident: the
VPS built directly inside `/var/www/transaksikilat`, so `COPY . .` picked up
the real `.env` file sitting next to the Dockerfile. Once the build happens
in CI (checking out git, where `.env*` is gitignored), those values must be
passed explicitly as Docker build args.

### 2. `.dockerignore` (new)

Excludes `node_modules`, `.git`, `.env*`, `.next` from the build context.
Belt-and-suspenders alongside `.env*` being gitignored — ensures secrets can
never end up baked into an image layer even if someone runs a local build
from a dirty working directory.

### 3. GitHub Actions workflow — `.github/workflows/build-and-push.yml` (new)

- Trigger: push to `main`.
- `docker/login-action` to `ghcr.io` using the built-in `GITHUB_TOKEN`
  (`packages: write` permission) — no manual PAT needed for CI.
- `docker/build-push-action` builds and pushes:
  - Tags: `ghcr.io/akbarryyan/transaksikilat:latest` and
    `ghcr.io/akbarryyan/transaksikilat:<git-sha>` (sha tag enables rollback).
  - Build args: the four `NEXT_PUBLIC_*` values, sourced from GitHub
    **repository variables** (not secrets — they're public-facing values
    anyway).
  - GitHub Actions cache (`type=gha`) to speed up repeated builds.
  - Default platform `linux/amd64` (matches the VPS architecture).

### 4. `docker-compose.yml` (moved into git repo for reference)

Identical to current VPS version except `build:` is replaced with:

```yaml
image: ghcr.io/akbarryyan/transaksikilat:latest
```

Everything else (`container_name`, `restart`, `network_mode: host`,
`env_file: .env`, the `public/uploads` volume) stays unchanged. The VPS
keeps its own copy of this file at `/var/www/transaksikilat/docker-compose.yml`
and is updated manually (not auto-synced from CI).

### 5. One-time VPS setup

Because the image contains full application source (single-stage Dockerfile,
`COPY . .`), the GHCR package is kept **private**, not public. This also
means the VPS needs to authenticate once:

1. Create a GitHub Personal Access Token (classic) with `read:packages`
   scope only.
2. On the VPS: `echo "<PAT>" | docker login ghcr.io -u akbarryyan --password-stdin`
   — credentials persist in `~/.docker/config.json`, no need to repeat per
   deploy.

Also requires setting the 4 `NEXT_PUBLIC_*` values as GitHub **repository
variables** (Settings → Secrets and variables → Actions → Variables) so the
CI workflow can read them.

## Resulting deploy flow

1. Push/merge to `main`.
2. GitHub Actions builds the image on GitHub's runners (ample RAM, doesn't
   touch the VPS) and pushes it to GHCR.
3. On the VPS: `docker compose pull && docker compose up -d`. No build step
   ever runs on the VPS.
4. Rollback: point the VPS compose file's tag at a previous `<git-sha>` tag,
   then `docker compose pull && docker compose up -d` again.

## Files touched

- `Dockerfile` (new in repo, adjusted from VPS's copy)
- `.dockerignore` (new)
- `docker-compose.yml` (new in repo, reference copy)
- `.github/workflows/build-and-push.yml` (new)
