# Security Audit & Vulnerability Scanning

## Tujuan

Lakukan audit keamanan menyeluruh terhadap project ini yang menggunakan:

- Next.js
- React
- TypeScript / JavaScript
- MySQL

Tugas utama adalah menemukan, menganalisis, dan mendokumentasikan potensi kerentanan keamanan pada seluruh project.

> **PENTING:** Audit ini bersifat read-only. Jangan mengubah source code, configuration, database, dependency, atau file project apa pun.

---

## 1. ATURAN UTAMA

Ikuti seluruh aturan berikut selama melakukan audit:

1. Jangan mengubah source code.
2. Jangan membuat file baru di dalam project.
3. Jangan menghapus file.
4. Jangan melakukan refactor.
5. Jangan memperbaiki vulnerability secara otomatis.
6. Jangan melakukan upgrade atau downgrade dependency.
7. Jangan mengubah database.
8. Jangan menjalankan query yang dapat mengubah data production.
9. Jangan melakukan tindakan destruktif.
10. Jangan melakukan deployment.
11. Jangan melakukan commit atau push Git.
12. Jangan mencetak secret atau credential secara lengkap.
13. Jangan menganggap suatu fitur aman hanya karena menggunakan framework.
14. Analisis implementasi aktual, bukan hanya berdasarkan asumsi.
15. Jika menemukan vulnerability, hanya dokumentasikan dan berikan rekomendasi perbaikan.
16. Jangan mengklaim suatu area aman jika area tersebut belum benar-benar diperiksa.
17. Jika membutuhkan environment variable untuk memahami suatu flow, periksa nama dan penggunaannya tanpa menampilkan nilainya.
18. Jangan melakukan penetration testing agresif terhadap layanan eksternal.
19. Jangan mengirim request berbahaya ke sistem eksternal.
20. Audit harus dilakukan secara aman dan non-destruktif.

---

## 2. PEMAHAMAN PROJECT

Sebelum melakukan audit, pahami terlebih dahulu struktur dan arsitektur project.

Identifikasi:

- Versi Next.js
- Versi React
- Versi Node.js
- TypeScript atau JavaScript
- Package manager
- ORM yang digunakan
- Database driver
- Arsitektur routing
- App Router atau Pages Router
- API Routes
- Route Handlers
- Server Actions
- Middleware
- Server Components
- Client Components
- Sistem authentication
- Sistem authorization
- Sistem role/permission
- Struktur database
- Integrasi API eksternal
- Webhook
- Upload file
- Payment
- Background jobs
- Cron jobs
- Email
- Storage
- Docker
- CI/CD

Cari dan pahami file seperti:

```text
package.json
package-lock.json
pnpm-lock.yaml
yarn.lock

next.config.*
middleware.*
tsconfig.json

.env
.env.*
.gitignore

Dockerfile
docker-compose.*

src/
app/
pages/
components/
lib/
server/
services/
api/
middleware/
```

Tidak semua file di atas harus tersedia.

Jangan membuat asumsi jika struktur project berbeda.

---

## 3. PROJECT RECONNAISSANCE

Buat pemetaan singkat terhadap project sebelum melakukan security scanning.

Identifikasi:

**Frontend**

- Halaman publik
- Halaman authenticated
- Dashboard
- Admin dashboard
- Form
- Upload
- Client-side API calls

**Backend**

- API endpoint
- Server Actions
- Route Handler
- Server-side services
- Database access
- External API integration

**Authentication**

- Login
- Register
- Logout
- Session
- JWT
- Refresh token
- Password reset
- Email verification

**Authorization**

- Role
- Permission
- Ownership
- Admin access
- Resource access

**Data**

Identifikasi data sensitif seperti:

- Password
- Email
- Nomor telepon
- Alamat
- Token
- API key
- Payment data
- Transaction data
- User data
- Session data

---

## 4. SECRET & CREDENTIAL SCANNING

Lakukan scanning terhadap seluruh project untuk menemukan secret yang tidak sengaja terekspos.

Cari:

- API key
- Access token
- JWT secret
- Database username
- Database password
- SMTP password
- OAuth secret
- Encryption key
- Payment credential
- Webhook secret
- Cloud credential
- Private key
- Hardcoded password

Periksa:

- `.env`
- `.env.local`
- `.env.production`
- `.env.development`
- `.env.example`
- `Dockerfile`
- `docker-compose.*`
- GitHub/GitLab CI
- Source code
- Scripts
- Configuration
- Documentation

