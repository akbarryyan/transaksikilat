# Memindahkan Docker Build Keluar dari VPS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VPS berhenti menjalankan `docker build`; semua build image dilakukan di GitHub Actions dan dipush ke GHCR, VPS tinggal `docker compose pull && docker compose up -d`.

**Architecture:** Tambahkan `Dockerfile`, `.dockerignore`, dan `docker-compose.yml` ke repo git (sebelumnya cuma ada di VPS, tidak version-controlled). Tambahkan workflow GitHub Actions yang build image dari Dockerfile itu dan push ke `ghcr.io/akbarryyan/transaksikilat` setiap push ke `main`. VPS lalu diupdate manual satu kali untuk pakai compose file versi `image:` dan login ke GHCR.

**Tech Stack:** Docker, Docker Compose, GitHub Actions (`docker/build-push-action`, `docker/login-action`), GHCR (GitHub Container Registry), Next.js 16 + Prisma 5 (existing app stack, tidak berubah).

Spec lengkap: [`docs/superpowers/specs/2026-09-17-move-docker-build-off-vps-design.md`](../specs/2026-09-17-move-docker-build-off-vps-design.md)

## Global Constraints

- Base image tetap `node:20-alpine`, sama seperti Dockerfile yang sekarang jalan di VPS — jangan diganti base image lain.
- Dockerfile tetap **single-stage** (bukan multi-stage/`output: standalone`) — sesuai keputusan spec Opsi A, supaya behavior image identik dengan yang sudah terbukti jalan sekarang.
- Registry: `ghcr.io/akbarryyan/transaksikilat`, **private** (image berisi source code lengkap karena single-stage).
- Workflow trigger hanya `push` ke branch `main`.
- Build args yang dibutuhkan Dockerfile HANYA 4 variabel `NEXT_PUBLIC_*` ini (sudah divalidasi lewat build test lokal — `next build` sukses tanpa `DATABASE_URL` atau env lain sama sekali, meski Prisma client di-instantiate di top-level module yang di-import ~75 route file):
  - `NEXT_PUBLIC_APP_URL`
  - `NEXT_PUBLIC_AUTH_OTP_ENABLED`
  - `NEXT_PUBLIC_BASE_URL`
  - `NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE`
- Tidak ada auto-deploy SSH dari CI — user jalankan `docker compose pull && docker compose up -d` manual di VPS (keputusan spec).
- Tidak menyentuh database, migration, atau worker BullMQ (out of scope, sesuai spec).
- **Keterbatasan lingkungan dev/sandbox:** kalau task ini dieksekusi di sandbox tanpa akses ke `dl-cdn.alpinelinux.org` (mirror paket Alpine), `docker build` penuh (dengan `apk add openssl libc6-compat`) akan hang di step itu meski `registry.npmjs.org` dan Docker Hub bisa diakses normal. Task 1 punya cara verifikasi yang menghindari masalah ini; verifikasi Dockerfile yang sudah termasuk `apk add` cukup dilakukan sekali secara nyata lewat GitHub Actions run (Task 5) atau di mesin dengan akses internet penuh.

---

## File Structure

- Create: `Dockerfile` (root) — image aplikasi, single-stage, dipindah dari VPS + build args untuk `NEXT_PUBLIC_*`
- Create: `.dockerignore` (root) — exclude `node_modules`, `.git`, `.env*`, `.next`
- Create: `docker-compose.yml` (root) — salinan referensi untuk VPS, versi `image:` (bukan `build:`)
- Create: `.github/workflows/build-and-push.yml` — CI build & push ke GHCR

## Task 1: Dockerfile + `.dockerignore`

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: image yang di-`EXPOSE 3003` dan `CMD ["npm", "run", "start"]` — dikonsumsi oleh compose file (Task 2, lewat `image:` yang sama) dan workflow CI (Task 3, yang men-tag hasil build Dockerfile ini).

- [ ] **Step 1: Buat `.dockerignore`**

```
node_modules
.git
.next
.env
.env.*
```

