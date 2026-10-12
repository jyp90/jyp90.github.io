---
layout: post
title: "논문 본문 뷰어 만들기 (2) S3 본문을 CloudFront 서명 쿠키로 서빙하기"
date: 2026-07-17 09:00:00 +0900
categories: blog
tags: [보안, 아키텍처, JavaScript, CDN, CloudFront, S3]
excerpt: "학술 논문 본문 JSON을 CloudFront 서명 쿠키로 서빙하면서 인증 누락과 짧은 TTL 갱신에서 겪은 함정을 정리합니다."
summary:
  - "본문·쿠키 재발급 API 일부에 로그인 확인이 빠져, 비로그인 상태로도 그대로 응답하는 경로가 있었습니다."
  - "서명 쿠키 TTL을 짧게 잡아 노출 범위를 줄이되, HttpOnly라 만료 시점은 응답 바디로 따로 추적해야 했습니다."
  - "발급 순서·선제 갱신·로컬 HTTPS 제약을 맞추고 나서야 뷰어가 끊김 없이 본문을 받아 왔습니다."
series: "논문 본문 뷰어 만들기"
---

## 문제와 배경

학술 논문 서비스에 본문 전체를 읽는 뷰어를 추가하면서, 본문과 번역 결과를 어디에 어떻게 저장하고 서빙할지부터 정해야 했습니다. 본문은 용량이 크고 페이지 단위로 쪼개져 있어 객체 스토리지(S3)에 JSON으로 두고 CDN(CloudFront)을 앞에 세우는 구조는 자연스러웠습니다. 다만 이 본문은 서비스의 핵심 자산이라, 정적 CSS·이미지처럼 누구나 받을 수 있게 열어 둘 수는 없었습니다. 로그인하지 않은 사람이나 크롤러가 URL만 알면 그대로 받아 갈 수 있으면 안 됩니다.

그래서 S3 버킷은 비공개로 두고 OAC(Origin Access Control)로 CloudFront만 접근하게 한 뒤, 애플리케이션이 로그인을 확인하고 짧은 TTL의 서명 쿠키를 내려주는 구조를 골랐습니다. 접근 제어를 엣지에 두면 매 요청마다 권한을 다시 조회하지 않아도 되고, 쿠키가 밖으로 새어 나가도 TTL이 지나면 쓸모가 없어집니다.

그런데 이 구조를 처음 넣었을 때, 본문 조회와 쿠키 재발급을 담당하는 엔드포인트 중 일부에 로그인 여부를 확인하는 코드가 빠져 있었습니다. 목차나 원시 조회용으로 따로 둔 보조 엔드포인트가 같은 패턴을 복사해 만들어지면서, 정작 그중 몇 개는 인증 게이트를 넣는 것을 놓친 것입니다. 비로그인 상태로 그 경로를 직접 호출하면 본문도, 심지어 서명 쿠키 재발급까지도 그대로 응답했습니다. 짧은 TTL로 노출을 줄인다는 설계 의도 자체가, 애초에 그 쿠키를 아무나 발급받을 수 있으면 무의미해집니다. 이 글은 그 구멍을 막고 나서 실제로 짧은 TTL을 운영하면서 부딪힌 함정들을 정리합니다.

글에 나오는 코드는 이 글을 위해 일반 이름으로 새로 쓴 예시이고, 그대로 실행해 보지는 않았습니다.

## 접근

전체 구조는 세 계층입니다.

| 계층 | 역할 |
|---|---|
| 기존 웹 애플리케이션 (Spring MVC + JSP) | 세션으로 로그인 여부 판단, 서명 쿠키 발급·재발급 |
| CloudFront | 쿠키 서명 검증, 엣지 캐싱 |
| S3 (비공개 버킷) | 본문·번역 JSON 원본, OAC로만 접근 허용 |

본문은 구독이 필요한 논문과 공개(오픈 액세스) 논문 두 갈래로 나뉩니다. 공개 논문은 로그인 없이도 본문을 볼 수 있지만, 서명 쿠키 발급 자체는 공개·비공개 구분 없이 동일하게 거칩니다. 권한 확인 로직을 한곳에 모아 두고, CDN 엣지에서는 "로그인했는가"가 아니라 "유효한 서명이 있는가"만 보게 하기 위해서입니다.

```text
GET /fulltext/{id}            # 본문 메타 + 첫 페이지, 구독 논문은 비로그인 시 401
POST /fulltext/{id}/cookie     # 서명 쿠키 재발급, 구독 논문은 비로그인 시 401
```

