#!/bin/sh
set -eu

BIN_DIR=${DECISIONATOR_BIN_DIR:-"$HOME/.local/bin"}
CLAUDE_SKILL_ROOT=${DECISIONATOR_CLAUDE_SKILL_DIR:-"$HOME/.claude/skills"}
CODEX_SKILL_ROOT=${DECISIONATOR_CODEX_SKILL_DIR:-"$HOME/.agents/skills"}
TARGETS=${DECISIONATOR_TARGETS:-}
REPOSITORY=${DECISIONATOR_REPOSITORY:-}
LANGUAGE=${DECISIONATOR_LANGUAGE:-}
LOCAL_BUILD=false
FORCE=false
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
TEMP_DIR=""
CONFIG_PREFIX="Decision language configuration:"

usage() {
  printf '%s\n' "Usage: install.sh [--targets claude,codex] [--bin-dir DIR] [--claude-skill-dir DIR] [--codex-skill-dir DIR] [--language LANGUAGE] [--repository OWNER/REPO] [--local] [--force]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bin-dir) BIN_DIR=$2; shift 2 ;;
    --claude-skill-dir) CLAUDE_SKILL_ROOT=$2; shift 2 ;;
    --codex-skill-dir) CODEX_SKILL_ROOT=$2; shift 2 ;;
    --targets) TARGETS=$2; shift 2 ;;
    --language) LANGUAGE=$2; shift 2 ;;
    --repository) REPOSITORY=$2; shift 2 ;;
    --local) LOCAL_BUILD=true; shift ;;
    --force) FORCE=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

choose_targets() {
  if [ -n "$TARGETS" ]; then
    return
  fi
  if [ -t 0 ] || [ "${DECISIONATOR_INTERACTIVE:-}" = "1" ]; then
    printf '%s\n' "Install the Decisionator skill for:" >&2
    printf '%s\n' "  1) Claude Code" >&2
    printf '%s\n' "  2) Codex" >&2
    printf '%s' "Select one or more targets (comma-separated, for example 1,2): " >&2
    IFS= read -r TARGETS || TARGETS=""
  else
    printf '%s\n' "No installation target was provided. Pass --targets claude, --targets codex, or --targets claude,codex." >&2
    exit 2
  fi
}

parse_targets() {
  SELECT_CLAUDE=false
  SELECT_CODEX=false
  normalized=$(printf '%s' "$TARGETS" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
  old_ifs=$IFS
  IFS=,
  set -- $normalized
  IFS=$old_ifs
  for target in "$@"; do
    case "$target" in
      1|claude|claude-code) SELECT_CLAUDE=true ;;
      2|codex) SELECT_CODEX=true ;;
      both|all) SELECT_CLAUDE=true; SELECT_CODEX=true ;;
      *)
        printf 'Unknown installation target: %s. Use claude, codex, or both.\n' "$target" >&2
        exit 2
        ;;
    esac
  done
  if [ "$SELECT_CLAUDE" = false ] && [ "$SELECT_CODEX" = false ]; then
    printf '%s\n' "Select at least one installation target." >&2
    exit 2
  fi
}

choose_targets
parse_targets

BIN_PATH="$BIN_DIR/decisionator"
BIN_MARKER="$BIN_PATH.decisionator-managed"

if [ -e "$BIN_PATH" ] && [ ! -f "$BIN_MARKER" ]; then
  printf 'Refusing to replace unmanaged executable: %s\n' "$BIN_PATH" >&2
  exit 1
fi

check_skill_target() {
  skill_path="$1/decisionator"
  if [ -e "$skill_path" ] && [ ! -f "$skill_path/.decisionator-managed" ]; then
    printf 'Refusing to replace unmanaged skill: %s\n' "$skill_path" >&2
    exit 1
  fi
}

if [ "$SELECT_CLAUDE" = true ]; then check_skill_target "$CLAUDE_SKILL_ROOT"; fi
if [ "$SELECT_CODEX" = true ]; then check_skill_target "$CODEX_SKILL_ROOT"; fi

installed_language_from() {
  if [ -f "$1/SKILL.md" ]; then
    sed -n "s/^$CONFIG_PREFIX write every decision screen and every agent reply in \\(.*\\)\\.\$/\\1/p" "$1/SKILL.md" | head -n 1
  fi
}

installed_language() {
  value=""
  if [ "$SELECT_CLAUDE" = true ]; then value=$(installed_language_from "$CLAUDE_SKILL_ROOT/decisionator"); fi
  if [ -z "$value" ] && [ "$SELECT_CODEX" = true ]; then value=$(installed_language_from "$CODEX_SKILL_ROOT/decisionator"); fi
  printf '%s' "$value"
}