- [ ] **Step 2: Buat `Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_AUTH_OTP_ENABLED
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_AUTH_OTP_ENABLED=$NEXT_PUBLIC_AUTH_OTP_ENABLED \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE=$NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE

RUN npx prisma generate

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3003

EXPOSE 3003

CMD ["npm", "run", "start"]
```

- [ ] **Step 3: Verifikasi build tanpa `.env` sama sekali (mimicking CI checkout)**

Ini memastikan tidak ada env var tersembunyi lain yang selama ini kebetulan ke-inject dari `.env` asli VPS (lewat `COPY . .` yang lama).

Kalau punya akses internet penuh ke Alpine mirror, langsung test Dockerfile aslinya:

```bash
git archive HEAD | (mkdir -p /tmp/build-check && tar -x -C /tmp/build-check)
cp Dockerfile .dockerignore /tmp/build-check/
cd /tmp/build-check
docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://test.example \
  --build-arg NEXT_PUBLIC_AUTH_OTP_ENABLED=false \
  --build-arg NEXT_PUBLIC_BASE_URL=https://test.example \
  --build-arg NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE=false \
  -t transaksikilat-buildtest .
```

Expected: build selesai dengan `Successfully tagged transaksikilat-buildtest:latest`, output `npm run build` menunjukkan daftar routes ter-compile tanpa error.

Kalau di sandbox yang tidak bisa akses `dl-cdn.alpinelinux.org` (apk add akan hang), pakai variant tanpa `apk add` khusus untuk cek bagian `npm ci` + `prisma generate` + `next build`-nya saja (baris `RUN apk add ...` dihapus sementara di file test, bukan di `Dockerfile` asli):

```bash
sed '/RUN apk add/d' Dockerfile > /tmp/build-check/Dockerfile.diag
cd /tmp/build-check
docker build -f Dockerfile.diag \
  --build-arg NEXT_PUBLIC_APP_URL=https://test.example \
  --build-arg NEXT_PUBLIC_AUTH_OTP_ENABLED=false \
  --build-arg NEXT_PUBLIC_BASE_URL=https://test.example \
  --build-arg NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE=false \
  -t transaksikilat-diag .
```

Expected: sama, build sukses tanpa error. (Sudah divalidasi manual sekali dengan hasil sukses — lihat Global Constraints.)

- [ ] **Step 4: Bersihkan image test**

```bash
docker rmi transaksikilat-buildtest transaksikilat-diag 2>/dev/null
rm -rf /tmp/build-check
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile and .dockerignore for CI-based image builds"
```

## Task 2: `docker-compose.yml` (reference copy)

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: nama image `ghcr.io/akbarryyan/transaksikilat:latest` — harus identik dengan tag yang dipush workflow di Task 3.
- Produces: definisi service `transaksikilat-app` yang jadi acuan file yang akan disalin manual ke VPS (Task 4).

- [ ] **Step 1: Buat `docker-compose.yml`**

```yaml
services:
  transaksikilat-app:
    image: ghcr.io/akbarryyan/transaksikilat:latest
    container_name: transaksikilat-app
    restart: unless-stopped
    network_mode: host
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: 3003
    volumes:
      - /var/www/transaksikilat/public/uploads:/app/public/uploads
```

- [ ] **Step 2: Validasi syntax YAML**

```bash
docker compose -f docker-compose.yml config
```

Expected: keluar YAML ter-parse tanpa error (tidak perlu file `.env` benar-benar ada — `docker compose config` cuma mem-validasi syntax & reference, akan warning kalau `.env` belum ada tapi tidak gagal).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add reference docker-compose.yml using GHCR image"
```

## Task 3: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/build-and-push.yml`

**Interfaces:**
- Consumes: `Dockerfile` dari Task 1 (context build `.`), 4 GitHub repository variables `NEXT_PUBLIC_*` (di-setup manual di Task 4).
- Produces: image `ghcr.io/akbarryyan/transaksikilat:latest` dan `ghcr.io/akbarryyan/transaksikilat:<git-sha>` — dikonsumsi oleh `docker-compose.yml` (Task 2) di VPS.