쿠키 TTL은 1분 남짓으로 짧게 잡았습니다. 평소 CDN 캐시 TTL보다 훨씬 짧은 값입니다. TTL이 짧을수록 쿠키 값이 유출됐을 때 악용할 수 있는 시간이 줄어들지만, 그만큼 뷰어가 열려 있는 동안 쿠키를 계속 갱신해야 합니다. 이 트레이드오프를 받아들이는 대신, 갱신을 사용자가 느끼지 못하게 만드는 쪽에 공을 들였습니다.

## 구현

### 핵심 코드

서버는 로그인 세션을 확인한 뒤 서명 쿠키를 발급하고, 만료 시각을 응답 바디에 함께 내려줍니다. 쿠키 자체는 `HttpOnly`라서 브라우저 스크립트가 값도 만료 시각도 직접 읽을 수 없기 때문입니다.

```java
public class SignedCookieIssuer {

    private static final long TTL_SECONDS = 60;

    public CookieIssueResult issue(HttpServletResponse response, String nodeId) {
        long expiresAtEpochMillis = System.currentTimeMillis() + TTL_SECONDS * 1000;

        // 한 경로 아래 여러 객체를 허용해야 하므로 와일드카드를 쓰는 사용자 지정 정책입니다.
        String policy = buildCustomPolicy("https://cdn.example.com/fulltext/*", expiresAtEpochMillis);
        String signature = sign(policy);

        addCookie(response, "CloudFront-Policy", policy);
        addCookie(response, "CloudFront-Signature", signature);
        addCookie(response, "CloudFront-Key-Pair-Id", keyPairId());

        return new CookieIssueResult(expiresAtEpochMillis, TTL_SECONDS);
    }

    private void addCookie(HttpServletResponse response, String name, String value) {
        // 구버전 Servlet API의 Cookie 클래스에는 SameSite 속성이 없어 헤더를 직접 씁니다.
        response.addHeader("Set-Cookie", name + "=" + value
                + "; Domain=.example.com; Path=/fulltext; Max-Age=" + TTL_SECONDS
                + "; HttpOnly; Secure; SameSite=None");
    }
}
```

클라이언트는 응답에 담긴 만료 정보를 저장해 뒀다가, 만료 몇 초 전에 선제적으로 재발급을 요청합니다. 같은 페이지에서 이미지 블록 여러 개가 동시에 CDN을 호출할 수 있으므로, 재발급 요청이 겹치지 않도록 진행 중인 요청을 추적합니다.

```javascript
const pendingRefresh = new Map(); // nodeId -> Promise

async function ensureCookie(nodeId, { force = false } = {}) {
  const cached = readExpiry(nodeId);
  const marginMs = 10_000;
  const needsRefresh = force || !cached || cached.expiresAt - Date.now() < marginMs;
  if (!needsRefresh) return;

  if (pendingRefresh.has(nodeId)) {
    await pendingRefresh.get(nodeId);
    return;
  }

  const request = fetch(`/fulltext/${nodeId}/cookie`, { method: 'POST', credentials: 'include' })
    .then((res) => res.json())
    .then((body) => saveExpiry(nodeId, body.expiresInSec))
    .finally(() => pendingRefresh.delete(nodeId));

  pendingRefresh.set(nodeId, request);
  await request;
}

function saveExpiry(nodeId, expiresInSec) {
  // 절대 시각이 아니라 응답을 받은 시점 기준 상대 시간으로 저장합니다.
  const expiresAt = Date.now() + expiresInSec * 1000;
  try {
    localStorage.setItem(`cookie:exp:${nodeId}`, String(expiresAt));
  } catch {
    inMemoryFallback.set(nodeId, expiresAt);
  }
}
```

이미지 요청이 403으로 실패하면 쿠키가 만료됐다고 보고 강제 재발급 후 한 번만 다시 시도합니다. 두 번째도 실패하면 재시도를 멈춥니다. 무한 재시도는 실제 권한 문제(예: 세션이 끊겨 로그인 자체가 풀린 경우)를 사용자에게 알리지 못한 채 요청만 계속 쌓이게 만들기 때문입니다.

본문·번역 JSON의 객체 키는 식별자 앞에 짧은 샤드 접두어를 둔 구조로 나눴습니다. `nodes/{shard}/{nodeId}/v1/{lang}/p{page}/content.json` 같은 형태입니다. 언어와 페이지가 경로에 드러나므로, 번역 하나를 다시 만들거나 지울 때도 그 접두어 아래만 다루면 됩니다.

번역은 요청 즉시 결과가 나오지 않으므로 상태를 두고 폴링하는 방식을 썼습니다. 요청이 들어오면 상태를 "생성 중"으로 기록하고, 번역이 끝나면 CDN 경로와 함께 "완료"로 바꿉니다. 클라이언트는 몇 초 간격으로 상태를 물어보다가 완료 상태가 되면 그 경로로 JSON을 받아 옵니다. 완료된 결과는 매번 다시 번역하지 않도록 CDN에 그대로 남겨 두고, 같은 요청이 들어오면 캐시된 결과를 돌려줍니다.

