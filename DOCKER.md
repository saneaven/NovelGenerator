# Docker

## Files

- `docker-compose.yml` (base)
- `docker-compose.dev.yml` (dev: autoreload + bind mounts)
- `docker-compose.prod.yml` (prod: no autoreload)
- `docker/Caddyfile.dev` (dev HTTPS with `tls internal` + on-demand certs, e.g. `novelbuds.localhost` / `<desktop-ip>.sslip.io`)
- `docker/Caddyfile.prod` (`https://{$APP_DOMAIN}` via Cloudflare Origin CA)

## Dev (local)

1. Create env file:
   - Copy `.env.dev.example` -> `.env.dev`
   - Fill `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`
   - Dev uses local asset storage by default; S3 is not required for image upload / generation

2. Start:
   - `docker compose --env-file .env.dev -f docker-compose.yml -f docker-compose.dev.yml up -d --build`

3. Open:
   - Same machine: `https://novelbuds.localhost`
   - LAN / mobile: `https://<desktop-ip>.sslip.io` (or `https://<desktop-ip-with-dashes>.sslip.io`)

Note: `.localhost` resolves to the *client device*, so it won't work from other devices.

### Trust the dev TLS cert (Caddy `tls internal`)

Caddy's local CA cert is stored in the `caddy_data` volume.
Inside the container it is typically at:
- `/data/caddy/pki/authorities/local/root.crt`

You can copy it out and trust it on your OS/browser.

### If Docker is running inside WSL2 (LAN access)

If your Docker engine is inside WSL2, publishing `80/443` from containers may not automatically bind to the Windows LAN IP.
Options:
- Use Docker Desktop / Windows engine (simplest for LAN access).
- Or forward Windows `80/443` to the WSL IP (e.g. `netsh interface portproxy`) and allow inbound in Windows Firewall.

## Prod (VPS)

Prereqs:
- Domain: `APP_DOMAIN` A/AAAA record points to the VPS (typically through Cloudflare DNS)
- Firewall: allow inbound `80/tcp` + `443/tcp`
- Cloudflare DNS record for `APP_DOMAIN` is `Proxied`
- Cloudflare SSL/TLS mode is `Full (strict)`

1. Create env file on the VPS:
   - Copy `.env.prod.example` -> `.env.prod`
   - Fill `APP_DOMAIN`, secrets, and S3 settings with strong values

2. Create a Cloudflare Origin CA certificate:
   - Cloudflare dashboard -> `SSL/TLS` -> `Origin Server` -> `Create Certificate`
   - Choose `PEM`
   - Include every proxied hostname served by Caddy (`APP_DOMAIN`, plus `www` if it points at the same origin)
   - Save the certificate as `docker/certs-origin/cloudflare-origin.crt`
   - Save the private key as `docker/certs-origin/cloudflare-origin.key`

3. Start:
   - `docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

4. Verify through Cloudflare:
   - `https://APP_DOMAIN/`
   - `https://APP_DOMAIN/api/...`

Note: Origin CA certificates are for Cloudflare-to-origin TLS only. Direct browser access to the origin can show a trust warning, which is expected.

## Notes

- Backend runs `alembic upgrade head` on container start.
- Fresh installs use a single Alembic baseline migration (`0001_baseline`).
- DB image is `pgvector/pgvector:pg18` (pgvector extension is required by the baseline schema).
- For Postgres 18+, mount the DB volume at `/var/lib/postgresql` (not `/var/lib/postgresql/data`).
- Prod frontend startup runs `vite build` (skips `tsc -b`) then `vite preview` in `docker/frontend/entrypoint.sh`.
- In dev, image assets are stored on the backend filesystem by default and served through `/storage/assets/*`.
- In prod, image assets are stored in S3 and served through `/storage/assets/*`.
- Recommended production setup: Lightsail static IP + Cloudflare proxied DNS + SSL mode `Full (strict)`.
- Prod Caddy expects `docker/certs-origin/cloudflare-origin.crt` and `docker/certs-origin/cloudflare-origin.key` to exist before startup.
- A Cloudflare `524` means the origin did not return an HTTP response before Cloudflare's timeout; changing to Origin CA does not by itself fix slow origin responses.
- Recommended backups: Lightsail automatic snapshots plus periodic `pg_dump` uploads to S3.
