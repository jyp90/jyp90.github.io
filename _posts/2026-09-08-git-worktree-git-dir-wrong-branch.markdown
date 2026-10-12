---
layout: post
title: "여러 git 저장소를 안전하게 다루기 (2) worktree에 --git-dir을 넘기면 엉뚱한 브랜치에 커밋되는 이유"
date: 2026-09-08 09:00:00 +0900
categories: blog
tags: [Git, 개발도구, Shell, 장애복구]
excerpt: "서브모듈 worktree에서 --git-dir로 공통 저장소를 지정하면 커밋이 메인 체크아웃의 브랜치에 쌓이는 원리와, HEAD가 어디로 풀리는지 확인하는 법, 남의 미커밋 변경 때문에 pull이 막혔을 때 임시 worktree로 push하는 방법을 정리합니다."
---

> **시리즈: 여러 git 저장소를 안전하게 다루기**
>
> 1. [(1) SVN을 전체 이력째 git으로 옮기기](/blog/2026/08/30/svn-to-git-full-history-migration.html)
> 2. **(2) worktree에 --git-dir을 넘기면 엉뚱한 브랜치에 커밋되는 이유**
> 3. [(3) 수십 개 저장소를 git grep 패턴 파일로 한 번에 훑기](/blog/2026/09/19/multi-repo-git-grep-pattern-file.html)

## 문제와 배경

여러 저장소를 서브모듈로 묶은 작업 공간에서, 서브모듈 하나(`app-web`)에 기능 브랜치용 worktree를 따로 만들어 작업하고 있었습니다. 그 worktree에서 개발 브랜치를 머지하는 명령을 이런 형태로 실행했습니다.

```bash
git --git-dir=.git/modules/app-web --work-tree=../wt-feature merge origin/dev
```

명령은 오류 없이 끝났고, 파일도 worktree 쪽에 정상으로 반영됐습니다. 그런데 커밋은 기능 브랜치가 아니라 **메인 체크아웃이 잡고 있던 브랜치**에 쌓였습니다. 로컬의 배포 기준 브랜치가 원격보다 커밋 두 개 앞서 버린 것입니다. push 전이라 원격은 무사했지만, 그대로 push했다면 공유 브랜치에 엉뚱한 커밋이 올라갔을 것입니다.

`--git-dir`을 붙인 이유는 단순했습니다. 서브모듈의 실제 저장소는 서브모듈 디렉터리가 아니라 상위 저장소의 `.git/modules/<경로>` 아래에 있습니다. 이 사실을 알고 나면 스크립트나 자동화 도구에서 "git-dir을 명시하는 편이 안전하다"는 습관이 생기기 쉽습니다. 메인 체크아웃에 대해서는 틀린 말이 아니지만, 같은 경로를 worktree에 넘기면 정반대 결과가 나옵니다.

## 원리: 저장소는 하나, HEAD는 체크아웃마다 따로

### `.git`이 파일인 두 경우

서브모듈의 메인 체크아웃과 그 서브모듈에서 만든 worktree는 둘 다 `.git`이 디렉터리가 아니라 **한 줄짜리 파일**입니다. 다만 가리키는 곳이 다릅니다.

| 위치 | `.git` 파일 내용 | 그 디렉터리에 있는 것 |
|---|---|---|
| 메인 체크아웃 `app-web/` | `gitdir: ../.git/modules/app-web` | 공통 저장소 전체(objects, refs, config) **와** 메인 체크아웃 전용 `HEAD`, `index` |
| worktree `wt-feature/` | `gitdir: .../.git/modules/app-web/worktrees/wt-feature` | 이 worktree 전용 `HEAD`, `index`, 그리고 공통 저장소를 가리키는 `commondir` |

여기서 핵심은 `.git/modules/app-web`이 두 가지 역할을 겸한다는 점입니다. 모든 worktree가 공유하는 공통 저장소이면서, 동시에 **메인 체크아웃 한 곳의 git-dir**이기도 합니다. 그래서 그 안의 `HEAD`는 메인 체크아웃이 체크아웃한 브랜치를 가리킵니다.

worktree의 git-dir(`worktrees/<이름>/`)에는 `HEAD`와 `index`가 따로 있고, `commondir` 파일(내용은 `../..`)로 objects와 refs를 공통 저장소에서 찾아갑니다. 브랜치 ref 자체는 공유하지만, "지금 어느 브랜치에 있는가"는 체크아웃마다 따로 기록되는 구조입니다.

### `--git-dir`은 이 연결을 끊습니다