Perhatikan penggunaan `NEXT_PUBLIC_*`.

Pastikan secret server-side tidak menggunakan prefix `NEXT_PUBLIC_`.

### Aturan Penting

Jika menemukan secret:

- Jangan tampilkan nilai secret.
- Jangan menyalin secret ke laporan.
- Jangan mengirim secret ke tool eksternal.
- Jangan menganggap `.env` aman hanya karena masuk `.gitignore`.

Gunakan format:

```text
[CRITICAL] Secret Terpapar

Lokasi:
path/to/file.ts:123

Jenis:
API Key

Risiko:
Credential dapat terekspos melalui source code atau repository.

Rekomendasi:
Rotate credential dan pindahkan secret ke environment variable atau secret manager.
```

---

## 5. GIT & SOURCE CONTROL SECURITY

Periksa apakah file sensitif pernah atau sedang berada di repository.

Periksa:

- `.gitignore`
- `.git/`
- `.env`
- `.env.local`
- `.env.production`
- `*.pem`
- `*.key`
- `*.crt`
- `credentials.*`
- `service-account.*`

Periksa juga kemungkinan secret berada pada:

- Git history
- Commit sebelumnya
- Configuration lama
- File backup
- File temporary

Jika menemukan credential yang pernah masuk Git history:

- Jangan menampilkan nilainya.
- Laporkan lokasi/commit jika dapat diketahui.
- Rekomendasikan credential rotation.

---

## 6. AUTHENTICATION SECURITY

Audit seluruh sistem authentication.

Periksa:

- Login
- Register
- Logout
- Session
- JWT
- Refresh token
- Password reset
- Email verification
- Remember me
- Session expiration
- Session invalidation

Cari kemungkinan:

- Authentication bypass
- Weak password policy
- Password disimpan plaintext
- Password hashing yang lemah
- Session fixation
- Session hijacking
- Token yang tidak expired
- Refresh token tidak dirotasi
- JWT secret lemah
- JWT algorithm misuse
- Token dapat digunakan ulang
- Password reset token dapat ditebak
- Password reset token dapat digunakan ulang
- Account enumeration
- Brute-force attack
- Tidak ada rate limiting

---

## 7. SESSION & COOKIE SECURITY

Audit seluruh cookie dan session.

Periksa apakah cookie sensitif menggunakan:

- `HttpOnly`
- `Secure`
- `SameSite`

Analisis:

- Session expiration
- Session invalidation saat logout
- Session rotation
- Cookie scope
- Domain
- Path
- SameSite policy
- Secure flag
- HttpOnly flag

Pastikan token authentication tidak disimpan secara tidak aman.

Periksa penggunaan:

- `localStorage`
- `sessionStorage`
- `document.cookie`

Berikan perhatian khusus jika access token disimpan di `localStorage`, dan analisis risiko XSS terhadap token tersebut.

---

## 8. AUTHORIZATION & ACCESS CONTROL

Lakukan audit menyeluruh terhadap authorization.

Cari:

- IDOR
- BOLA
- Broken Access Control
- Privilege Escalation
- Horizontal Privilege Escalation
- Vertical Privilege Escalation
- Role bypass
- Permission bypass
- Admin endpoint yang dapat diakses user biasa
- User dapat mengakses resource user lain

Untuk setiap endpoint sensitif, jawab:

- Apakah membutuhkan authentication?
- Siapa yang boleh mengakses?
- Apakah role diperiksa?
- Apakah permission diperiksa?
- Apakah ownership diperiksa?
- Apakah ID dapat dimanipulasi?
- Apakah user dapat mengakses data milik user lain?

Contoh pola yang harus diperiksa:

```text
/api/users/:id
/api/orders/:id
/api/transactions/:id
/api/payments/:id
/api/files/:id
/api/accounts/:id
/api/admin/*
```

---

## 9. IDOR / BOLA

Lakukan pemeriksaan khusus terhadap resource berdasarkan ID.

Contoh:

```text
GET /api/orders/123
GET /api/orders/124
```

Pastikan aplikasi tidak hanya memeriksa bahwa user sudah login, tetapi juga bahwa user memiliki akses terhadap order tersebut.

Cari pola seperti:

```ts
findUnique({
  where: {
    id
  }
})
```

dan pastikan terdapat ownership atau authorization check jika diperlukan.

