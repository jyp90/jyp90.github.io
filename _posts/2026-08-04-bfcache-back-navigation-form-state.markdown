---
layout: post
title: "브라우저와 URL에서 조용히 어긋나는 것들 (1) 뒤로가기 bfcache와 어긋나는 폼 상태"
date: 2026-08-04 09:00:00 +0900
categories: blog
tags: [JavaScript, 웹, 브라우저, bfcache, Playwright]
excerpt: "뒤로가기로 bfcache에서 되살아난 페이지의 폼 상태가 URL과 어긋나는 원리와, pageshow 처리·autocomplete 오해·자동화 브라우저로 재현되지 않는 이유를 정리합니다."
---

> **시리즈: 브라우저와 URL에서 조용히 어긋나는 것들**
>
> 1. **(1) 뒤로가기 bfcache와 어긋나는 폼 상태**
> 2. [(2) 초기화 시점에 전역 객체를 단정하는 함정](/blog/2026/09/01/global-object-init-time-assumption.html)
> 3. [(3) URL 정규화 301의 두 가지 부작용](/blog/2026/09/17/url-normalization-301-side-effects.html)

## 문제와 배경

서버가 렌더링하는 검색 결과 페이지가 있습니다. 상단에 검색창과 필터가 있고, 검색은 GET 폼 제출이라 검색어와 필터가 모두 URL 쿼리에 실립니다.

```text
https://example.com/search?q=cache&sort=recent
```

여기서 다음 순서로 움직이면 화면이 URL과 어긋납니다.

1. `q=cache`로 검색합니다.
2. 검색창에 다른 검색어 `index`를 입력하고, 제출하지 않은 채 결과 하나를 눌러 상세 페이지로 갑니다.
3. 브라우저의 뒤로가기를 누릅니다.

주소창은 `?q=cache`인데 검색창에는 `index`가 그대로 남아 있습니다. 필터 체크박스도 마지막으로 건드린 상태 그대로입니다. 목록은 `cache`의 결과이므로, 사용자는 `index`의 결과를 보고 있다고 착각하기 쉽습니다.

서버 템플릿은 URL의 `q`를 검색창 `value`에 넣고 있었고, 입력란에는 `autocomplete="off"`도 붙어 있었습니다. 새로 고침하면 화면이 정확히 맞습니다. 그런데 뒤로가기에서만 어긋납니다. 원인은 뒤로가기가 페이지를 **다시 불러오지 않았다**는 데 있습니다.

## 뒤로가기는 두 가지 경로로 돌아옵니다

뒤로가기를 눌렀을 때 브라우저가 페이지를 되살리는 방법은 크게 두 가지입니다.

| 경로 | 무엇이 일어나는가 | 폼 값은 어디서 오는가 |
|---|---|---|
| bfcache 복원 | 떠날 때 얼려 둔 페이지(DOM, JS 힙, 타이머 상태까지)를 그대로 되살립니다 | 떠나기 직전의 DOM 그대로입니다 |
| 다시 로드 + 폼 상태 복원 | 문서를 다시 받아 파싱하고, 히스토리 항목에 저장해 둔 폼 컨트롤 값을 덮어씁니다 | 브라우저가 저장해 둔 값이 서버 렌더 값을 덮습니다 |

bfcache(back/forward cache)는 페이지를 떠날 때 문서를 통째로 메모리에 보관했다가, 뒤로·앞으로 이동하면 그대로 꺼내는 캐시입니다. 이때는 서버에 요청도 가지 않고 HTML 파싱도, 스크립트 초기화도 다시 일어나지 않습니다. 서버 템플릿이 URL로 검색창을 맞춰 두는 코드는 애초에 실행될 기회가 없습니다.

두 번째 경로는 bfcache에 들어가지 못한 페이지가 거치는 길입니다. 문서를 다시 그리지만, 브라우저는 사용자가 입력하던 값을 잃지 않도록 폼 컨트롤 값을 기억해 두었다가 복원합니다. 이 경우에도 서버가 넣은 `value`가 사용자의 마지막 입력으로 덮일 수 있습니다.