git은 명령을 실행할 때 git-dir을 먼저 정하고, 그 안의 `HEAD`와 `index`를 씁니다. 옵션 없이 worktree 안에서 실행하면 `.git` 파일을 따라 `worktrees/<이름>/`이 git-dir이 되므로 `HEAD`는 기능 브랜치입니다.

`--git-dir=.git/modules/app-web`을 직접 주면 이 해석 단계를 건너뜁니다. git-dir은 공통 저장소가 되고, 그 안의 `HEAD`, 곧 **메인 체크아웃의 브랜치**가 커밋 대상이 됩니다. `--work-tree`는 파일을 어디서 읽고 어디에 쓸지만 바꿀 뿐 `HEAD`를 바꾸지 않습니다. 결과적으로 이렇게 나뉩니다.

| 무엇 | 어디로 가는가 |
|---|---|
| 작업 파일 읽기·쓰기 | `--work-tree`로 준 worktree |
| 스테이징(index) | 메인 체크아웃의 index |
| 커밋이 올라가는 브랜치 | 메인 체크아웃의 `HEAD`가 가리키는 브랜치 |

오류가 나지 않는다는 점이 이 문제를 위험하게 만듭니다. 파일은 기대한 곳에 있으니 겉으로는 모든 것이 정상으로 보입니다. 환경 변수 `GIT_DIR`도 `--git-dir`과 같은 효과를 내므로(git 공식 문서의 정의입니다) 스크립트에서 이 변수를 export해 두는 경우도 같은 함정에 빠집니다.

## 재현 스크립트

임시 디렉터리에 저장소를 처음부터 만들어 위 동작을 재현하는 스크립트입니다. 사용자 전역 설정의 영향을 받지 않도록 `GIT_CONFIG_GLOBAL=/dev/null`로 실행합니다. 아래 출력은 git 2.54(macOS)에서 직접 실행한 결과이고, 해시와 임시 경로는 실행할 때마다 달라집니다.

```bash
#!/usr/bin/env bash
set -euo pipefail
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@example.com
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@example.com
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/gitdir-demo.XXXXXX")
cd "$ROOT"

# 서브모듈로 쓸 저장소
git init -q -b main app-web-src
git -C app-web-src commit -q --allow-empty -m "init app-web"

# 작업 공간 저장소에 서브모듈로 붙이고, 메인 체크아웃은 main에 둡니다
git init -q -b main workspace
cd workspace
git commit -q --allow-empty -m "init workspace"
git -c protocol.file.allow=always submodule add -q "$ROOT/app-web-src" app-web
git commit -q -m "add app-web"
git -C app-web switch -q main

# 서브모듈 안에 기능 브랜치용 worktree
git -C app-web worktree add -q -b feature/login "$ROOT/wt-login"

echo "app-web/.git  : $(cat app-web/.git)"
echo "wt-login/.git : $(cat "$ROOT/wt-login/.git")"
echo "공통 HEAD     : $(cat .git/modules/app-web/HEAD)"
echo "worktree HEAD : $(cat .git/modules/app-web/worktrees/wt-login/HEAD)"

# 잘못된 방식: 공통 저장소를 git-dir로 직접 넘깁니다
echo "change" > "$ROOT/wt-login/login.txt"
git --git-dir=.git/modules/app-web --work-tree="$ROOT/wt-login" add login.txt
git --git-dir=.git/modules/app-web --work-tree="$ROOT/wt-login" commit -q -m "login 작업"

git -C app-web log --oneline -1 main
git -C app-web log --oneline -1 feature/login
git -C app-web status --short
```

출력은 다음과 같았습니다(임시 경로는 줄였습니다).

```text
app-web/.git  : gitdir: ../.git/modules/app-web
wt-login/.git : gitdir: <tmp>/workspace/.git/modules/app-web/worktrees/wt-login
공통 HEAD     : ref: refs/heads/main
worktree HEAD : ref: refs/heads/feature/login
b5485c5 login 작업
189ad8b init app-web
 D login.txt
```

worktree에서 만든 `login.txt` 커밋이 `main`에 올라갔고, `feature/login`은 처음 상태 그대로입니다. 마지막 줄도 눈여겨볼 만합니다. 스테이징이 메인 체크아웃의 index에 들어갔기 때문에, 메인 체크아웃 입장에서는 "커밋에는 있는데 작업 트리에는 없는 파일"이 생겨 `D`(삭제됨)로 보입니다. 메인 체크아웃에서 누군가 작업 중이었다면 그 사람의 스테이징 상태도 함께 섞였을 것입니다.

## HEAD가 어디로 풀리는지 확인하는 법

