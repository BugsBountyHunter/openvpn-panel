# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Clients table: status filter (active, online, offline, expiring within 30
  days, revoked, all) with counts, search by name or IP address, and sortable
  Name, Status, Cert expiry, In / Out and Connected columns.
- Audit log: filter by action, result, date range (UTC) and free text
  (user, target, IP, detail); filters live in the URL and work without
  JavaScript. "Export CSV" downloads every matching entry (spreadsheet
  formula injection is neutralized) and is itself recorded in the audit log.
- Live view: overview and clients show "Live · updated Xs ago" with a
  Pause/Resume toggle (remembered per browser), and refresh immediately when
  the tab becomes visible again.
- Add client: optional certificate validity (1–7300 days) and optional
  passphrase-protected private key. The passphrase is sent to the helper on
  stdin and never appears in argv, logs, the audit log or on disk.
- Renew a client certificate from the clients table, with an optional
  validity in days (1–7300). The new profile downloads once and is never
  stored; the old certificate is revoked. New `renew <name> [days]` helper
  verb; renewals are audited.
- Overview warns 30 days before the server certificate, the CA certificate or
  the CRL expires (red within 7 days or once expired), with the command to fix
  it. New read-only `pki` helper verb reads the dates with `openssl`; results
  are cached for 10 minutes.

### Changed

- Management-interface reads (`status 3`, state/load-stats/version) are
  shared for 2 seconds, so several open tabs no longer queue on the
  single-client management socket. Disconnect, add, renew and revoke clear it.

## [0.1.0] - 2026-09-29

First public release.

### Added

- Overview, clients and audit log pages; demo mode with fake data.
- Live backend for angristan/openvpn-install servers: OpenVPN management
  interface (`status 3`, `load-stats`, `state`, `version`, `kill`) and a
  root-owned sudo helper for add/revoke/list/status.
- Single-admin login (argon2id or bcrypt), signed session cookie, login rate
  limiting, CSRF protection, append-only JSON-lines audit log.
- One-command install from GitHub releases with SHA-256 verification;
  `openvpn-panel-update` (keeps settings, health-checked with automatic
  rollback) and `openvpn-panel-uninstall`.
- Release workflow publishing `openvpn-panel.tar.gz`, `install.sh` and
  `SHA256SUMS` with build-provenance attestations.
- Hardened systemd unit, visudo-validated sudoers rule, management-socket
  bridge (0600 unix socket by default).
- Tests: unit, API integration, Playwright E2E (desktop and mobile), and an
  install/update/uninstall test in a clean Debian container; CI coverage
  thresholds; optional SSH deploy workflow for maintainers.

Tested against a live OpenVPN 2.7.7 server on Ubuntu 24.04 and recorded
output from OpenVPN 2.5 and 2.6.

[0.1.0]: https://github.com/BugsBountyHunter/openvpn-panel/releases/tag/v0.1.0
