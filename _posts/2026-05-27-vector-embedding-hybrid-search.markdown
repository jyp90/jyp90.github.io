---
layout: post
title: "고전 문헌 RAG 서비스를 만들며 배운 것 (2) 벡터 임베딩과 하이브리드 검색"
date: 2026-05-27 09:00:00 +0900
categories: blog
tags: [RAG, Elasticsearch, 임베딩, 벡터검색, Python, 배치]
excerpt: "한문 고전 문헌 질의응답 서비스의 검색 계층을 만들면서 정한 임베딩 서버 교체 구조, 무엇을 임베딩할지, Elasticsearch dense_vector 설정, BM25와 kNN을 합치는 방법, 질의 구조화와 임베딩 상태 운영, 그리고 의미 기반 캐시를 끄게 된 이유를 정리합니다."
---

> **시리즈: 고전 문헌 RAG 서비스를 만들며 배운 것**
>
> 1. [(1) LLM API 호출의 함정과 대응](/blog/2026/05/20/llm-api-backend-lessons.html)
> 2. **(2) 벡터 임베딩과 하이브리드 검색**
> 3. [(3) 한문 원문 채팅과 Prefect 배치 연동](/blog/2026/06/03/classical-chinese-rag-chat-prefect.html)

## 무엇을 다루나

한문 원문과 국역문이 짝을 이루는 고전 문헌을 대상으로 한 AI 질의응답 서비스에서, 사용자의 질문에 맞는 문서를 찾아 LLM에 넘기는 검색 계층을 만들었습니다. 구성은 단순합니다. 배치 프로젝트(Prefect)가 문서를 청크로 나눠 임베딩하고 Elasticsearch에 넣고, 채팅 API 서버(FastAPI)가 질문을 임베딩해 BM25(키워드 일치 기반 전문 검색 점수)와 kNN(벡터 최근접 이웃 검색)을 합친 하이브리드 검색으로 문서를 꺼냅니다.

RAG(Retrieval-Augmented Generation)에서 답변 품질의 상한은 검색 품질이 정합니다. 엉뚱한 문서를 꺼내 오면 아무리 좋은 LLM도 맞는 답을 쓰지 못합니다. 이 글은 그 검색 계층을 만들고 운영하면서 결정한 것을 순서대로 적습니다.

- 임베딩 모델 서빙을 교체 가능하게 만든 구조
- 문서의 어느 부분을 어떤 형태로 임베딩할지
- 청크 단위와 Elasticsearch `dense_vector` 인덱스 설정
- BM25와 kNN을 한 질의로 합치는 방법
- 질의 구조화, 분류 키워드 반영, 기사 단위 중복 제거
- 임베딩 상태 컬럼 분리와 실패 재처리, 임베딩 일관성 검증
- 의미 기반(semantic) 캐시의 위험

1편에서 다룬 LLM 호출 구조는 전제로 두고, 3편에서는 한문 원문 채팅과 배치 연동을 다룹니다.

## 임베딩 모델 서빙: 교체 가능하게

처음에는 사내 임베딩 서버 하나를 직접 호출했습니다. 요청과 응답 형식이 그 서버만의 것이었고, 호출 코드가 그 형식에 묶여 있었습니다. 모델을 BGE-M3로 바꾸는 검토를 하면서 문제가 드러났습니다. 새 모델은 Infinity 같은 서빙 도구로 OpenAI 호환 API(`POST /embeddings`)를 제공하는데, 기존 호출 코드로는 요청 본문과 응답 파싱을 모두 다시 써야 했습니다.

그래서 임베딩 호출을 「API 타입」으로 분기하는 구조로 바꿨습니다. 환경변수 하나로 어느 서버를 쓸지 고르고, 요청 조립과 응답 파싱을 타입별 함수로 분리합니다. 두 타입이 공통으로 지키는 것은 「입력 수와 벡터 수가 같다」와 「벡터 차원이 설정값과 같다」는 두 검증뿐입니다.