Contoh risiko:

```text
User A:
GET /api/invoices/100

User A mengubah ID:
GET /api/invoices/101

Invoice 101 ternyata milik User B.
```

Jika memungkinkan, klasifikasikan sebagai IDOR/BOLA.

---

## 10. INPUT VALIDATION

Audit seluruh input dari user.

Periksa:

- Request body
- Query parameter
- Path parameter
- Headers
- Cookies
- Form
- Search
- Filter
- Sort
- Pagination
- File upload

Pastikan validasi dilakukan server-side.

Jangan menganggap validasi frontend sebagai security control.

Cari:

- Input tidak divalidasi
- Type confusion
- Missing length limit
- Missing numeric limit
- Invalid enum
- Unexpected field
- Mass assignment
- Parameter tampering

Periksa penggunaan library seperti:

- Zod
- Yup
- Joi
- Valibot
- class-validator

Jika tidak menggunakan validation library, analisis validasi manual.

---

## 11. SQL INJECTION

Karena project menggunakan MySQL, lakukan audit khusus SQL Injection.

Cari:

- Raw SQL
- String concatenation
- Template literal untuk SQL
- Dynamic query
- Dynamic WHERE
- Dynamic ORDER BY
- Dynamic LIMIT
- User-controlled table/column
- Query yang menerima input langsung dari user

Contoh pola berbahaya:

```js
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

atau:

```js
const query = "SELECT * FROM users WHERE id = " + id;
```

Pastikan penggunaan:

- Prisma
- Drizzle
- mysql2
- Sequelize
- TypeORM
- Query Builder

tidak digunakan dengan cara yang tetap memungkinkan injection.

---

## 12. ORM SECURITY

Jika menggunakan ORM seperti Prisma atau Drizzle, audit:

- Raw query
- `$queryRaw`
- `$queryRawUnsafe`
- Dynamic SQL
- User-controlled query
- Dynamic filtering
- Dynamic sorting

Berikan perhatian khusus terhadap `$queryRawUnsafe` dan penggunaan raw SQL lainnya.

Jika raw query ditemukan, periksa apakah parameterized query digunakan dengan benar.

---

## 13. XSS

Audit:

- **Reflected XSS** — input user langsung ditampilkan kembali.
- **Stored XSS** — input user disimpan ke database kemudian ditampilkan.
- **DOM XSS** — input user diproses oleh browser secara tidak aman.

Khusus React/Next.js, cari `dangerouslySetInnerHTML`.

Periksa juga:

- HTML editor
- Markdown renderer
- Rich text editor
- User-generated content
- URL rendering
- iframe
- SVG
- HTML sanitization

Pastikan sanitization dilakukan jika memang dibutuhkan.

---

## 14. NEXT.JS SECURITY

Karena project menggunakan Next.js, lakukan audit khusus terhadap area berikut.

### App Router

Periksa:

- `app/`
- `page.tsx`
- `layout.tsx`
- `route.ts`
- server actions
- middleware
- `loading.tsx`
- `error.tsx`

### Pages Router

Jika digunakan:

- `pages/`
- `pages/api/`

### Server Actions

Audit:

- Authentication
- Authorization
- Input validation
- CSRF considerations
- Mass assignment
- Sensitive operations

Jangan menganggap Server Action otomatis aman hanya karena dijalankan di server.

### Route Handlers

Periksa `app/api/**/route.ts`.

Untuk setiap route:

- Authentication
- Authorization
- Validation
- Rate limiting
- Error handling
- Data exposure

---

## 15. NEXT_PUBLIC ENVIRONMENT VARIABLES

Audit seluruh penggunaan `NEXT_PUBLIC_*`.

Pastikan tidak ada:

- Database password
- API secret
- JWT secret
- Private API key
- Encryption key
- Payment secret
- Internal credential

yang diekspos melalui environment variable public.

Ingat: `NEXT_PUBLIC_*` dapat masuk ke client bundle.

---

## 16. SERVER-SIDE DATA EXPOSURE

Audit data yang dikirim dari server ke client.

Cari kemungkinan:

- Password hash
- Internal ID
- API key
- Secret
- Database information
- Internal configuration
- Sensitive user data
- Admin-only data

Contoh risiko:

```ts
return NextResponse.json(user);
```

Jika object user memiliki field sensitif, data tersebut dapat ikut dikirim ke client.

Pastikan response hanya mengandung field yang diperlukan.

---

## 17. API SECURITY

Buat inventory seluruh endpoint.

Gunakan format:

| Method | Endpoint | Authentication | Authorization | Input Validation | Risiko |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/users` | Ya | Admin | Ya | - |
| GET | `/api/users/:id` | Ya | Owner | Ya | - |
| POST | `/api/orders` | Ya | User | Ya | - |

