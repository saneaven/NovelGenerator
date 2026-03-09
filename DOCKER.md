# Docker

## Files

- `docker-compose.yml` (base)
- `docker-compose.dev.yml` (dev: autoreload + bind mounts)
- `docker-compose.prod.yml` (prod: no autoreload)
- `docker/Caddyfile.dev` (dev HTTPS with `tls internal` + on-demand certs, e.g. `novelbuds.localhost` / `<desktop-ip>.sslip.io`)
- `docker/Caddyfile.prod` (`https://{$APP_DOMAIN}` via Let's Encrypt)

## Dev (local)

1. Create env file:
   - Copy `.env.dev.example` -> `.env.dev`
   - Fill `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`
   - Configure S3 if you need image upload / generation locally

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

1. Create env file on the VPS:
   - Copy `.env.prod.example` -> `.env.prod`
   - Fill `APP_DOMAIN`, secrets, and S3 settings with strong values

2. Start:
   - `docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

## Notes

- Backend runs `alembic upgrade head` on container start.
- Fresh installs use a single Alembic baseline migration (`0001_baseline`).
- DB image is `pgvector/pgvector:pg18` (pgvector extension is required by the baseline schema).
- For Postgres 18+, mount the DB volume at `/var/lib/postgresql` (not `/var/lib/postgresql/data`).
- Prod frontend startup runs `vite build` (skips `tsc -b`) then `vite preview` in `docker/frontend/entrypoint.sh`.
- Image assets are stored in S3 and served through `/storage/assets/*` redirects.
- Recommended production setup: Lightsail static IP + Cloudflare proxied DNS + SSL mode `Full (strict)`.
- Recommended backups: Lightsail automatic snapshots plus periodic `pg_dump` uploads to S3.
