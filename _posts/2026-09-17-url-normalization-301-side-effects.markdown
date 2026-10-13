---
layout: post
title: "브라우저와 URL에서 조용히 어긋나는 것들 (3) URL 정규화 301의 두 가지 부작용"
date: 2026-09-17 09:00:00 +0900
categories: blog
tags: [Java, JavaScript, Web]
excerpt: "끝 슬래시 같은 전 경로 URL 정규화 301이 XHR·fetch 엔드포인트까지 리다이렉트하고 폐지 URL의 410을 가리는 원리와, 규칙 순서·테스트 방법을 정리합니다."
series: "브라우저와 URL에서 조용히 어긋나는 것들"
summary:
  - "전 경로에 301 URL 정규화를 걸었더니 XHR·fetch 요청과 폐지 URL의 410까지 영향을 받았습니다."
  - "Accept 헤더로 화면 요청만 가려야 하고, 값에 따라 상태가 갈리는 옛 주소는 정규화에서 빼야 한다는 원리를 확인했습니다."
  - "Accept에 text/html이 있는 GET·HEAD만 301 대상으로 하고, 판정 순서를 고정해 테스트로 검증했습니다."
---

## 문제와 배경

URL 표기를 하나로 통일하는 규칙은 흔합니다. 「모든 경로는 끝을 `/`로 닫는다」, 「경로는 소문자로 쓴다」 같은 규칙입니다. 목적은 검색엔진 색인과 유입 분석입니다. 같은 화면이 `/faq`와 `/faq/` 두 주소로 잡히면 색인이 나뉘고 통계도 둘로 갈라지기 때문입니다.

이 규칙을 구현하는 가장 손쉬운 방법은 서블릿 필터나 리버스 프록시에서 **전 경로**에 301을 거는 것입니다. 표기가 정본과 다르면 정본 주소로 보내고, 예외로는 보통 두 가지만 둡니다. 서버 간 호출 경로와 정적 자원입니다.

```text
GET /faq          →  301  Location: /faq/
GET /faq/         →  200
```

규칙 자체는 단순하지만, 전 경로에 걸면 의도하지 않은 요청까지 그물에 들어옵니다. 이 글은 그중 두 가지를 다룹니다.

1. 화면이 아닌 XHR·`fetch` 엔드포인트도 301을 받습니다.
2. 폐지된 옛 주소가 내야 할 `410 Gone`이 301 뒤로 밀려 가려집니다.

둘 다 오류 로그를 남기지 않는다는 공통점이 있습니다. 앞의 것은 빈 목록으로, 뒤의 것은 「정상적인 리다이렉트」로 보입니다.

## 부작용 1: XHR·fetch 엔드포인트도 리다이렉트됩니다

서버 렌더링 페이지는 대개 화면 경로와 데이터 경로가 같은 접두사를 공유합니다. 예를 들어 `/mypage/orders/`가 화면이라면, 그 화면의 JS가 부르는 목록 API는 `/mypage/orderList`처럼 같은 접두사 아래에 있습니다. 정규화 규칙은 이 둘을 구분하지 못하므로 데이터 엔드포인트도 301을 받습니다.

결과는 소비자에 따라 갈립니다.

| 소비자 | 301을 받으면 |
|---|---|
| 브라우저의 XHR·`fetch` (같은 출처) | 리다이렉트를 따라가므로 동작은 하지만, 요청이 매번 두 번 나갑니다. |
| 리다이렉트를 따르지 않도록 설정한 HTTP 클라이언트 | 본문이 없는 301을 받고 끝납니다. 파싱 단계에서 빈 목록이 됩니다. |
| `POST` 요청 | 브라우저는 301을 따라가면서 메서드를 `GET`으로 바꾸고 본문을 버립니다. |

마지막 줄은 HTTP 명세가 역사적 관행으로 허용하는 동작입니다. 메서드를 유지해야 한다면 307이나 308을 써야 하지만, 애초에 데이터 요청을 정규화 대상에 넣지 않는 편이 맞습니다.

### 경로로는 가를 수 없습니다

처음 떠오르는 해법은 「이 접두사는 API」라는 목록을 만드는 것입니다. 그런데 앞의 예처럼 데이터 엔드포인트의 상당수가 화면과 같은 접두사 아래에 있으면 목록을 만들 수 없습니다. 경로 끝에 `Ajax`를 붙이는 식의 명명 관행이 있더라도, 모든 엔드포인트가 그 관행을 따르지 않는 한 판정 기준이 되지 못합니다.

### Accept 헤더로 가릅니다

