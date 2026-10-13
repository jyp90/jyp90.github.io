# 블로그 스타일 가이드 — 책 디자인

메인 목록과 상세 페이지는 **책 표지 위에 놓인 종이 한 장**처럼 보여요. 페이지를 옮길 때는 클립으로 묶은 서류를 오른쪽 아래 모서리부터 좌상단으로 넘기는 동작을 보여 줘요. 이 문서는 그 규칙의 기준 문서(SSOT, Single Source of Truth)예요. 스타일을 바꾸면 이 문서도 같이 고쳐 주세요.

## 1. 색과 글꼴 토큰

모든 색은 `assets/style.css` 상단 토큰 블록에서만 정의해요. 토큰 블록 밖에 hex 값을 쓰지 않아요. 다크(`:root`), 라이트(`[data-theme="light"]`), 라이트 자동(`prefers-color-scheme: light`) 세 블록에 같은 이름으로 값을 넣어요.

| 토큰 | 쓰임 |
|---|---|
| `--paper`, `--paper-edge` | 종이 바탕, 종이 테두리·점선·구분선 |
| `--ink-accent` | 책 안의 강조색 (목차 번호, 연도 장 제목, 머리말, 현재 쪽수) |
| `--cover`, `--cover-edge` | 표지 가죽색, 표지 테두리·어두운 끝 |
| `--desk` | 책을 올려 둔 책상 바탕. `body`·`main`(`assets/reset.css`)·헤더·푸터와 브라우저 `theme-color`가 함께 써요 |
| `--font-serif` | 제목용 명조 (시스템 글꼴만 쓰고, 웹 폰트는 불러오지 않아요) |

`.book` 안에서는 사이트 공용 표면 토큰(`--bg-secondary`, `--bg-tertiary`, `--bg-card`, `--border-primary`, `--border-secondary`, `--code-bg`)을 종이색에서 `color-mix`로 다시 만들어요. 그래서 코드 블록·요약·시리즈·태그 칩 같은 기존 컴포넌트는 따로 고치지 않아도 종이 톤을 따라가요. 책 안에 새 컴포넌트를 만들 때도 이 토큰을 그대로 쓰면 돼요.

`.book` 안에서는 `--accent-primary`와 `--gradient-primary`도 `--ink-accent`로 바꿔요. 그래서 종이 위의 링크·태그·선택된 태그 칩·버튼은 파란색 대신 잉크색(갈색)으로 보여요.

## 2. 페이지 구조

```
.book            표지 (가죽 그라데이션, 왼쪽 제본 그림자)
└ .home | .post  종이 (왼쪽 제본 그림자, 아래쪽에 겹친 종이 두 장)
```

- `_layouts/home.html`, `_layouts/post.html`, `_layouts/page.html`(소개·시리즈·도구 목록)이 각각 `.book`으로 감싸요. `page.html`은 minima의 같은 이름 레이아웃을 덮어써요.
- `.book`은 `width: fit-content`라서 폭은 안쪽 종이가 정해요. 종이 폭은 메인 760px, 격자 보기 1080px, 상세 `--measure + 144px`, 상세에 목차가 있으면 사이드 목차 폭(288px)을 더해요.

### 메인 목록 (책의 목차)

| 부분 | 모양 |
|---|---|
| 표제지 (`.home-intro`) | 가운데 정렬 명조 제목, 아래 이중선 |
| 머리말 (`.featured`) | 왼쪽 `--ink-accent` 세로줄, 명조 제목 |
| 장 (`.year-heading`) | 연도를 양쪽 가로선 사이 가운데에 둬요 |
| 목차 행 (`.post-item-title`) | 번호(`.toc-no`) · 제목 · 점선(`.toc-leader`) · 날짜 `MM.DD`(`.toc-page`) |
| 쪽수 (`.pager`) | 이중선 아래 테두리 없는 명조 숫자, 현재 쪽은 `--ink-accent` 굵게 + 밑줄 |

- 목차 번호는 Liquid에서 전체 글 수부터 하나씩 줄여 매겨요. 그래서 태그 필터·페이지를 바꿔도 번호가 같아요.
- 목록 보기에서는 날짜가 점선 끝에 있으므로, 메타 줄의 날짜와 구분점은 숨겨요.

### 상세 페이지

- 종이 왼쪽 위에 「‹ 목록」(`.post-back`)을 두고, 제목은 명조로 써요.
- 하단의 「목록으로」(`.btn-back`)와 이전·다음 글 카드는 책 안 표면 토큰을 따라가요.
- 시리즈 상태 배지(`.series-status`)는 `_data/series.yml`의 `complete`/`ongoing` 값을 「완결」/「연재 중」으로 시리즈 목차 상자와 `/series/`에 보여 줘요.
- mermaid 다이어그램(`.mermaid-figure`)은 cdnjs의 mermaid로 그리고, 색은 테마 토큰에서 읽어 테마 토글 때 다시 그려요. 스크립트를 못 불러오면 원문 코드 블록을 그대로 보여 줘요.
- 댓글(`.post-comments`, giscus)은 본문과 하단 내비게이션 사이에 둬요. giscus 테마는 `noborder_light`/`noborder_dark`이고 테마 토글을 따라가요. 설계: `docs/specs/2026-10-14-analytics-comments.md`

### 헤더와 푸터

책상(`--desk`) 위에 있는 요소라서 표지·종이색 대신 책상색을 바탕으로 쓰고, 선과 강조만 책과 맞춰요.

