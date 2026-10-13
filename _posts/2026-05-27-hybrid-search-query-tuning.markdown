---
layout: post
title: "고전 문헌 RAG 서비스를 만들며 배운 것 (4) 하이브리드 검색과 질의 튜닝"
date: 2026-05-27 12:00:00 +0900
categories: blog
tags: [Python, Elasticsearch, LLM, Performance, Batch]
excerpt: "고전 문헌 RAG에서 BM25와 kNN을 합치는 하이브리드 검색, 질의 구조화와 키워드 반영, 임베딩 재처리와 의미 기반 캐시를 켜지 않은 이유를 정리합니다."
series: "고전 문헌 RAG 서비스를 만들며 배운 것"
summary:
  - "BM25와 kNN을 한 요청에 합치고 필터는 양쪽에, k는 중복 제거를 감안해 넉넉히 뒀습니다."
  - "질문에 문서와 같은 접두어를 붙이고 분류 키워드를 부스트로 반영해 검색 정확도를 높였습니다."
  - "의미 기반 캐시는 비슷한 질문에 다른 답을 줘야 하는 위험이 있어 운영에서는 끄고 정확 일치만 썼습니다."
---

3편에서는 임베딩 모델 서빙 구조, 임베딩할 텍스트 설계, Elasticsearch `dense_vector` 인덱스 설정을 다뤘습니다. 색인이 끝난 뒤에도 품질 문제는 질의 쪽에서 더 많이 나왔습니다. 이 글은 BM25와 kNN을 합치는 하이브리드 검색, 질의 단계 튜닝, 운영 중 임베딩 상태 관리, 그리고 의미 기반 캐시를 검토하고 켜지 않은 이유를 다룹니다.

## BM25 + kNN 하이브리드 검색

kNN만으로는 부족했습니다. 임베딩은 의미가 비슷한 문서를 잘 찾지만, 고유명사나 한자 키워드처럼 정확히 그 문자열이 있어야 하는 질문에는 BM25가 낫습니다. 반대로 BM25는 「권력 견제」 같은 분석 용어를 원문에서 찾지 못합니다. 그래서 둘을 한 요청으로 보냅니다.

```python
def build_hybrid_body(query: str, query_vector: list[float], *, size: int = 12,
                      filters: list | None = None, excluded: list | None = None,
                      boost_terms: list[str] | None = None) -> dict:
    k = size + 20
    should = [
        {"multi_match": {
            "query": query, "type": "best_fields",
            "fields": ["title^4", "volume.text^3", "keywords.text^3",
                       "chunk_text^2", "commentary^1.5", "all_text"],
        }},
        {"match_phrase_prefix": {"title": {"query": query, "boost": 2}}},
    ]
    for term in (boost_terms or [])[:8]:
        should.append({"multi_match": {
            "query": term, "type": "best_fields", "boost": 2.0,
            "fields": ["keywords.text^3", "chunk_text^2", "title^2"],
        }})
    scope = {"filter": filters or [], "must_not": excluded or []}
    return {
        "query": {"bool": {"should": should, **scope}},
        "knn": {
            "field": "embedding",
            "query_vector": query_vector,
            "k": k,
            "num_candidates": max(150, k * 4),
            "filter": {"bool": scope},
        },
        "_source": ["article_id", "chunk_no", "title", "chunk_text"],
        "size": size,
    }
```

