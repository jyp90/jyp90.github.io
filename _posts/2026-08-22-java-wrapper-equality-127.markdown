---
layout: post
title: "레거시 Java 웹 애플리케이션에서 만난 함정 (2) Integer == 비교가 127까지만 맞는 이유"
date: 2026-08-22 09:00:00 +0900
categories: blog
tags: [Java, Spring, Security]
excerpt: "Long·Integer 래퍼끼리 ==로 비교하면 -128~127 캐시 구간에서만 맞아 본인 여부 판정이 조용히 뒤집히는 원리와, 안전한 비교 방법·같은 패턴을 찾는 방법을 정리합니다."
series: "레거시 Java 웹 애플리케이션에서 만난 함정"
featured: true
summary:
  - "Long끼리 !=로 본인 여부를 비교해, 번호가 128 이상이면 자기 목록이 남의 목록으로 처리됐습니다."
  - "래퍼끼리의 ==는 참조 비교이고, -128~127 구간만 valueOf 캐시 덕분에 우연히 맞습니다."
  - "null 가능성에 따라 primitive 비교나 Objects.equals로 고치고, 같은 패턴은 정적 분석으로 찾습니다."
---

## 문제와 배경

레거시 웹 애플리케이션에는 사용자별 글 목록을 돌려주는 API가 있습니다. 조회자가 그 목록의 주인이면 숨김 처리한 글까지 보여 주고, 다른 사람이면 공개 글만 보여 주면서 조회 이력을 남깁니다. 분기 조건은 이런 모양이었습니다.

```java
Long viewerId = loginUser.getUserId();   // 세션에서 꺼낸 조회자 번호
Long ownerId  = request.getOwnerId();    // 요청으로 들어온 목록 주인 번호

if (viewerId != ownerId) {
    return postService.findPublicPosts(ownerId);   // 남의 목록으로 처리
}
return postService.findAllPosts(ownerId);          // 내 목록으로 처리
```

읽기에는 아무 문제가 없어 보입니다. 하지만 두 변수가 모두 `Long`이라서 `!=`는 값이 아니라 **객체 참조**를 비교합니다. 사용자 번호가 127 이하면 우연히 맞고, 128 이상이면 값이 같아도 다른 객체로 판정됩니다. 결과적으로 번호가 큰 사용자 대부분에게 자기 목록이 남의 목록으로 처리됐습니다.

증상은 권한 오류처럼 보이지 않았습니다.

| 겉으로 보이는 증상 | 실제 원인 |
|---|---|
| 숨긴 글이 자기 글 목록에서 사라짐 | 본인인데 공개 글만 조회하는 분기를 탐 |
| 자기 목록을 볼 때마다 조회 이력이 쌓임 | 본인 조회를 남의 조회로 기록 |
| 예외도 로그도 없음 | 「남으로 분류」라는 정상 분기를 탔을 뿐 |

같은 파일의 조회 이력 저장 조건도 같은 형태였습니다. 한 번 생긴 습관은 대개 한 곳에서 끝나지 않습니다.

## 왜 127에서 갈리는가

### 오토박싱은 `valueOf`를 부르고, `valueOf`는 캐시를 씁니다

`Long x = 200L;`처럼 primitive를 래퍼에 넣으면 컴파일러가 `Long.valueOf(200L)` 호출로 바꿉니다. 그리고 `Long.valueOf`는 -128부터 127까지의 값에 대해 미리 만들어 둔 인스턴스를 돌려줍니다. 범위를 벗어나면 매번 새 객체를 만듭니다.

```java
Long a = 127L, b = 127L;
Long c = 128L, d = 128L;

System.out.println(a == b);   // true  — 캐시된 같은 인스턴스
System.out.println(c == d);   // false — 값은 같지만 서로 다른 객체
```

`Integer`, `Short`, `Byte`, `Character`(0~127)도 같은 식으로 캐시합니다. JLS(Java Language Specification) §5.1.7은 -128~127 구간의 정수를 박싱하면 같은 참조가 나와야 한다고 정해 두었고, 그 밖의 값은 같은 참조일 수도 아닐 수도 있다고만 말합니다. 즉 127까지 맞는 것은 **보장된 우연**이고, 그 위에서 틀리는 것은 **보장되지 않은 동작**입니다.

### 캐시 상한을 늘려도 해결되지 않습니다

`Integer`는 `-XX:AutoBoxCacheMax=<n>` 옵션으로 캐시 상한을 키울 수 있습니다. 그런데 이 옵션은 `Integer`에만 적용되고 `Long`의 캐시는 -128~127로 고정입니다. 아래 결과는 JDK 21에서 직접 실행해 확인한 값입니다(JDK 8에서는 돌려 보지 않았습니다).

```text
# 기본 실행
Long 128 == Long 128       → false
Integer 1000 == Integer 1000 → false

# -XX:AutoBoxCacheMax=2000
Long 128 == Long 128       → false   (Long은 그대로)
Integer 1000 == Integer 1000 → true
```

