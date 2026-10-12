#!/usr/bin/env bash
# Fixture test for scan.sh. Run: bash .claude/skills/tech-blog/scan.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
check() { # name expected_exit expected_grep file
  out=$(TECH_BLOG_TERMS="$tmp/terms.txt" bash "$here/scan.sh" "$4" 2>&1); code=$?
  if [ "$code" = "$2" ] && { [ -z "$3" ] || printf '%s\n' "$out" | grep -qE -- "$3"; }; then pass=$((pass+1))
  else fail=$((fail+1)); echo "FAIL $1: exit=$code out=$out"; fi
}

printf '# header comment\n\nAcmeCorp\n  \nwidgetly\n' > "$tmp/terms.txt"

printf '일반적인 멱등성 설명입니다.\nUTF-8, SHA-256, ISO-8601, RFC-7231\ngit@github.com:jyp90/x.git\n연락: jyp90@kakao.com\n' > "$tmp/clean.md"
check clean 0 '' "$tmp/clean.md"

printf 'line one\nwe built it at acmecorp\n' > "$tmp/term.md"
check term-case-insensitive 1 ':2: term#1$' "$tmp/term.md"
out=$(TECH_BLOG_TERMS="$tmp/terms.txt" bash "$here/scan.sh" "$tmp/term.md")
printf '%s' "$out" | grep -qi acme && { fail=$((fail+1)); echo "FAIL term-not-echoed"; } || pass=$((pass+1))

printf 'mail me: kim@company.co.kr\n' > "$tmp/email.md";   check email 1 ':1: email$' "$tmp/email.md"
printf 'db at 10.0.3.7 and 192.168.1.20\n' > "$tmp/ip.md"; check private-ip 1 ':1: private-ip$' "$tmp/ip.md"
printf 'see api.billing.internal\n' > "$tmp/host.md";       check internal-host 1 ':1: internal-host$' "$tmp/host.md"
printf 'https://x.atlassian.net/browse/A\n' > "$tmp/link.md"; check internal-link 1 ':1: internal-link$' "$tmp/link.md"
printf 'fixed in PAY-1234\n' > "$tmp/ticket.md";            check ticket-key 1 ':1: ticket-key$' "$tmp/ticket.md"
printf 'remote git@gitlab.example-corp.io:team/repo.git\n' > "$tmp/gitat.md"; check git-at-other-host 1 ':1: email$' "$tmp/gitat.md"
check missing-file 2 'cannot read' "$tmp/no-such-file.md"
printf 'account 123456789012 here\n' > "$tmp/acct.md";      check account-id 1 ':1: account-id$' "$tmp/acct.md"
printf 'key AKIAABCDEFGHIJKLMNOP\n' > "$tmp/secret.md";      check secret 1 ':1: secret$' "$tmp/secret.md"

printf '# only a comment\n\n' > "$tmp/terms.txt"
check empty-terms 2 'terms file' "$tmp/clean.md"
rm "$tmp/terms.txt"
check missing-terms 2 'terms file' "$tmp/clean.md"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