규칙의 목적에서 기준을 끌어오면 답이 나옵니다. 정규화는 색인과 분석을 위한 것이고, 그 주체는 **HTML을 받으러 온 요청**입니다. 그래서 `Accept` 헤더에 `text/html`이 있는 요청에만 301을 겁니다.

| 소비자 | 기본으로 보내는 `Accept` | 301 대상 |
|---|---|---|
| 브라우저 주소창·링크 이동 | `text/html,application/xhtml+xml,…` | 예 |
| 주요 검색엔진 크롤러 | `text/html`을 포함하는 값 | 예 |
| `fetch()` 기본값 | `*/*` | 아니요 |
| `XMLHttpRequest` 기본값 | `*/*` | 아니요 |
| jQuery `$.ajax`의 `dataType: "json"` | `application/json, text/javascript, */*; q=0.01` | 아니요 |
| 서버 간 호출·모바일 앱 | 대개 `*/*`나 JSON | 아니요 |

크롤러가 보내는 `Accept` 값은 공식 계약이라기보다 관찰된 동작입니다. `text/html`을 보내지 않는 크롤러는 301을 받지 못하므로, 그 경우의 색인 통합은 `<link rel="canonical">`이 맡게 됩니다. 이때 canonical에 적는 주소는 301 목적지와 같은 표기여야 합니다. 둘이 다르면 301로 모은 정본을 화면이 다시 둘로 가릅니다.

## 부작용 2: 폐지 URL의 410이 가려집니다

두 번째 부작용은 옛 표기 주소에서 생깁니다. 사이트 개편 뒤에도 옛 주소를 한동안 남겨 두는 경우가 많습니다. 그중에는 **파라미터 값에 따라 응답이 갈리는 주소**가 있습니다.

```text
/category/list?code=A10   →  아직 있는 분류, 새 주소로 301
/category/list?code=B20   →  폐지된 분류, 410 Gone
/category/list?code=ZZ    →  배정된 적 없는 값, 404
/category/list?code=C30   →  새 주소가 없는 분류, 옛 화면 그대로 200
```

301 갈래는 필터의 리다이렉트 규칙이 처리하고, 나머지 세 갈래는 필터가 일부러 통과시켜 컨트롤러가 응답합니다. 여기에 전 경로 정규화를 얹으면 순서가 이렇게 됩니다.

```text
GET /category/list?code=B20
  →  필터: 리다이렉트 규칙에 안 걸림, 그런데 끝 슬래시가 없음
  →  301  Location: /category/list/?code=B20
```

컨트롤러는 410을 낼 준비가 되어 있었지만 요청이 거기까지 가지 못했습니다. 410은 검색엔진에 「이 주소는 영구히 없어졌으니 색인에서 지워 달라」고 알리는 신호인데, 그 신호가 301 뒤로 밀리거나 사라집니다. 404와 200 갈래도 똑같이 301로 덮입니다.

손해가 하나 더 있습니다. 옛 표기는 어차피 정본이 아닌데, 슬래시를 붙인 변형을 새로 만들면 검색엔진이 알게 되는 주소가 오히려 하나 늘어납니다.

### 모든 폐지 경로를 뺄 필요는 없습니다

컨트롤러가 값과 상관없이 **무조건 410을 내는 경로**는 사정이 다릅니다.

```text
GET /board/oldView   →  301  →  /board/oldView/  →  410
```

검색엔진은 301을 따라가 410을 받으므로 삭제 신호는 보존됩니다. 비용은 한 홉뿐입니다. 이런 경로까지 필터에 목록으로 적어 두면 컨트롤러와 필터가 같은 정보를 두 벌로 들고 있게 되어 오히려 관리하기 어려워집니다.

갈라 보는 기준은 한 줄로 정리됩니다.

- **같은 경로가 파라미터 값에 따라 여러 상태로 갈리면** 정규화 대상에서 뺍니다.
- **경로만으로 상태가 하나로 정해지면** 301 → 410을 허용합니다.

## 규칙의 순서

두 부작용을 함께 막으려면 필터 안에서 판정 순서를 고정해 두어야 합니다.

1. 정규화 대상이 아닌 요청은 먼저 통과시킵니다. `GET`·`HEAD`가 아닌 요청, `Accept`에 `text/html`이 없는 요청, 마지막 세그먼트에 점이 있는 요청(`.js`, `.css`, `.png`, `.do` 같은 확장자 매핑)이 여기에 해당합니다.
2. 개별 리다이렉트 규칙이 목적지를 냈다면, **그 목적지에** 정규화를 적용해서 301을 한 번만 냅니다.
3. 규칙에 걸리지 않았는데 값 조건 옛 표기 경로라면 손대지 않고 통과시킵니다.
4. 그 밖의 경로는 정규화가 필요할 때만 301을 냅니다.

