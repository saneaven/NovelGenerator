# Docker

## Files

- `docker-compose.yml` (base)
- `docker-compose.dev.yml` (dev: autoreload + bind mounts)
- `docker-compose.prod.yml` (prod: no autoreload)
- `docker/Caddyfile.dev` (dev HTTPS with `tls internal` + on-demand certs, e.g. `novelbuds.localhost` / `<desktop-ip>.sslip.io`)
- `docker/Caddyfile.prod` (`https://novelbuds.com` via Let's Encrypt)

## Dev (local)

1. Create env file:
   - Copy `.env.dev.example` -> `.env.dev`
   - Fill `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`

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
- DNS: `novelbuds.com` A/AAAA record points to the VPS
- Firewall: allow inbound `80/tcp` + `443/tcp`

1. Create env file on the VPS:
   - Copy `.env.prod.example` -> `.env.prod`
   - Fill secrets with strong values (must remain stable)

2. Start:
   - `docker compose --env-file .env.prod -f docker-compose.yml -f docker-compose.prod.yml up -d --build`

## Notes

- Backend runs `alembic upgrade head` on container start.
- DB image is `pgvector/pgvector:pg18` (pgvector extension required by migration `058`).
- For Postgres 18+, mount the DB volume at `/var/lib/postgresql` (not `/var/lib/postgresql/data`).
- Prod frontend startup runs `vite build` (skips `tsc -b`) then `vite preview` in `docker/frontend/entrypoint.sh`.