```python
import os
import httpx

API_TYPE = os.environ.get("EMBEDDING_API_TYPE", "openai")   # openai | legacy
DIMS = int(os.environ.get("EMBEDDING_DIMENSIONS", "1024"))

if API_TYPE not in {"openai", "legacy"}:
    # import 시점에 실패시켜야 잘못된 설정으로 배치가 한참 돌다 죽는 일을 막습니다
    raise ValueError(f"EMBEDDING_API_TYPE 값이 잘못되었습니다: {API_TYPE!r}")


def _request(texts: list[str]) -> tuple[str, dict]:
    if API_TYPE == "openai":
        return os.environ["EMBEDDING_URL"], {"model": os.environ["EMBEDDING_MODEL"], "input": texts}
    return os.environ["LEGACY_EMBEDDING_URL"], {"query": texts}


def _parse_openai(data: dict) -> list[list[float]]:
    items = sorted(data["data"], key=lambda x: x["index"])   # 순서를 믿지 않고 index로 정렬
    return [item["embedding"] for item in items]


def _parse_legacy(data) -> list[list[float]]:
    return data["vector"] if isinstance(data, dict) else data


def embed(texts: list[str]) -> list[list[float]]:
    url, payload = _request(texts)
    with httpx.Client(timeout=30.0) as client:
        data = client.post(url, json=payload).raise_for_status().json()
    vectors = _parse_openai(data) if API_TYPE == "openai" else _parse_legacy(data)
    if len(vectors) != len(texts):
        raise ValueError("응답 벡터 수가 입력 수와 다릅니다")
    for vec in vectors:
        if len(vec) != DIMS:
            raise ValueError(f"차원 불일치: {len(vec)} != {DIMS}")
    return vectors
```

세 가지가 중요했습니다.

- **설정 검증은 import 시점에 합니다.** 배치는 수천 건을 처리한 뒤에야 임베딩 단계에 닿습니다. 잘못된 타입 문자열로 거기까지 가서 죽으면 그 앞의 시간이 버려집니다.
- **OpenAI 호환 응답은 `index`로 정렬합니다.** 응답 배열이 입력 순서와 같다는 보장은 계약이 아니라 관례입니다. 순서가 어긋나면 벡터가 엉뚱한 청크에 붙고, 검색은 조용히 틀어집니다.
- **활성 타입과 URL을 실행 로그 첫 줄에 남깁니다.** 「어느 모델로 임베딩했는가」는 나중에 검색 품질 문제를 추적할 때 가장 먼저 확인하는 값입니다.

OpenAI 호환 형식을 기본값으로 둔 이유는, 이 형식이 사실상 표준이라 Infinity, TEI(Text Embeddings Inference), vLLM 등 어느 서빙 도구로 바꿔도 호출 코드를 건드리지 않아도 되기 때문입니다.

## 무엇을 임베딩할 것인가

임베딩 모델보다 검색 품질에 더 크게 영향을 준 것은 「모델에 어떤 텍스트를 넣는가」였습니다. 세 번 바꿨습니다.

### 본문만 임베딩합니다

국역문은 앞단 배치에서 LLM이 생성합니다. 이때 LLM이 서론과 결론을 덧붙인 구조(`{"intro": …, "body": …, "conclusion": …}`)로 결과를 내놓도록 되어 있었는데, 이 전체를 그대로 청크로 나눠 임베딩하고 있었습니다. 서론과 결론은 LLM이 지어낸 요약이지 문서의 내용이 아닙니다. 「이 기록은 당시의 …을 보여 줍니다」 같은 문장이 모든 문서에 비슷하게 들어가면, 벡터가 서로 가까워져 변별력이 떨어집니다.

그래서 청크로 나누기 전에 본론만 꺼내도록 했습니다. 평문으로 저장된 옛 데이터는 그대로 통과시켜 하위 호환을 지킵니다.

```python
import json


def extract_body(text: str) -> str:
    stripped = (text or "").strip()
    if stripped.startswith("{"):
        try:
            parsed = json.loads(stripped)
            return (parsed.get("body") or "").strip() or stripped
        except json.JSONDecodeError:
            pass
    return stripped
```

### 구조화된 임베딩 텍스트, 본문은 마지막에