- [ ] **Step 1: Buat direktori workflow**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Buat `.github/workflows/build-and-push.yml`**

```yaml
name: Build and Push Docker Image

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/akbarryyan/transaksikilat:latest
            ghcr.io/akbarryyan/transaksikilat:${{ github.sha }}
          build-args: |
            NEXT_PUBLIC_APP_URL=${{ vars.NEXT_PUBLIC_APP_URL }}
            NEXT_PUBLIC_AUTH_OTP_ENABLED=${{ vars.NEXT_PUBLIC_AUTH_OTP_ENABLED }}
            NEXT_PUBLIC_BASE_URL=${{ vars.NEXT_PUBLIC_BASE_URL }}
            NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE=${{ vars.NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 3: Validasi syntax YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-and-push.yml'))" && echo "YAML valid"
```

Expected: `YAML valid` tercetak tanpa error.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-and-push.yml
git commit -m "feat: add CI workflow to build and push image to GHCR"
```

## Task 4: Setup satu kali (manual — GitHub & VPS, tidak bisa diotomasi lewat kode)

Task ini dijalankan langsung oleh user, bukan agent, karena melibatkan UI GitHub dan akses SSH ke server production.

**Files:** tidak ada file yang diubah di repo.

- [ ] **Step 1: Set GitHub repository variables**

Buka `https://github.com/akbarryyan/transaksikilat/settings/variables/actions` → New repository variable, tambahkan 4 variabel (nilai persis sama dengan yang ada di `.env.production` VPS sekarang):
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_AUTH_OTP_ENABLED`
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE`

- [ ] **Step 2: Buat GitHub Personal Access Token untuk VPS**

Buka `https://github.com/settings/tokens` → Generate new token (classic) → scope `read:packages` saja → simpan token-nya (hanya muncul sekali).

- [ ] **Step 3: Login GHCR di VPS (sekali saja)**

```bash
echo "<PASTE_PAT_DI_SINI>" | docker login ghcr.io -u akbarryyan --password-stdin
```

Expected: `Login Succeeded`.

- [ ] **Step 4: Ganti `docker-compose.yml` di VPS**

Di VPS, edit `/var/www/transaksikilat/docker-compose.yml`, ganti blok:

```yaml
    build:
      context: .
      dockerfile: Dockerfile
      network: host
```

menjadi:

```yaml
    image: ghcr.io/akbarryyan/transaksikilat:latest
```

(baris `container_name`, `restart`, `network_mode`, `env_file`, `environment`, `volumes` tetap sama persis, tidak diubah).

- [ ] **Step 5: Push ke `main` supaya image pertama ter-build**

Ini push ke branch production dan akan trigger workflow CI (build + push image ke GHCR) — **konfirmasi dulu ke user sebelum dieksekusi**, karena ini aksi yang terlihat oleh sistem lain (GitHub Actions run, image baru di registry).

```bash
git push origin main
```

Lalu cek tab **Actions** di GitHub, tunggu sampai workflow selesai hijau.

- [ ] **Step 6: Pull & jalankan image pertama di VPS**

```bash
cd /var/www/transaksikilat
docker compose pull
docker compose up -d
```

Expected: container `transaksikilat-app` restart pakai image baru dari GHCR (bukan build lokal). Cek dengan `docker inspect transaksikilat-app --format '{{.Config.Image}}'` → harus muncul `ghcr.io/akbarryyan/transaksikilat:latest`.

- [ ] **Step 7: Smoke test aplikasi**

Buka domain/URL production di browser, pastikan halaman utama, login, dan minimal satu alur transaksi tetap jalan normal (regresi visual/fungsional dari perubahan Docker seharusnya nol, karena behavior image sama persis — cuma sumber build-nya yang beda).

- [ ] **Step 8: Pantau resource VPS**

```bash
docker stats --no-stream
free -h
```

Expected: tidak ada lonjakan CPU/RAM seperti sebelumnya, karena VPS memang tidak menjalankan build sama sekali di langkah ini.
