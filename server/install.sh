#!/usr/bin/env bash
# openvpn-panel server installer. Idempotent: safe to re-run for upgrades.
#
# Run on the VPN server (already set up with angristan/openvpn-install):
#
#   sudo ./server/install.sh [options]
#
# Options:
#   --installer PATH       openvpn-install.sh to copy to /usr/local/sbin
#                          (default: first of ./openvpn-install.sh,
#                          /root/openvpn-install.sh, ~SUDO_USER/openvpn-install.sh,
#                          or the copy already installed)
#   --bind IP              address the panel listens on (default 127.0.0.1;
#                          use the server's VPN IP, e.g. 10.8.0.1, for VPN-only access)
#   --port PORT            panel port (default 8081)
#   --admin-user NAME      admin username (default admin)
#   --reset-password       prompt for a new admin password even if one is set
#   --mgmt-bridge tcp|unix how the panel reaches the root-owned management
#                          socket: tcp = socat on 127.0.0.1:7505 (default),
#                          unix = socat on a 0600 socket owned by the panel user
#   --deploy-key "KEY"     also create the "openvpn-panel-deploy" SSH user for
#                          CI deploys, restricted to the deploy script
#
# Non-interactive: set PANEL_ADMIN_PASSWORD in the environment.
set -euo pipefail
umask 022

readonly PANEL_USER=openvpn-panel
readonly DEPLOY_USER=openvpn-panel-deploy
readonly APP_DIR=/opt/openvpn-panel
readonly CONF_DIR=/etc/openvpn-panel
readonly ENV_FILE=$CONF_DIR/env
readonly DATA_DIR=/var/lib/openvpn-panel
readonly SBIN=/usr/local/sbin
readonly HELPER=$SBIN/openvpn-panel-helper
readonly DEPLOY_SCRIPT=$SBIN/openvpn-panel-deploy
readonly INSTALLER_DST=$SBIN/openvpn-install.sh
readonly SUDOERS_FILE=/etc/sudoers.d/openvpn-panel
readonly UNIT_DIR=/etc/systemd/system
readonly MGMT_TCP_PORT=7505
readonly MGMT_UNIX_DIR=/run/openvpn-panel-mgmt
readonly MIN_NODE_MAJOR=24
readonly MIN_NODE_MINOR=7

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)

installer_src=""
bind_ip=127.0.0.1
port=8081
admin_user="admin"
reset_password=false
mgmt_bridge=tcp
deploy_key=""

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
	printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
	exit 1
}

