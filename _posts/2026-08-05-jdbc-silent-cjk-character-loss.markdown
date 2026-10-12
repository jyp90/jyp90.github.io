---
layout: post
title: "한자가 조용히 ?로 바뀌는 곳 — JDBC 전송 계층의 문자 손실 추적기"
date: 2026-08-05 09:00:00 +0900
categories: blog
tags: [Java, JDBC, SQL Server, Unicode, 장애대응, DB]
excerpt: "컬럼이 NVARCHAR인데도 일부 한자가 오류 없이 ?로 저장되는 문제를, 손실 지점을 좁혀 가는 방법과 복구 순서까지 함께 정리합니다."
featured: true
summary:
  - "NVARCHAR 컬럼인데도 일부 한자가 오류 없이 ?로 저장되는 문제가 있었습니다."
  - "sendStringParametersAsUnicode=false 설정 때문에 값이 CP949로 전송되며 깨진 것입니다."
  - "setNString()으로 전송을 고치고, URL 대조와 원본 재적재로 값을 복구한 뒤 재색인합니다."
---

## 문제와 배경

외부에서 수집한 다국어 데이터를 SQL Server에 적재하는 배치가 있었습니다. 인명이나 도서 제목 같은 텍스트였고, 대부분은 문제없이 들어갔습니다. 그런데 일부 행에서 한자 한 글자만 `?`로 바뀌어 있었습니다.

```text
원문  : 渡辺花子
저장값: 渡?花子
```

이상한 점이 세 가지 있었습니다.

- 컬럼 타입은 `NVARCHAR`였습니다. 유니코드를 저장할 수 있는 컬럼입니다.
- 배치 로그에는 오류도 경고도 없었습니다.
- 같은 문장 안에서도 어떤 한자는 멀쩡하고 어떤 한자만 사라졌습니다.

문제가 처음 눈에 띈 곳은 검색 결과 화면이었습니다. 그래서 처음에는 검색 색인이나 수집(크롤링) 단계에서 인코딩이 깨졌을 것이라고 추정했습니다. 이 추정은 틀렸고, 처방도 완전히 달라졌습니다. 이 글은 그 손실 지점을 어떻게 찾았는지를 정리합니다.

## 손실이 보이는 곳과 손실이 일어난 곳은 다릅니다

데이터는 대략 이렇게 흘러갑니다.

```text
[1] 외부 원문 (UTF-8)
      ↓ 수집
[2] 원본 JSON 파일 (UTF-8)
      ↓ 배치가 JDBC로 INSERT
[3] DB 테이블 (NVARCHAR)
      ↓ 복제·색인
[4] 검색 색인 → API 응답 → 화면
```

`?`는 [4]에서 보였지만, [4]는 받은 값을 그대로 옮겼을 뿐일 수 있습니다. 손실 지점을 찾으려면 각 단계에 남아 있는 값을 상류부터 하나씩 확인해야 합니다.

1. **원본 JSON을 직접 열어 봅니다.** 문제의 글자가 그대로 있었습니다. 따라서 [1]→[2]는 무손실입니다.
2. **DB 값을 직접 조회합니다.** 이미 `?`였습니다. 색인은 깨진 값을 받아 그대로 옮긴 것이므로 [3]→[4]는 원인이 아닙니다.
3. **같은 행의 다른 컬럼을 봅니다.** 이 단서가 결정적이었습니다. 같은 행에는 원문 링크 URL도 저장돼 있었는데, URL은 퍼센트 인코딩된 ASCII 문자열입니다. 이 URL을 디코딩하면 원래 한자가 그대로 나왔습니다. 수집 단계에서 깨졌다면 URL에도 흔적이 남았어야 합니다.
4. **어느 쓰기 주체가 넣은 행인지 봅니다.** 손실은 특정 배치가 넣은 행에서만 나타났습니다.

남는 곳은 [2]→[3], 즉 **배치가 JDBC로 값을 DB에 보내는 구간**이었습니다.

## 원인: `sendStringParametersAsUnicode=false`

Microsoft의 SQL Server JDBC 드라이버(mssql-jdbc)에는 `sendStringParametersAsUnicode`라는 접속 옵션이 있습니다. 기본값은 `true`입니다. 이 값이 `true`이면 `PreparedStatement.setString()`으로 넘긴 문자열을 유니코드(`NVARCHAR`)로 전송합니다.

문제의 배치는 접속 URL에 이 옵션을 `false`로 명시하고 있었습니다.

```text
jdbc:sqlserver://db-host:1433;databaseName=app;sendStringParametersAsUnicode=false
```

