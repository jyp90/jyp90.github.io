# First run: forbidden-terms file

Read this only when `scan.sh` exits 2 (terms file missing or empty).

If `~/.config/tech-blog/forbidden-terms.txt` is missing or has no terms (`scan.sh` exit 2), create it and pre-seed it with work email domains and non-`jyp90` remote owners (GitHub orgs), writing straight to the file without printing anything. Run `sources.md` 「Repo discovery」 first (it writes `<scratchpad>/repos.txt`):

```bash
SP=<scratchpad>; T=~/.config/tech-blog/forbidden-terms.txt; mkdir -p ~/.config/tech-blog
[ -f "$T" ] || printf '%s\n' '# tech-blog forbidden terms: one per line, case-insensitive fixed strings.' \
  '# Company, service, client, codename, domain, host. Private file: never commit or print it.' > "$T"
{ while IFS= read -r r; do git -C "$r" config user.email; done < "$SP/repos.txt" | grep -vxF jyp90@kakao.com | sed 's/.*@//'
  while IFS= read -r r; do git -C "$r" remote get-url origin 2>/dev/null; done < "$SP/repos.txt" \
    | sed -E 's#\.git$##; s#^.*[:/]([^/:]+)/[^/]+$#\1#' | grep -vixF jyp90; } \
  | grep -v '^$' | sort -u | while IFS= read -r d; do grep -qixF -- "$d" "$T" || printf '%s\n' "$d" >> "$T"; done
```
Then ask the user to add company/service/client/codename names themselves (「회사·서비스·고객사 이름을 `~/.config/tech-blog/forbidden-terms.txt`에 한 줄씩 추가해 주세요」). Do not guess or type those names yourself. Continue only once `scan.sh` no longer exits 2.
- Each identifier goes in once per spelling: English, Korean, abbreviation, old name. Ticket project keys go in `~/.config/tech-blog/ticket-keys.txt` (one key per line, matched case-insensitively as `KEY-<n>`), not in the terms file, because a short key as a fixed string matches ordinary words.
- After seeding, you may collect module, host-domain, DB and knowledge-base domain names from the workspace into a private candidate file (`~/.config/tech-blog/uncovered-candidates.txt`) for the user to review; never type them into chat.

