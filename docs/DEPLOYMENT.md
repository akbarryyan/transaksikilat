# Deployment

VPS **tidak pernah** menjalankan `docker build` lagi. Image dibangun di luar VPS (idealnya lewat GitHub Actions, sementara ini manual dari laptop karena akun GitHub masih locked), lalu di-push ke GitHub Container Registry (GHCR). VPS hanya `docker compose pull` + `docker compose up -d`.

Latar belakang & desain lengkap: [`superpowers/specs/2026-09-17-move-docker-build-off-vps-design.md`](superpowers/specs/2026-09-17-move-docker-build-off-vps-design.md)

## Arsitektur singkat

```
laptop / GitHub Actions  --build & push-->  ghcr.io/akbarryyan/transaksikilat
                                                        |
                                                        v
VPS (/var/www/transaksikilat)  --docker compose pull & up-d-->  container jalan
```

Registry: `ghcr.io/akbarryyan/transaksikilat` (private).

## Status saat ini: build manual dari laptop

Akun GitHub sedang **locked karena masalah billing**, jadi workflow `.github/workflows/build-and-push.yml` belum bisa jalan otomatis (job langsung gagal sebelum dapat runner). Selama ini belum beres, build dilakukan manual dari laptop yang punya akses internet penuh — **bukan** dari VPS, dan **bukan** dari environment yang dibatasi jaringan (mis. sandbox tanpa akses ke `dl-cdn.alpinelinux.org`).

### Build & push dari laptop

Jalankan gate-nya dulu. `npm run verify` menjalankan typecheck, lint, dan
seluruh test suite — jangan build image kalau ini merah.

```bash
cd ~/Kerjaan/repository/transaksikilat
git pull origin main

npm run verify

docker build \
  --build-arg NEXT_PUBLIC_APP_URL="https://transaksikilat.com" \
  --build-arg NEXT_PUBLIC_AUTH_OTP_ENABLED="false" \
  --build-arg NEXT_PUBLIC_BASE_URL="https://transaksikilat.com" \
  --build-arg NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE="true" \
  -t ghcr.io/akbarryyan/transaksikilat:latest .

docker push ghcr.io/akbarryyan/transaksikilat:latest
```

Login GHCR di laptop (sekali saja per mesin, token butuh scope `write:packages`):

```bash
echo "<PAT_WRITE_PACKAGES>" | docker login ghcr.io -u akbarryyan --password-stdin
```

### Deploy ke VPS

```bash
ssh <user>@<vps-host>
cd /var/www/transaksikilat
docker compose pull
docker compose up -d
docker inspect transaksikilat-app --format '{{.Config.Image}}'   # harus ghcr.io/akbarryyan/transaksikilat:latest
```

**Kalau rilisnya mengandung migration database**, sisipkan satu langkah di
antara `pull` dan `up -d`:

```bash
docker compose pull
docker compose run --rm transaksikilat-app npx prisma migrate deploy
docker compose up -d
```

Migration dijalankan memakai image baru selagi container lama masih melayani
trafik, jadi tidak ada jeda mati. Kalau urutannya dibalik, container baru naik
sebelum tabelnya ada dan request yang menyentuhnya akan gagal.

Cek apakah sebuah rilis mengandung migration:

```bash
git diff --name-only <sha-terakhir-dideploy>..HEAD -- prisma/migrations
```

Login GHCR di VPS (sekali saja, token cukup scope `read:packages`):

```bash
echo "<PAT_READ_PACKAGES>" | docker login ghcr.io -u akbarryyan --password-stdin
```

Lalu smoke test: buka domain production, cek halaman utama, login, dan minimal satu alur transaksi.

## Cron: rekonsiliasi order menggantung

Order yang macet di `PAID`/`PROCESSING_PROVIDER` dicek ulang ke provider oleh
`POST /api/cron/reconcile-orders`. Ini perlu dijadwalkan dari luar aplikasi:
retry yang berjalan di dalam proses memakai timer di memori, dan timer itu
hilang setiap container dibuat ulang — artinya hilang di setiap deploy.

Satu kali setup di VPS:

1. Isi `CRON_SECRET` di `/var/www/transaksikilat/.env` dengan string acak
   panjang, lalu `docker compose up -d`. Tanpa secret ini endpointnya menolak
   semua request.

2. Pasang cron (`crontab -e`), jalan tiap 5 menit:

```cron
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer GANTI_DENGAN_CRON_SECRET" http://127.0.0.1:3003/api/cron/reconcile-orders >> /var/log/reconcile-cron.log 2>&1
```

Satu sapuan memproses paling banyak 25 order, jadi tumpukan diselesaikan
bertahap lintas beberapa panggilan, bukan sekali jalan sampai timeout.

Cek hasilnya di log aplikasi — baris hanya muncul kalau ada yang dikerjakan:

```bash
docker compose logs --tail=200 transaksikilat-app | grep "Cron/Reconcile"
# atau langsung dari file (lihat bagian "Log aplikasi" di bawah):
tail -f /var/www/transaksikilat/logs/app.log | grep "Cron/Reconcile"
```

Endpoint admin `POST /api/admin/transactions/reconcile-all` tetap ada untuk
sapuan manual dari panel admin.

## Log aplikasi (tanpa `docker logs`)