`false`이면 드라이버는 `setString()`으로 받은 문자열을 **데이터베이스 기본 코드 페이지로 인코딩해서** 보냅니다. 이 DB의 코드 페이지는 한국어 CP949였습니다. 그 결과는 다음과 같습니다.

```text
Java String "渡辺花子" (UTF-16, 손실 없음)
   ↓ setString() + sendStringParametersAsUnicode=false
CP949로 인코딩 시도
   "渡" "花" "子" → CP949에 있음 → 통과
   "辺" (U+8FBA)  → CP949에 없음 → "?"로 치환, 예외 없음
   ↓
NVARCHAR 컬럼에 저장 — 이미 "?"가 된 값을 그대로 저장
```

여기서 오해하기 쉬운 점이 두 가지 있습니다.

- **컬럼이 `NVARCHAR`여도 소용없습니다.** 값이 컬럼에 도착하기 전에 이미 깨졌습니다.
- **DB 콜레이션(collation)은 원인이 아닙니다.** `NVARCHAR`는 콜레이션의 코드 페이지가 아니라 UTF-16으로 저장합니다. 콜레이션은 정렬과 비교에만 쓰입니다.

이 옵션을 `false`로 두는 데에는 나름의 이유가 있습니다. 인덱스가 걸린 `VARCHAR` 컬럼을 `NVARCHAR` 파라미터와 비교하면 SQL Server가 암묵적 형 변환을 하면서 인덱스 탐색(seek)을 못 하고 스캔으로 떨어지는 경우가 있습니다. 이를 피하려고 시스템 전체 접속 설정에 `false`를 넣어 두는 일이 흔합니다. 그래서 이 설정은 한 배치만의 문제가 아니라, 같은 접속 설정을 공유하는 모든 쓰기 경로에 잠재된 위험입니다.

## 어떤 글자가 사라지는가

처음에는 「일본 한자 일부」만의 문제로 보였습니다.

| 글자 | 코드 포인트 | 설명 |
|---|---|---|
| 辺 | U+8FBA | 일본 신자체 (한국 정자체는 邊) |
| 駅 | U+99C5 | 일본 신자체 (驛) |
| 教 | U+6559 | 중국 간체 |
| 应 | U+5E94 | 중국 간체 (應) |

하지만 범위를 넓혀 보니 한자에만 국한되지 않았습니다. `ñ`, `ā` 같은 라틴 확장 문자와 em dash(`—`), en dash(`–`)도 똑같이 사라졌습니다. 정확한 규칙은 하나입니다. **CP949 문자 집합 밖에 있는 문자는 전부 손실 대상입니다.** 「중국어 데이터가 깨진다」 같은 언어 단위 설명은 범위를 잘못 잡게 만듭니다.

## 처방

### 핵심 코드: `setNString()`

가장 국소적인 처방은 해당 쓰기 경로에서 `setString()` 대신 `setNString()`을 쓰는 것입니다. `setNString()`은 `sendStringParametersAsUnicode` 설정과 관계없이 값을 `NVARCHAR`로 전송합니다.

```java
public void insertReference(Connection conn, String title, String author) throws SQLException {
    String sql = "INSERT INTO reference_item (title, author) VALUES (?, ?)";
    try (PreparedStatement ps = conn.prepareStatement(sql)) {
        ps.setNString(1, title);   // 접속 옵션과 무관하게 유니코드로 전송
        ps.setNString(2, author);
        ps.executeUpdate();
    }
}
```

선택지를 정리하면 다음과 같습니다.

| 방법 | 영향 범위 | 언제 쓰는가 |
|---|---|---|
| 해당 쓰기 경로만 `setNString()` | 그 쿼리만 | 다국어 입력이 들어오는 경로가 분명할 때 (가장 먼저) |
| 이 배치 전용 접속 URL을 `true`로 분리 | 그 배치만 | 한 배치 안에 쓰기 경로가 많을 때 |
| 전역 설정을 `true`로 변경 | 시스템 전체 | 회귀 테스트와 인덱스 영향 평가를 감당할 수 있을 때 (마지막 수단) |

### 전송을 고쳐도 남는 손실

목적지 컬럼 자체가 `VARCHAR`라면 이야기가 다릅니다. `VARCHAR`는 콜레이션의 코드 페이지에 묶여 있어서, 전송을 유니코드로 바꿔도 저장하는 순간 같은 치환이 일어납니다. 이 경우에는 DDL을 바꿔 컬럼 타입을 변경해야 합니다. 같은 데이터가 흘러가는 경로 중 `VARCHAR` 컬럼이 끼어 있는 곳이 없는지 함께 확인해야 합니다.

