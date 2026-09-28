#!/usr/bin/env bash
# Removes openvpn-panel from this server. OpenVPN itself is not touched.
#
#   sudo openvpn-panel-uninstall           keep config (/etc/openvpn-panel) and audit log
#   sudo openvpn-panel-uninstall --purge   remove those too
set -euo pipefail

purge=false
[[ ${1-} == --purge ]] && purge=true
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

log() { printf '==> %s\n' "$*"; }

for unit in openvpn-panel.service openvpn-panel-mgmt.service; do
	systemctl disable --now "$unit" >/dev/null 2>&1 || true
	rm -f "/etc/systemd/system/$unit"
done
systemctl daemon-reload
log "services removed"

rm -f /etc/sudoers.d/openvpn-panel
rm -f /usr/local/sbin/openvpn-panel-helper /usr/local/sbin/openvpn-panel-deploy
rm -f /usr/local/sbin/openvpn-panel-update /usr/local/sbin/openvpn-panel-uninstall
# Our root-only copy; the original openvpn-install.sh you downloaded is untouched.
rm -f /usr/local/sbin/openvpn-install.sh
rm -rf /opt/openvpn-panel
log "files removed"

if id -u openvpn-panel-deploy >/dev/null 2>&1; then
	userdel --remove openvpn-panel-deploy 2>/dev/null || userdel openvpn-panel-deploy
	log "deploy user removed"
fi
if id -u openvpn-panel >/dev/null 2>&1; then
	userdel openvpn-panel
	log "service user removed"
fi

if [[ $purge == true ]]; then
	rm -rf /etc/openvpn-panel /var/lib/openvpn-panel
	log "configuration and audit log removed"
else
	log "kept /etc/openvpn-panel and /var/lib/openvpn-panel (use --purge to delete)"
fi