- **`query`와 `knn`을 같은 본문에 넣으면** Elasticsearch가 두 점수를 더해 순위를 매깁니다. RRF(reciprocal rank fusion)로 순위를 합치는 `rank` 절이 더 안정적이지만, 쓰던 버전의 Basic 라이선스에서는 쓸 수 없었습니다. 점수 합산으로 동작하도록 `rank` 절을 뺐습니다. 점수 합산은 BM25 점수 범위가 kNN 점수(0~1)보다 커서 BM25가 지배하기 쉬우므로, 필드 가중치를 낮게 잡고 kNN 후보 수를 넉넉히 둡니다.
- **`k`는 요청 크기보다 크게 잡습니다.** 뒤에서 기사 단위로 중복을 제거하면 청크 여러 개가 한 기사로 합쳐져 결과가 줄어들기 때문입니다. `num_candidates`는 `k`의 몇 배로 두고, 필터가 있을 때는 더 올립니다. 필터가 걸리면 HNSW 탐색에서 걸러지는 후보가 많아져 같은 `num_candidates`로는 `k`개를 채우지 못할 수 있습니다.
- **필터는 `query`와 `knn` 양쪽에 같이 넣습니다.** `knn.filter`는 벡터 탐색 단계에서 적용되는 사전 필터이고, `query.bool.filter`는 BM25 쪽입니다. 한쪽에만 넣으면 다른 쪽에서 제외 대상이 올라옵니다.
- **서비스 범위 밖 문서는 `must_not`으로 질의 단계에서 뺍니다.** 특정 묶음이나 특정 문서를 채팅에서 제외해야 할 때 재색인 없이 처리할 수 있습니다. 목록이 길어지면 색인 시 플래그 필드로 옮깁니다.
- **`copy_to`로 모은 `all_text` 필드는 가중치 1로 둡니다.** 초기 버전은 개별 필드와 합본 필드에 모두 높은 가중치를 줘서 같은 토큰이 두 번 점수를 받았습니다. 합본 필드는 「어디든 있으면 조금 더」 정도의 역할만 맡깁니다.

질문에 문서 묶음 이름이 들어 있으면 그 묶음으로 필터하고 `term` 부스트를 함께 줍니다. 묶음 이름은 이름과 코드를 짝지은 사전으로 질문에서 감지하며, 감지되지 않으면 필터 없이 전체를 봅니다. 이 규칙은 질문이 범위를 명시했을 때 다른 묶음의 비슷한 기록이 끼어드는 것을 막는 데 효과가 컸습니다.

## 질의 쪽에서 품질 올리기

인덱스를 다 만든 뒤에도 품질 문제는 질의 쪽에서 더 많이 나왔습니다.

### 질의 구조화

문서 벡터는 「제목: … / 묶음: … / 본문: …」 구조의 텍스트에서 나왔는데, 질문 벡터는 질문 문장을 그대로 넣어 만들고 있었습니다. 같은 모델이지만 입력 형태가 달라 코사인 유사도가 체계적으로 낮게 나왔습니다. 고친 것은 한 줄입니다.

```python
structured_query = f"본문: {query}"
query_vector = await embedding.embed_query(structured_query)
```

문서 텍스트의 마지막 줄이 `본문:`으로 시작하므로, 질문에도 같은 접두어를 붙여 문서의 본문 필드와 같은 공간에서 비교되게 합니다. 임베딩 텍스트를 만들 때 본문을 마지막에 둔 이유가 이것입니다.

이 변경은 단위 테스트로 「임베딩 호출 인자가 `본문: `으로 시작한다」와 「원문 질문이 보존된다」를 고정해 두고, 서버에서는 고정 질문 묶음으로 상위 결과를 눈으로 비교했습니다. 정량 전후 비교는 남기지 못했으며, 효과는 직접 관찰한 결과입니다.

### 분류 단계 키워드를 검색에 반영

채팅 서버는 질문을 받으면 먼저 LLM으로 의도를 분류합니다. 이 분류기는 질문에서 확장 키워드도 같이 뽑아냅니다. 예를 들어 어떤 인물에 대한 단독 질문이면 그 인물이 속한 기관이나 관련된 저작 같은 연관어가 나옵니다. 그런데 이 키워드는 답변 생성에만 쓰이고 검색에는 반영되지 않고 있었습니다. 인물 이름만으로 검색하면 같은 이름이 등장하는 다른 시대의 기록이 올라왔습니다.

분류 결과의 키워드를 `boost_terms`로 검색에 넘겨 `should` 절에 추가했습니다. 키워드마다 `multi_match`를 하나씩 만들고 부스트 2.0을 주며, 최대 8개까지만 씁니다. 분류기가 키워드를 너무 많이 뽑으면 질문의 초점이 흐려지기 때문입니다.

