---
layout: post
title: "여러 git 저장소를 안전하게 다루기 (1) SVN을 전체 이력째 git으로 옮기기"
date: 2026-08-30 09:00:00 +0900
categories: blog
tags: [Git, SVN, 마이그레이션, 개발도구]
excerpt: "SVN 저장소를 전체 이력째 git으로 옮기고, 외부에서 통째로 받은 코드를 공통 조상 기준 3-way merge로 합치는 절차를 정리합니다."
series: "여러 git 저장소를 안전하게 다루기"
summary:
  - "SVN 저장소를 git으로 옮기면서 외부 팀 결과물과 내부 변경을 합쳐야 했습니다."
  - "공통 조상 커밋이 있어야 3-way merge가 진짜 충돌만 남긴다는 원리에 따라 전체 이력 이관을 선택했습니다."
  - "git svn으로 전체 이력을 옮기고 baseline 위에 외부 결과물을 올려 merge로 통합했습니다."
---

## 문제와 배경

SVN으로 관리하던 저장소 하나를 git으로 옮기고, 여러 저장소를 서브모듈로 묶은 작업 공간에 넣어야 했습니다. 조건이 세 가지 겹쳐 있었습니다.

- 빌드·배포 파이프라인이 SVN에 물려 있어서 한 번에 끊을 수 없었습니다.
- 담당자는 git 안에서 `git log`, `git blame`으로 예전 변경 이력까지 추적하기를 원했습니다. 현재 소스만 커밋 하나로 올리는 이관으로는 이 요구를 채울 수 없습니다.
- 외부 협력 팀이 특정 시점의 SVN 소스를 떠 가서 자기 저장소에서 고도화하고 있었고, 끝나면 결과물을 **코드 묶음 하나로** 넘겨줄 예정이었습니다. 그동안 내부에서도 같은 코드를 계속 고쳤습니다.

어려운 부분은 세 번째입니다. 외부 결과물로 현재 코드를 덮어쓰면 그사이 내부에서 고친 내용이 사라집니다. 반대로 내부 변경을 SVN 커밋 로그에서 하나씩 찾아 외부 결과물에 다시 넣는 일은 느리고 빠뜨리기 쉽습니다. 이 글은 이 통합을 git의 3-way merge가 대신하게 만드는 절차를 다룹니다. 이관 방식을 고르는 기준도 이 목표에서 나옵니다.

## 접근: 공통 조상이 있어야 3-way merge가 됩니다

통합할 두 갈래는 **외부 결과물**과 **그동안의 내부 변경**입니다. 두 갈래가 갈라진 지점, 즉 외부 팀이 소스를 떠 간 SVN 리비전이 공통 조상입니다. 이 글에서는 이 리비전을 `R_base`라고 부릅니다.

```text
SVN/git 이력:  ... ── R_base ── 내부 변경 ── 내부 변경 ── 현재
                        │
외부 저장소:            └──── 고도화 ──── 고도화 ──── 결과물(코드 묶음)
```

git의 merge는 두 브랜치 끝과 공통 조상을 함께 봅니다. 공통 조상과 비교해서 한쪽만 바뀐 줄은 그쪽을 자동으로 고르고, 양쪽이 같은 곳을 다르게 바꿨을 때만 충돌로 표시합니다. 따라서 git 이력 안에 `R_base`에 해당하는 커밋이 있으면 남는 일은 진짜 충돌을 푸는 것뿐입니다.

공통 조상이 없으면 git은 두 파일을 그냥 맞대어 비교할 수밖에 없습니다. 내부에서 이미 끝낸 수정까지 「외부 결과물과 다르다」는 이유로 전부 충돌이 되고, 결국 하나씩 찾아 넣는 수작업으로 돌아갑니다.

이관 방식별로 비교하면 다음과 같습니다.

