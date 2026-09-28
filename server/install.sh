#!/usr/bin/env bash
# openvpn-panel installer and updater. Idempotent: safe to re-run.
#
# Quick install (downloads the latest release, verifies it, installs it):
#
#   curl -fsSLO https://github.com/BugsBountyHunter/openvpn-panel/releases/latest/download/install.sh
#   sudo bash install.sh --bind 10.8.0.1
#
# Update later (keeps your settings and password):
#
#   sudo openvpn-panel-update            # latest release
#   sudo openvpn-panel-update v0.2.0     # a specific release
#
# Options:
#   --bind IP              address the panel listens on (default 127.0.0.1, or the
#                          current setting on re-runs). Use the VPN IP, e.g.
#                          10.8.0.1, for VPN-only access. Never 0.0.0.0.
#   --port PORT            panel port (default 8081)
#   --admin-user NAME      admin username (default admin)
#   --reset-password       prompt for a new admin password even if one is set
#   --version TAG          release to install: "latest" (default) or e.g. v0.1.0
#   --installer PATH       openvpn-install.sh to copy to /usr/local/sbin
#                          (default: ./openvpn-install.sh, /root/openvpn-install.sh,
#                          ~SUDO_USER/openvpn-install.sh, or the copy already installed)
#   --mgmt-bridge unix|tcp how the panel reaches the root-owned management socket:
#                          unix = 0600 socket owned by the panel user (default)
#                          tcp  = socat on 127.0.0.1:7505 (any local user can connect)
#   --deploy-key "KEY"     maintainers: create the "openvpn-panel-deploy" SSH user for
#                          CI deploys, restricted to the deploy script
#   --app PATH             install this release tarball instead of downloading one
#   --no-app               only (re)configure the server side; don't install an app
#
# Environment: PANEL_ADMIN_PASSWORD (non-interactive installs),
# OPENVPN_PANEL_REPO (owner/name of a fork).
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
readonly UPDATE_SCRIPT=$SBIN/openvpn-panel-update
readonly UNINSTALL_SCRIPT=$SBIN/openvpn-panel-uninstall
readonly INSTALLER_DST=$SBIN/openvpn-install.sh
readonly SUDOERS_FILE=/etc/sudoers.d/openvpn-panel
readonly UNIT_DIR=/etc/systemd/system
readonly MGMT_TCP_PORT=7505
readonly MGMT_UNIX_DIR=/run/openvpn-panel-mgmt
readonly MIN_NODE_MAJOR=24
readonly MIN_NODE_MINOR=7
readonly RELEASE_ASSET=openvpn-panel.tar.gz

REPO=${OPENVPN_PANEL_REPO:-BugsBountyHunter/openvpn-panel}
# Base URL for release downloads; overridable only for tests and mirrors.
RELEASE_BASE=${OPENVPN_PANEL_RELEASE_URL:-https://github.com/$REPO/releases}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)

installer_src=""
bind_ip=127.0.0.1
port=8081
admin_user="admin"
reset_password=false
mgmt_bridge=unix
deploy_key=""
version=latest
app_tarball=""
no_app=false

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
	printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
	exit 1
}