Audit:

- Authentication
- Authorization
- Input validation
- Rate limiting
- Pagination
- Response filtering
- Error handling
- CORS
- HTTP method
- Resource ownership
- Mass assignment

---

## 18. MASS ASSIGNMENT

Cari penggunaan object input secara langsung ke database.

Contoh berisiko:

```ts
await prisma.user.update({
  where: { id },
  data: req.body
});
```

Jika `req.body` dapat berisi:

- `role`
- `isAdmin`
- `balance`
- `verified`
- `permissions`

maka user dapat memodifikasi field yang seharusnya tidak boleh diubah.

Pastikan hanya field yang diperbolehkan yang diterima.

---

## 19. SSRF

Cari fitur yang menerima URL dari user.

Contoh:

- Image import
- URL preview
- Webhook
- External API proxy
- URL scraping
- Fetch URL
- Import data dari URL

Periksa apakah user dapat membuat server melakukan request ke:

```text
localhost
127.0.0.1
0.0.0.0
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.169.254
```

Periksa juga redirect-based SSRF.

---

## 20. FILE UPLOAD SECURITY

Jika project memiliki upload file, audit:

- Extension validation
- MIME validation
- File size
- Filename sanitization
- Path traversal
- Executable file
- SVG
- HTML
- JavaScript
- ZIP
- Archive
- Image processing
- Storage
- Public accessibility

Cari kemungkinan file berbahaya dapat di-upload, seperti:

- `.php`
- `.js`
- `.html`
- `.svg`
- `.exe`
- `.sh`

Periksa apakah file disimpan di `public/` dan apakah file dapat dieksekusi atau diakses secara langsung.

---

## 21. PATH TRAVERSAL

Cari penggunaan input user untuk filesystem.

Contoh:

- `readFile()`
- `writeFile()`
- `unlink()`
- `createReadStream()`
- `path.join()`

Periksa apakah user dapat memasukkan `../`, `..\`, atau absolute path.

Cari kemungkinan:

- Arbitrary file read
- Arbitrary file write
- Arbitrary file deletion

---

## 22. COMMAND INJECTION

Cari penggunaan:

- `child_process`
- `exec`
- `execSync`
- `spawn`
- `spawnSync`
- `shell`

Periksa apakah input user masuk ke command.

Contoh berbahaya:

```js
exec(`command ${userInput}`);
```

Jika ditemukan, klasifikasikan berdasarkan exploitability dan impact.

---

## 23. OPEN REDIRECT

Audit:

- `redirect`
- `NextResponse.redirect`
- `router.push`
- `router.replace`

Periksa apakah URL tujuan dikontrol user.

Contoh:

```text
/login?redirect=https://malicious-site.com
```

Pastikan redirect eksternal tidak dapat digunakan untuk phishing atau abuse.

---

## 24. CSRF

Analisis apakah aplikasi menggunakan:

- Cookie-based authentication
- Session authentication
- JWT
- SameSite cookies
- CSRF token

Untuk seluruh operasi state-changing (`POST`, `PUT`, `PATCH`, `DELETE`), periksa apakah request dapat dipalsukan dari website lain.

Berikan perhatian khusus terhadap:

- Change password
- Change email
- Payment
- Transfer
- Delete account
- Admin operation
- Update profile

---

## 25. CORS

Audit konfigurasi CORS.

Cari:

- `Access-Control-Allow-Origin`
- `cors`
- `CORS`

Periksa konfigurasi seperti `*` atau origin yang terlalu luas.

Pastikan credentialed request tidak dikombinasikan dengan origin yang tidak terpercaya.

---

## 26. RATE LIMITING

Identifikasi endpoint yang membutuhkan rate limiting.

Prioritaskan:

- Login
- Register
- Password reset
- OTP
- Email verification
- Search
- API
- File upload
- Payment
- Webhook
- Admin endpoint

Periksa apakah rate limiting diterapkan.

Jika tidak ada, dokumentasikan sebagai security weakness dengan severity berdasarkan risiko aktual.

---

## 27. BRUTE FORCE

Audit:

- Login
- OTP
- Password reset
- Verification code
- API key
- Admin authentication

Periksa:

- Rate limit
- Account lockout
- Progressive delay
- CAPTCHA
- Monitoring
- IP-based protection

---

## 28. PAYMENT SECURITY

Jika project memiliki payment atau transaksi keuangan, lakukan audit khusus.

Periksa:

- Manipulasi amount
- Manipulasi price
- Manipulasi transaction ID
- Callback spoofing
- Webhook spoofing
- Replay attack
- Double payment
- Race condition
- Refund manipulation
- Balance manipulation
- Status manipulation
- Currency manipulation

Jangan percaya nilai dari client untuk:

- `amount`
- `price`
- `status`
- `role`
- `user_id`
- `ownership`
- `balance`

Trace flow:

```text
Client
  ↓
