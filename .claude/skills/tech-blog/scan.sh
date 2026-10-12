#!/usr/bin/env bash
# De-identification gate for blog drafts.
# Usage: scan.sh <file>...   Exit 0 clean, 1 findings, 2 terms file missing/empty or a file unreadable.
# Terms: ~/.config/tech-blog/forbidden-terms.txt (one per line, # comments). Matched terms are never printed.
set -u
terms_file="${TECH_BLOG_TERMS:-$HOME/.config/tech-blog/forbidden-terms.txt}"
own_email='jyp90@kakao.com'
public_prefixes='^(UTF|ISO|SHA|MD|AES|RSA|HS|RS|ES|PS|RFC|CVE|HTTP|TLS|JDK|JSR|PEP)-'

[ $# -gt 0 ] || { echo "usage: scan.sh <file>..." >&2; exit 2; }
terms=$(grep -v '^[[:space:]]*#' "$terms_file" 2>/dev/null | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$')
[ -n "$terms" ] || { echo "terms file missing or empty: $terms_file" >&2; exit 2; }

findings=""
add() { findings="$findings$1"$'\n'; }

lines_matching() { # rule ERE file
  grep -nE -- "$2" "$3" | cut -d: -f1 | while read -r l; do echo "$3:$l: $1"; done
}

for f in "$@"; do
  [ -r "$f" ] || { echo "cannot read: $f" >&2; exit 2; }
  n=0
  while IFS= read -r t; do
    n=$((n+1))
    hits=$(grep -niF -- "$t" "$f" | cut -d: -f1 | while read -r l; do echo "$f:$l: term#$n"; done)
    [ -n "$hits" ] && add "$hits"
  done <<< "$terms"

  hits=$(grep -noE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$f" \
    | grep -vE ":(git@github\.com$|${own_email//./\\.}$|[^:]*@example\.(com|org)$)" \
    | cut -d: -f1 | sort -un | while read -r l; do echo "$f:$l: email"; done)
  [ -n "$hits" ] && add "$hits"

  hits=$(grep -noE '(^|[^A-Za-z0-9])[A-Z][A-Z0-9]{1,9}-[0-9]+' "$f" \
    | sed -E 's/^([0-9]+):[^A-Z]?/\1:/' | while IFS=: read -r l k; do
        echo "$k" | grep -qE "$public_prefixes" || echo "$f:$l: ticket-key"; done | sort -u)
  [ -n "$hits" ] && add "$hits"

  for rule in \
    'private-ip|(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})' \
    'internal-host|[A-Za-z0-9-]+\.(internal|local|corp|lan)([^A-Za-z0-9-]|$)' \
    'internal-link|atlassian\.net|slack\.com/archives|notion\.so' \
    'account-id|(^|[^0-9])[0-9]{12}([^0-9]|$)' \
    'secret|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|PRIVATE KEY'; do
    hits=$(lines_matching "${rule%%|*}" "${rule#*|}" "$f")
    [ -n "$hits" ] && add "$hits"
  done
done

[ -z "$findings" ] && exit 0
printf '%s' "$findings"
exit 1