명령을 실행하기 전에 git이 어떤 git-dir과 브랜치를 잡는지 확인할 수 있습니다. 모두 읽기 전용 명령입니다.

```bash
cd ../wt-login

git rev-parse --git-dir         # .../modules/app-web/worktrees/wt-login 이어야 합니다
git rev-parse --git-common-dir  # 공통 저장소(.../modules/app-web)
git rev-parse --show-toplevel   # 지금 작업 트리의 최상위 경로
git symbolic-ref HEAD           # refs/heads/feature/login
git branch --show-current       # feature/login
```

판단 기준은 간단합니다.

- `git rev-parse --git-dir`이 `.../worktrees/<이름>`으로 끝나면 worktree를 제대로 잡은 것입니다.
- `.../modules/<경로>`로 끝나는데 지금 있는 곳이 worktree라면, 메인 체크아웃의 HEAD를 잡은 상태이니 멈춥니다.
- `--git-dir`과 `--git-common-dir`이 같은 디렉터리를 가리키면 지금 git은 "메인 체크아웃"으로 동작하고 있다는 뜻입니다.

커밋이나 머지를 한 뒤에는 첫 부모가 기대한 베이스인지 한 번 더 봅니다.

```bash
git log --pretty='%h %p %s' -1   # %p의 첫 번째 해시가 기대한 브랜치의 이전 커밋인지
git branch --show-current
```

## 안전한 습관

- **worktree에서는 `cd`한 뒤 옵션 없는 git을 씁니다.** worktree의 `.git` 파일이 이미 올바른 git-dir을 가리키므로 `--git-dir`이 필요한 상황 자체가 없습니다. 셸 상태가 호출마다 초기화되는 자동화 도구에서는 `cd <worktree> && git <명령>`을 한 줄로 묶습니다.
- **`git -C <경로>`는 괜찮습니다.** `-C`는 "이 디렉터리에서 실행한 것처럼" 동작하므로 `.git` 파일 해석을 거칩니다. 위험한 것은 git-dir을 직접 지정하는 `--git-dir`과 `GIT_DIR`입니다.
- **git-dir을 명시해야 한다는 규칙이 있다면 적용 범위를 적어 둡니다.** "서브모듈의 실제 저장소는 `.git/modules/` 아래에 있다"는 설명은 메인 체크아웃에 대한 사실입니다. 이것이 "모든 체크아웃에 그 git-dir을 넘겨라"로 일반화되지 않도록, 문서나 에이전트 지침에 worktree는 예외라고 함께 적어 두는 편이 좋습니다.
- **실행 전 확인을 습관으로 둡니다.** 공유 브랜치로 이어질 수 있는 머지·커밋 앞에는 `git rev-parse --git-dir`과 `git branch --show-current` 두 줄이면 충분합니다.

## 이미 잘못 커밋했다면

push 전이라면 되돌릴 수 있습니다. 파일은 이미 worktree에 들어가 있으므로, worktree에서 평범하게 다시 커밋하고 메인 체크아웃 쪽 브랜치는 한 커밋 되돌립니다. 아래는 위 재현 스크립트에 이어 실행해 확인한 순서입니다.

```bash
BAD=$(git -C app-web rev-parse main)

# 1) worktree에서 같은 변경을 다시 커밋합니다(메시지는 -C로 재사용)
cd "$ROOT/wt-login"
git add login.txt
git commit -q -C "$BAD"

# 2) 메인 체크아웃 브랜치를 한 커밋 되돌립니다
cd "$ROOT/workspace/app-web"
git reset -q HEAD~1        # 기본값 --mixed: 작업 트리는 건드리지 않습니다
git status --short         # 출력이 없으면 깨끗합니다
```

`--mixed`를 고른 이유는 메인 체크아웃의 작업 트리를 건드리지 않기 위해서입니다. 다만 index는 되돌아가므로, 메인 체크아웃에 다른 사람이 스테이징해 둔 변경이 있었다면 그 스테이징도 풀립니다. 공유하는 체크아웃이라면 되돌리기 전에 주인에게 먼저 확인합니다. 잘못된 커밋이 머지 커밋이었다면 worktree에서 머지를 처음부터 다시 하는 편이 깔끔합니다. 이미 push했다면 공유 브랜치의 이력을 고치는 일이 되므로 `revert`로 처리하거나 팀과 상의해야 합니다.

## 덧붙여: 남의 미커밋 변경 때문에 pull이 막힐 때