| 기준 | 전체 이력 이관 | `R_base` + 현재, 커밋 2개 | 현재만 커밋 1개 |
|---|---|---|---|
| git 안에서 예전 이력 추적 | 가능 | 불가 | 불가 |
| 공통 조상 | 이력 안에 이미 있음 | 직접 만들어 둠 | 없음 |
| 통합 방식 | 3-way merge | 3-way merge | 사실상 수작업 |
| 비용 | 변환 시간, 작성자 매핑 준비 | 중간 | 적음 |

전체 이력 이관을 골랐습니다. 이력 추적 요구를 채우면서, `R_base` 커밋이 이력 안에 자연히 들어오기 때문입니다. 변환 시간과 작성자 매핑은 한 번만 들이면 되는 비용입니다.

## 구현

아래 명령은 이 글을 위해 일반화한 템플릿입니다. 실제로는 저장소 주소, 레이아웃, 브랜치 이름을 착수 전에 확인해 채웠고, 모든 줄을 이 모양 그대로 실행한 것은 아닙니다.

### 1단계: 준비

`git svn`이 필요합니다. 배포판에 따라 `git`과 따로 설치해야 하는 경우가 있습니다(데비안 계열의 `git-svn` 패키지 등).

먼저 SVN 저장소의 레이아웃을 확인합니다.

```bash
SVN_URL="https://svn.example.com/repos/app-web"
svn ls "$SVN_URL"    # trunk/ branches/ tags/ 가 있는지 봅니다
```

다음은 작성자 매핑입니다. SVN 커밋에는 계정 이름만 있고, git 커밋에는 이름과 이메일이 필요합니다. 매핑 없이 변환하면 작성자가 `account <account@uuid>` 같은 형태로 남고, 나중에 고치려면 이력을 다시 써야 합니다.

```bash
# SVN 로그에 등장한 계정 이름을 중복 없이 뽑습니다
svn log -q "$SVN_URL" \
  | awk -F'|' '/^r[0-9]+/ { gsub(/^ +| +$/, "", $2); print $2 }' \
  | sort -u > svn-users.txt
```

이 목록을 `authors.txt` 형식으로 고칩니다.

```text
alice = Alice Kim <alice@example.com>
bob = Bob Lee <bob@example.com>
(no author) = Unknown <unknown@example.com>
```

`git svn`은 매핑에 없는 계정을 만나면 변환을 멈춥니다. 오래된 저장소에는 작성자가 비어 있는 리비전이 섞여 있을 수 있어서, `(no author)` 줄을 미리 넣어 두는 편이 안전합니다. 이 파일에는 실제 이메일이 들어가므로 저장소에 커밋하지 않고 로컬에만 둡니다.

마지막으로 `R_base`를 확정합니다. 이 리비전 번호는 소스를 떠 간 쪽에 직접 묻는 것이 가장 확실합니다. 날짜로 추정하면 같은 날의 앞뒤 커밋 사이에서 틀리기 쉽습니다.

### 2단계: 전체 이력 변환

```bash
WORK=$(mktemp -d)
cd "$WORK"

git svn clone "$SVN_URL" app-web \
  --stdlayout \
  --authors-file=/path/to/authors.txt \
  --prefix=svn/
cd app-web
```

- `--stdlayout`은 `trunk/branches/tags` 표준 레이아웃을 가정합니다. 레이아웃이 다르면 `--trunk=`, `--branches=`, `--tags=`로 각각 지정합니다.
- `--prefix=svn/`을 주면 SVN 쪽 참조가 `refs/remotes/svn/trunk`, `refs/remotes/svn/feature-x`, `refs/remotes/svn/tags/v1.0`처럼 한곳에 모입니다. 다음 단계에서 이들을 정리하기 쉬워집니다.
- 변환 시간은 리비전 수에 비례합니다. 리비전마다 서버에 다녀오기 때문에 오래 걸릴 수 있으니 백그라운드로 돌려 둡니다.

### 3단계: `R_base`에 태그 달기