Setiap `console.log`/`console.error` di aplikasi ditulis dua kali: ke
stdout (yang dibaca `docker logs`) dan ke file
`/var/www/transaksikilat/logs/app.log` di host — dipasang lewat volume
`logs:/app/logs` di `docker-compose.yml`, diinisialisasi sekali saat startup
oleh `instrumentation.ts` (`lib/logger.ts`). File ini tetap ada walau
container di-restart atau di-recreate, dan bisa dibaca tanpa akses ke
Docker sama sekali:

```bash
tail -f /var/www/transaksikilat/logs/app.log
grep "ERROR" /var/www/transaksikilat/logs/app.log
```

Direktori `/var/www/transaksikilat/logs` harus sudah ada sebelum
`docker compose up -d` pertama kali (Docker akan membuatnya otomatis kalau
belum ada, tapi sebagai root — bikin manual dulu kalau mau kepemilikannya
sesuai user VPS-mu):

```bash
mkdir -p /var/www/transaksikilat/logs
```

File ini tidak dirotasi oleh aplikasi — supaya tidak tumbuh tanpa batas,
pasang `logrotate` di VPS, misal `/etc/logrotate.d/transaksikilat`:

```
/var/www/transaksikilat/logs/app.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
```

`copytruncate` dipakai karena aplikasi menulis ke file ini dengan
append-per-baris (tanpa menyimpan file handle terbuka lama), jadi truncate
di tempat aman dilakukan kapan saja tanpa perlu me-restart container.

## Gate test

`.github/workflows/build-and-push.yml` punya dua job: `verify` menjalankan
typecheck dan seluruh test suite terhadap MySQL sungguhan, lalu `build-and-push`
hanya berjalan kalau `verify` hijau. Jadi image tidak akan pernah sampai ke
registry dari kode yang test-nya merah.

Selama akun GitHub masih locked, gate itu tidak pernah jalan — karena itu
`npm run verify` di langkah build manual di atas adalah satu-satunya
pelindung yang aktif sekarang.

`npm run verify` menjalankan tiga hal: typecheck, lint, lalu seluruh test.
Ketiganya harus hijau sebelum image dibangun.

## Setelah akun GitHub tidak locked lagi

Cukup:

```bash
git push origin main
```

GitHub Actions otomatis build & push image ke GHCR (lihat tab **Actions** di repo untuk memantau). Langkah build/push manual dari laptop di atas tidak diperlukan lagi. Bagian **Deploy ke VPS** tetap sama — masih manual (`docker compose pull && docker compose up -d`), karena workflow ini sengaja tidak auto-SSH ke VPS.

## Variabel build-time (`NEXT_PUBLIC_*`)

Next.js meng-inline nilai `NEXT_PUBLIC_*` ke bundle client saat `next build`, jadi nilainya harus dikirim sebagai build arg — baik manual (`--build-arg`) maupun lewat CI (GitHub repository variables). Kalau salah satu prefix `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_AUTH_OTP_ENABLED` / `NEXT_PUBLIC_BASE_URL` / `NEXT_PUBLIC_REQUIRE_LOGIN_TO_PURCHASE` berubah nilainya, image harus di-build ulang (bukan cukup ganti `.env` di VPS).

Semua variabel lain (`DATABASE_URL`, kredensial SMTP, session secret, dll.) tetap di file `.env` di VPS dan dibaca saat runtime lewat `env_file: .env` di `docker-compose.yml` — tidak pernah masuk ke proses build maupun ke GitHub.

Lokasi setting untuk CI: repo GitHub → Settings → Secrets and variables → Actions → tab **Variables**.

## Rollback

Image di-tag dua kali saat build CI: `latest` dan `<git-sha>`. Untuk rollback ke versi sebelumnya:

1. Cari sha commit versi yang mau dipakai (`git log --oneline`)
2. Di VPS, edit `docker-compose.yml`, ganti tag image dari `:latest` ke `:<git-sha>`
3. `docker compose pull && docker compose up -d`

(Build manual dari laptop di atas cuma nge-tag `:latest`, jadi rollback berbasis sha baru berfungsi penuh setelah CI otomatis kembali jalan.)

## Troubleshooting

**`apk add` di dalam `docker build` macet lama / timeout.**
Container Docker tidak bisa reach mirror paket Alpine (`dl-cdn.alpinelinux.org`), meskipun host bisa akses internet normal. Penyebab paling umum: **VPN aktif** menyebabkan masalah MTU di Docker bridge network (koneksi TCP kebentuk tapi transfer data macet). Matikan VPN sementara saat build, atau build dari mesin/waktu yang tidak sedang connect VPN.

**Muncul banyak `prisma:error ... Environment variable not found: DATABASE_URL` saat `npm run build`.**
Ini normal dan **tidak membatalkan build** — beberapa halaman mencoba fetch data (mis. site branding) saat proses static generation, dan `DATABASE_URL` memang sengaja tidak di-set saat build. Next.js menangkap error ini dan tetap lanjut. Build dianggap sukses selama di akhir log muncul `Successfully built ...` dan `Successfully tagged ...`.

**GitHub Actions gagal instan (job selesai dalam hitungan detik, 0 steps, tanpa runner).**
Dua kemungkinan:
1. Repo Settings → Actions → General → **Workflow permissions** di-set ke "Read repository contents permission" (bukan "Read and write"), sehingga `permissions: packages: write` di workflow ditolak.
2. Akun GitHub locked karena billing — cek `https://github.com/settings/billing`. Kalau halaman itu terlihat normal tapi GitHub tetap menolak, laporkan ke `https://github.com/support` (issue administratif di sisi GitHub, bukan masalah konfigurasi repo).