어느 쪽이든 결과는 같습니다. **화면의 입력 상태는 "떠나기 직전" 기준이고, URL은 "마지막으로 제출한 상태" 기준입니다.** 둘 사이에 제출하지 않은 변경이 있었다면 어긋납니다.

## `autocomplete="off"`가 막는 것과 막지 못하는 것

흔한 오해가 `autocomplete="off"`를 붙이면 뒤로가기 시 입력값이 남지 않는다는 것입니다. 이 속성이 영향을 주는 곳은 두 번째 경로, 즉 다시 로드할 때 브라우저가 폼 컨트롤 값을 복원하는 동작입니다. 브라우저 자동완성 제안을 끄는 것도 같은 속성의 몫입니다.

bfcache는 값을 "복원"하지 않습니다. 얼려 둔 DOM 자체를 되살릴 뿐이므로 입력란의 현재 값도 그대로 남아 있습니다. 그래서 `autocomplete="off"`와 서버 렌더로 다시 로드 경로를 안전하게 만들어 두어도, bfcache 경로는 따로 처리해야 합니다.

## 복원 시점에 실행되는 이벤트는 `pageshow`입니다

bfcache에서 되살아난 페이지에서는 초기화용으로 흔히 쓰는 이벤트가 다시 실행되지 않습니다.

| 이벤트 | 새로 로드 | bfcache 복원 |
|---|---|---|
| `DOMContentLoaded` | 발생 | 발생하지 않음 |
| `load` | 발생 | 발생하지 않음 |
| `pageshow` | 발생 (`persisted: false`) | 발생 (`persisted: true`) |

떠날 때 발생하는 `pagehide`에도 `persisted` 값이 있어서, 페이지가 bfcache에 들어갈 예정인지 알 수 있습니다.

`popstate`는 같은 문서 안에서 `pushState`로 쌓은 항목 사이를 오갈 때를 위한 이벤트입니다. 문서가 바뀌는 뒤로가기의 복원 신호로 쓰기에는 맞지 않으므로, 복원 처리를 여기에 걸지 않는 편이 안전합니다.

따라서 복원 시점의 보정은 `pageshow`에서 `event.persisted`를 보고 합니다.

## 구현

### 핵심 코드

원칙은 하나입니다. **URL을 정본으로 보고, 화면을 URL에 맞추는 함수를 하나만 두고, 두 경로에서 같은 함수를 부릅니다.** 복원 전용 로직을 따로 쓰면 두 경로의 동작이 시간이 지나며 갈라집니다.

```javascript
// URL 쿼리를 읽어 검색 폼을 맞춥니다. 새로 로드와 bfcache 복원이 같은 함수를 씁니다.
function syncSearchFormFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const form = document.querySelector('#search-form');
  if (!form) return;

  form.elements.q.value = params.get('q') ?? '';

  const sort = params.get('sort') ?? 'relevance';
  for (const radio of form.querySelectorAll('input[name="sort"]')) {
    radio.checked = radio.value === sort;
  }

  const selectedTypes = new Set(params.getAll('type'));
  for (const box of form.querySelectorAll('input[name="type"]')) {
    box.checked = selectedTypes.has(box.value);
  }
}

document.addEventListener('DOMContentLoaded', syncSearchFormFromUrl);

window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return; // 새로 로드는 DOMContentLoaded 쪽에서 이미 맞췄습니다
  syncSearchFormFromUrl();
});
```

`DOMContentLoaded` 쪽 호출은 서버 렌더가 이미 맞춰 두었다면 없어도 됩니다. 다만 두 번째 경로(다시 로드 + 폼 상태 복원)에서 브라우저가 렌더 값을 덮는 경우까지 막으려면 남겨 두는 편이 낫습니다. 폼 상태 복원이 정확히 언제 적용되는지는 브라우저 구현에 달려 있으므로, 이 경로는 실제 브라우저에서 확인해야 합니다.

검색창 말고도 화면에 남는 상태가 있다면 같은 함수에서 함께 맞춥니다. 열려 있던 드롭다운, "필터 적용 중" 배지, 입력하는 동안 켜 둔 로딩 표시처럼 사용자가 떠나기 직전에 바뀐 UI가 그대로 얼어 있기 때문입니다.

### `pushState`로 해결하려는 시도

