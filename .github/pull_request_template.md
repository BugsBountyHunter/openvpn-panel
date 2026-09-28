## What & why

<!-- Short description of the change and the problem it solves. -->

## How it was tested

- [ ] `npm run lint && npm run typecheck && npm test && npm run build`
- [ ] Tried in demo mode (`npm run dev`)
- [ ] Tried against a real OpenVPN server (if backend/server scripts changed)

## Security checklist

- [ ] No hostnames, IPs, secrets or server-specific paths committed
- [ ] Client profiles (.ovpn) are never logged or stored
- [ ] Changes to `server/`, `src/lib/auth/` or `src/proxy.ts` explain the threat-model impact
