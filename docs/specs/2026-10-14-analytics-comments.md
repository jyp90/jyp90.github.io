# 분석 도구와 댓글 설계

## 결정

| 항목 | 선택 | 이유 |
|---|---|---|
| 댓글 | giscus (GitHub Discussions) | 무료이고 광고가 없어요. 댓글이 이 저장소의 Discussions에 쌓여서 데이터가 내 저장소에 남아요. 독자 대부분이 개발자라 GitHub 로그인이 부담스럽지 않아요. |
| 분석 | GoatCounter | 쿠키를 쓰지 않아서 동의 배너가 필요 없고, 개인 사이트는 무료예요. 스크립트가 3.5KB라 GA4보다 훨씬 가벼워요. |

검토하고 고르지 않은 것:

- utterances: Issues에 댓글을 쌓아서 이슈 목록이 섞이고, 반응(이모지)과 답글 스레드가 약해요.
- Disqus: 광고와 추적 스크립트가 붙어요.
- GA4: 쿠키 동의 문제가 있고 스크립트가 무거워요. 이 블로그에 필요한 숫자(글별 조회수, 유입 경로)는 GoatCounter로 충분해요.
- Cloudflare Web Analytics: 이 사이트는 Cloudflare를 거치지 않아요.

## 동작

- 설정은 `_config.yml`의 `comments.giscus`와 `analytics.goatcounter`에 있어요. 두 기능 모두 값이 채워져야 켜져요.
- 댓글
  - `_includes/comments.html`이 상세 페이지 본문과 하단 내비게이션 사이에 자리를 만들어요.
  - 스크립트는 `assets/js/blog.js`의 `initComments`가 넣어요. 글과 댓글은 `pathname`으로 연결하고, `loading=lazy`라서 스크롤이 댓글 근처에 와야 불러와요.
  - 테마 토글을 누르면 `themechange` 이벤트를 받아 `postMessage`로 giscus 테마를 바꿔요(`noborder_light` / `noborder_dark`).
  - 글 front matter에 `comments: false`를 두면 그 글에서는 숨겨요.
  - 스크립트가 꺼져 있으면 `<noscript>`로 Discussions 링크를 보여 줘요.
- 분석
  - `_includes/analytics.html`이 `JEKYLL_ENV=production` 빌드에서만 스크립트를 넣어요.
  - 로컬 서버와 PR 산출물 확인에서는 집계하지 않아요(GoatCounter도 localhost는 기본으로 무시해요).

## 켜는 방법 (사용자 작업)

1. 저장소 Discussions는 2026-10-14에 켜 두었어요. `Announcements` 카테고리를 쓰는데, 관리자만 새 글을 열 수 있어서 giscus가 만드는 글 단위 스레드만 생겨요.
2. https://github.com/apps/giscus 에서 앱을 `jyp90/jyp90.github.io` 저장소에만 설치해요.
3. `_config.yml`의 `comments.giscus.enabled`를 `true`로 바꿔요.
4. https://www.goatcounter.com 에 가입하고 사이트 코드를 정해요(예: `jyp90`). 그 값을 `analytics.goatcounter`에 넣어요.
5. PR을 올려 산출물에서 상세 페이지 하단 댓글과 `<head>`의 `count.js`를 확인해요.

## 남은 위험

- giscus 앱을 설치하기 전에 `enabled: true`로 바꾸면 댓글 자리에 오류 문구가 보여요.
- `repo_id`와 `category_id`는 저장소나 카테고리를 다시 만들면 바뀌어요. 그때는 GraphQL로 다시 조회해요.
  `gh api graphql -f query='{repository(owner:"jyp90",name:"jyp90.github.io"){id discussionCategories(first:10){nodes{id name}}}}'`