Next.js
  ↓
Database
  ↓
Payment Provider
  ↓
Webhook / Callback
  ↓
Database
  ↓
Order / Balance
```

Pastikan setiap tahap melakukan validasi yang diperlukan.

---

## 29. WEBHOOK SECURITY

Jika terdapat webhook, audit:

- Signature verification
- HMAC
- Secret validation
- Timestamp
- Replay protection
- Idempotency
- Duplicate request
- Transaction verification
- Amount verification
- Order verification

Jangan hanya mempercayai `status=success` dari request webhook tanpa melakukan validasi yang sesuai.

---

## 30. RACE CONDITION

Cari operasi Read → Check → Update yang dilakukan tanpa transaction atau locking yang tepat.

Berikan perhatian khusus pada:

- Payment
- Balance
- Inventory
- Voucher
- Coupon
- License
- Subscription
- Withdrawal
- Deposit
- Order

Contoh:

```text
User memiliki balance Rp100.000

Request A membaca balance Rp100.000
Request B membaca balance Rp100.000

Request A melakukan withdrawal Rp100.000
Request B melakukan withdrawal Rp100.000

Jika keduanya berhasil:
Balance dapat menjadi tidak konsisten.
```

Periksa penggunaan:

- Database transaction
- Row locking
- Atomic update
- Unique constraint
- Idempotency key

---

## 31. DATABASE SECURITY

Audit MySQL.

Periksa:

- SQL Injection
- Database credential exposure
- Password storage
- Sensitive data
- Encryption
- Hashing
- Foreign key
- Unique constraint
- Data integrity
- Excessive database privilege

Cari apakah aplikasi menggunakan database account dengan privilege berlebihan.

---

## 32. PASSWORD SECURITY

Periksa:

- Password hashing
- Salt
- Hash algorithm
- Password reset
- Password change
- Password validation

Pastikan password tidak disimpan menggunakan:

- MD5
- SHA1
- SHA256
- plaintext

untuk password authentication.

Cari penggunaan:

- bcrypt
- argon2
- scrypt

atau mekanisme password hashing modern lainnya.

---

## 33. SENSITIVE DATA EXPOSURE

Identifikasi apakah data sensitif muncul di:

- API response
- Logs
- Error message
- Browser
- LocalStorage
- SessionStorage
- URL
- Query parameter
- HTML
- JavaScript bundle
- Source map

Perhatikan:

- `password`
- `token`
- `secret`
- `apiKey`
- `privateKey`
- `authorization`
- `cookie`

---

## 34. ERROR HANDLING

Audit error handling.

Cari:

- `console.log`
- `console.error`
- `throw new Error()`
- stack trace
- database error

Pastikan production tidak membocorkan:

- Stack trace
- File path
- SQL query
- Database credential
- Internal IP
- Environment variable
- Framework information
- Internal service URL

---

## 35. NEXT.JS PRODUCTION CONFIGURATION

Periksa:

- `next.config.js`
- `next.config.mjs`
- `next.config.ts`

Audit:

- Security headers
- CSP
- Image configuration
- Remote patterns
- Redirects
- Rewrites
- CORS
- Source maps
- Server configuration

Cari konfigurasi yang dapat meningkatkan attack surface.

---

## 36. SECURITY HEADERS

Periksa apakah aplikasi memiliki security headers yang relevan:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options`

Jangan hanya melaporkan header yang tidak ada.

Pertimbangkan apakah header tersebut memang relevan terhadap arsitektur aplikasi.

---

## 37. DEPENDENCY SECURITY

Periksa dependency project.

