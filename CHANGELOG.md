# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-28

### Added

- Overview, clients and audit log pages; demo mode with fake data.
- Live backend for angristan/openvpn-install servers: OpenVPN management
  interface (`status 3`, `load-stats`, `state`, `version`, `kill`) and a
  root-owned sudo helper for add/revoke/list/status.
- Single-admin login (argon2id or bcrypt), signed session cookie, login rate
  limiting, CSRF protection, append-only JSON-lines audit log.
- `server/install.sh`, `uninstall.sh`, `openvpn-panel-helper`,
  `openvpn-panel-deploy` and a hardened systemd unit.
- CI (lint, typecheck, tests, build, ShellCheck) and SSH deploy workflows.

Tested against OpenVPN 2.5/2.6 recorded output and a live OpenVPN 2.7.7
server on Ubuntu 24.04.

[0.1.0]: https://github.com/BugsBountyHunter/openvpn-panel/releases/tag/v0.1.0