이 문제를 히스토리 조작으로 풀려는 경우가 있습니다. 입력이 바뀔 때마다 `history.pushState`로 URL을 갱신해 두면 뒤로가기 시 URL과 화면이 맞을 것이라는 생각입니다.

GET 폼 제출로 이동하는 페이지라면 URL에 이미 상태가 실려 있으므로 이 방법은 맞지 않습니다. 제출하지 않은 입력을 히스토리에 쌓으면 뒤로가기 횟수만 늘고, 사용자가 실제로 보던 목록과 URL이 오히려 어긋납니다. 상태의 정본이 URL이라면 할 일은 **URL을 읽어 화면을 맞추는 것**이지, 히스토리를 더 쌓는 것이 아닙니다. `pushState`가 필요한 곳은 문서 이동 없이 화면 상태만 바뀌는 전환입니다.

### 고치기 전에 실제로 로드되는 스크립트를 확인합니다

오래된 서버 렌더 페이지에서는 같은 화면을 위한 스크립트가 신·구 두 벌 남아 있는 경우가 있습니다. 이름이 그럴듯한 파일을 고쳤는데 그 화면이 다른 파일을 로드하고 있다면, 코드는 들어갔는데 동작은 그대로입니다. 뷰 템플릿에서 include 체인을 따라가 `<script>` 태그까지 확인하거나, 개발자 도구의 Sources 패널에서 수정한 파일이 실제로 로드되는지 먼저 봅니다.

## 확인하는 법

### 실제 브라우저에서

가장 확실한 방법은 일반 Chrome이나 Safari에서 앞의 재현 순서를 손으로 밟는 것입니다. 복원 경로를 탔는지는 페이지에 잠시 다음 코드를 넣어 확인할 수 있습니다.

```javascript
window.addEventListener('pageshow', (event) => {
  console.log('pageshow persisted =', event.persisted);
});
```

bfcache에 들어가지 못했다면 Chrome 개발자 도구의 Application 패널에 있는 Back/forward cache 항목에서 테스트를 돌려 이유를 볼 수 있습니다. `unload` 핸들러, 열려 있는 연결, `Cache-Control: no-store` 같은 응답 헤더가 대표적인 원인인데, 기준은 브라우저와 버전마다 다르므로 대상 브라우저에서 직접 확인하는 것이 좋습니다. 개발 환경에서는 bfcache에 들어가지 않다가 운영 환경에서만 들어가는 일도 있으므로, "개발 환경에서 재현되지 않는다"를 "문제없다"로 읽으면 안 됩니다.

### 핸들러만 확인하려면

복원 경로의 핸들러가 제대로 동작하는지만 보려면 `persisted: true`인 `pageshow` 이벤트를 직접 만들어 보낼 수 있습니다.

```javascript
// 검색창 값을 일부러 바꿔 둔 뒤 실행합니다
document.querySelector('#search-form').elements.q.value = 'stale';
window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
console.log(document.querySelector('#search-form').elements.q.value); // URL의 q 값이어야 합니다
```

이 방법은 핸들러 로직만 증명합니다. 브라우저가 실제로 그 페이지를 bfcache에 넣는지, 복원 직후 다른 스크립트가 값을 다시 바꾸지 않는지는 증명하지 못합니다. 그러니 무엇을 확인했고 무엇은 확인하지 못했는지 함께 남겨 두는 것이 좋습니다.

## 함정: 자동화 브라우저로는 잘 재현되지 않습니다

Playwright처럼 CDP(Chrome DevTools Protocol)로 Chromium을 조종하는 도구로 이 버그를 재현하려 하면 대개 실패합니다. 아래는 공식 문서의 계약이 아니라 Chromium 계열에서 직접 관찰한 결과입니다.