| 부분 | 모양 |
|---|---|
| 헤더 | 반투명 책상색 바탕, 아래 `--paper-edge` 한 줄. 로고는 명조 `--text-primary`, 마우스를 올리면 `--ink-accent` |
| 헤더 메뉴 | 마우스를 올리면 `--ink-accent` 글자와 옅은 `--paper-edge` 바탕, 현재 페이지는 `--ink-accent` 밑줄 |
| 푸터 | 책상색 바탕, 위쪽 `--paper-edge` 이중선. 제목은 명조, 소제목은 명조 `--ink-accent`, 링크는 `--ink-accent` |
| 읽기 진행 바 | `--ink-accent` 단색 |

파란·보라 그라데이션(`--gradient-primary`)은 헤더·푸터·책 안에서 쓰지 않아요.

## 3. 반응형 기준

| 폭 | 바뀌는 것 |
|---|---|
| ≤ 480px | 목차 점선·날짜를 숨기고 날짜를 메타 줄로 되돌려요. 상세 종이 여백은 `16px 18px 32px` |
| ≤ 640px | 표지 여백 `8px 8px 14px 10px`, 메인 종이 여백 `36px 18px 28px`, 표제지 28px |
| ≤ 768px | 상세 종이 여백 `24px 32px 40px` |
| ≥ 1100px | 상세 목차가 종이 안 오른쪽 사이드 열로 옮겨 가요 |
| 격자 보기 | 점선·날짜를 숨기고, 번호는 제목 위에 따로 한 줄로 둬요 |

상세 페이지의 768px 규칙은 파일 뒤쪽 "Responsive Post Styles"에 있어서 앞쪽 640px 블록보다 우선해요. 상세 종이 여백은 그 뒤 480px 블록에서 고쳐야 해요.

## 4. 페이지 넘김 전환

브라우저의 cross-document View Transitions API를 써요. SPA(단일 페이지 앱)로 바꾸지 않아요.

| 위치 | 하는 일 |
|---|---|
| `_includes/head.html` 인라인 스크립트 | 새 페이지의 `pagereveal`에서 `<html data-turn="forward\|backward">`를 붙이고, 전환이 끝나면 지워요. 첫 렌더 전에 실행돼야 해서 `blog.js`(defer)로 옮기지 않아요 |
| `_layouts/default.html`의 `.page-flap` | 넘어가는 종이 뒷면을 그릴 투명 고정 요소예요 (`view-transition-name: page-flap`) |
| `assets/style.css` "Page turn" 섹션 | 접는 선 `x + y = c`를 `c = 100vw + 100vh → 0`으로 움직여요. 퍼센트가 아니라 길이 단위라서 세로로 긴 휴대폰에서도 선이 45도예요 |

- **방향**: 새 페이지가 목록이면 `backward`, 나머지는 `forward`예요. Navigation API가 있으면 히스토리 이동은 앞뒤 순서로 정해요. 전환은 새 페이지가 그리므로 방향도 새 페이지에서만 정해요. view-transition types 대신 속성을 쓰는 이유는, Safari에 Navigation API가 없으면 이전 페이지가 목적지를 몰라 뒤로 갈 때 앞으로 넘기는 장면이 나왔기 때문이에요.
- **forward**: 이전 화면이 오른쪽 아래부터 좌상단으로 잘려 나가고(`page-peel`), 잘린 부분을 접는 선에 대해 뒤집은 모양이 종이 뒷면(`page-flap`)으로 보여요. 뒤집기는 `translate(c, c) matrix(0, -1, -1, 0, 0, 0)`이에요. 아래 새 화면은 살짝 어두웠다가 밝아져요(`page-under`).
- **backward**: 같은 애니메이션을 `animation-direction: reverse`로 돌려, 새 화면이 위에서 내려앉아요.
- **꺼지는 경우**: `prefers-reduced-motion: reduce`이면 `@view-transition`을 켜지 않아요. Firefox처럼 지원하지 않는 브라우저는 효과 없이 이동해요.
- **한계**: 종이가 휘는 곡면은 없고 평평한 접힘이에요. iOS·Android에서 가장자리를 밀어 뒤로 가면 브라우저 자체 애니메이션이 나오고, 이때 브라우저가 이 전환을 건너뛰어요.

### 뒤로 가기

`blog.js`의 `initBackLink`가 `.post-back`, `.btn-back`을 처리해요. 직전 페이지가 같은 사이트의 목록이면 링크 대신 `history.back()`으로 돌아가요. 그래서 `backward` 전환이 나오고, 목록의 쪽·태그·스크롤 위치도 그대로예요.

## 5. 기존 CSS 함정

- minima `assets/main.css`의 `a:visited`(명시도 0,1,1)가 클래스 하나짜리 링크 색을 이겨요. 새 링크 클래스는 `:visited`도 같이 지정해요.
- 전역 `button` 규칙(그라데이션)이 새 버튼에도 적용돼요. 새 버튼은 배경·그림자·transform을 직접 덮어써요.

## 6. 확인 방법

1. PR 빌드 산출물을 받아 로컬에서 띄워요 (`CLAUDE.md` 방법 3).
2. Playwright로 라이트·다크 × 1280px·375px, 격자 보기를 스크린샷으로 확인해요. 375px에서 `document.documentElement.scrollWidth`가 화면 폭을 넘지 않아야 해요.
3. 전환 중간 장면은 CDP `Animation.setPlaybackRate`를 `0.1`로 낮춘 뒤 클릭하고 1~3초 뒤에 찍어요.
4. 방향은 `pagereveal`에서 `setTimeout(0)` 뒤에 `<html>`의 `data-turn`을 읽어 확인해요. 바로 읽으면 head 스크립트보다 먼저 실행돼 빈 값이 나와요. 모바일은 `isMobile`·`hasTouch` 컨텍스트(390×844)에서 `tap()`으로 확인해요.