usage() {
	sed -n '2,37p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

env_value() {
	[[ -r $ENV_FILE ]] || return 0
	sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 | sed "s/^'\(.*\)'\$/\1/"
}

# On re-runs and updates, keep the current settings unless flags override them.
load_existing_settings() {
	[[ -r $ENV_FILE ]] || return 0
	local value
	value=$(env_value PANEL_HOST) && [[ -n $value ]] && bind_ip=$value
	value=$(env_value PANEL_PORT) && [[ -n $value ]] && port=$value
	value=$(env_value ADMIN_USER) && [[ -n $value ]] && admin_user=$value
	value=$(env_value OVPN_MGMT)
	case "$value" in
	tcp:*) mgmt_bridge=tcp ;;
	unix:*) mgmt_bridge=unix ;;
	esac
	return 0
}

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--installer) installer_src=${2:?--installer needs a path}; shift 2 ;;
		--bind) bind_ip=${2:?--bind needs an IP}; shift 2 ;;
		--port) port=${2:?--port needs a number}; shift 2 ;;
		--admin-user) admin_user=${2:?--admin-user needs a name}; shift 2 ;;
		--reset-password) reset_password=true; shift ;;
		--mgmt-bridge) mgmt_bridge=${2:?--mgmt-bridge needs unix or tcp}; shift 2 ;;
		--deploy-key) deploy_key=${2:?--deploy-key needs a public key}; shift 2 ;;
		--version) version=${2:?--version needs a tag}; shift 2 ;;
		--app) app_tarball=${2:?--app needs a path}; shift 2 ;;
		--no-app) no_app=true; shift ;;
		-h | --help) usage 0 ;;
		*) warn "unknown option: $1"; usage 1 ;;
		esac
	done
	[[ $port =~ ^[0-9]{1,5}$ ]] && ((port >= 1 && port <= 65535)) || die "invalid --port"
	[[ $bind_ip =~ ^[0-9A-Fa-f.:]+$ ]] || die "invalid --bind (use an IP address)"
	[[ $bind_ip != 0.0.0.0 && $bind_ip != :: ]] || die "refusing to bind to all interfaces; use 127.0.0.1 or the VPN IP"
	[[ $admin_user =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "invalid --admin-user"
	[[ $mgmt_bridge == tcp || $mgmt_bridge == unix ]] || die "--mgmt-bridge must be unix or tcp"
	[[ $version == latest || $version =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "--version must be 'latest' or a tag like v0.1.0"
	[[ $REPO =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "OPENVPN_PANEL_REPO must look like owner/name"
	if [[ -n $app_tarball ]]; then
		[[ -f $app_tarball ]] || die "--app: $app_tarball not found"
		app_tarball=$(cd -- "$(dirname -- "$app_tarball")" && pwd)/$(basename -- "$app_tarball")
	fi
	if [[ -n $deploy_key ]]; then
		local key_re='^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( [^"]*)?$'
		[[ $deploy_key =~ $key_re && $deploy_key != *$'\n'* ]] || die "--deploy-key must be a single OpenSSH public key line"
	fi
}

# --- Bootstrap: fetch and verify a release, then run the installer inside it --

download() {
	local url=$1 dest=$2
	case "$url" in
	https://*) curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$dest" "$url" ;;
	http://127.0.0.1:* | http://localhost:*) curl -fsSL --retry 3 -o "$dest" "$url" ;; # tests only
	*) die "refusing to download over an insecure URL: $url" ;;
	esac
}

# Runs when install.sh is used on its own (curl-downloaded) or as openvpn-panel-update.
bootstrap_release() {
	[[ $EUID -eq 0 ]] || die "run as root: sudo bash $0 $*"
	for tool in curl tar sha256sum; do
		command -v "$tool" >/dev/null || die "$tool is required"
	done
	local base
	if [[ $version == latest ]]; then base=$RELEASE_BASE/latest/download; else base=$RELEASE_BASE/download/$version; fi

	local work
	work=$(mktemp -d /tmp/openvpn-panel-release.XXXXXX)
	# shellcheck disable=SC2064 # expand now: $work is local
	trap "rm -rf -- '$work'" EXIT
	log "downloading openvpn-panel $version from $base"
	download "$base/$RELEASE_ASSET" "$work/$RELEASE_ASSET" || die "download failed ($base/$RELEASE_ASSET)"
	download "$base/SHA256SUMS" "$work/SHA256SUMS" || die "checksum download failed"
	(cd "$work" && grep -E "  $RELEASE_ASSET\$" SHA256SUMS | sha256sum -c --quiet -) ||
		die "checksum verification FAILED for $RELEASE_ASSET — not installing"
	log "checksum verified"

	mkdir "$work/bundle"
	tar -xzf "$work/$RELEASE_ASSET" -C "$work/bundle" --no-same-owner
	[[ -f $work/bundle/server/install.sh ]] || die "release does not contain server/install.sh"
	bash "$work/bundle/server/install.sh" "$@" --app "$work/$RELEASE_ASSET"
}

# --- Installation ------------------------------------------------------------

suggest_node() {
	local candidate=""
	if [[ -n ${SUDO_USER-} ]]; then
		local home
		home=$(getent passwd "$SUDO_USER" | cut -d: -f6)
		candidate=$(find "$home/.nvm/versions/node" -maxdepth 3 -path '*/bin/node' 2>/dev/null | sort -V | tail -n1 || true)
	fi
	if [[ -n $candidate ]]; then
		warn "found Node in nvm ($candidate), which the service cannot use from your home directory."
		warn "Copy it to a system path, then re-run this installer:"
		warn "    sudo install -m 0755 $candidate /usr/local/bin/node"
	else
		warn "install Node.js >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR, e.g. from your distribution or https://nodejs.org/en/download"
	fi
}

check_prereqs() {
	[[ $EUID -eq 0 ]] || die "run as root (sudo $0)"
	command -v systemctl >/dev/null || die "systemd is required"
	local tool
	for tool in visudo socat curl flock tar; do
		command -v "$tool" >/dev/null || die "$tool is required (apt install sudo socat curl util-linux tar)"
	done
	if ! command -v node >/dev/null; then
		suggest_node
		die "Node.js >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR is required in a system path"
	fi
	local node_version major minor
	node_version=$(node -p 'process.versions.node')
	major=${node_version%%.*}
	minor=${node_version#*.}
	minor=${minor%%.*}
	if ((major < MIN_NODE_MAJOR || (major == MIN_NODE_MAJOR && minor < MIN_NODE_MINOR))); then
		suggest_node
		die "Node.js $node_version found; >= $MIN_NODE_MAJOR.$MIN_NODE_MINOR is required"
	fi
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
	local src="" c
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
	install -o root -g root -m 0755 "$SCRIPT_DIR/install.sh" "$UPDATE_SCRIPT"
	install -o root -g root -m 0755 "$SCRIPT_DIR/uninstall.sh" "$UNINSTALL_SCRIPT"
	log "helper, deploy, update and uninstall commands installed in $SBIN"
}

write_sudoers() {
	local tmp
	tmp=$(mktemp)
	{
		echo "# Managed by openvpn-panel install.sh — do not edit."
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
# Installed by openvpn-panel install.sh
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
		read -rsp "Choose the panel admin password for '$admin_user' (min 12 chars): " password
		echo >&2
		read -rsp "Repeat password: " confirm
		echo >&2
		[[ $password == "$confirm" ]] || die "passwords do not match"
	fi
	# Password goes through stdin, never argv; only the hash is stored.
	printf '%s' "$password" | node "$REPO_DIR/scripts/hash-password.mjs"
}

write_env() {
	local hash secret
	if [[ -f $ENV_FILE && $reset_password == false ]] && [[ -n $(env_value ADMIN_PASSWORD_HASH) ]]; then
		hash=$(env_value ADMIN_PASSWORD_HASH)
		log "keeping existing admin password (use --reset-password to change it)"
	else
		hash=$(hash_password) || die "could not hash the password"
	fi
	secret=$(env_value SESSION_SECRET)
	if [[ ${#secret} -lt 32 ]]; then
		secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
	fi
	local tmp
	tmp=$(mktemp "$CONF_DIR/.env.XXXXXX")
	# systemd EnvironmentFile: single quotes keep "$" in the hash literal.
	cat >"$tmp" <<EOF
# openvpn-panel configuration — written by install.sh.
# Re-run the installer (or openvpn-panel-update) to change it.
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

installed_version() {
	cat "$APP_DIR/current/VERSION" 2>/dev/null || echo none
}

start_services() {
	install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/openvpn-panel.service" "$UNIT_DIR/openvpn-panel.service"
	systemctl daemon-reload
	systemctl enable --now openvpn-panel-mgmt.service >/dev/null
	systemctl restart openvpn-panel-mgmt.service
	systemctl enable openvpn-panel.service >/dev/null
}

install_app() {
	if [[ -n $app_tarball ]]; then
		local new
		new=$(cat "$REPO_DIR/VERSION" 2>/dev/null || echo unknown)
		log "installing openvpn-panel $new (currently: $(installed_version))"
		"$DEPLOY_SCRIPT" <"$app_tarball" || die "deploy failed; the previous version (if any) is still running"
	elif [[ -e $APP_DIR/current/start.mjs ]]; then
		systemctl restart openvpn-panel.service
		log "openvpn-panel $(installed_version) restarted"
	else
		warn "no app installed yet. Run the installer without --no-app to download the latest release."
	fi
}

print_summary() {
	local vpn_ip
	vpn_ip=$(ip -4 -o addr show dev tun0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -n1 || true)
	echo
	log "Done: openvpn-panel $(installed_version) on http://$bind_ip:$port"
	if [[ $bind_ip == 127.0.0.1 ]]; then
		echo "    Only reachable from this machine. From your laptop:"
		echo "      ssh -L $port:127.0.0.1:$port <you>@<this-server>   then open http://127.0.0.1:$port"
		if [[ -n $vpn_ip ]]; then
			echo "    Or re-run with --bind $vpn_ip to reach it over the VPN."
		fi
	else
		echo "    If ufw is active, allow it on the VPN interface only:"
		echo "      ufw allow in on tun0 to $bind_ip port $port proto tcp"
		echo "    Never expose the panel on a public interface."
	fi
	if [[ $mgmt_bridge == tcp ]]; then
		echo "    Note: the management bridge on 127.0.0.1:$MGMT_TCP_PORT is reachable by every local user."
	fi
	echo "    Update: sudo openvpn-panel-update    Uninstall: sudo openvpn-panel-uninstall"
}

main() {
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
	install_app
	print_summary
}

# --- Entry point ---------------------------------------------------------------

# Invoked as "openvpn-panel-update [TAG]": fetch that release and re-run.
if [[ $(basename -- "$0") == openvpn-panel-update ]]; then
	load_existing_settings
	update_args=()
	if [[ $# -gt 0 && $1 != -* ]]; then
		update_args=(--version "$1")
		shift
	fi
	parse_args "${update_args[@]}" "$@"
	bootstrap_release "${update_args[@]}" "$@"
	exit 0
fi

load_existing_settings
parse_args "$@"

if [[ ! -f $SCRIPT_DIR/openvpn-panel-helper ]]; then
	# Standalone install.sh (e.g. downloaded with curl): get the release bundle.
	bootstrap_release "$@"
	exit 0
fi

if [[ -z $app_tarball && $no_app == false && ! -f $REPO_DIR/server.js ]]; then
	# Source checkout without a built app: install the published release.
	# (Maintainers testing local changes: build, package, and pass --app.)
	bootstrap_release "$@"
	exit 0
fi

main
