#!/usr/bin/env bash
# Runs inside the container started by test/install/run.sh.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq sudo socat curl procps >/dev/null

pass() { printf '  \033[32mPASS\033[0m %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; exit 1; }
check() { local desc=$1; shift; if "$@"; then pass "$desc"; else fail "$desc"; fi; }

# --- Fakes: OpenVPN server config, openvpn-install.sh, systemd -----------------
mkdir -p /etc/openvpn/server
echo 'management /var/run/openvpn-server/server.sock unix' >/etc/openvpn/server/server.conf
printf '#!/bin/bash\n# OUTPUT_FORMAT fake installer\necho "{\\"clients\\":[]}"\n' >/root/openvpn-install.sh
cat >/usr/local/bin/systemctl <<'SH'
#!/bin/sh
# Minimal systemctl stand-in: only openvpn-panel.service is actually run.
[ "$1" = restart ] && [ "$2" = openvpn-panel.service ] || exit 0
if [ -f /run/panel.pid ]; then
  pid=$(cat /run/panel.pid); kill "$pid" 2>/dev/null
  while kill -0 "$pid" 2>/dev/null; do sleep 0.1; done
fi
set -a; . /etc/openvpn-panel/env; set +a
cd /opt/openvpn-panel/current && su -s /bin/sh openvpn-panel -c 'exec node start.mjs' >/tmp/panel.log 2>&1 &
echo $! >/run/panel.pid
SH
chmod 755 /usr/local/bin/systemctl
printf '#!/bin/sh\nexit 0\n' >/usr/local/bin/journalctl && chmod 755 /usr/local/bin/journalctl

# --- Fake GitHub Releases on 127.0.0.1:8000 ------------------------------------
node -e '
const http=require("http"),fs=require("fs"),path=require("path");
http.createServer((q,s)=>{const f=path.join("/work",decodeURIComponent(q.url));
 if(!f.startsWith("/work/releases/")||!fs.existsSync(f)){s.writeHead(404);return s.end();}
 s.end(fs.readFileSync(f));}).listen(8000,"127.0.0.1");' &
sleep 1
export OPENVPN_PANEL_RELEASE_URL=http://127.0.0.1:8000/releases
PASSWORD='correct horse battery staple'
health() { curl -fsS -m 3 http://127.0.0.1:8081/api/health >/dev/null 2>&1; }
version() { cat /opt/openvpn-panel/current/VERSION; }

echo "== fresh install from a standalone install.sh"
cd /root
curl -fsSLO http://127.0.0.1:8000/releases/latest/download/install.sh
PANEL_ADMIN_PASSWORD=$PASSWORD bash install.sh --bind 127.0.0.1 >/tmp/install.log 2>&1 || { cat /tmp/install.log; fail "install"; }
check "panel is healthy" health
check "installed latest (v0.0.1)" test "$(version)" = v0.0.1
check "env file is 0600 root" test "$(stat -c '%a %U' /etc/openvpn-panel/env)" = "600 root"
check "only a password hash is stored" grep -q "^ADMIN_PASSWORD_HASH='\$argon2id\\$" /etc/openvpn-panel/env
check "password not stored in clear" bash -c "! grep -qF '$PASSWORD' /etc/openvpn-panel/env"
check "sudoers valid and limited to the helper" bash -c 'visudo -c >/dev/null && grep -q "NOPASSWD: /usr/local/sbin/openvpn-panel-helper$" /etc/sudoers.d/openvpn-panel'
check "unix management bridge is the default" grep -q '^OVPN_MGMT=unix:' /etc/openvpn-panel/env
check "update/uninstall commands installed" test -x /usr/local/sbin/openvpn-panel-update -a -x /usr/local/sbin/openvpn-panel-uninstall
check "no temp files left behind" bash -c '! ls -d /tmp/openvpn-panel-release.* 2>/dev/null'
login=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: http://127.0.0.1:8081' -H 'Content-Type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD\"}" http://127.0.0.1:8081/api/auth/login)
check "admin can sign in with the chosen password" test "$login" = 200

echo "== tampered release is refused"
hash_before=$(grep ^ADMIN_PASSWORD_HASH /etc/openvpn-panel/env)
if openvpn-panel-update v0.0.9 >/tmp/tamper.log 2>&1; then fail "tampered update was accepted"; fi
check "refused with a checksum error" grep -q "checksum verification FAILED" /tmp/tamper.log
check "still running v0.0.1" test "$(version)" = v0.0.1

echo "== update keeps settings"
openvpn-panel-update v0.0.2 >/tmp/update.log 2>&1 || { cat /tmp/update.log; fail "update"; }
check "updated to v0.0.2" test "$(version)" = v0.0.2
check "panel healthy after update" health
check "password hash unchanged" test "$(grep ^ADMIN_PASSWORD_HASH /etc/openvpn-panel/env)" = "$hash_before"
check "bind address unchanged" grep -q '^PANEL_HOST=127.0.0.1$' /etc/openvpn-panel/env

echo "== uninstall keeps config unless --purge"
openvpn-panel-uninstall >/tmp/uninstall.log 2>&1 || { cat /tmp/uninstall.log; fail "uninstall"; }
check "app removed" test ! -e /opt/openvpn-panel
check "commands removed" test ! -e /usr/local/sbin/openvpn-panel-update
check "config kept" test -f /etc/openvpn-panel/env
echo "ALL INSTALL TESTS PASSED"