choose_language() {
  if [ -n "$LANGUAGE" ]; then
    printf '%s' "$LANGUAGE"
    return
  fi
  default=$(installed_language)
  default=${default:-English}
  answer=""
  if [ -t 0 ] || [ "${DECISIONATOR_INTERACTIVE:-}" = "1" ]; then
    printf 'Language the agent uses for decision screens and replies [%s]: ' "$default" >&2
    IFS= read -r answer || answer=""
  fi
  printf '%s' "${answer:-$default}"
}

LANGUAGE=$(choose_language)
NEWLINE='
'
case "$LANGUAGE" in
  *"$NEWLINE"*) LANGUAGE="" ;;
esac
if [ -z "$LANGUAGE" ] || [ "${#LANGUAGE}" -gt 80 ] || printf '%s' "$LANGUAGE" | LC_ALL=C grep -q '[[:cntrl:]]'; then
  printf '%s\n' "The decision language must be a name on one line, such as English or Polish." >&2
  exit 2
fi

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

normalize_repository() {
  printf '%s' "$1" | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##'
}

detect_repository() {
  if [ -n "$REPOSITORY" ]; then
    normalize_repository "$REPOSITORY"
    return
  fi
  if command -v git >/dev/null 2>&1 && git -C "$PROJECT_DIR" remote get-url origin >/dev/null 2>&1; then
    normalize_repository "$(git -C "$PROJECT_DIR" remote get-url origin)"
    return
  fi
  printf '%s\n' "johniak/decisionator"
}

platform_name() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    arm64|aarch64) arch=arm64 ;;
    *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
  esac
  printf '%s-%s' "$os" "$arch"
}

binary_version() {
  "$1" --version 2>/dev/null | sed -n 's/^Decisionator \([0-9][0-9.]*\)$/\1/p' | head -n 1
}

version_is_newer() {
  awk -v left="$1" -v right="$2" 'BEGIN {
    split(left, a, "."); split(right, b, ".");
    for (i = 1; i <= 3; i++) {
      if ((a[i] + 0) > (b[i] + 0)) exit 0;
      if ((a[i] + 0) < (b[i] + 0)) exit 1;
    }
    exit 1;
  }'
}

verify_checksum() {
  if command -v shasum >/dev/null 2>&1; then
    (cd "$TEMP_DIR" && shasum -a 256 -c "$1.sha256" >/dev/null)
  elif command -v sha256sum >/dev/null 2>&1; then
    (cd "$TEMP_DIR" && sha256sum -c "$1.sha256" >/dev/null)
  else
    printf '%s\n' "A SHA-256 checksum utility (shasum or sha256sum) is required." >&2
    exit 1
  fi
}

write_language_config() {
  skill_path=$1
  configured_line="$CONFIG_PREFIX write every decision screen and every agent reply in $LANGUAGE."
  temporary_skill="$skill_path/.SKILL.md.decisionator.tmp"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$CONFIG_PREFIX"*) printf '%s\n' "$configured_line" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < "$skill_path/SKILL.md" > "$temporary_skill"
  if ! grep -Fqx "$configured_line" "$temporary_skill"; then
    rm -f "$temporary_skill"
    printf '%s\n' "The Decisionator skill is missing its language configuration marker." >&2
    exit 1
  fi
  mv "$temporary_skill" "$skill_path/SKILL.md"
}

skills_are_installed() {
  if [ "$SELECT_CLAUDE" = true ] && [ ! -f "$CLAUDE_SKILL_ROOT/decisionator/SKILL.md" ]; then return 1; fi
  if [ "$SELECT_CODEX" = true ] && [ ! -f "$CODEX_SKILL_ROOT/decisionator/SKILL.md" ]; then return 1; fi
  return 0
}

configure_installed_skills() {
  if [ "$SELECT_CLAUDE" = true ]; then write_language_config "$CLAUDE_SKILL_ROOT/decisionator"; fi
  if [ "$SELECT_CODEX" = true ] && { [ "$SELECT_CLAUDE" = false ] || [ "$CODEX_SKILL_ROOT" != "$CLAUDE_SKILL_ROOT" ]; }; then
    write_language_config "$CODEX_SKILL_ROOT/decisionator"
  fi
}