SVN 메타데이터를 지우기 전에 해야 합니다. 리비전 번호와 커밋을 이어 주는 정보가 그 메타데이터에 있기 때문입니다.

```bash
R_BASE=1234   # 확정한 리비전 번호
BASE_SHA=$(git svn find-rev --before "r$R_BASE" svn/trunk)
echo "$BASE_SHA"            # 비어 있으면 멈추고 원인을 확인합니다
git tag baseline "$BASE_SHA"
```

`--before`를 붙인 이유가 있습니다. SVN의 리비전 번호는 저장소 전체에 하나뿐이라서, `R_base`가 다른 브랜치나 태그를 건드린 커밋이면 `trunk` 이력에는 그 번호의 커밋이 없습니다. 그러면 옵션 없는 `find-rev`는 아무것도 출력하지 않습니다. `--before`는 해당 리비전 시점에 `trunk`가 가리키던 커밋, 즉 외부 팀이 실제로 받아 간 상태를 돌려줍니다. 외부 팀이 `trunk`가 아닌 브랜치를 떠 갔다면 마지막 인자를 그 브랜치로 바꿉니다.

### 4단계: 브랜치와 태그를 git 것으로 옮기고 메타데이터 제거

`git svn`이 만든 SVN 브랜치와 태그는 원격 추적 참조(`refs/remotes/svn/*`)일 뿐입니다. 그대로 push해도 원격에는 올라가지 않고, 메타데이터와 함께 지우면 사라집니다. 지우기 전에 git의 로컬 브랜치와 태그로 옮겨 둡니다.

```bash
# SVN 태그 → git 태그
git for-each-ref --format='%(refname:strip=4)' refs/remotes/svn/tags \
  | while read -r t; do git tag "$t" "refs/remotes/svn/tags/$t"; done

# SVN 브랜치 → git 브랜치 (trunk와 태그 제외)
git for-each-ref --format='%(refname:strip=3)' refs/remotes/svn \
  | grep -v -e '^tags/' -e '^trunk$' \
  | while read -r b; do git branch "$b" "refs/remotes/svn/$b"; done
```

SVN 태그는 실제로는 복사 커밋이라, 위처럼 만들면 원본 커밋이 아니라 그 복사 커밋을 가리키는 태그가 됩니다. 대개 트리 내용은 같으므로 문제가 되지 않지만, 태그를 만든 뒤 그 경로에 다시 커밋한 이력이 있는 저장소라면 따로 확인해야 합니다.

그다음 `git svn` 연결을 끊습니다.

```bash
git config --remove-section svn-remote.svn
git for-each-ref --format='%(refname)' refs/remotes/svn \
  | xargs -n1 git update-ref -d
rm -rf .git/svn
```

`git svn`은 처음 변환할 때만 씁니다. 메타데이터를 남겨 두면 누군가 `git svn dcommit`으로 SVN에 직접 커밋을 돌려보낼 수 있는데, 이 명령은 보낸 커밋의 SHA를 다시 씁니다. 이미 원격에 push한 커밋, 특히 상위 저장소가 서브모듈 포인터로 가리키는 커밋이 다시 쓰이면 force push가 필요해지고, 그 포인터는 사라진 커밋을 가리키게 됩니다.

이제 순수 git 저장소이므로 원격에 올립니다. 기본 브랜치 이름은 팀 관례를 따르면 됩니다.

```bash
git branch -M main
git remote add origin https://git.example.com/team/app-web.git
git push -u origin --all
git push origin --tags
```

### 5단계: 검증

이관이 끝났다고 판단하기 전에 두 가지를 확인합니다.

트리가 같은지 봅니다. SVN의 현재 `trunk`를 내려받아 git의 기본 브랜치와 파일 단위로 비교하고, 차이가 없어야 합니다.

```bash
svn export -q "$SVN_URL/trunk" /tmp/svn-head
mkdir -p /tmp/git-head
git -C "$WORK/app-web" archive main | tar -x -C /tmp/git-head
diff -r /tmp/svn-head /tmp/git-head && echo "tree identical"
```