- **헤드리스 Chromium은 bfcache를 쓰지 않았습니다.** 실행 인자에서 `--disable-back-forward-cache`를 빼도 마찬가지였고, 복원되지 않은 이유로 `BackForwardCacheDisabledForDelegate`가 보고됐습니다. 이 환경의 뒤로가기는 항상 새로 로드이므로, 버그가 "고쳐진 것처럼" 보입니다.
- **창을 띄운 Chrome(`headless: false`, `channel: 'chrome'`)에서는 bfcache 복원이 실제로 일어났습니다.** 다만 복원 이후의 요청을 `page.on('request')`나 CDP `Network` 이벤트로 보지 못하는 경우가 있었습니다. 요청이 나가지 않은 것처럼 보이지만 실제로는 나갑니다. 복원 과정에서 문서가 다른 렌더러 프로세스로 옮겨 가면서 관찰 세션이 따라가지 못하는 것으로 보입니다.
- **복원된 페이지는 `load`를 다시 내지 않으므로** `page.goBack({ waitUntil: 'load' })`는 타임아웃이 납니다. `waitUntil: 'commit'`으로 기다려야 합니다.

자동화로 확인해야 한다면 관찰 지점을 페이지 바깥이 아니라 안에 둡니다. 모든 문서에 먼저 실행되는 스크립트를 넣어 `pageshow`의 `persisted` 값을 페이지 저장소에 남기고, 마지막에 같은 오리진 페이지에서 읽어 옵니다.

```javascript
// Playwright 예시입니다. 동작은 Chromium 계열에서 관찰한 범위로만 확인했습니다.
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false, channel: 'chrome' });
const context = await browser.newContext();

await context.addInitScript(() => {
  window.addEventListener('pageshow', (event) => {
    // 페이지 자신의 pageshow 핸들러가 끝난 뒤의 값을 기록하려고 한 틱 미룹니다
    setTimeout(() => {
      const log = JSON.parse(localStorage.getItem('pageshow-log') ?? '[]');
      log.push({
        persisted: event.persisted,
        url: location.href,
        q: document.querySelector('#search-form')?.elements.q.value ?? null,
      });
      localStorage.setItem('pageshow-log', JSON.stringify(log));
    }, 0);
  });
});

const page = await context.newPage();
await page.goto('https://example.com/search?q=cache');
await page.fill('#search-form input[name="q"]', 'index');
await page.click('.result-item a');
await page.goBack({ waitUntil: 'commit' });
await page.waitForTimeout(1000);

console.log(await page.evaluate(() => localStorage.getItem('pageshow-log')));
await browser.close();
```

기록에 `persisted: true`인 항목이 있고 그때의 `q`가 URL 값과 같다면 복원 경로가 처리된 것입니다. `persisted: true`인 항목이 하나도 없다면 버그가 없는 것이 아니라 bfcache가 끼지 않은 것이므로, 판정을 보류하고 실제 브라우저로 돌아갑니다. 위 스크립트는 구조를 보이기 위한 예시이고, 이 글을 위해 그대로 실행해 보지는 않았습니다.

정리하면 자동화 검증 결과가 비어 있거나 "문제없음"으로 나올 때는 다음 순서로 의심합니다.

1. 이 브라우저가 bfcache를 쓰는가 (헤드리스라면 대개 아닙니다)
2. 관찰 도구가 복원 이후의 페이지를 보고 있는가
3. 그다음에 애플리케이션 코드를 의심합니다

## 정리

- 뒤로가기는 bfcache 복원이거나 다시 로드 + 폼 상태 복원입니다. 어느 쪽이든 화면의 입력 상태는 "떠나기 직전" 기준이라, 제출하지 않은 변경이 있으면 URL과 어긋납니다.
- bfcache 복원에서는 `DOMContentLoaded`·`load`가 다시 실행되지 않습니다. 보정은 `pageshow`에서 `event.persisted`를 보고 합니다.
- `autocomplete="off"`는 다시 로드할 때의 폼 값 복원에 관한 속성이고, 얼려 둔 DOM을 되살리는 bfcache에는 영향을 주지 않습니다.
- URL이 정본이라면 화면을 URL에 맞추는 함수를 하나 두고 두 경로에서 같은 함수를 부릅니다. `pushState`로 히스토리를 더 쌓는 것은 해법이 아닙니다.
- 헤드리스 자동화 브라우저는 bfcache를 쓰지 않는 경우가 많아 이 버그가 재현되지 않습니다. 실제 브라우저에서 확인하거나, 페이지 안에 `persisted` 기록을 남겨 판정하고, 확인하지 못한 범위를 함께 적어 둡니다.
