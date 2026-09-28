# Contributing

Thanks for helping! Bug reports, docs fixes and new backends are all welcome.

## Setup

```bash
npm ci
npm run dev    # demo mode, http://127.0.0.1:8081, admin / demo
```

Requires Node.js ≥ 24.7. No OpenVPN server is needed: `PANEL_MODE=demo`
(the default) uses fake data.

## Before opening a PR

```bash
npm run lint && npm run typecheck && npm run test:coverage && npm run build && npm run test:e2e
test/install/run.sh   # needs Docker: install/update/uninstall in a clean container
shellcheck server/*.sh server/openvpn-panel-helper server/openvpn-panel-deploy scripts/*.sh
```

- Work on a branch and open a pull request; `main` requires passing CI.
- Add tests for new behaviour (`*.test.ts` next to the code; fixtures in
  `test/fixtures/`). Parser changes should come with recorded output from a
  real server — replace real IPs and names with documentation ranges
  (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`).
- Keep the code generic: no hostnames, IPs or paths specific to your server.
  Everything site-specific belongs in environment variables.
- Use [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:` …).

## Project layout

```
src/app/            Next.js pages and API routes
src/lib/backend/    Backend implementations (demo, live)
src/lib/mgmt/       OpenVPN management-interface client and parsers
src/lib/auth/       sessions, passwords, rate limiting, CSRF
src/lib/audit.ts    append-only audit log
server/             install/uninstall, root helper, deploy script, systemd unit
scripts/            start wrapper, password hashing, release packaging
```

## Adding a backend

Implement the `Backend` interface in `src/lib/types.ts`, add it under
`src/lib/backend/`, and select it in `src/lib/backend/index.ts`. Keep
privileged work in a small, separately reviewable helper like
`server/openvpn-panel-helper`, never in the web process.

## Security-sensitive changes

Changes to `server/`, `src/lib/auth/`, `src/proxy.ts` or the helper runner get
extra review. Please explain the threat model impact in the PR description.
