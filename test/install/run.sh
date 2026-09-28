#!/usr/bin/env bash
# End-to-end test of the user install/update/uninstall flow in a throwaway
# Debian container, against a local fake "GitHub Releases" server.
# Requires Docker and a prior `npm run build`.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

publish() { # publish <tag> <dir>
	local tag=$1 dir=$2
	mkdir -p "$dir"
	RELEASE_VERSION=$tag "$root/scripts/package-release.sh" "$dir/openvpn-panel.tar.gz" >/dev/null
	cp "$root/server/install.sh" "$dir/install.sh"
	(cd "$dir" && sha256sum openvpn-panel.tar.gz install.sh >SHA256SUMS 2>/dev/null ||
		shasum -a 256 openvpn-panel.tar.gz install.sh >SHA256SUMS)
}

releases=$work/releases
publish v0.0.1 "$releases/latest/download"
publish v0.0.2 "$releases/download/v0.0.2"
# A tampered release: valid checksum file, modified tarball.
publish v0.0.9 "$releases/download/v0.0.9"
printf 'tampered' >>"$releases/download/v0.0.9/openvpn-panel.tar.gz"

cp "$root/test/install/in-container.sh" "$work/"
docker run --rm -v "$work:/work" node:24-bookworm-slim bash /work/in-container.sh
