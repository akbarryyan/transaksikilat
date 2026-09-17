# Memindahkan Docker Build Keluar dari VPS — Desain

## Masalah

Deploy saat ini dilakukan dengan SSH ke VPS, `git pull`, lalu menjalankan
`docker build` / `docker compose up --build` langsung di VPS. Menjalankan
`next build` di VPS menghabiskan CPU/RAM sampai bikin instance-nya crash.
Dockerfile dan docker-compose.yml selama ini cuma ada di VPS
(`/var/www/transaksikilat`), tidak pernah masuk ke repo git ini.

## Tujuan

VPS seharusnya hanya menjalankan:

```
docker compose pull
docker compose up -d
```

Semua proses build image dipindahkan keluar dari VPS, dilakukan di GitHub
Actions, lalu hasilnya di-publish ke GitHub Container Registry (GHCR).

## Bukan tujuan (out of scope)

- Tidak ada perubahan pada database (bersifat eksternal/managed; compose
  file tidak punya service DB, dan perubahan ini sama sekali tidak
  menyentuh migration atau data).
- Tidak ada service worker BullMQ — belum di-deploy ke production, jadi di
  luar scope perubahan ini.
- Tidak ada penulisan ulang Dockerfile jadi multi-stage/`output: standalone`.
  Pendekatan yang dipilih mempertahankan perilaku Dockerfile single-stage
  yang sekarang persis sama, demi meminimalkan risiko. Optimasi multi-stage
  bisa jadi perbaikan lanjutan di masa depan, bukan bagian dari perubahan
  ini.
- Tidak ada auto-deploy via SSH dari CI. User yang menjalankan pull dan
  restart secara manual di VPS setiap kali build CI selesai.

## Desain

### 1. Dockerfile (dipindahkan ke repo git, perubahan minimal)

Struktur single-stage yang sudah ada dipertahankan (`npm ci` → `prisma
generate` → `npm run build` → `npm run start`). Ditambahkan `ARG`/`ENV`
untuk build empat variabel `NEXT_PUBLIC_*` yang dibaca aplikasi saat build:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_AUTH_OTP_ENABLED`
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE`

Ini diperlukan karena Next.js meng-inline nilai `NEXT_PUBLIC_*` ke dalam
client bundle saat `next build`. Sebelumnya ini jalan secara kebetulan: VPS
build langsung di dalam `/var/www/transaksikilat`, jadi `COPY . .` ikut
mengambil file `.env` asli yang ada di sebelah Dockerfile. Begitu build
pindah ke CI (checkout dari git, di mana `.env*` di-gitignore), nilai-nilai
tersebut harus dikirim eksplisit sebagai Docker build args.

### 2. `.dockerignore` (baru)

Mengecualikan `node_modules`, `.git`, `.env*`, `.next` dari build context.
Sebagai lapisan pengaman tambahan selain `.env*` yang sudah di-gitignore —
memastikan secret tidak akan pernah ikut ter-bake ke dalam image layer,
bahkan kalau ada yang menjalankan build lokal dari working directory yang
kotor.

### 3. GitHub Actions workflow — `.github/workflows/build-and-push.yml` (baru)

- Trigger: push ke `main`.
- `docker/login-action` ke `ghcr.io` menggunakan `GITHUB_TOKEN` bawaan
  (permission `packages: write`) — tidak perlu PAT manual untuk CI.
- `docker/build-push-action` build lalu push:
  - Tag: `ghcr.io/akbarryyan/transaksikilat:latest` dan
    `ghcr.io/akbarryyan/transaksikilat:<git-sha>` (tag sha memungkinkan
    rollback).
  - Build args: empat nilai `NEXT_PUBLIC_*`, diambil dari GitHub
    **repository variables** (bukan secrets — karena memang nilainya
    bersifat public-facing).
  - GitHub Actions cache (`type=gha`) untuk mempercepat build berikutnya.
  - Platform default `linux/amd64` (sesuai arsitektur VPS).

### 4. `docker-compose.yml` (dipindahkan ke repo git sebagai referensi)

Identik dengan versi VPS sekarang, kecuali `build:` diganti jadi:

```yaml
image: ghcr.io/akbarryyan/transaksikilat:latest
```

Bagian lainnya (`container_name`, `restart`, `network_mode: host`,
`env_file: .env`, volume `public/uploads`) tetap tidak berubah. VPS tetap
menyimpan salinannya sendiri di
`/var/www/transaksikilat/docker-compose.yml` dan diupdate manual (tidak
di-sync otomatis dari CI).

### 5. Setup satu kali di VPS

Karena image berisi source code aplikasi secara lengkap (Dockerfile
single-stage, `COPY . .`), package GHCR dibuat **private**, bukan public.
Konsekuensinya, VPS perlu autentikasi sekali:

1. Buat GitHub Personal Access Token (classic) dengan scope `read:packages`
   saja.
2. Di VPS: `echo "<PAT>" | docker login ghcr.io -u akbarryyan --password-stdin`
   — kredensial tersimpan permanen di `~/.docker/config.json`, tidak perlu
   diulang setiap deploy.

Juga perlu set 4 nilai `NEXT_PUBLIC_*` sebagai GitHub **repository
variables** (Settings → Secrets and variables → Actions → Variables) supaya
workflow CI bisa membacanya.

## Alur deploy setelahnya

1. Push/merge ke `main`.
2. GitHub Actions build image di runner GitHub (RAM cukup, tidak menyentuh
   VPS sama sekali) lalu push ke GHCR.
3. Di VPS: `docker compose pull && docker compose up -d`. Tidak ada proses
   build yang pernah jalan di VPS.
4. Rollback: arahkan tag di compose file VPS ke `<git-sha>` versi
   sebelumnya, lalu `docker compose pull && docker compose up -d` lagi.

## File yang terpengaruh

- `Dockerfile` (baru di repo, hasil penyesuaian dari salinan di VPS)
- `.dockerignore` (baru)
- `docker-compose.yml` (baru di repo, sebagai salinan referensi)
- `.github/workflows/build-and-push.yml` (baru)