Gunakan audit bawaan package manager jika tersedia, contoh:

```bash
npm audit
# atau
pnpm audit
# atau
yarn audit
```

Jangan melakukan `npm audit fix` atau upgrade dependency otomatis.

Audit:

- Known CVE
- Outdated dependency
- Deprecated dependency
- Abandoned package
- Suspicious package
- Dependency confusion
- Typosquatting
- Unsafe install script

Jika terdapat vulnerability dependency, dokumentasikan:

- Package
- Version
- Vulnerability
- Severity
- Affected functionality
- Recommended upgrade path

---

## 38. NPM / PACKAGE SECURITY

Periksa:

- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`
- `yarn.lock`

Cari:

- Dependency tidak digunakan
- Dependency mencurigakan
- Postinstall script
- Preinstall script
- Package dengan native execution
- Package yang memiliki akses sensitif

---

## 39. DOCKER SECURITY

Jika project menggunakan Docker, audit:

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.yaml`

Periksa:

- Container berjalan sebagai root
- Privileged container
- Host networking
- Host filesystem mount
- Exposed port
- Hardcoded credential
- Secret dalam image
- `latest` tag
- Base image yang tidak jelas
- Unnecessary packages
- Unnecessary capabilities

Cari konfigurasi seperti `privileged: true` atau `network_mode: host`, dan nilai risiko berdasarkan konteksnya.

---

## 40. CI/CD SECURITY

Jika menggunakan GitHub Actions / GitLab CI / pipeline lainnya, audit:

- Secret exposure
- Hardcoded credential
- Token permission
- Pull request security
- Dependency installation
- Build script
- Deployment credential
- Environment variable
- Artifact exposure

Perhatikan workflow yang menjalankan code dari Pull Request dengan permission tinggi.

---

## 41. LOGGING & AUDIT TRAIL

Identifikasi apakah security-sensitive action dicatat.

Contoh:

- Login
- Failed login
- Logout
- Password reset
- Password change
- Role change
- Permission change
- Admin action
- Payment
- Refund
- License activation
- Account deletion

Pastikan log tidak mengandung:

- Password
- Token
- API key
- Secret
- Sensitive personal data

---

## 42. BUSINESS LOGIC SECURITY

Jangan hanya mencari vulnerability teknis. Analisis juga business logic.

Cari kemungkinan:

- Negative amount
- Negative quantity
- Duplicate transaction
- Duplicate redemption
- Coupon abuse
- Voucher abuse
- Trial abuse
- Subscription bypass
- License bypass
- Payment bypass
- Status manipulation
- Workflow bypass
- Race condition

Pertanyaan utama:

> Apakah user yang sudah legitimate dapat menyalahgunakan fitur aplikasi tanpa perlu membobol authentication atau sistem secara teknis?

---

## 43. ADMIN SECURITY

Cari seluruh fitur admin.

Periksa:

- `/admin`
- `/dashboard/admin`
- `/api/admin`

atau pola lainnya.

Pastikan:

- Admin endpoint membutuhkan authentication
- Role admin diverifikasi server-side
- Permission diperiksa
- Tidak hanya mengandalkan hidden UI
- API admin tidak dapat dipanggil user biasa

Jangan menganggap "tombol admin tidak ditampilkan" sebagai security control.

---

## 44. TENANT / USER DATA ISOLATION

Jika aplikasi memiliki konsep tenant, organization, school, company, account, atau user ownership, audit isolation secara khusus.

Pastikan user dari Tenant A tidak dapat mengakses Tenant B melalui:

- ID manipulation
- API parameter
- Query parameter
- URL
- Header
- Cookie
- Request body

Periksa apakah setiap query memiliki tenant/ownership restriction yang benar.

---

## 45. SECURITY FLOW ANALYSIS

Untuk fitur penting, lakukan tracing end-to-end.

Minimal audit:

### Authentication Flow

```text
Login
  ↓
Validation
  ↓
Database
  ↓
Session/Token
  ↓
Cookie
  ↓
Authenticated Request
  ↓
Logout
```

### Authorization Flow

```text
Request
  ↓
Authentication
  ↓
User
  ↓
Role
  ↓
Permission
  ↓
Ownership
  ↓
Resource
```

### Payment Flow

```text
Client
  ↓
API
  ↓
Validation
  ↓
Database
  ↓
Payment Provider
  ↓
Webhook
  ↓
Verification
  ↓
Transaction
  ↓
Final State
```