상한을 늘리면 틀리는 경계가 뒤로 밀릴 뿐이고, 경계 뒤의 값에서는 여전히 틀립니다. 게다가 이런 JVM 옵션에 코드의 정확성이 기대는 것 자체가 위험합니다.

### 래퍼 변수가 생기는 자리

레거시 Java 웹 애플리케이션에서 래퍼 타입은 생각보다 자주 생깁니다.

- MyBatis가 채우는 VO·DTO 필드는 NULL 허용 컬럼 때문에 대개 `Long`·`Integer`로 선언합니다.
- 세션에 넣어 둔 로그인 사용자 객체의 번호 필드도 비로그인을 `null`로 표현하려고 래퍼로 둡니다.
- `Map<String, Object>` 파라미터 맵에서 꺼낸 값을 캐스팅하면 래퍼가 됩니다.
- Spring MVC에서 선택 파라미터를 `@RequestParam(required = false) Long ownerId`로 받으면 래퍼가 됩니다.

양쪽이 이런 출처에서 오면 `==`·`!=`는 조용히 참조 비교가 됩니다.

## 왜 QA에서 잡히지 않는가

이 결함은 테스트 환경의 데이터 특성과 정확히 맞물려 숨습니다.

- **개발·테스트 DB의 번호가 작습니다.** 시드 데이터가 1번부터 수십 번까지라면 전부 캐시 구간 안이라 모든 테스트가 통과합니다.
- **검수자는 자기 계정으로 확인합니다.** 일찍 만든 테스트 계정일수록 번호가 작아서 재현되지 않습니다.
- **실패가 조용합니다.** 예외가 나지 않고 정상 분기 중 하나를 타므로 로그나 모니터링에 걸리지 않습니다. 조용한 실패가 왜 오래 살아남는지는 [종료 코드 0으로 끝나는 조용한 실패](/blog/2026/10/07/silent-failure-exit-code-fail-open.html)에서도 다뤘습니다.
- **증상이 다른 문제처럼 보입니다.** 「글이 사라졌다」는 신고는 저장·삭제 로직부터 의심하게 만듭니다.

그래서 이 부류는 검수 항목으로 막기 어렵고 코드 리뷰나 정적 분석에서 잡아야 합니다. 단위 테스트를 쓴다면 **128 이상의 번호**를 일부러 넣는 것만으로 재현됩니다.

```java
@Test
public void ownerCheckWorksAboveBoxCache() {
    Long viewerId = Long.valueOf(1000L);
    Long ownerId  = Long.valueOf(1000L);   // 같은 값, 다른 객체
    assertTrue(OwnerCheck.isOwner(viewerId, ownerId));
}
```

## 안전하게 비교하는 방법

정답은 하나가 아니고, 값이 `null`일 수 있는지에 따라 고릅니다.

| 방식 | 예 | 맞는 경우 | 주의할 점 |
|---|---|---|---|
| 한쪽을 primitive로 받기 | `viewerId != null && viewerId == ownerId` (`ownerId`가 `long`) | 한쪽 값이 경로 변수처럼 반드시 있을 때 | 래퍼 쪽이 `null`이면 언박싱하다 NPE가 나므로 `null` 가드가 먼저 와야 합니다 |
| `Objects.equals(a, b)` | `Objects.equals(viewerId, ownerId)` | 양쪽 다 `null`일 수 있을 때 | `null`과 `null`을 같다고 판정합니다. 비로그인끼리 「본인」이 되지 않는지 먼저 확인합니다 |
| `a.equals(b)` | `viewerId.equals(ownerId)` | 왼쪽이 `null`이 아님을 이미 보장했을 때 | 왼쪽이 `null`이면 NPE입니다 |
| primitive로 꺼내 비교 | `a.longValue() == b.longValue()` | 둘 다 `null`이 아님이 확실할 때 | 의도는 분명하지만 `null`이면 NPE입니다 |

본인 여부 판정이라면 첫 번째 방식이 가장 의도를 잘 드러냅니다. 비로그인은 항상 남으로 본다는 규칙까지 한 줄에 담기기 때문입니다.

```java
final class OwnerCheck {
    /** 비로그인(viewerId == null)은 항상 타인으로 봅니다. */
    static boolean isOwner(Long viewerId, long ownerId) {
        return viewerId != null && viewerId == ownerId;   // long과 비교하므로 언박싱 후 값 비교
    }
}
```

여기에는 리뷰어를 헷갈리게 하는 지점이 있습니다. `viewerId == ownerId`는 고치기 전 코드와 **생김새가 똑같습니다.** 값 비교인지 참조 비교인지는 연산자 모양이 아니라 두 피연산자의 선언 타입이 정합니다. 한쪽이라도 primitive면 언박싱이 일어나 값 비교가 되고, 둘 다 래퍼면 참조 비교가 됩니다. 리뷰할 때는 `==` 주변만 보지 말고 변수 선언까지 따라가야 합니다.

### 섞인 타입에서 생기는 두 번째 함정

`equals`로 바꾸면 끝일 것 같지만 타입이 섞이면 또 틀립니다. 아래도 JDK 21에서 실행해 확인한 결과입니다.