if [ "$LOCAL_BUILD" = true ]; then
  if [ ! -x "$PROJECT_DIR/dist/decisionator" ] || [ ! -f "$PROJECT_DIR/skills/decisionator/SKILL.md" ]; then
    printf '%s\n' "A local build is not available. Run bun run build first or omit --local." >&2
    exit 1
  fi
  BINARY_SOURCE="$PROJECT_DIR/dist/decisionator"
  SKILL_SOURCE="$PROJECT_DIR/skills/decisionator"
  printf '%s\n' "Installing the local Decisionator build…"
else
  if ! command -v gh >/dev/null 2>&1; then
    printf '%s\n' "GitHub CLI is required to download a release. Install it from https://cli.github.com/, or build from source with bun run build and pass --local." >&2
    exit 1
  fi
  REPOSITORY=$(detect_repository)
  LATEST_TAG=$(gh release view --repo "$REPOSITORY" --json tagName --jq .tagName)
  if ! printf '%s' "$LATEST_TAG" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
    printf 'Latest release has an unsupported version tag: %s\n' "$LATEST_TAG" >&2
    exit 1
  fi
  LATEST_VERSION=${LATEST_TAG#v}
  INSTALLED_VERSION=""
  if [ -x "$BIN_PATH" ]; then
    INSTALLED_VERSION=$(binary_version "$BIN_PATH")
  fi

  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ] && [ "$FORCE" = false ] && skills_are_installed; then
    configure_installed_skills
    printf 'Decisionator %s is already up to date.\n' "$INSTALLED_VERSION"
    printf 'Decision language: %s\n' "$LANGUAGE"
    exit 0
  fi
  if [ -n "$INSTALLED_VERSION" ] && version_is_newer "$INSTALLED_VERSION" "$LATEST_VERSION" && [ "$FORCE" = false ]; then
    if skills_are_installed; then configure_installed_skills; fi
    printf 'Installed Decisionator %s is newer than the latest release %s; keeping it. Use --force to replace it.\n' "$INSTALLED_VERSION" "$LATEST_VERSION"
    printf 'Decision language: %s\n' "$LANGUAGE"
    exit 0
  fi

  PLATFORM=$(platform_name)
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/decisionator-install.XXXXXX")
  ARCHIVE="decisionator-$PLATFORM.tar.gz"
  if [ -n "$INSTALLED_VERSION" ]; then
    printf 'Updating Decisionator %s to %s…\n' "$INSTALLED_VERSION" "$LATEST_VERSION"
  else
    printf 'Installing Decisionator %s…\n' "$LATEST_VERSION"
  fi
  gh release download "$LATEST_TAG" --repo "$REPOSITORY" --pattern "$ARCHIVE" --pattern "$ARCHIVE.sha256" --dir "$TEMP_DIR"
  if ! verify_checksum "$ARCHIVE"; then
    printf 'The downloaded archive does not match its SHA-256 checksum: %s\n' "$ARCHIVE" >&2
    exit 1
  fi
  tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"
  BINARY_SOURCE="$TEMP_DIR/decisionator"
  SKILL_SOURCE="$TEMP_DIR/decisionator-skill"
fi

if [ ! -x "$BINARY_SOURCE" ] || [ ! -f "$SKILL_SOURCE/SKILL.md" ]; then
  printf '%s\n' "The installation payload is incomplete." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
install -m 755 "$BINARY_SOURCE" "$BIN_PATH"
printf '%s\n' "Installed by Decisionator" > "$BIN_MARKER"

install_skill() {
  label=$1
  skill_root=$2
  skill_path="$skill_root/decisionator"
  mkdir -p "$skill_root"
  if [ -d "$skill_path" ]; then rm -rf "$skill_path"; fi
  cp -R "$SKILL_SOURCE" "$skill_path"
  write_language_config "$skill_path"
  printf '%s\n' "Installed by Decisionator" > "$skill_path/.decisionator-managed"
  printf 'Installed %s skill: %s\n' "$label" "$skill_path"
}

printf 'Installed Decisionator executable: %s\n' "$BIN_PATH"
if [ "$SELECT_CLAUDE" = true ]; then install_skill "Claude Code" "$CLAUDE_SKILL_ROOT"; fi
if [ "$SELECT_CODEX" = true ] && { [ "$SELECT_CLAUDE" = false ] || [ "$CODEX_SKILL_ROOT" != "$CLAUDE_SKILL_ROOT" ]; }; then
  install_skill "Codex" "$CODEX_SKILL_ROOT"
fi
printf 'Decision language: %s\n' "$LANGUAGE"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf 'Add %s to PATH before using /decisionator or $decisionator.\n' "$BIN_DIR" ;;
esac