2번이 중요한 이유는 홉 수입니다. 개별 규칙마다 목적지에 슬래시를 손으로 붙이면, 언젠가 하나를 빠뜨렸을 때 `/faq/list` → `/faq` → `/faq/`처럼 두 홉이 생깁니다. 정규화를 필터 말미의 공통 단계로 두면 규칙을 새로 추가하는 사람이 슬래시를 신경 쓰지 않아도 됩니다.

### 핵심 코드

아래는 이 글을 위해 새로 쓴 최소 예시이며, 그대로 실행해 본 코드는 아닙니다. 리다이렉트 규칙 목록(`rules`)과 옛 표기 경로 패턴은 사이트마다 다르므로 자리만 잡아 두었습니다.

```java
public class UrlNormalizeFilter implements Filter {

    private static final Pattern LEGACY_VALUE_PATHS =
            Pattern.compile("^/(category|collection)/list$");

    private final RedirectRules rules;

    public UrlNormalizeFilter(RedirectRules rules) {
        this.rules = rules;
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;
        String path = request.getRequestURI();

        if (!isPageRequest(request) || hasExtension(path)) {
            chain.doFilter(req, res);
            return;
        }

        String target = rules.resolve(request);   // 개별 규칙의 목적지, 없으면 null
        if (target != null) {
            redirect(response, withTrailingSlash(target));
            return;
        }

        if (LEGACY_VALUE_PATHS.matcher(path).matches()) {
            chain.doFilter(req, res);              // 410·404·200은 컨트롤러가 정합니다
            return;
        }

        if (!path.endsWith("/")) {
            redirect(response, withTrailingSlash(path + query(request)));
            return;
        }
        chain.doFilter(req, res);
    }

    /** 화면(HTML)을 받으러 온 GET·HEAD 요청인지 */
    private static boolean isPageRequest(HttpServletRequest request) {
        String method = request.getMethod();
        if (!"GET".equals(method) && !"HEAD".equals(method)) {
            return false;
        }
        String accept = request.getHeader("Accept");
        return accept != null && accept.toLowerCase(Locale.ROOT).contains("text/html");
    }

    private static boolean hasExtension(String path) {
        String last = path.substring(path.lastIndexOf('/') + 1);
        return last.contains(".");
    }

    private static String query(HttpServletRequest request) {
        String q = request.getQueryString();
        return q == null ? "" : "?" + q;
    }

    /** 경로 부분만 슬래시로 닫고 쿼리 문자열은 그대로 둡니다 */
    private static String withTrailingSlash(String url) {
        int q = url.indexOf('?');
        String path = q < 0 ? url : url.substring(0, q);
        String rest = q < 0 ? "" : url.substring(q);
        return path.endsWith("/") ? url : path + "/" + rest;
    }

    private static void redirect(HttpServletResponse response, String location) {
        response.setStatus(HttpServletResponse.SC_MOVED_PERMANENTLY);
        response.setHeader("Location", location);
        response.setHeader("Vary", "Accept");
    }
}
```

`Vary: Accept`는 응답이 `Accept`에 따라 달라진다는 사실을 캐시에 알리는 헤더입니다. 301은 명시적인 만료 헤더가 없어도 캐시될 수 있는 응답이라, 중간에 공유 캐시나 CDN이 있으면 화면 요청이 받은 301을 JSON 요청에 그대로 돌려줄 수 있습니다. 이 문제를 직접 관측하지는 않았지만, `Accept`로 분기하는 순간 함께 따라오는 조건이라 넣어 두었습니다.

## 두 부작용을 테스트하는 방법

### 검증 요청도 브라우저와 같은 Accept를 보내야 합니다

`curl`과 Node의 `fetch`는 기본으로 `Accept: */*`를 보냅니다. 위 필터는 이 요청을 화면 요청으로 보지 않으므로, 기본값 그대로 점검하면 **301을 하나도 관측하지 못합니다.** 규칙이 아예 걸리지 않은 상태를 「문제 없음」으로 읽게 되는 셈입니다. 그래서 화면 경로를 점검할 때는 브라우저와 같은 값을 명시합니다.

```bash
# 화면 요청: 301이 나와야 합니다
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
  'http://localhost:8080/faq'

# 데이터 요청: 301이 나오면 안 됩니다
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Accept: application/json' \
  'http://localhost:8080/mypage/orderList'
```

반대 방향도 같습니다. 데이터 엔드포인트를 화면용 `Accept`로 두드리면 301이 관측되어 존재하지 않는 회귀를 만듭니다. 점검 스크립트에서 라우트마다 「화면인지 데이터인지」를 적어 두고 그에 맞는 `Accept`를 골라 보내야 합니다.