트레이드오프가 하나 있습니다. 원래 의도 분류와 검색은 `asyncio.gather`로 병렬 실행하고 있었는데, 분류 결과를 검색에 쓰려면 순차 실행으로 바꿔야 합니다. 응답 시간이 분류 LLM 호출 시간만큼 늘어납니다. 품질과 지연을 맞바꾼 것이고, 엉뚱한 시대의 기록을 가져오는 문제가 더 심각했으므로 순차 실행을 택했습니다.

### 기사 단위 중복 제거와 점수 전파

검색 단위는 청크지만 LLM에 넘기고 사용자에게 보여 주는 단위는 기사입니다. 한 기사에서 청크 여러 개가 상위에 오면 같은 기사가 여러 번 들어가므로 기사 단위로 합칩니다. 검색 결과가 점수 내림차순이므로, 기사별로 처음 만나는 청크가 그 기사의 최고 점수 청크입니다.

```python
def dedupe_by_article(hits: list[dict], limit: int) -> list[Reference]:
    seen: set[str] = set()
    out: list[Reference] = []
    for hit in hits:                               # 점수 내림차순을 전제합니다
        article_id = hit["article_id"]
        if article_id in seen:
            continue
        seen.add(article_id)
        out.append(Reference(
            article_id=article_id,
            title=hit["title"],
            snippet=hit["chunk_text"],
            score=float(hit.get("score") or 0.0),  # 청크 점수를 기사로 전파
        ))
        if len(out) >= limit:
            break
    return out
```

`score`를 넘기는 한 줄은 뒤늦게 추가한 것입니다. 청크 검색 결과에는 점수가 있었지만 기사 객체로 바꿀 때 빠뜨려서, 응답의 참고 문헌 점수가 항상 0.0으로 나가고 있었습니다. 기능에는 영향이 없어 아무도 알아채지 못했고, 검색 품질을 점검하려고 점수를 보기 시작했을 때 드러났습니다. 점수는 디버깅 도구입니다. 응답에 실어 두면 「왜 이 문서가 나왔는가」를 운영 중에 물을 수 있습니다.

## 운영: 임베딩 상태와 재처리

### 상태 컬럼 분리

배치 프로젝트는 문서 한 건의 처리 단계를 PostgreSQL의 `status` 컬럼 하나로 관리했습니다. 파싱, 번역, 요약, 해설 생성까지의 파이프라인 단계가 이 컬럼의 값이었는데, 임베딩 단계가 추가되면서 `EMBEDDING`, `EMBEDDING_COMPLETED`, `EMBEDDING_FAILED`도 같은 컬럼에 들어갔습니다.

이렇게 되면 임베딩이 끝난 문서는 파이프라인 단계가 어디까지 갔는지 `status`만 봐서는 알 수 없습니다. 임베딩 실패 문서를 재처리하려면 `status IN (…)`을 따로 조회해야 하고, 재처리 로직이 늘수록 조건이 복잡해집니다. 파이프라인 상태와 임베딩 상태는 서로 독립적으로 바뀌는 값이므로 컬럼을 분리했습니다.

```sql
ALTER TABLE articles ADD COLUMN embedding_status VARCHAR(50) DEFAULT NULL;
-- NULL = 임베딩 미처리, 이후 EMBEDDING / COMPLETED / FAILED
```

배포 순서가 중요합니다. 컬럼 추가 → 새 컬럼을 쓰는 코드 배포 → 기존 데이터 이관의 순서를 지켜야 합니다. 코드가 먼저 나가면 없는 컬럼을 갱신하다 실패하고, 데이터 이관이 먼저 되면 옛 코드가 `status`를 다시 임베딩 상태로 덮어씁니다. 이관은 한 트랜잭션에서 두 단계로 합니다.

```sql
BEGIN;
UPDATE articles
   SET embedding_status = CASE status
         WHEN 'EMBEDDING_COMPLETED' THEN 'COMPLETED'
         WHEN 'EMBEDDING_FAILED'    THEN 'FAILED'
         WHEN 'EMBEDDING'           THEN 'EMBEDDING'
       END
 WHERE status IN ('EMBEDDING_COMPLETED', 'EMBEDDING_FAILED', 'EMBEDDING');

UPDATE articles
   SET status = 'PIPELINE_DONE'          -- 임베딩 직전 단계의 이름으로 되돌립니다
 WHERE status IN ('EMBEDDING_COMPLETED', 'EMBEDDING_FAILED', 'EMBEDDING');
COMMIT;
```