같은 방법으로 `R_base` 시점의 SVN 소스(`svn export -r "$R_BASE" ...`)와 `baseline` 태그의 트리도 비교합니다. 이 비교가 맞아야 이후의 3-way merge가 의미가 있습니다.

이력이 맞는지도 봅니다. 몇 개 리비전을 골라 `svn log -r <N>`과 해당 git 커밋의 작성자, 시각, 메시지를 대조합니다. 작성자가 이메일 대신 계정 이름으로 남아 있다면 매핑이 빠진 것입니다.

| 확인 항목 | 방법 | 통과 기준 |
|---|---|---|
| 현재 트리 | `svn export` 결과와 `git archive` 결과 비교 | `diff -r` 출력 없음 |
| 공통 조상 트리 | `R_base` 시점 export와 `baseline` 태그 비교 | `diff -r` 출력 없음 |
| 작성자·시각 | 샘플 리비전의 `svn log`와 `git log` 대조 | 모두 매핑된 이름과 이메일 |
| 브랜치·태그 | `git branch -a`, `git tag`와 `svn ls` 비교 | 빠진 항목 없음 |

### 병행 기간: git에서 SVN으로 한 방향 스냅샷

빌드·배포가 아직 SVN을 보고 있는 동안에는 배포할 때만 git의 내용을 SVN 작업 사본에 덮어써서 커밋합니다. 방향은 git에서 SVN으로 하나뿐입니다.

```bash
cd /path/to/svn-working-copy
svn update
rsync -a --delete --exclude='.git' --exclude='.svn' /path/to/app-web/ ./
svn add --force -q .
svn status | awk '/^!/ { print $2 }' | xargs -r svn delete -q
svn commit -m "deploy: snapshot of git $(git -C /path/to/app-web rev-parse --short HEAD)"
```

이 방식은 git 커밋을 건드리지 않습니다. 커밋 메시지에 git 커밋 해시를 남겨 두면 어떤 SVN 리비전이 어느 git 상태인지 거꾸로 찾을 수 있습니다. 스냅샷을 만드는 장소는 한 곳으로 정해 둡니다. 여러 사람이 각자 SVN에 커밋하면 배포본이 git과 어긋납니다. 경로에 공백이 있는 파일이 있다면 `awk`의 `$2`가 잘리므로 그 줄은 손봐야 합니다.

### 외부 결과물 통합: `baseline` 위에 올리고 merge

외부 결과물이 도착하면 `baseline`에서 브랜치를 따서 그 위에 결과물을 통째로 커밋합니다.

```bash
cd /path/to/app-web
git switch -c external-upgrade baseline

# 작업 트리를 비우고 외부 결과물로 채웁니다 (삭제된 파일까지 반영되도록)
git rm -rq .
rsync -a --exclude='.git' /path/to/delivered-code/ ./
git add -A
git commit -m "Import external upgrade on top of baseline"
```

`git rm -rq .`로 먼저 비우는 것이 중요합니다. 그냥 덮어쓰기만 하면 외부 팀이 지운 파일이 남아서 「외부에서 지웠다」는 변경이 사라집니다.

외부 팀이 git 접근 권한을 준다면 결과물을 통째로 커밋하는 대신 `git fetch`로 그쪽 이력을 받아도 됩니다. 다만 그쪽 이력은 `baseline`과 조상 관계가 없으므로, 그 끝 커밋의 트리를 위와 같은 방법으로 `baseline` 위에 다시 올려야 merge가 공통 조상을 찾습니다.

이제 내부 변경을 합칩니다.

```bash
git switch -c integration external-upgrade
git log --oneline baseline..main     # 합쳐질 내부 변경 목록
git merge main
```

