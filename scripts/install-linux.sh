#!/usr/bin/env bash
set -euo pipefail

RB_REPOSITORY="DarinRowe/RecallBase"
RB_INSTALL_DIR="${RB_INSTALL_DIR:-$HOME/.local/bin}"
RB_NO_MODIFY_PATH="${RB_NO_MODIFY_PATH:-0}"
RB_TMPDIR=""

_log() {
  printf 'recallbase: %s\n' "$*"
}

_fail() {
  printf 'recallbase: error: %s\n' "$*" >&2
  exit 1
}

_cleanup() {
  if [[ -n "$RB_TMPDIR" && -d "$RB_TMPDIR" ]]; then
    rm -rf "$RB_TMPDIR"
  fi
}

trap _cleanup EXIT

_download() {
  local url="$1"
  local destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --silent --show-error "$url" -o "$destination"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet "$url" -O "$destination"
  else
    _fail "curl or wget is required"
  fi
}

_latest_version() {
  local latest_url="https://github.com/$RB_REPOSITORY/releases/latest"
  local effective_url
  if command -v curl >/dev/null 2>&1; then
    effective_url="$(curl --fail --location --silent --show-error --output /dev/null --write-out '%{url_effective}' "$latest_url")"
  elif command -v wget >/dev/null 2>&1; then
    effective_url="$(wget --server-response --spider "$latest_url" 2>&1 | awk '/^  Location: / { value=$2 } END { print value }' | tr -d '\r')"
  else
    _fail "curl or wget is required"
  fi
  printf '%s\n' "${effective_url##*/}"
}

_normalize_version() {
  local requested="$1"
  if [[ "$requested" != v* ]]; then
    requested="v$requested"
  fi
  if [[ ! "$requested" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9][A-Za-z0-9.-]*)?$ ]]; then
    _fail "invalid version: $requested"
  fi
  printf '%s\n' "$requested"
}

_detect_target() {
  [[ "$(uname -s)" == "Linux" ]] || _fail "this installer supports Linux only"
  if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
    _fail "musl Linux is not supported; use a glibc distribution or install from npm"
  fi

  case "$(uname -m)" in
    x86_64|amd64) printf 'x86_64-unknown-linux-gnu\n' ;;
    arm64|aarch64) printf 'aarch64-unknown-linux-gnu\n' ;;
    *) _fail "unsupported Linux architecture: $(uname -m)" ;;
  esac
}

_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{ print $1 }'
  else
    _fail "sha256sum or shasum is required"
  fi
}

_configure_path() {
  [[ "$RB_NO_MODIFY_PATH" == "1" ]] && return
  case ":$PATH:" in
    *":$RB_INSTALL_DIR:"*) return ;;
  esac

  local profile
  case "${SHELL:-}" in
    */zsh) profile="$HOME/.zshrc" ;;
    */bash) profile="$HOME/.bashrc" ;;
    *) profile="$HOME/.profile" ;;
  esac
  local path_line="export PATH=\"$RB_INSTALL_DIR:\$PATH\""
  if [[ ! -f "$profile" ]] || ! grep -Fqx "$path_line" "$profile"; then
    printf '\n%s\n' "$path_line" >> "$profile"
    _log "added $RB_INSTALL_DIR to PATH in $profile"
  fi
  _log "restart your shell or run: export PATH=\"$RB_INSTALL_DIR:\$PATH\""
}

main() {
  local target version archive_name base_url archive_path checksums_path expected actual installed_version
  target="$(_detect_target)"
  version="$(_normalize_version "${RB_VERSION:-$(_latest_version)}")"
  archive_name="recallbase-${target}-${version}.tar.gz"
  base_url="https://github.com/$RB_REPOSITORY/releases/download/$version"
  RB_TMPDIR="$(mktemp -d)"
  archive_path="$RB_TMPDIR/$archive_name"
  checksums_path="$RB_TMPDIR/checksums.sha256"

  _log "downloading $archive_name"
  _download "$base_url/$archive_name" "$archive_path"
  _download "$base_url/checksums.sha256" "$checksums_path"

  expected="$(awk -v name="$archive_name" '$2 == name { print $1 }' "$checksums_path")"
  [[ -n "$expected" ]] || _fail "checksum entry is missing for $archive_name"
  actual="$(_sha256 "$archive_path")"
  [[ "$actual" == "$expected" ]] || _fail "checksum mismatch for $archive_name"

  mkdir -p "$RB_TMPDIR/extract" "$RB_INSTALL_DIR"
  tar -xzf "$archive_path" -C "$RB_TMPDIR/extract"
  [[ -f "$RB_TMPDIR/extract/rb" ]] || _fail "archive does not contain rb"
  install -m 0755 "$RB_TMPDIR/extract/rb" "$RB_INSTALL_DIR/rb"
  installed_version="$("$RB_INSTALL_DIR/rb" --version)" || _fail "installed binary failed its version check"
  _log "installed $installed_version at $RB_INSTALL_DIR/rb"
  _configure_path
}

main "$@"