### 폐지 값은 상태 코드를 고정 케이스로 둡니다

값 조건 옛 표기 경로는 갈래마다 기대 상태 코드를 하나씩 박아 둡니다. 이 케이스는 정규화 규칙과 관계없이 늘 같은 답을 내야 합니다.

```javascript
const HTML_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const cases = [
  ['/category/list?code=A10', 301],   // 살아 있는 값은 새 주소로
  ['/category/list?code=B20', 410],   // 폐지된 값
  ['/category/list?code=ZZ', 404],    // 배정된 적 없는 값
  ['/category/list?code=C30', 200],   // 새 주소가 없는 값
];

for (const [path, expected] of cases) {
  const res = await fetch(`http://localhost:8080${path}`, {
    redirect: 'manual',
    headers: { Accept: HTML_ACCEPT },
  });
  const ok = res.status === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${path} → ${res.status} (기대 ${expected})`);
  if (!ok) process.exitCode = 1;
}
```

두 가지를 지켜야 이 테스트가 의미를 가집니다.

- `redirect: 'manual'`로 리다이렉트를 따라가지 않게 해야 합니다. 따라가면 최종 응답의 코드만 보게 되어, 301 → 410이 410처럼 보입니다. 무조건 410 경로처럼 한 홉을 허용하는 경우는 따로 케이스를 두고 명시적으로 따라가서 확인합니다.
- 기대값을 「3xx도 허용」처럼 느슨하게 바꾸지 않습니다. 이 케이스의 핵심은 **301이 아니라는 것**을 확인하는 데 있습니다. 실패가 귀찮아서 기대값을 넓히면 이 결함이 통째로 통과합니다. 통과했는데 실제로는 아무것도 검사하지 않는 점검의 문제는 [종료 코드 0과 조용한 실패](/blog/2026/10/07/silent-failure-exit-code-fail-open.html)에서도 다루었습니다.

위 스크립트도 이 글을 위해 새로 쓴 예시이며 그대로 실행해 보지는 않았습니다. Node 18 이상의 내장 `fetch`를 전제로 하고, 최상위 `await`를 쓰므로 ES 모듈(`.mjs`)로 저장해야 합니다.

## 함정과 트레이드오프

- **HTML 조각을 받는 XHR은 301 대상이 됩니다.** jQuery의 `dataType: "html"`이나 `$(el).load()`는 `Accept`에 `text/html`을 넣습니다. 화면 일부를 서버에서 렌더링해 끼워 넣는 엔드포인트라면 정규화 대상에 들어가므로, 그 경로를 정본 표기(끝 슬래시)로 부르거나 별도로 제외해야 합니다.
- **크롤러가 `text/html`을 보내지 않으면 301을 받지 못합니다.** 이 경우는 canonical 선언에 기대야 합니다. 템플릿이 자동으로 넣는 canonical뿐 아니라, 화면이 직접 선언하는 canonical까지 모두 301 목적지와 같은 표기인지 확인해야 합니다.
- **`Accept` 분기는 정책 문서에 없는 구현 판단인 경우가 많습니다.** 「서버 간 호출과 정적 자원만 예외」라고 적힌 정책을 그대로 구현하면 부작용 1이 생깁니다. 예외를 하나 더 두었다는 사실은 정책 쪽에도 기록해 두어야 다음 사람이 「정책과 다르다」며 되돌리지 않습니다.
- **값 조건 경로 목록은 필터와 컨트롤러가 함께 알아야 하는 정보입니다.** 옛 표기 경로가 새로 생기면 필터의 제외 패턴도 같이 갱신해야 합니다. 이 결합을 줄이려면 앞의 고정 테스트 케이스가 사실상 유일한 안전망입니다.

## 정리

- 전 경로 정규화 301은 화면이 아닌 요청까지 붙잡습니다. 경로 대신 `Accept`에 `text/html`이 있는지로 화면 요청만 골라 걸고, `GET`·`HEAD`로 제한합니다.
- 파라미터 값에 따라 301·410·404·200으로 갈리는 옛 표기 경로는 정규화 대상에서 뺍니다. 경로만으로 410이 정해지는 주소는 301 → 410의 한 홉을 허용해도 됩니다.
- 판정 순서는 「대상 아님 통과 → 개별 규칙 목적지에 정규화 → 값 조건 경로 통과 → 나머지 정규화」로 고정합니다.
- 점검 요청은 브라우저와 같은 `Accept`를 보내고, 리다이렉트를 따라가지 않으며, 폐지 값의 상태 코드를 「301이 아님」으로 고정해 둡니다.