이관 중에 임베딩 배치가 돌면 `status`를 되돌린 문서를 다시 임베딩 중으로 바꿀 수 있으므로, 이관 전에 배치를 멈추고 `EMBEDDING` 상태인 문서가 없는지 확인합니다.

### Enum을 문자열로 바꾸다 생긴 사고

새 컬럼을 갱신하는 코드에서 Enum 값을 `str()`로 바꿔 넘겼습니다.

```python
from enum import Enum


class EmbeddingStatus(str, Enum):
    EMBEDDING = "EMBEDDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


cursor.execute(sql, (str(status), ids))      # 'EmbeddingStatus.FAILED' 가 저장됩니다
cursor.execute(sql, (status.value, ids))     # 'FAILED'
```

`str` 믹스인을 섞은 Enum이라도 `str()`은 `EmbeddingStatus.FAILED`처럼 클래스 이름이 붙은 문자열을 돌려줍니다. `VARCHAR` 컬럼은 어떤 문자열이든 받으므로 DB는 거부하지 않았고, 상당수 문서가 `EmbeddingStatus.FAILED`라는 값으로 기록됐습니다. 그중 일부는 실제로는 임베딩에 성공한 문서였습니다. `.value`를 쓰거나 Python 3.11 이상이면 `StrEnum`을 쓰면 됩니다. 상태 컬럼에 `CHECK` 제약이나 PostgreSQL enum 타입을 걸어 두었다면 첫 갱신에서 바로 실패했을 것입니다.

### 실패 재처리

실패 문서를 다시 임베딩하는 스크립트는 세 모드를 둡니다.

| 옵션 | 동작 |
|---|---|
| `--dry-run` | 상태 분포와 재처리 대상 수만 출력합니다. 항상 이것부터 실행합니다. |
| `--normalize-only` | 잘못 기록된 `EmbeddingStatus.*` 문자열만 올바른 값으로 고치고 재임베딩하지 않습니다. |
| (기본) | `FAILED` 문서를 일정 크기로 묶어 대기 상태의 임베딩 잡을 만듭니다. `--run-flow`를 붙이면 바로 실행합니다. |

재처리 대상에 실제로는 성공한 문서가 섞여 있어도 안전합니다. 청크의 `content_hash`가 같으면 임베딩 호출과 색인을 건너뛰기 때문입니다. 재처리 스크립트가 멱등하려면 재처리되는 단계 자체가 멱등해야 합니다.

## 임베딩 일관성 검증

문서 벡터는 배치가, 질문 벡터는 채팅 서버가 만듭니다. 두 쪽이 다른 모델을 쓰거나 다른 접두어 규칙을 쓰면 검색은 에러 없이 조용히 나빠집니다. 임베딩 모델을 바꾸는 작업이 예정되어 있었으므로, 이 조건을 사람이 기억하는 대신 서버가 답하게 했습니다.

```json
GET /v1/embed/consistency
{
  "embeddingModel": "bge-m3",
  "embeddingDimensions": 1024,
  "documentStructure": "제목: {title}\n묶음: {volume}\n키워드: {keywords}\n[해설: {commentary[:300]}]\n본문: {chunk_text}",
  "queryPrefix": "본문: {query}",
  "consistent": true
}
```

이 엔드포인트는 서버 설정과 코드 상수를 읽어 돌려줄 뿐 실제 벡터를 비교하지는 않습니다. 그래도 「지금 서버가 쓰는 모델과 접두어」를 한 번의 호출로 확인할 수 있고, 배치 쪽 로그 첫 줄의 모델 이름과 맞춰 보면 됩니다. 청크 문서의 `embedding_model` 필드까지 조회하면 인덱스 안에 다른 모델의 벡터가 섞여 있는지도 알 수 있습니다. 모델을 바꿀 때는 새 인덱스를 만들어 전체를 다시 임베딩하고 alias를 전환해야 하며, 한 인덱스 안에서 벡터 일부만 바꾸는 일은 없어야 합니다.

## 의미 기반 캐시의 위험