### File Upload Flow

```text
Client
  ↓
Upload API
  ↓
Validation
  ↓
Storage
  ↓
Public/Private Access
```

---

## 46. OWASP TOP 10

Petakan temuan terhadap OWASP Top 10 yang relevan:

- Broken Access Control
- Cryptographic Failures
- Injection
- Insecure Design
- Security Misconfiguration
- Vulnerable and Outdated Components
- Identification and Authentication Failures
- Software and Data Integrity Failures
- Security Logging and Monitoring Failures
- Mishandling of Exceptional Conditions

Jika suatu kategori tidak memiliki temuan, tetap catat bahwa kategori tersebut telah diperiksa.

---

## 47. OWASP API SECURITY

Untuk API, periksa kategori yang relevan dari OWASP API Security:

- Broken Object Level Authorization
- Broken Authentication
- Broken Object Property Level Authorization
- Unrestricted Resource Consumption
- Broken Function Level Authorization
- Unrestricted Access to Sensitive Business Flows
- Server Side Request Forgery
- Security Misconfiguration
- Improper Inventory Management
- Unsafe Consumption of APIs

---

## 48. SEVERITY CLASSIFICATION

Gunakan klasifikasi berikut.

### CRITICAL

Contoh:

- Remote Code Execution
- Authentication bypass total
- Arbitrary database compromise
- Credential compromise besar
- Unrestricted financial manipulation

### HIGH

Contoh:

- IDOR dengan data sensitif
- Privilege escalation
- Admin bypass
- SQL Injection
- SSRF yang signifikan
- Payment manipulation
- Sensitive credential exposure

### MEDIUM

Contoh:

- Limited data exposure
- Missing rate limiting
- CSRF pada fungsi tertentu
- Security misconfiguration dengan exploitability terbatas

### LOW

Contoh:

- Minor information disclosure
- Missing hardening
- Weak security configuration dengan impact rendah

### INFO

Security improvement yang tidak secara langsung merupakan vulnerability.

---

## 49. JANGAN MENGGELEMBUNGKAN SEVERITY

Severity harus ditentukan berdasarkan:

```text
Exploitability
+
Impact
+
Required Privilege
+
Required User Interaction
+
Attack Complexity
```

Jangan memberikan CRITICAL hanya karena "secara teori bisa berbahaya". Harus ada alasan teknis yang jelas.

---

## 50. FORMAT TEMUAN

Setiap vulnerability harus menggunakan format berikut:

```text
SEC-001 — [SEVERITY] Judul Vulnerability

Lokasi
path/to/file.ts:123

Kategori
OWASP:
CWE:

Deskripsi
Jelaskan vulnerability secara jelas.

Root Cause
Jelaskan mengapa vulnerability tersebut terjadi.

Dampak
Jelaskan apa yang dapat dilakukan attacker.

Skenario Serangan
Berikan contoh realistic attack scenario.

Evidence
Tunjukkan bagian implementasi yang relevan.

Rekomendasi
Berikan rekomendasi perbaikan.

Cara Verifikasi
Jelaskan bagaimana developer dapat memastikan vulnerability sudah diperbaiki.
```

Pada bagian Evidence, jangan menampilkan:

- Password
- Token
- API key
- Secret
- Private key

---

## 51. CONTOH FORMAT TEMUAN

### SEC-001 — [HIGH] IDOR pada Endpoint Invoice

**Lokasi**

`app/api/invoices/[id]/route.ts:42`

**Kategori**

- OWASP: A01 - Broken Access Control
- CWE: CWE-639 - Authorization Bypass Through User-Controlled Key

**Deskripsi**

Endpoint mengambil invoice berdasarkan ID dari URL tanpa melakukan verifikasi bahwa invoice tersebut dimiliki oleh user yang sedang login.

**Dampak**

User yang sudah login dapat mencoba ID invoice lain dan berpotensi membaca invoice milik user lain.

**Skenario Serangan**

User A memiliki:

```text
GET /api/invoices/100
```

Kemudian user A mencoba:

```text
GET /api/invoices/101
```

Jika invoice 101 milik user B dan tetap dikembalikan, maka terjadi broken object-level authorization.

**Evidence**

Implementasi hanya melakukan pencarian berdasarkan ID tanpa ownership check.

**Rekomendasi**

Tambahkan authorization dan ownership verification sebelum mengembalikan resource.