## 깨진 값 찾기와 복구

### `?`를 세는 것만으로는 규모를 알 수 없습니다

손실된 행을 찾으려고 `?`를 검색하면 두 방향으로 틀립니다.

- `LIKE N'%?%'`만 쓰면 원래 물음표가 있던 값(`Why Unity?` 같은 제목)이 섞입니다.
- 이를 피하려고 「영숫자 사이에 낀 `?`」 같은 패턴으로 좁히면, 한자 사이에 낀 `?`를 대량으로 놓칩니다.

확정하려면 **손실을 피해 간 사본과 대조**해야 합니다. 이번에는 같은 행의 URL이 그 사본이었습니다. 퍼센트 인코딩된 ASCII라서 CP949 변환을 무손실로 통과했기 때문입니다. 깨진 값의 `?`를 정규식의 캡처 그룹으로 바꿔 디코딩한 URL에서 찾으면, 손실 여부와 원래 글자를 한 번에 얻을 수 있습니다.

```python
import re
from urllib.parse import unquote

def recover_from_url(broken: str, url: str) -> str | None:
    """깨진 값의 '?' 자리를 URL 디코딩본에서 찾아 원문을 돌려줍니다."""
    decoded = unquote(url)
    pattern = re.escape(broken).replace(r"\?", "(.)")
    match = re.search(pattern, decoded)
    return match.group(0) if match else None

recover_from_url("教?心理", "https://example.org/search?q=%E6%95%99%E8%82%B2%E5%BF%83%E7%90%86")
# '教育心理'
```

다만 URL에 들어 있는 필드만 이 방법으로 되살아납니다. 나머지 필드는 원본 JSON에서 다시 적재해야 합니다. 일부만 복구된 행을 「복구 완료」로 처리해 원본 재적재 대상에서 빼면, 그 행은 영구히 깨진 채 남습니다.

### 복구 순서

순서가 중요합니다.

1. **코드 수정** — 새 손실부터 막습니다. 이걸 먼저 하지 않으면 복구하는 동안에도 계속 깨집니다.
2. **DB 값 복구** — 사본 대조 복구, 이어서 원본 재적재를 합니다.
3. **검색 색인 재색인** — 마지막에 합니다. DB 값이 깨진 상태에서 재색인하면 깨진 값을 다시 색인할 뿐입니다.

### 왕복 테스트로 닫기

수정 후에는 CP949 밖 문자를 실제로 넣고 다시 읽어서 같은지 확인합니다. 기본 다국어 평면(BMP) 밖의 문자도 하나 넣어 두면 서로게이트 쌍 처리까지 함께 검증할 수 있습니다.

```java
@Test
void unicodeRoundTrip() throws SQLException {
    List<String> samples = List.of("渡辺", "教育", "ñ — –", "𝛽"); // 마지막은 U+1D6FD
    for (String expected : samples) {
        long id = repository.insert(expected);
        assertEquals(expected, repository.findTitle(id));
    }
}
```

## 함정과 트레이드오프

- **「색인을 다시 하면 된다」는 착각** — 손실이 DB 값 자체에 있으면 재색인으로는 회복되지 않습니다.
- **손실 지점을 추정으로 남겨 두는 것** — 처음 추정대로 수집 단계를 고쳤다면 아무것도 해결되지 않았을 것입니다. 처방은 손실 지점에 따라 완전히 달라지므로, 추정은 추정이라고 표시하고 실증으로 닫아야 합니다.
- **전역 설정을 바로 바꾸고 싶은 유혹** — `sendStringParametersAsUnicode=false`에는 인덱스 성능이라는 이유가 있을 수 있습니다. 전역 변경은 손실보다 큰 성능 회귀를 부를 수 있으므로 국소 처방부터 시작합니다.

## 정리

- 오류 없이 문자가 사라질 때는 「보이는 곳」이 아니라 상류부터 각 단계의 실제 값을 확인해 손실 지점을 좁힙니다. 같은 행에서 손실을 피해 간 다른 컬럼은 가장 강한 증거가 됩니다.
- mssql-jdbc에서 `sendStringParametersAsUnicode=false`이면 `setString()` 값은 DB 코드 페이지로 인코딩되어 전송됩니다. 그 문자 집합 밖의 모든 문자는 컬럼 타입과 관계없이 `?`가 됩니다.
- 처방은 `setNString()` 같은 국소 수정이 먼저이고, `VARCHAR` 컬럼은 DDL 변경이 따로 필요합니다.
- 복구는 코드 수정, DB 값 복구, 재색인 순서로 진행하고, 왕복 테스트로 마무리합니다.