같은 질문이 반복되면 LLM 호출을 생략하고 싶어집니다. 의미 기반 캐시는 질문을 임베딩해 Elasticsearch에 저장해 두고, 새 질문의 벡터와 코사인 유사도가 임계값(0.92) 이상인 질문이 있으면 그때의 응답을 그대로 돌려주는 구조입니다. 캐시 적중이면 응답이 수백 밀리초에 끝나고 LLM 비용이 들지 않습니다.

```python
cosine = 2.0 * knn_score - 1.0        # cosine 유사도일 때 ES kNN _score = (1 + cosine) / 2
if cosine < 0.92:
    return None                        # miss
```

만들어서 개발 환경에 붙여 봤고, 결국 운영에서는 켜지 않았습니다. 이유는 다음과 같습니다. 첫 번째는 실측으로 확인한 것이 아니라 이 서비스의 질문 유형을 보고 내린 판단이고, 나머지 둘은 개발 환경에서 실제로 겪은 것입니다.

- **표현이 비슷한 것과 같은 질문인 것은 다릅니다.** 이 서비스의 질문은 「A가 B한 이유」처럼 인물이나 시기만 바뀌면 전혀 다른 답이 나와야 하는 형태가 많습니다. 그런 두 질문은 문장 구조가 거의 같아 벡터가 가깝습니다. 임계값을 올리면 적중이 사라지고, 내리면 다른 질문에 남의 답을 줍니다. 안전한 구간이 좁습니다.
- **응답 전체를 저장하므로 응답 스키마에 묶입니다.** 캐시에는 답변 본문뿐 아니라 참고 문헌, 키워드, 보조 답변까지 통째로 들어갑니다. 응답 모델에 필수 필드가 하나 추가되자 예전에 저장된 캐시를 재생할 때 검증 오류가 났습니다. 캐시 무효화 수단이 인덱스 이름을 바꾸는 것뿐이라, 스키마가 바뀔 때마다 캐시를 통째로 버려야 합니다.
- **적중 경로가 정상 경로의 부수 효과를 흉내 내야 합니다.** 정상 경로는 채팅방을 만들고 메시지를 저장하고 사용량을 집계합니다. 캐시 적중 때도 이걸 다 해야 하므로 「LLM만 건너뛰는」 단순한 분기가 아니라 두 번째 응답 경로가 생깁니다. 유지해야 할 코드가 두 배가 됩니다.

적중률이 높고 질문이 사실상 동일한 서비스(추천 질문, 자주 묻는 질문)라면 임베딩 대신 정규화한 질문 문자열의 해시를 키로 쓰는 정확 일치 캐시가 낫습니다. 실제로 추천 질문 경로는 그렇게 캐시했고 효과가 컸습니다. 의미 기반 캐시는 「비슷한 질문에 같은 답을 줘도 되는가」에 서비스가 예라고 답할 수 있을 때만 켜야 합니다.

## 정리

- BM25와 kNN은 한 요청에 넣어 점수를 합칩니다. 필터는 양쪽에, k는 중복 제거를 감안해 넉넉히, 합본 필드는 낮은 가중치로 둡니다.
- 질문에는 문서와 같은 접두어를 붙이고, 분류 단계의 키워드를 부스트로 넘기며, 청크를 기사 단위로 합칠 때 점수를 같이 넘깁니다.
- 임베딩 상태는 파이프라인 상태와 다른 컬럼에 둡니다. Enum은 `.value`로 저장하고, 상태 컬럼에는 제약을 겁니다. 재처리는 `content_hash` 덕분에 멱등합니다.
- 모델과 접두어 규칙은 서버가 답하게 하고, 인덱스에 `embedding_model`을 남깁니다.
- 의미 기반 캐시는 비슷한 질문에 같은 답을 줘도 되는 서비스에서만 켭니다.

## 다음 편 예고

5편에서는 채팅 API에서 수십 초가 걸리는 LLM 요청 중 클라이언트가 이탈했을 때 무엇을 남길지, 대명사 섞인 후속 질문을 어떻게 풀지, 서문·부록 같은 비본문 문서를 어떻게 걸러내는지를 다룹니다.