초기 배치는 임베딩 텍스트를 이모지와 구분선이 섞인 메타데이터 블록으로 만들었습니다. 출처, 간지, 연호, 판본 같은 서지 정보가 앞에 길게 붙고 본문은 뒤로 밀렸습니다. 벡터 공간에서 이모지와 서지 정보는 의미 없는 잡음이고, 사용자 질문은 자연어라 문서 벡터와 구조가 달라 코사인 거리가 벌어집니다.

바꾼 형식은 한글 레이블만 쓰는 몇 줄짜리 구조체입니다. 검색에 쓸 필드만 넣고, 본문을 항상 마지막 줄에 둡니다.

```python
def build_embedding_text(*, title: str, volume: str, keywords: list[str],
                         commentary: str | None, body: str) -> str:
    parts = [f"제목: {title}", f"묶음: {volume}"]
    if keywords:
        parts.append("키워드: " + " ".join(keywords))
    if commentary:
        parts.append(f"해설: {commentary[:300]}")
    parts.append(f"본문: {body}")          # 항상 마지막
    return "\n".join(parts)
```

본문을 마지막에 두는 것은 뒤에서 다룰 질의 구조화와 짝을 이룹니다. 이 텍스트를 만드는 함수는 서버 한 곳에만 두고, 배치는 원시 필드만 보내 서버가 조립하게 했습니다. 배치와 서버가 각자 조립하면 형식이 어긋나는 순간이 반드시 옵니다.

### 짧은 원문은 해설로 보강

고전 기록은 단문 사건 기록이 많습니다. 본문이 수십 자에 그치는 청크는 벡터에 담긴 의미가 빈약합니다. 특히 「권력 견제」처럼 후대 연구자가 쓰는 분석 용어는 원문에 등장하지 않으므로, 그런 용어로 질문하면 kNN이 관련 문서를 놓쳤습니다.

문서마다 LLM으로 미리 생성해 둔 해설이 있었으므로, 그 앞부분을 잘라 임베딩 텍스트에 넣었습니다(`해설: {commentary[:300]}`). 해설 전체를 넣지 않고 앞부분만 쓰는 것은, 해설이 본문보다 길어지면 벡터가 해설 쪽으로 쏠리기 때문입니다. 같은 해설을 BM25 필드로도 색인해 낮은 가중치를 줬습니다.

결과는 질문 유형에 따라 갈렸습니다. 분석 용어를 쓴 질문에서는 상위 결과가 전부 바뀌었고, 원문에 고유명사가 직접 등장하는 질문은 변화가 없었습니다. 이미 잘 맞던 질문은 그대로이고 못 맞추던 질문이 맞게 된 것이므로 의도한 효과입니다. 평균 임베딩 텍스트 길이가 눈에 띄게 늘었고, 짧아서 사실상 비어 있던 구간이 사라졌습니다.

다만 kNN 쪽은 변경 전 점수 스냅샷을 남기지 않아 정량 비교를 하지 못했습니다. 임베딩 텍스트를 바꾸기 전에는 고정된 질문 묶음으로 상위 결과와 점수를 파일로 떠 두어야 합니다. 바꾼 뒤에는 「전」을 다시 만들 수 없습니다.

## 청크 단위 설계

청크는 문자 단위 슬라이딩 윈도우로 나눕니다. 크기 1000자, 겹침 150자입니다. 문장 경계를 따지는 분할기도 검토했지만, 국역문은 문장 길이 편차가 크고 한자 병기가 섞여 있어 단순한 쪽을 택했습니다.

```python
def chunk_text(text: str, size: int = 1000, overlap: int = 150) -> list[str]:
    base = (text or "").strip() or " "
    step = max(1, size - overlap)
    out: list[str] = []
    for i in range(0, len(base), step):
        out.append(base[i:i + size].strip() or " ")
        if i + size >= len(base):
            break
    return out
```

청크 문서에는 벡터 말고도 운영에 필요한 필드를 같이 넣습니다.