**Cara Verifikasi**

Pastikan user A tidak dapat membaca invoice milik user B meskipun mengetahui ID resource tersebut.

---

## 52. FINAL SECURITY REPORT

Setelah seluruh audit selesai, hasil akhir harus memiliki struktur berikut.

### 1. Executive Summary

Berikan ringkasan:

- Area yang diperiksa
- Temuan utama
- Area dengan risiko terbesar
- Security control yang sudah diterapkan

Jangan memberikan "security score" jika tidak ada metodologi scoring yang jelas.

### 2. Project Overview

```text
Framework:
Next.js

Database:
MySQL

Runtime:
...

Authentication:
...

Authorization:
...

ORM:
...

Architecture:
...
```

### 3. Attack Surface

Buat daftar:

- Public pages
- Authenticated pages
- Admin pages
- API endpoints
- Server Actions
- File upload
- Webhook
- Payment
- External integrations
- Database
- Background jobs

### 4. Findings Summary

Gunakan tabel:

| ID | Severity | Kategori | Lokasi | Ringkasan |
| --- | --- | --- | --- | --- |
| SEC-001 | CRITICAL | ... | ... | ... |
| SEC-002 | HIGH | ... | ... | ... |
| SEC-003 | MEDIUM | ... | ... | ... |
| SEC-004 | LOW | ... | ... | ... |

### 5. Detailed Findings

Masukkan seluruh vulnerability menggunakan format `SEC-001`, `SEC-002`, `SEC-003`, dan seterusnya.

### 6. Security Strengths

Catat security control yang benar-benar ditemukan.

Contoh:

- Password menggunakan Argon2
- API menggunakan server-side validation
- Authorization menggunakan middleware
- Database menggunakan parameterized query
- Sensitive cookie menggunakan HttpOnly
- Webhook menggunakan signature verification

Jangan menulis security strength jika belum diverifikasi.

### 7. Security Weaknesses

Ringkas area yang masih membutuhkan peningkatan.

### 8. Recommended Remediation

Kelompokkan:

- **Immediate** — Critical dan High.
- **Short Term** — Medium.
- **Hardening** — Low dan Informational.

Jangan melakukan perbaikan otomatis.

### 9. Files Reviewed

Catat file/directory penting yang benar-benar diperiksa.

Contoh:

```text
app/
lib/
middleware.ts
next.config.ts
package.json
prisma/
...
```

### 10. Areas Not Verified

Catat area yang tidak dapat diverifikasi.

Contoh:

- Production environment tidak tersedia
- External payment provider tidak dapat diuji
- Environment variable production tidak tersedia
- Database production tidak dapat diakses

Jangan menyimpulkan area tersebut aman.

---

## 53. FINAL VERIFICATION PASS

Sebelum membuat laporan final, lakukan satu kali pemeriksaan terakhir khusus untuk:

- Authentication bypass
- Authorization bypass
- IDOR / BOLA
- SQL Injection
- XSS
- SSRF
- Command Injection
- Path Traversal
- Arbitrary File Upload
- Secret Exposure
- Payment Manipulation
- Webhook Spoofing
- Replay Attack
- Race Condition
- Mass Assignment
- Sensitive Data Exposure
- Dependency Vulnerability
- Security Misconfiguration
- Missing Rate Limiting
- Tenant Isolation

Pastikan tidak ada area penting yang terlewat.

---

## 54. HASIL YANG DIHARAPKAN

Output akhir harus berupa:

- Ringkasan project
- Attack surface
- Daftar vulnerability
- Severity setiap vulnerability
- Lokasi vulnerability
- Root cause
- Dampak
- Skenario serangan
- Evidence
- Rekomendasi perbaikan
- Cara verifikasi
- Security strengths
- Security weaknesses
- Remediation priority
- Area yang belum dapat diverifikasi

---

## 55. ATURAN TERAKHIR

**JANGAN MEMPERBAIKI CODE.**

Tugasmu hanya:

```text
SCAN
  ↓
ANALYZE
  ↓
VERIFY
  ↓
DOCUMENT
  ↓
RECOMMEND
```

Jangan melakukan:

```text
SCAN
  ↓
FIX
  ↓
REFACTOR
  ↓
COMMIT
```

Jika menemukan vulnerability, berhenti pada tahap rekomendasi.

Perubahan kode hanya boleh dilakukan setelah mendapatkan instruksi eksplisit dari developer.
