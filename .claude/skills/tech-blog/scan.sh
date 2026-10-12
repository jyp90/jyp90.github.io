#!/usr/bin/env bash
# De-identification gate for blog drafts.
# Usage: scan.sh <file>...   Exit 0 clean, 1 findings, 2 terms file missing/empty or a file unreadable.
# Terms: ~/.config/tech-blog/forbidden-terms.txt (one per line, # comments). Matched terms are never printed.
# Optional: ~/.config/tech-blog/ticket-keys.txt (one project key per line), matched case-insensitively as KEY-<n>.
# "review:" lines on stderr (business-metric-looking numbers) do not change the exit code; check each by hand.
set -u
export LC_ALL=en_US.UTF-8
terms_file="${TECH_BLOG_TERMS:-$HOME/.config/tech-blog/forbidden-terms.txt}"
keys_file="${TECH_BLOG_KEYS:-$HOME/.config/tech-blog/ticket-keys.txt}"
own_email='jyp90@kakao.com'
public_prefixes='^(UTF|ISO|SHA|MD|AES|RSA|HS|RS|ES|PS|RFC|CVE|HTTP|TLS|JDK|JSR|PEP|GPT|COVID|IEEE|ECMA)-'

[ $# -gt 0 ] || { echo "usage: scan.sh <file>..." >&2; exit 2; }
nfc() { python3 -c 'import sys,unicodedata
for l in sys.stdin: sys.stdout.write(unicodedata.normalize("NFC",l).replace("​","").replace("‌","").replace("‍","").replace("﻿","").replace("­",""))'; }
terms=$(grep -v '^[[:space:]]*#' "$terms_file" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | nfc)
[ -n "$terms" ] || { echo "terms file missing or empty: $terms_file" >&2; exit 2; }
keys=$(grep -v '^[[:space:]]*#' "$keys_file" 2>/dev/null | tr -d '[:space:]' | grep -E '^[A-Za-z][A-Za-z0-9]{1,9}$' | paste -sd'|' -)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

findings=""
add() { findings="$findings$1"$'\n'; }

lines_matching() { # rule ERE file label [grep-flags]
  grep -n${5:-}E -- "$2" "$3" | cut -d: -f1 | while read -r l; do echo "$4:$l: $1"; done
}

for f in "$@"; do
  [ -f "$f" ] && [ -r "$f" ] || { echo "cannot read (not a readable regular file): $f" >&2; exit 2; }
  g="$tmp/n"; nfc < "$f" > "$g" || { echo "cannot normalize: $f" >&2; exit 2; }
  tr -d ' \t._-' < "$g" > "$tmp/sq"   # squashed copy: catches "A B", "A-B", "A_B" spellings of a term
  n=0
  while IFS= read -r t; do
    n=$((n+1))
    hits=$(grep -niF -- "$t" "$g" | cut -d: -f1 | while read -r l; do echo "$f:$l: term#$n"; done)
    [ -n "$hits" ] && add "$hits"
    ts=$(printf '%s' "$t" | tr -d ' \t._-')
    [ "${#ts}" -ge 4 ] && [ -z "$hits" ] && {
      hits=$(grep -niF -- "$ts" "$tmp/sq" | cut -d: -f1 | while read -r l; do echo "$f:$l: term#$n(spaced)"; done)
      [ -n "$hits" ] && add "$hits"; }
  done <<< "$terms"

  hits=$(grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$g" \
    | grep -vE ":(git@github\.com$|${own_email//./\\.}$|[^:]*@example\.(com|org)$)" \
    | cut -d: -f1 | sort -un | while read -r l; do echo "$f:$l: email"; done)
  [ -n "$hits" ] && add "$hits"

  hits=$(grep -noE '(^|[^A-Za-z0-9])[A-Z][A-Z0-9]{1,9}-[0-9]+' "$g" \
    | sed -E 's/^([0-9]+):[^A-Z]?/\1:/' | while IFS=: read -r l k; do
        echo "$k" | grep -qE "$public_prefixes" || echo "$f:$l: ticket-key"; done | sort -u)
  [ -n "$hits" ] && add "$hits"
  if [ -n "$keys" ]; then
    hits=$(lines_matching ticket-key-ci "(^|[^A-Za-z0-9])($keys)-[0-9]+" "$g" "$f" i); [ -n "$hits" ] && add "$hits"
  fi

  for rule in \
    'private-ip|(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})' \
    'internal-host|[A-Za-z0-9-]+\.(internal|local|corp|lan)([^A-Za-z0-9-]|$)' \
    'internal-link|atlassian\.net|slack\.com/archives|notion\.so' \
    'account-id|(^|[^0-9])[0-9]{12}([^0-9]|$)' \
    'cloud-resource|amazonaws\.com|s3://|git-codecommit\.|arn:aws[a-z-]*:|blob\.core\.windows\.net|storage\.googleapis\.com/' \
    'branch-ref|(^|[^A-Za-z0-9])(feature|bugfix|hotfix|release|fix)/[A-Za-z][A-Za-z0-9]{1,9}-[0-9]+' \
    'kr-pii|(^|[^0-9])(01[016789]-?[0-9]{3,4}-?[0-9]{4}|[0-9]{3}-[0-9]{2}-[0-9]{5}|[0-9]{6}-[1-4][0-9]{6})([^0-9]|$)' \
    'secret|PRIVATE KEY|sk-ant-|sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{10,}|hooks\.slack\.com/(services|workflows)/|AIza[0-9A-Za-z_-]{30,}|(sk|rk)_live_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{30,}|ATATT[A-Za-z0-9_=-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}' \
    'credential-url|[A-Za-z][A-Za-z0-9+.-]*://[^/[:space:]:@]+:[^/[:space:]@]+@' ; do
    hits=$(lines_matching "${rule%%|*}" "${rule#*|}" "$g" "$f")
    [ -n "$hits" ] && add "$hits"
  done
  for rule in \
    'secret-assign|(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|credential|비밀번호|패스워드|암호|토큰|시크릿|인증키)[A-Za-z0-9_]*["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9_./+=-]{8,}' \
    'bearer|(bearer|basic)[[:space:]]+[A-Za-z0-9._~+/=-]{16,}' \
    'env-secret|^[[:space:]]*(export[[:space:]]+)?[A-Z][A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD|PASS|PWD|CREDENTIALS?)[A-Z0-9_]*=[^[:space:]]{8,}'; do
    hits=$(lines_matching "${rule%%|*}" "${rule#*|}" "$g" "$f" i)
    [ -n "$hits" ] && add "$hits"
  done
  grep -nE '[0-9][0-9,.]*[[:space:]]*(만|억|천)?[[:space:]]*(건|명|원|%|퍼센트|기관|회원|개사|고객)' "$g" \
    | cut -d: -f1 | while read -r l; do echo "review: $f:$l: metric?" >&2; done
done

[ -z "$findings" ] && exit 0
printf '%s' "$findings"
exit 1