`git log baseline..main`이 그사이 내부에서 바뀐 커밋 목록입니다. SVN 로그를 뒤지며 하던 일을 이 한 줄이 대신합니다. `git merge`는 `baseline`을 공통 조상으로 잡고, 양쪽이 같은 곳을 다르게 고친 부분만 충돌로 남깁니다. 내부 변경 중 일부만 가져가야 한다면 merge 대신 위 목록에서 골라 `cherry-pick`합니다.

충돌을 다 풀고 빌드와 테스트가 통과하면 `integration`을 기본 브랜치에 반영합니다. 그다음 배포는 앞의 스냅샷 절차로 SVN에 보냅니다.

### git 단독 운영으로 넘어가기

통합까지 끝나면 마지막 스냅샷으로 SVN과 git을 같은 상태로 맞추고, 빌드·배포 파이프라인이 git을 보도록 바꿉니다. 그 뒤 SVN 저장소의 쓰기 권한을 거둬 읽기 전용으로 둡니다. 전체 이력이 git에 있으므로 SVN을 다시 열 일은 거의 없습니다.

## 함정과 트레이드오프

- **줄 끝과 인코딩이 다르면 가짜 충돌이 납니다.** 외부 결과물이 다른 운영체제에서 CRLF로 저장됐거나 파일 인코딩이 바뀌었으면, 실제 내용은 같아도 모든 줄이 바뀐 것으로 보입니다. 통째 커밋을 만들기 전에 `git diff --stat baseline`으로 변경 규모가 상식적인지 보고, 거의 모든 파일이 통째로 바뀌었다면 줄 끝과 인코딩부터 맞춥니다.
- **`R_base`가 틀리면 결과가 조용히 틀립니다.** 공통 조상을 너무 이르게 잡으면 내부 변경 일부가 「외부도 이미 갖고 있던 것」으로 잘못 계산될 수 있고, 너무 늦게 잡으면 가짜 충돌이 늘어납니다. 3단계의 트리 비교로 `baseline`이 외부 팀이 받아 간 소스와 같은지 반드시 확인합니다.
- **`git svn dcommit`을 쓰는 양방향 운용은 피했습니다.** 커밋마다 SVN에 1:1로 반영되는 장점은 있지만, 앞에서 말한 SHA 재작성 때문에 서브모듈로 묶인 저장소와는 맞지 않습니다. 대신 배포 시점 단위로만 SVN에 반영됩니다.
- **변환과 매핑에 드는 시간은 줄일 수 없습니다.** 리비전이 많은 저장소는 변환이 오래 걸립니다. 다만 한 번만 하면 되므로, 이력을 버리는 쪽보다는 대체로 싸게 먹힙니다.
- **`authors.txt`와 인증 정보는 저장소 밖에 둡니다.** 실제 이메일 목록과 SVN 계정 정보가 커밋 이력에 남으면 지우기 어렵습니다.

## 정리

- 외부에서 통째로 받은 코드를 합칠 계획이 있다면, 이관 방식은 **공통 조상 커밋을 git 이력에 남길 수 있는지**로 고릅니다. 전체 이력 이관은 그 커밋을 저절로 포함합니다.
- `git svn clone --stdlayout --authors-file --prefix=svn/`으로 변환하고, 메타데이터를 지우기 전에 `find-rev --before`로 공통 조상에 태그를 달고 SVN 브랜치·태그를 git 것으로 옮깁니다.
- 변환 뒤에는 `git svn` 연결을 끊습니다. 병행 기간에는 git에서 SVN으로 가는 한 방향 스냅샷만 씁니다.
- 외부 결과물은 `baseline` 위에 통째로 커밋하고 내부 브랜치를 merge합니다. 진짜 충돌만 사람이 풉니다.
- 트리 비교와 작성자 대조로 이관을 검증하고, 통합 전에는 줄 끝과 인코딩 차이부터 확인합니다.

다음 편에서는 이렇게 서브모듈로 들어온 저장소를 worktree로 다룰 때 `--git-dir` 하나 때문에 커밋이 엉뚱한 브랜치에 들어가는 문제를 다룹니다.