| 필드 | 용도 |
|---|---|
| `article_id`, `chunk_no` | 청크 ID는 `{article_id}#{chunk_no}`. 기사 단위로 다시 묶을 때 씁니다. |
| `content_hash` | 임베딩 텍스트의 SHA-256. 재색인 때 같은 해시면 임베딩 호출을 건너뜁니다. |
| `embedding_text` | 실제로 임베딩한 텍스트. `index: false`로 저장만 하고, 품질 문제를 추적할 때 꺼내 봅니다. |
| `embedding_model` | 어느 모델로 만든 벡터인지. 모델을 바꾸면 이 값으로 섞임을 찾습니다. |

`content_hash`는 재색인 비용을 줄이는 장치이면서 재처리를 멱등하게 만드는 장치입니다. 뒤에서 다룰 실패 재처리에서 이미 성공한 청크가 섞여 들어가도 임베딩을 다시 호출하지 않습니다. 반대로 개발 단계에서는 이 스킵이 「바꿨는데 반영이 안 된다」는 혼란을 만들므로, 기본값을 끄고 운영에서만 켭니다.

## Elasticsearch dense_vector 인덱스 설정

### 설정 블록

`dense_vector` 필드는 두 저장소(배치, 서버)에서 아래 블록을 그대로 씁니다. 필드 이름은 저장소 관례를 따르되, 설정값은 하나로 맞춥니다.

```json
{
  "type": "dense_vector",
  "dims": 1024,
  "index": true,
  "similarity": "cosine",
  "index_options": {
    "type": "bbq_hnsw",
    "m": 16,
    "ef_construction": 100,
    "rescore_vector": { "oversample": 3 }
  }
}
```

| 항목 | 값 | 이유 |
|---|---|---|
| `dims` | 1024 | BGE-M3 계열 출력 차원입니다. 모델을 바꾸지 않는 한 고정입니다. |
| `similarity` | `cosine` | `dot_product`는 단위 정규화된 벡터를 전제합니다. 정규화된 벡터라면 두 방식의 순위가 같지만, 정규화를 빼먹은 벡터가 섞여도 안전한 `cosine`을 정본으로 뒀습니다. |
| `index_options.type` | `bbq_hnsw` | BBQ(Better Binary Quantization)는 차원당 1비트로 양자화합니다. 1024차원 벡터 하나가 약 128바이트로, `int8_hnsw`(약 1KB)보다 HNSW(근사 최근접 탐색용 그래프 인덱스)의 메모리 상주분이 크게 줄어듭니다. |
| `rescore_vector.oversample` | 3 | BBQ 근사 점수만으로 순위를 정하면 리콜이 떨어집니다. 후보를 3배로 뽑아 원본 벡터로 다시 채점하도록 인덱스 기본값에 고정합니다. 질의의 `knn` 절에 `rescore_vector`를 명시하면 그 값이 우선합니다. |
| `m`, `ef_construction` | 16, 100 | HNSW 그래프의 이웃 수와 색인 시 탐색 폭입니다. 리콜을 위해 `ef_construction`을 올렸던 이력이 있지만, 리콜 실측이 뒤따르지 않은 값이라 두 저장소를 기본값 근처로 통일했습니다. 실측 결과가 나오면 두 저장소를 함께 바꿉니다. |

`bbq_hnsw`는 Elasticsearch 8.16 이상, 인덱스 수준 `rescore_vector`는 8.18 이상에서만 받습니다. 버전이 낮으면 매핑이 거부되어 인덱스 생성 자체가 실패하므로, 새 인덱스를 만들기 전에 `GET /`로 클러스터 버전을 확인합니다.

처음에는 `int8_hnsw`로 시작했습니다. 디스크의 벡터 저장 공간보다 HNSW 그래프가 메모리에 상주하는 양이 부담이었고, 청크 인덱스가 커질수록 그 부담이 같이 커지므로 BBQ로 옮겼습니다.

### 생성 시점에만 적용되는 값과 블루그린 전환

`index_options`는 인덱스를 만들 때만 적용됩니다. 매핑 코드를 고쳐도 이미 있는 인덱스는 바뀌지 않습니다. 운영 인덱스에 반영하려면 새 인덱스를 만들어 재색인한 뒤 alias를 바꿔야 합니다.

```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "chunks_v1", "alias": "chunks" } },
    { "add":    { "index": "chunks_v2", "alias": "chunks" } }
  ]
}
```

