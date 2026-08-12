#!/usr/bin/env bash
# Convenience installer for people who clone this repo directly. Uses
# `pi install <local-path>` instead of a raw file copy, since most of these
# packages depend on pi-echo-core as a real npm package and need the
# workspace built first for that to resolve.
#
# Usage:
#   ./install.sh                     Install everything (via the pi-echo-bundle umbrella package)
#   ./install.sh permissions         Install just pi-echo-permissions
#   ./install.sh pi-echo-permissions Same as above, full name also accepted
#   ./install.sh --local             Project-local instead of global (default: global)
#   ./install.sh permissions -l      Combine: one package, project-local
#
# --local scopes to whatever directory YOU run this script from (your own
# project), not to this echo/ repo itself — the build step below runs inside
# this repo regardless of your cwd, but the actual `pi install` call runs from
# your original working directory using an absolute path to the target package.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v pi >/dev/null 2>&1; then
	echo "Error: 'pi' not found on PATH. Install it first:" >&2
	echo "  npm install -g @earendil-works/pi-coding-agent" >&2
	exit 1
fi

SCOPE_FLAG=""
EXTENSION=""

for arg in "$@"; do
	case "$arg" in
	--local | -l)
		SCOPE_FLAG="-l"
		;;
	--help | -h)
		echo "Usage: ./install.sh [extension-name] [--local]"
		echo ""
		echo "  extension-name   Install just one package (e.g. 'permissions' or 'pi-echo-permissions')."
		echo "                   Omit to install everything via pi-echo-bundle."
		echo "  --local, -l      Install project-local (to your current directory) instead of"
		echo "                   global (default: global, available in every project)."
		exit 0
		;;
	*)
		EXTENSION="$arg"
		;;
	esac
done

echo "Installing dependencies and building..."
(cd "$SCRIPT_DIR" && npm install && npm run build)

if [ -z "$EXTENSION" ]; then
	TARGET="$SCRIPT_DIR/packages/pi-echo-bundle"
else
	case "$EXTENSION" in
	pi-echo-*) TARGET="$SCRIPT_DIR/packages/$EXTENSION" ;;
	*) TARGET="$SCRIPT_DIR/packages/pi-echo-$EXTENSION" ;;
	esac
fi

if [ ! -d "$TARGET" ]; then
	echo "Error: no such package: $TARGET" >&2
	exit 1
fi

echo "Installing $TARGET (scope: ${SCOPE_FLAG:-global})..."
pi install "$TARGET" $SCOPE_FLAG
