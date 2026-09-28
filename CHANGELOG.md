# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Overview warns 30 days before the server certificate, the CA certificate or
  the CRL expires (red within 7 days or once expired), with the command to fix
  it. New read-only `pki` helper verb reads the dates with `openssl`; results
  are cached for 10 minutes.

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