검색 코드는 물리 인덱스 이름이 아니라 alias만 봅니다. 두 동작이 한 요청에서 원자적으로 바뀌므로 전환 중에 빈 결과가 나가는 순간이 없습니다.

이 규칙 때문에 문서도 둘로 나눠 적어야 합니다. 「생성 시점 매핑」을 서술하는 설계 문서와 「지금 운영 중인 인덱스」를 서술하는 현황 표는 다른 값을 가질 수 있습니다. 둘을 한 문서에 섞으면 어느 쪽이 사실인지 알 수 없게 됩니다.

### nori 분석기 함정

BM25 쪽 한국어 분석기는 nori를 씁니다. 품사 필터의 `stoptags`에 상위 범주 태그(`J`, `E`)를 적으면 인덱스를 만드는 단계에서 오류가 납니다. Lucene의 nori는 세부 품사 태그만 받으므로 조사는 `JKS`, `JKC`, `JKG`, `JKO`, `JKB`, `JKV`, `JKQ`, `JX`, `JC`로 풀어 적어야 합니다.

```json
"analysis": {
  "tokenizer": {
    "nori_ko": { "type": "nori_tokenizer", "decompound_mode": "mixed" }
  },
  "filter": {
    "ko_pos": {
      "type": "nori_part_of_speech",
      "stoptags": ["IC", "JKS", "JKC", "JKG", "JKO", "JKB", "JKV", "JKQ", "JX", "JC",
                   "SP", "SSC", "SSO", "SC", "SE", "XPN", "XSA", "XSN", "XSV",
                   "UNA", "NA", "VSV"]
    }
  },
  "analyzer": {
    "ko_nori": {
      "type": "custom",
      "tokenizer": "nori_ko",
      "filter": ["nori_readingform", "ko_pos", "lowercase"]
    }
  }
}
```

`nori_readingform`은 한자를 한글 독음으로 바꿉니다. 한자 병기가 많은 국역문에서 「天文」과 「천문」을 같은 토큰으로 맞추는 데 필요합니다. 그리고 새 인덱스를 만들 때 분석기 정의는 새로 쓰지 않고 기존 인덱스의 `_settings`에서 꺼내 그대로 복사합니다. 분석기가 조금이라도 다르면 두 인덱스의 BM25 점수가 서로 비교 불가능해집니다.

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

- 임베딩 호출은 API 타입으로 분기하고 OpenAI 호환 형식을 기본으로 둡니다. 입력 수와 차원은 항상 검증하고, 응답은 `index`로 정렬합니다.
- 임베딩할 텍스트는 본문만, 구조화된 몇 줄로, 본문을 마지막에 둡니다. 짧은 원문은 해설 앞부분으로 보강합니다. 바꾸기 전에 기준선 점수를 파일로 남깁니다.
- `dense_vector`는 `cosine`, `bbq_hnsw`, `rescore_vector`로 고정하고 두 저장소가 같은 블록을 씁니다. `index_options`는 생성 시점에만 적용되므로 변경은 새 인덱스와 alias 전환으로 합니다.
- BM25와 kNN은 한 요청에 넣어 점수를 합칩니다. 필터는 양쪽에, `k`는 중복 제거를 감안해 넉넉히, 합본 필드는 낮은 가중치로 둡니다.
- 질문에는 문서와 같은 접두어를 붙이고, 분류 단계의 키워드를 부스트로 넘기며, 청크를 기사 단위로 합칠 때 점수를 같이 넘깁니다.
- 임베딩 상태는 파이프라인 상태와 다른 컬럼에 둡니다. Enum은 `.value`로 저장하고, 상태 컬럼에는 제약을 겁니다. 재처리는 `content_hash` 덕분에 멱등합니다.
- 모델과 접두어 규칙은 서버가 답하게 하고, 인덱스에 `embedding_model`을 남깁니다.
- 의미 기반 캐시는 비슷한 질문에 같은 답을 줘도 되는 서비스에서만 켭니다.

3편에서는 한문 원문을 그대로 다루는 채팅 경로와 Prefect 배치가 채팅 서버와 주고받는 방식을 다룹니다.
