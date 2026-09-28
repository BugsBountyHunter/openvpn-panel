# openvpn-panel

[![CI](https://github.com/BugsBountyHunter/openvpn-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/BugsBountyHunter/openvpn-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A small, self-hosted web dashboard for OpenVPN servers installed with
[angristan/openvpn-install](https://github.com/angristan/openvpn-install).

See who is connected, add clients (the `.ovpn` downloads straight to your
browser and is never stored), revoke or disconnect them, and keep an audit
trail — without handing a web app root access.

![Clients page in demo mode](docs/screenshot-clients.png)

## Features

- **Overview** — OpenVPN up/down, uptime, connected clients, total traffic,
  certificates expiring soon.
- **Clients** — name, active/revoked, certificate expiry, online now, real IP,
  VPN IP, bytes in/out, connected since. Add (profile download), Revoke (with
  confirmation) and Disconnect. The server's own `server_*` certificate is
  hidden and cannot be touched.
- **Audit log** — who did what, when and from where: sign-in, add, revoke,
  disconnect (append-only JSON lines).
- **Single admin** login with an argon2id or bcrypt hash, rate limiting and
  CSRF protection.
- **Demo mode** with fake data for local development, screenshots and tests.
- `GET /api/health` for deploy checks.

## How it works

```
browser ──HTTP(S) over VPN──▶ Next.js panel (user: openvpn-panel, sandboxed)
                                   │                    │
               status / kill       │                    │  sudo -n (only this program)
                                   ▼                    ▼
       socat bridge ─▶ OpenVPN management socket   /usr/local/sbin/openvpn-panel-helper
       (127.0.0.1:7505 or 0600 unix socket)             │  add | revoke | list | status
                                                        ▼
                                           openvpn-install.sh client … (root)
```

- Live data comes from the OpenVPN **management interface** (`status 3`,
  `load-stats`, `state`, `kill`). It serves one client at a time, so the
  panel connects per request, serializes access and uses short timeouts.
- Certificate operations go through a tiny root-owned **helper** that accepts
  four verbs and a name matching `^[A-Za-z0-9_-]{1,32}$`. The panel never runs
  `openvpn-install.sh` itself, and never uses a shell.
- Data sources sit behind a `Backend` interface (`src/lib/types.ts`), so other
  installers can be supported by adding a backend.

## Security model

- Binds to `127.0.0.1` by default. Use the server's VPN IP (e.g. `10.8.0.1`)
  to reach it over the VPN only; never expose it publicly.
- The panel runs as an unprivileged system user in a hardened systemd unit.
  Its only privilege is `sudo` for the helper (validated with `visudo -c`).
- Profiles are streamed to the browser and deleted from disk immediately; they
  are never logged or stored by the panel.
- Sessions: HMAC-signed, `httpOnly`, `SameSite=Strict` cookie (12 h).
  Mutations require POST + matching `Origin` + JSON bodies.
- Login attempts are rate-limited per IP and globally.
- No secrets or server addresses live in the repository — everything is
  configured through environment variables.

Details and known trade-offs: [SECURITY.md](SECURITY.md).

## Requirements

- A Linux server set up with a recent
  [openvpn-install.sh](https://github.com/angristan/openvpn-install) (with the
  `client` CLI and `OUTPUT_FORMAT=json`), systemd, `sudo`, `socat`, `curl`.
- **Node.js ≥ 24.7** on the server (uses `crypto.argon2`), installed at a
  system path such as `/usr/local/bin/node` or `/usr/bin/node`. A Node from
  `nvm` in your home directory is not visible to the service (the systemd
  sandbox hides `/home`) — copy the binary or use your distro/NodeSource
  package:

  ```bash
  sudo install -m 0755 "$(command -v node)" /usr/local/bin/node
  ```

Tested on Ubuntu 24.04 with OpenVPN 2.7.7 (management interface v6), plus
recorded output from OpenVPN 2.5 and 2.6.

## Try it locally (demo mode)

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:8081 and sign in as `admin` / `demo`. Demo mode is the
default whenever `PANEL_MODE` is not `live`.

## Install on your VPN server

1. Install Node.js ≥ 24.7, then clone this repository on the server:

   ```bash
   git clone https://github.com/BugsBountyHunter/openvpn-panel.git && cd openvpn-panel
   ```

2. Run the installer (prompts for the admin password; only its hash is stored):

   ```bash
   sudo ./server/install.sh --bind 10.8.0.1
   ```

   Useful options: `--port 8081`, `--admin-user admin`,
   `--installer /root/openvpn-install.sh`, `--mgmt-bridge unix`,
   `--reset-password`, `--deploy-key "ssh-ed25519 AAAA…"`. Run with `--help`
   for all of them. It is idempotent — re-run it any time.

3. Deploy a build — either through GitHub Actions (below) or by hand:

   ```bash
   npm ci && npm run build && scripts/package-release.sh
   sudo /usr/local/sbin/openvpn-panel-deploy < release.tar.gz
   ```

4. Allow the port on the VPN interface only, e.g.
   `ufw allow in on tun0 to 10.8.0.1 port 8081 proto tcp`.

### What the installer sets up

| Path | Purpose |
| --- | --- |
| `/usr/local/sbin/openvpn-install.sh` | root-only copy of the installer |
| `/usr/local/sbin/openvpn-panel-helper` | the only command the panel may `sudo` |
| `/etc/sudoers.d/openvpn-panel` | sudo rule for the helper (and deploy script) |
| `/etc/openvpn-panel/env` | configuration, `0600 root` |
| `/var/lib/openvpn-panel/audit.log` | audit log |
| `/opt/openvpn-panel/releases/*`, `current` | deployed releases |
| `openvpn-panel.service` | the panel |
| `openvpn-panel-mgmt.service` | socat bridge to the management socket |

## Deployment options

The panel runs natively under systemd next to OpenVPN. That is deliberate:

| Approach | Verdict |
| --- | --- |
| **Native systemd service** (this project) | ✅ Unprivileged user, read-only sandbox, `sudo` limited to one small helper. Matches a native openvpn-install server. |
| Panel in Docker + host helper over a socket | Possible, but adds a root daemon for the container to call — more moving parts for the same result. |
| Docker with `--privileged` / `/etc/openvpn` mounted | ❌ Equivalent to root on the host; defeats the privilege separation. |
| OpenVPN and panel both in containers | Only sensible for new servers; migrating means reissuing every client profile. |

Demo mode has no privileged parts, so it is fine to run anywhere, including a
container.

## Configuration

All settings are environment variables, validated at startup
(see [.env.example](.env.example)):

| Variable | Default | Notes |
| --- | --- | --- |
| `PANEL_MODE` | `demo` | `live` for a real server |
| `PANEL_HOST` | `127.0.0.1` | bind address |
| `PANEL_PORT` | `8081` | |
| `OVPN_MGMT` | `tcp:127.0.0.1:7505` | or `unix:/path/to.sock` |
| `PANEL_HELPER` | `/usr/local/sbin/openvpn-panel-helper` | |
| `ADMIN_USER` | `admin` | |
| `ADMIN_PASSWORD_HASH` | — | required in live mode; `npm run hash-password` |
| `SESSION_SECRET` | — | ≥ 32 chars, required in live mode |
| `AUDIT_LOG_PATH` | `./data/audit.log` | |

## Continuous deployment (GitHub Actions)

`ci.yml` runs lint, typecheck, tests, build and ShellCheck on every push and
PR. `deploy.yml` runs on pushes to `main`: it builds the standalone bundle,
packs it into `release.tar.gz` and pipes it over SSH to the server, where
`openvpn-panel-deploy` installs it, checks `/api/health` and rolls back on
failure (keeping the last 3 releases).

1. Create a dedicated key pair: `ssh-keygen -t ed25519 -f deploy_key -N ""`.
2. On the server: `sudo ./server/install.sh --deploy-key "$(cat deploy_key.pub)"`.
   The key can do nothing but run the deploy script.
3. Add repository secrets:
   - `DEPLOY_HOST` — server hostname or IP
   - `DEPLOY_SSH_KEY` — contents of `deploy_key`
   - `DEPLOY_KNOWN_HOSTS` — output of `ssh-keyscan -t ed25519 <host>`
     (verify the fingerprint out of band)
   - optional repository *variable* `DEPLOY_SSH_PORT` (default 22)

Add them as *repository* secrets. The deploy job runs in a `production`
environment: add required reviewers there if every deploy should need a manual
approval.

Without these secrets (e.g. in forks) the deploy job is skipped, not failed.

## Upgrade

- **Panel:** push to `main`, or build and pipe a new `release.tar.gz` into
  `openvpn-panel-deploy`.
- **Server scripts:** `git pull && sudo ./server/install.sh` (keeps your
  password and settings).
- **openvpn-install.sh:** update your copy, then
  `sudo ./server/install.sh --installer /path/to/openvpn-install.sh`.

## Uninstall

```bash
sudo ./server/uninstall.sh           # keeps /etc/openvpn-panel and the audit log
sudo ./server/uninstall.sh --purge   # removes them too
```

OpenVPN and your clients are not affected.

## Development

```bash
npm run dev            # demo mode on 127.0.0.1:8081 (admin / demo)
npm test               # unit + integration tests (vitest)
npm run test:coverage  # same, enforcing coverage thresholds
npm run build          # standalone output in .next/standalone
npm run test:e2e       # Playwright against the production build (run build first)
npm run lint
npm run typecheck
```

### Testing strategy

| Layer | What it covers |
| --- | --- |
| Unit | parsers (recorded `status 3` from OpenVPN 2.5/2.6/2.7), management client against a fake server, sessions, password hashing, rate limiting, audit log, helper runner |
| Integration | every API route and the proxy: login, CSRF, add → disconnect → revoke lifecycle, audit entries, `server_*` protection |
| E2E | Playwright on the production build: login, add/download, confirmations, audit page, sign-out, security headers, no horizontal scroll on mobile |
| Server scripts | ShellCheck in CI; helper/deploy smoke-tested in a Debian container |

CI runs all of the above on every push and pull request; line coverage must
stay above 80 %.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