usage() {
	sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--installer) installer_src=${2:?--installer needs a path}; shift 2 ;;
		--bind) bind_ip=${2:?--bind needs an IP}; shift 2 ;;
		--port) port=${2:?--port needs a number}; shift 2 ;;
		--admin-user) admin_user=${2:?--admin-user needs a name}; shift 2 ;;
		--reset-password) reset_password=true; shift ;;
		--mgmt-bridge) mgmt_bridge=${2:?--mgmt-bridge needs tcp or unix}; shift 2 ;;
		--deploy-key) deploy_key=${2:?--deploy-key needs a public key}; shift 2 ;;
		-h | --help) usage 0 ;;
		*) warn "unknown option: $1"; usage 1 ;;
		esac
	done
	[[ $port =~ ^[0-9]{1,5}$ ]] && ((port >= 1 && port <= 65535)) || die "invalid --port"
	[[ $bind_ip =~ ^[0-9A-Fa-f.:]+$ ]] || die "invalid --bind (use an IP address)"
	[[ $bind_ip != 0.0.0.0 && $bind_ip != :: ]] || die "refusing to bind to all interfaces; use 127.0.0.1 or the VPN IP"
	[[ $admin_user =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "invalid --admin-user"
	[[ $mgmt_bridge == tcp || $mgmt_bridge == unix ]] || die "--mgmt-bridge must be tcp or unix"
	if [[ -n $deploy_key ]]; then
		local key_re='^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( [^"]*)?$'
		[[ $deploy_key =~ $key_re && $deploy_key != *$'\n'* ]] || die "--deploy-key must be a single OpenSSH public key line"
	fi
}

check_prereqs() {
	[[ $EUID -eq 0 ]] || die "run as root (sudo $0)"
	command -v systemctl >/dev/null || die "systemd is required"
	command -v visudo >/dev/null || die "sudo/visudo is required (apt install sudo)"
	command -v socat >/dev/null || die "socat is required (apt install socat)"
	command -v curl >/dev/null || die "curl is required (apt install curl)"
	command -v node >/dev/null || die "Node.js >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR is required (https://nodejs.org/en/download)"
	local version major minor
	version=$(node -p 'process.versions.node')
	major=${version%%.*}
	minor=${version#*.}
	minor=${minor%%.*}
	if ((major < MIN_NODE_MAJOR || (major == MIN_NODE_MAJOR && minor < MIN_NODE_MINOR))); then
		die "Node.js $version found; >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR is required"
	fi
	[[ -f $SCRIPT_DIR/openvpn-panel-helper && -f $SCRIPT_DIR/openvpn-panel-deploy ]] ||
		die "run this script from a checkout of the openvpn-panel repository"
	[[ -f $REPO_DIR/scripts/hash-password.mjs ]] || die "missing $REPO_DIR/scripts/hash-password.mjs"
}

find_server_conf() {
	local candidate
	for candidate in /etc/openvpn/server/server.conf /etc/openvpn/server.conf; do
		[[ -f $candidate ]] && { echo "$candidate"; return 0; }
	done
	return 1
}

install_installer() {
	local candidates=()
	if [[ -n $installer_src ]]; then
		candidates=("$installer_src")
	else
		candidates=("$PWD/openvpn-install.sh" /root/openvpn-install.sh)
		if [[ -n ${SUDO_USER-} ]]; then
			candidates+=("$(getent passwd "$SUDO_USER" | cut -d: -f6)/openvpn-install.sh")
		fi
		candidates+=("$INSTALLER_DST")
	fi
	local src=""
	for c in "${candidates[@]}"; do
		[[ -f $c ]] && { src=$c; break; }
	done
	[[ -n $src ]] || die "openvpn-install.sh not found; pass --installer /path/to/openvpn-install.sh"
	grep -q 'OUTPUT_FORMAT' "$src" ||
		die "$src is too old: update angristan/openvpn-install (needs the 'client' CLI and OUTPUT_FORMAT=json)"
	if [[ $(readlink -f "$src") != "$(readlink -f "$INSTALLER_DST" 2>/dev/null || true)" ]]; then
		install -o root -g root -m 0700 "$src" "$INSTALLER_DST"
	fi
	chown root:root "$INSTALLER_DST" && chmod 0700 "$INSTALLER_DST"
	log "openvpn-install.sh installed at $INSTALLER_DST (root-only)"
}

create_user() {
	if ! id -u "$PANEL_USER" >/dev/null 2>&1; then
		useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home \
			--shell /usr/sbin/nologin --comment "openvpn-panel service" "$PANEL_USER"
		log "created system user $PANEL_USER"
	fi
	install -d -o root -g root -m 0755 "$APP_DIR" "$APP_DIR/releases"
	install -d -o root -g root -m 0700 "$CONF_DIR"
	install -d -o "$PANEL_USER" -g "$PANEL_USER" -m 0750 "$DATA_DIR"
}

install_scripts() {
	install -o root -g root -m 0755 "$SCRIPT_DIR/openvpn-panel-helper" "$HELPER"
	install -o root -g root -m 0755 "$SCRIPT_DIR/openvpn-panel-deploy" "$DEPLOY_SCRIPT"
	log "helper installed at $HELPER"
}

write_sudoers() {
	local tmp
	tmp=$(mktemp)
	{
		echo "# Managed by openvpn-panel server/install.sh — do not edit."
		echo "# The panel user may run ONLY the helper, which validates its own arguments."
		echo "Defaults:$PANEL_USER !requiretty, !lecture, env_reset"
		echo "$PANEL_USER ALL=(root) NOPASSWD: $HELPER"
		if [[ -n $deploy_key ]] || id -u "$DEPLOY_USER" >/dev/null 2>&1; then
			echo
			echo "# CI deploy user: only the deploy script, with no arguments."
			echo "Defaults:$DEPLOY_USER !requiretty, !lecture, env_reset"
			echo "$DEPLOY_USER ALL=(root) NOPASSWD: $DEPLOY_SCRIPT \"\""
		fi
	} >"$tmp"
	if ! visudo -cf "$tmp" >/dev/null; then
		rm -f "$tmp"
		die "generated sudoers file failed validation; nothing was changed"
	fi
	install -o root -g root -m 0440 "$tmp" "$SUDOERS_FILE"
	rm -f "$tmp"
	visudo -c >/dev/null || die "sudoers configuration is invalid after install; check $SUDOERS_FILE"
	log "sudoers rule installed at $SUDOERS_FILE"
}

# Prints the management socket path configured in server.conf.
mgmt_socket_path() {
	local conf line
	conf=$(find_server_conf) || return 1
	line=$(grep -E '^[[:space:]]*management[[:space:]]+/' "$conf" | tail -n1) || return 1
	# "management /var/run/openvpn-server/server.sock unix"
	awk '{print $2}' <<<"$line"
}

write_mgmt_bridge() {
	local socket
	if ! socket=$(mgmt_socket_path); then
		warn "no unix management socket found in server.conf."
		warn "Add this line to /etc/openvpn/server/server.conf and restart OpenVPN:"
		warn "    management /var/run/openvpn-server/server.sock unix"
		socket=/var/run/openvpn-server/server.sock
	fi
	local listen
	if [[ $mgmt_bridge == tcp ]]; then
		listen="TCP-LISTEN:$MGMT_TCP_PORT,bind=127.0.0.1,reuseaddr,fork,max-children=1"
		mgmt_env="tcp:127.0.0.1:$MGMT_TCP_PORT"
	else
		listen="UNIX-LISTEN:$MGMT_UNIX_DIR/mgmt.sock,unlink-early,fork,max-children=1,user=$PANEL_USER,group=$PANEL_USER,mode=0600"
		mgmt_env="unix:$MGMT_UNIX_DIR/mgmt.sock"
	fi
	cat >"$UNIT_DIR/openvpn-panel-mgmt.service" <<EOF
# Installed by openvpn-panel server/install.sh
[Unit]
Description=openvpn-panel bridge to the OpenVPN management socket
After=openvpn-server@server.service openvpn@server.service

[Service]
Type=simple
ExecStart=/usr/bin/env socat $listen UNIX-CONNECT:$socket
Restart=always
RestartSec=2
RuntimeDirectory=openvpn-panel-mgmt
RuntimeDirectoryMode=0755
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=CAP_DAC_OVERRIDE CAP_CHOWN CAP_FOWNER
ReadWritePaths=-$(dirname "$socket") -$MGMT_UNIX_DIR

[Install]
WantedBy=multi-user.target
EOF
	log "management bridge ($mgmt_bridge) -> $socket"
}

hash_password() {
	local password confirm
	if [[ -n ${PANEL_ADMIN_PASSWORD-} ]]; then
		password=$PANEL_ADMIN_PASSWORD
	else
		[[ -t 0 ]] || die "no terminal to prompt for the admin password; set PANEL_ADMIN_PASSWORD"
		read -rsp "Admin password for '$admin_user' (min 12 chars): " password
		echo >&2
		read -rsp "Repeat password: " confirm
		echo >&2
		[[ $password == "$confirm" ]] || die "passwords do not match"
	fi
	# Password goes through stdin, never argv; only the hash is stored.
	printf '%s' "$password" | node "$REPO_DIR/scripts/hash-password.mjs"
}

env_value() {
	sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed "s/^'\(.*\)'\$/\1/"
}

write_env() {
	local hash secret
	if [[ -f $ENV_FILE && $reset_password == false ]] && [[ -n $(env_value ADMIN_PASSWORD_HASH) ]]; then
		hash=$(env_value ADMIN_PASSWORD_HASH)
		log "keeping existing admin password (use --reset-password to change it)"
	else
		hash=$(hash_password) || die "could not hash the password"
	fi
	secret=$([[ -f $ENV_FILE ]] && env_value SESSION_SECRET || true)
	if [[ ${#secret} -lt 32 ]]; then
		secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
	fi
	local tmp
	tmp=$(mktemp "$CONF_DIR/.env.XXXXXX")
	# systemd EnvironmentFile: single quotes keep "$" in the hash literal.
	cat >"$tmp" <<EOF
# openvpn-panel configuration — written by server/install.sh.
# Re-run install.sh to change it; edit by hand at your own risk.
PANEL_MODE=live
PANEL_HOST=$bind_ip
PANEL_PORT=$port
OVPN_MGMT=$mgmt_env
PANEL_HELPER=$HELPER
ADMIN_USER=$admin_user
ADMIN_PASSWORD_HASH='$hash'
SESSION_SECRET=$secret
AUDIT_LOG_PATH=$DATA_DIR/audit.log
EOF
	chown root:root "$tmp"
	chmod 0600 "$tmp"
	mv -f "$tmp" "$ENV_FILE"
	log "configuration written to $ENV_FILE (0600)"
}

setup_deploy_user() {
	[[ -n $deploy_key ]] || return 0
	local home=/var/lib/$DEPLOY_USER
	if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
		# A real shell is needed for sshd to run the forced command.
		useradd --system --user-group --home-dir "$home" --create-home --shell /bin/sh \
			--comment "openvpn-panel CI deploys" "$DEPLOY_USER"
		log "created deploy user $DEPLOY_USER"
	fi
	# "*" instead of a locked "!" so sshd accepts key logins on all PAM setups.
	usermod -p '*' "$DEPLOY_USER"
	install -d -o root -g "$DEPLOY_USER" -m 0750 "$home/.ssh"
	local opts='command="sudo /usr/local/sbin/openvpn-panel-deploy",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc'
	# Root-owned so the deploy user cannot change its own restrictions.
	printf '%s %s\n' "$opts" "$deploy_key" >"$home/.ssh/authorized_keys"
	chown root:"$DEPLOY_USER" "$home/.ssh/authorized_keys"
	chmod 0640 "$home/.ssh/authorized_keys"
	log "deploy key installed for $DEPLOY_USER (forced command: $DEPLOY_SCRIPT)"
}

start_services() {
	install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/openvpn-panel.service" "$UNIT_DIR/openvpn-panel.service"
	systemctl daemon-reload
	systemctl enable --now openvpn-panel-mgmt.service >/dev/null
	systemctl restart openvpn-panel-mgmt.service
	systemctl enable openvpn-panel.service >/dev/null
	if [[ -e $APP_DIR/current/start.mjs ]]; then
		systemctl restart openvpn-panel.service
		log "openvpn-panel restarted"
	else
		warn "no release deployed yet — push to main (GitHub Actions) or run:"
		warn "    npm ci && npm run build && scripts/package-release.sh"
		warn "    sudo $DEPLOY_SCRIPT < release.tar.gz"
	fi
}

print_summary() {
	local vpn_ip
	vpn_ip=$(ip -4 -o addr show dev tun0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)
	echo
	log "Done. The panel listens on http://$bind_ip:$port"
	if [[ $bind_ip == 127.0.0.1 ]]; then
		echo "    It is only reachable from this machine. From your laptop:"
		echo "      ssh -L $port:127.0.0.1:$port <you>@<this-server>   then open http://127.0.0.1:$port"
		if [[ -n $vpn_ip ]]; then
			echo "    Or re-run with --bind $vpn_ip to reach it over the VPN."
		fi
	else
		echo "    Allow it on the VPN interface only (ufw):"
		echo "      ufw allow in on tun0 to $bind_ip port $port proto tcp"
		echo "    Never expose the panel on a public interface."
	fi
	if [[ $mgmt_bridge == tcp ]]; then
		echo "    Note: the management bridge on 127.0.0.1:$MGMT_TCP_PORT is reachable by every local user."
		echo "    On shared hosts prefer --mgmt-bridge unix (see SECURITY.md)."
	fi
}

main() {
	parse_args "$@"
	check_prereqs
	find_server_conf >/dev/null || die "OpenVPN server config not found; install OpenVPN with openvpn-install.sh first"
	install_installer
	create_user
	install_scripts
	setup_deploy_user
	write_sudoers
	mgmt_env=""
	write_mgmt_bridge
	write_env
	start_services
	print_summary
}

main "$@"
