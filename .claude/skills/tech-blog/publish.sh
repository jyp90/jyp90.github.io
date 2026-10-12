#!/usr/bin/env bash
# Publish one approved draft through a PR (direct push to master is blocked by a protected-branch hook).
# usage: publish.sh <draft.markdown> <YYYY-MM-DD> <slug> <title> [<commit trailer>]
# Exit 0 only when the post URL answers 200. Run as ONE Bash call with a 600000 ms timeout.
set -u
[ $# -ge 4 ] || { echo "usage: publish.sh <draft> <YYYY-MM-DD> <slug> <title> [trailer]" >&2; exit 2; }
D=$1; DT=$2; SL=$3; TI=$4; TR=${5:-}
B=~/Projects/jyp90.github.io; S=$(cd "$(dirname "$0")" && pwd); GH=jyp90/jyp90.github.io
P=_posts/$DT-$SL.markdown; BR=post/$SL
[ -f "$D" ] || { echo "draft not found: $D"; exit 1; }
[ -d "$B" ] || git clone -q git@github.com:$GH.git "$B" || exit 1
e=$(git -C "$B" config user.email); [ -z "$e" ] && git -C "$B" config user.email jyp90@kakao.com && e=jyp90@kakao.com
[ "$e" = jyp90@kakao.com ] || { echo "blog repo email is not jyp90@kakao.com — stop"; exit 1; }
printf '%s\n' "$SL" > "$D.slug" && bash "$S/scan.sh" "$D.slug" || { echo "slug scan failed — stop"; exit 1; }
[ "$(git -C "$B" branch --show-current)" = master ] && [ -z "$(git -C "$B" status --porcelain)" ] \
  || { echo "blog repo not on a clean master — stop and ask the user"; exit 1; }
git -C "$B" pull -q --ff-only origin master || { echo "pull failed — stop and ask the user"; exit 1; }
[ -e "$B/$P" ] && { echo "$P already exists — stop"; exit 1; }
git -C "$B" checkout -q -b "$BR" || exit 1
undo() { git -C "$B" rm -q --cached "$P" 2>/dev/null; rm -f "$B/$P"; git -C "$B" checkout -q master; git -C "$B" branch -q -D "$BR"; }
cp "$D" "$B/$P" && git -C "$B" add "$P"
bash "$S/scan.sh" "$B/$P" || { undo; echo "post scan failed — stop"; exit 1; }
bash "$S/lint.sh" "$B/$P" || { undo; echo "post lint failed — stop"; exit 1; }
if [ -n "$TR" ]; then git -C "$B" commit -q -m "post: $TI" -m "$TR"; else git -C "$B" commit -q -m "post: $TI"; fi || { undo; exit 1; }
git -C "$B" push -q -u origin "$BR" || { echo "push failed — stop and ask the user"; exit 1; }
cd "$B" || exit 1
gh pr create -R $GH -B master -H "$BR" -t "post: $TI" -b "새 글을 게시합니다." >/dev/null || { echo "pr create failed — stop"; exit 1; }
gh pr merge "$BR" -R $GH --merge --delete-branch >/dev/null 2>&1 || gh pr merge "$BR" -R $GH --merge || { echo "pr merge failed — stop"; exit 1; }
git -C "$B" checkout -q master && git -C "$B" pull -q --ff-only origin master || { echo "ff to master failed — stop"; exit 1; }
git -C "$B" branch -q -D "$BR" 2>/dev/null
sha=$(git -C "$B" rev-parse HEAD); id=""
for i in 1 2 3 4 5 6; do sleep 10; id=$(gh run list -R $GH --commit "$sha" --limit 1 --json databaseId -q '.[0].databaseId'); [ -n "$id" ] && break; done
[ -n "$id" ] && gh run watch "$id" -R $GH --exit-status >/dev/null; echo "pages-run=${id:-none} exit=$?"
U=https://jyp90.github.io/blog/${DT//-//}/$SL.html
for i in 1 2 3 4 5 6 7 8 9; do c=$(curl -s -o /dev/null -w '%{http_code}' "$U"); [ "$c" = 200 ] && break; sleep 10; done
echo "$c $U"; [ "$c" = 200 ]