worktree를 쓰는 다른 이유도 하나 정리해 둡니다. 여러 세션이나 에이전트가 같은 체크아웃을 공유하면, 내 커밋을 push하려는데 브랜치가 원격보다 뒤처져 있고 `pull`이 이렇게 거부되는 경우가 생깁니다.

```text
error: Your local changes to the following files would be overwritten by merge:
	README.md
Please commit your changes or stash them before you merge.
```

여기서 걸린 `README.md`는 내가 아니라 다른 세션이 고치는 중인 파일이고, 원격에서도 누군가 같은 파일을 고쳤습니다. 메시지가 권하는 대로 `git stash`를 하면 남의 작업이 stash 목록에 갇히고, 나중에 다시 꺼낼 때 원격 변경과의 충돌을 내가 풀어야 합니다. 그 충돌을 어떻게 풀지는 작업 주인이 판단할 일입니다. `reset`은 더 나쁩니다. 그 변경이 사라집니다.

대신 **체크아웃을 전혀 건드리지 않고** 별도 worktree에서 원격 최신 위에 내 커밋만 올립니다.

```bash
# 0) 원격이 바꾼 파일과 내 커밋이 바꾼 파일이 겹치는지 먼저 봅니다
git fetch
git diff --name-only HEAD...origin/main    # 원격 쪽 변경
git diff --name-only origin/main...HEAD    # 내 커밋 쪽 변경

# 1) 원격 최신에서 임시 worktree를 만듭니다(브랜치 없이 detached)
git worktree add --detach ../push-tmp origin/main

# 2) 내 커밋만 오래된 순서대로 옮겨 push합니다
MINE=$(git rev-list --reverse origin/main..main)
cd ../push-tmp
git cherry-pick $MINE
git push origin HEAD:main

# 3) 임시 worktree를 지웁니다
cd - && git worktree remove --force ../push-tmp
```

이 순서도 임시 저장소에서 재현해 확인했습니다. `pull`은 위 메시지로 거부됐고, 임시 worktree의 cherry-pick과 push는 충돌 없이 통과했으며, 원래 체크아웃의 미커밋 변경(` M README.md`)은 그대로 남았습니다.

알아 둘 점이 몇 가지 있습니다.

- **0단계에서 파일이 겹치면 이 방법을 쓰지 않습니다.** 겹치면 cherry-pick 자체가 충돌하고, 그 충돌은 결국 원격 변경과 내 변경 사이의 문제라 별도로 풀어야 합니다.
- **push 뒤에도 로컬 브랜치는 `ahead 1, behind 2`처럼 어긋난 상태로 남습니다.** cherry-pick이 새 커밋 해시를 만들기 때문입니다. 미커밋 변경의 주인이 커밋한 뒤 원격을 받아 오면, git이 같은 패치를 알아보므로 내 변경이 두 번 들어가지는 않습니다(재현 스크립트에서는 이 마지막 단계까지는 확인하지 않았습니다).
- **서브모듈을 품은 상위 저장소에서 이 방법을 쓸 때는** `git -c submodule.recurse=0 worktree add ...`처럼 서브모듈 재귀를 꺼 두는 편이 안전합니다. 서브모듈 포인터를 올리는 커밋은 index의 gitlink만 바꾸므로 서브모듈이 체크아웃되지 않은 worktree에서도 cherry-pick할 수 있습니다. 다만 그 포인터가 가리키는 커밋이 원격에 이미 있는지(`git branch -r --contains <sha>`)는 먼저 확인합니다.
- 이 임시 worktree에도 앞의 규칙이 그대로 적용됩니다. `cd`해서 옵션 없는 git으로 작업합니다.

## 정리

- 서브모듈의 `.git/modules/<경로>`는 공통 저장소이면서 **메인 체크아웃의 git-dir**입니다. 그 안의 `HEAD`는 메인 체크아웃의 브랜치입니다.
- worktree는 `.git` 파일로 자기 전용 `worktrees/<이름>/`을 가리키고, 그곳에 따로 `HEAD`와 `index`를 둡니다.
- `--git-dir`(또는 `GIT_DIR`)로 공통 저장소를 넘기면 파일은 worktree에 쓰이지만 스테이징과 커밋은 메인 체크아웃 쪽으로 갑니다. 오류는 나지 않습니다.
- worktree에서는 `cd`한 뒤 옵션 없이 실행하고, 중요한 명령 전에는 `git rev-parse --git-dir`과 `git branch --show-current`로 확인합니다.
- 남의 미커밋 변경 때문에 pull이 막히면 stash하지 말고, 임시 worktree에서 원격 최신 위에 내 커밋만 cherry-pick해 push합니다.