```java
Long id = 200L;
Integer other = 200;

Objects.equals(id, other);   // false — Long.equals는 상대가 Long일 때만 true
id.equals(200);              // false — 200은 int라서 Integer로 박싱됨
id.equals(200L);             // true
```

`Long.equals(Object)`는 상대가 `Long` 인스턴스가 아니면 값과 상관없이 `false`를 돌려줍니다. 한쪽은 `Long` 필드, 다른 쪽은 파라미터 맵에서 꺼낸 `Integer`인 상황은 MyBatis 코드에서 드물지 않습니다. 이때 `equals`는 컴파일도 되고 예외도 없이 항상 `false`입니다. 참고로 `Long == Integer`는 컴파일 오류가 나므로 오히려 안전합니다. 타입이 섞일 수 있는 자리에서는 비교 전에 한쪽 타입으로 맞추는 편이 확실합니다.

## 같은 패턴을 찾는 방법

### grep으로 후보 좁히기

정규식으로는 타입을 알 수 없으므로 grep은 후보를 모으는 용도입니다. 식별자처럼 생긴 이름끼리 `==`·`!=`로 비교하는 줄을 찾고, 한쪽이 `null`이나 숫자 리터럴인 줄은 뺍니다.

```bash
# 이름이 Id/No/Seq로 끝나는 값끼리 ==, != 로 비교하는 줄
grep -rnE '[A-Za-z_][A-Za-z0-9_.()]*(Id|No|Seq)\(?\)? *[!=]= *[A-Za-z_][A-Za-z0-9_.()]*(Id|No|Seq)\b' \
  --include='*.java' src/main/java \
  | grep -vE '[!=]= *(null|[0-9])'
```

이름 규칙이 다른 코드베이스라면 `(Id|No|Seq)` 부분만 바꾸면 됩니다. 작은 예제 파일로 돌려 보면 아래처럼 나옵니다.

```text
src/PostController.java:3:    if (viewerId == ownerId) {}
src/PostController.java:4:    if (post.getWriterId() != loginUser.getUserId()) {}
src/PostController.java:5:    if (viewerId == pathId) {}
```

5번째 줄의 `pathId`는 `long`으로 선언된 값이라 실제로는 안전합니다. grep 결과는 이렇게 오탐을 섞어 내므로, 걸린 줄마다 두 피연산자의 선언 타입을 확인합니다. 우선순위는 소유권·본인 여부·권한 판정에 쓰인 비교입니다. 기능 결함이 아니라 권한 결함이기 때문입니다.

`x == 0L`이나 `x != null`처럼 한쪽이 리터럴이거나 `null`이면 안전합니다. 앞쪽은 언박싱 후 값 비교이고, 뒤쪽은 원래 참조 비교가 의도이기 때문입니다.

### 정적 분석 도구에 맡기기

타입을 아는 도구는 이 패턴을 정확히 잡습니다. 이름이 알려진 규칙은 다음과 같습니다. 이번 글을 쓰면서 각 도구를 직접 돌려 보지는 않았으므로, 기본 활성화 여부와 심각도는 쓰는 버전의 문서에서 확인하기 바랍니다.

| 도구 | 규칙 |
|---|---|
| SpotBugs | `RC_REF_COMPARISON` (래퍼·String 같은 값 타입의 참조 비교) |
| Error Prone | `BoxedPrimitiveEquality`, `ReferenceEquality` |
| SonarQube (Java) | S4973 (String·박싱 타입은 `equals`로 비교) |
| IntelliJ IDEA 검사 | Number comparison using '==' instead of 'equals()' |

레거시 코드베이스에 정적 분석을 처음 붙이면 경고가 수백 개씩 쏟아지기 쉽습니다. 이 경우 전체를 켜기보다 위 규칙 하나만 켜서 결과를 먼저 처리하는 편이 현실적입니다. 걸린 곳을 고칠 때도 주변 코드는 손대지 않고 비교식 하나만 바꾸면 리뷰와 되돌리기가 쉽습니다.

## 정리

- `Long`·`Integer` 래퍼끼리의 `==`·`!=`는 값이 아니라 참조를 비교합니다. -128~127 구간은 `valueOf` 캐시 덕분에 우연히 맞고, 그 밖에서는 값이 같아도 틀립니다.
- 이 비교가 본인 여부·소유권 판정에 쓰이면 번호가 큰 사용자 대부분에게 판정이 조용히 뒤집히는 권한 결함이 됩니다.
- 테스트 데이터의 번호가 작고 실패가 정상 분기로 보이기 때문에 QA로는 잘 잡히지 않습니다. 단위 테스트에 128 이상의 값을 넣으면 바로 재현됩니다.
- 고칠 때는 `null` 가능성에 따라 primitive 비교, `Objects.equals`, `equals`를 고르고, `Long`과 `Integer`가 섞이면 `equals`도 항상 `false`라는 점을 기억해 둡니다.
- `==`의 생김새가 아니라 두 피연산자의 선언 타입을 봐야 합니다. grep으로 후보를 모으고, 확정은 타입을 아는 정적 분석 도구에 맡기는 것이 안전합니다.
