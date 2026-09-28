#!/usr/bin/env bash
# Packages the Next.js standalone build into release.tar.gz for
# server/openvpn-panel-deploy. Run after `npm run build`.
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
out=${1:-$root/release.tar.gz}
standalone=$root/.next/standalone
stage=$root/release

[[ -f $standalone/server.js ]] || { echo "no standalone build; run npm run build first" >&2; exit 1; }

rm -rf "$stage"
mkdir -p "$stage/.next"
cp -R "$standalone/." "$stage/"
cp -R "$root/.next/static" "$stage/.next/static"
[[ -d $root/public ]] && cp -R "$root/public" "$stage/public"
cp "$root/scripts/start.mjs" "$stage/start.mjs"
# Never ship local env files or dev data.
rm -rf "$stage"/.env* "$stage/data"

# The deploy script accepts only regular files and directories.
if links=$(find "$stage" -type l | head -n5) && [[ -n $links ]]; then
	echo "release contains symlinks, which the deploy script rejects:" >&2
	echo "$links" >&2
	exit 1
fi

tar_flags=()
# macOS bsdtar would embed extended attributes that GNU tar warns about.
if tar --version 2>/dev/null | grep -q bsdtar; then tar_flags=(--no-mac-metadata --no-xattrs); fi
COPYFILE_DISABLE=1 tar "${tar_flags[@]}" -czf "$out" -C "$stage" .
echo "wrote $out ($(du -h "$out" | cut -f1))"