## 함정과 트레이드오프

- **첫 요청 순서**: 쿠키가 없는 상태에서 CDN을 먼저 호출하면 403이 납니다. 뷰어가 열릴 때 쿠키 발급을 먼저 끝내고 나서 본문 요청을 보내야 합니다. 두 요청을 병렬로 쏘면 경쟁 상태에서 가끔만 실패하는 식으로 나타나, 원인을 찾기 더 어려웠습니다.
- **상대 시간으로 추적**: 서버가 돌려주는 만료 시각을 절대 타임스탬프로 그대로 쓰면 클라이언트 시계가 어긋났을 때 너무 일찍 혹은 너무 늦게 갱신하게 됩니다. 응답을 받은 시점을 기준으로 "몇 초 뒤 만료"를 다시 계산해 저장하는 쪽이 안전했습니다.
- **로컬에서는 전체 플로우를 검증할 수 없음**: `SameSite=None`은 `Secure`가 같이 있어야 브라우저가 쿠키를 받아들입니다. 로컬 개발 서버가 `http://localhost`라면 이 조건을 만족하지 못해 쿠키 자체가 안 걸립니다. 재발급 엔드포인트 단위 테스트까지는 로컬에서 가능하지만, 실제로 CDN이 쿠키를 읽고 응답하는지는 HTTPS가 적용된 환경에서만 확인할 수 있었습니다.
- **재시도는 한 번만**: CDN 403에 대한 재시도를 제한 없이 걸어 두면, 쿠키가 아니라 세션 자체가 끊긴 상황에서도 계속 재시도만 반복하며 실패를 감추게 됩니다. 한 번 재시도하고도 안 되면 멈추고 사용자에게 알리는 편이 디버깅에도, 사용자 경험에도 낫습니다.
- **엣지 캐싱과 권한 반영 시점의 괴리**: 권한은 쿠키 발급 시점에만 확인하므로, 발급 이후 구독이 끊기더라도 이미 내려준 쿠키는 TTL이 끝날 때까지 유효합니다. TTL을 짧게 잡은 이유 중 하나가 바로 이 간극을 줄이기 위해서입니다. 더 즉시성이 필요하다면 엣지에서 매 요청을 검증해야 하는데, 그러면 CDN을 두는 이점 자체가 줄어듭니다.
- **인증 게이트는 엔드포인트마다 따로 챙겨야 합니다**: 같은 기능을 복사해 보조 엔드포인트를 만들 때 인증 확인 코드까지 함께 복사되리라는 보장은 없습니다. 본문 조회, 쿠키 재발급, 목차 조회처럼 같은 리소스를 다루는 경로가 여러 개라면 하나씩 비로그인으로 직접 호출해 보는 점검이 필요합니다.

정적 자산을 WAR 밖으로 옮겨 CDN에 올리는 절차 자체는 접근 제어가 필요 없는 공개 자산 기준으로 [레거시 WAR에서 웹폰트와 정적 파일 덜어내기](/blog/2026/10/08/static-assets-out-of-war.html)에서 다뤘습니다. 이번 글의 본문·번역 JSON은 같은 CDN 경로를 쓰더라도 비공개 자산이라 서명 쿠키라는 층이 하나 더 필요했다는 점이 다릅니다.

## 정리

- 본문처럼 서비스의 핵심 자산을 CDN으로 서빙할 때는 "정적 자산을 CDN에 올린다"와 "비공개 자산을 CDN 뒤에서 보호한다"를 다른 문제로 다뤄야 합니다. 후자는 권한 확인 로직을 다루는 모든 엔드포인트에 동일하게 인증 게이트가 걸려 있는지 하나씩 점검해야 안전합니다.
- 짧은 TTL 서명 쿠키는 유출 시 노출 범위를 줄이지만, 그만큼 갱신을 사용자가 느끼지 못하게 설계해야 합니다. HttpOnly라 만료 시각은 응답 바디로 따로 내려주고, 클라이언트는 절대 시각이 아니라 응답을 받은 시점 기준 상대 시간으로 추적합니다.
- 첫 CDN 요청 전에 쿠키 발급이 끝나 있어야 하고, 재시도는 한 번으로 제한해 실제 권한 문제를 가리지 않게 합니다. `SameSite=None;Secure` 쿠키는 HTTPS 환경에서만 끝까지 검증할 수 있다는 점도 미리 알고 있어야 합니다.
