---
layout: post
title: "고전 문헌 RAG 서비스를 만들며 배운 것 (3) 임베딩 설계와 인덱스 구성"
date: 2026-05-27 09:00:00 +0900
categories: blog
tags: [Python, Elasticsearch, LLM, Architecture]
excerpt: "고전 문헌 RAG의 검색 계층에서 임베딩 모델 서빙을 교체 가능하게 만들고, 무엇을 임베딩할지와 Elasticsearch dense_vector 인덱스 설정을 정리합니다."
series: "고전 문헌 RAG 서비스를 만들며 배운 것"
summary:
  - "임베딩 호출을 API 타입으로 분기해 임베딩 서버 교체에도 흔들리지 않게 했습니다."
  - "임베딩 텍스트는 본문을 마지막에 둔 구조로 만들고 짧은 원문은 해설로 보강했습니다."
  - "dense_vector는 cosine·bbq_hnsw로 고정하고 두 저장소가 같은 설정 블록을 썼습니다."
---

## 무엇을 다루나

한문 원문과 국역문이 짝을 이루는 고전 문헌을 대상으로 한 AI 질의응답 서비스에서, 사용자의 질문에 맞는 문서를 찾아 LLM에 넘기는 검색 계층을 만들었습니다. 구성은 단순합니다. 배치 프로젝트(Prefect)가 문서를 청크로 나눠 임베딩하고 Elasticsearch에 넣고, 채팅 API 서버(FastAPI)가 질문을 임베딩해 BM25(키워드 일치 기반 전문 검색 점수)와 kNN(벡터 최근접 이웃 검색)을 합친 하이브리드 검색으로 문서를 꺼냅니다.

RAG(Retrieval-Augmented Generation)에서 답변 품질의 상한은 검색 품질이 정합니다. 엉뚱한 문서를 꺼내 오면 아무리 좋은 LLM도 맞는 답을 쓰지 못합니다. 이 글은 그 검색 계층 중 문서를 색인에 넣는 쪽, 즉 임베딩 설계와 인덱스 구성을 순서대로 적습니다. 질의 단계의 하이브리드 검색과 튜닝은 4편에서 이어집니다.

- 임베딩 모델 서빙을 교체 가능하게 만든 구조
- 문서의 어느 부분을 어떤 형태로 임베딩할지
- 청크 단위와 Elasticsearch `dense_vector` 인덱스 설정

1·2편에서 다룬 LLM 호출 구조는 전제로 둡니다.

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

본문을 마지막에 두는 것은 4편에서 다룰 질의 구조화와 짝을 이룹니다. 이 텍스트를 만드는 함수는 서버 한 곳에만 두고, 배치는 원시 필드만 보내 서버가 조립하게 했습니다. 배치와 서버가 각자 조립하면 형식이 어긋나는 순간이 반드시 옵니다.

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

`content_hash`는 재색인 비용을 줄이는 장치이면서 재처리를 멱등하게 만드는 장치입니다. 4편에서 다룰 실패 재처리에서 이미 성공한 청크가 섞여 들어가도 임베딩을 다시 호출하지 않습니다. 반대로 개발 단계에서는 이 스킵이 「바꿨는데 반영이 안 된다」는 혼란을 만들므로, 기본값을 끄고 운영에서만 켭니다.

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

## 정리

- 임베딩 호출은 API 타입으로 분기하고 OpenAI 호환 형식을 기본으로 둡니다. 입력 수와 차원은 항상 검증하고, 응답은 `index`로 정렬합니다.
- 임베딩할 텍스트는 본문만, 구조화된 몇 줄로, 본문을 마지막에 둡니다. 짧은 원문은 해설 앞부분으로 보강합니다. 바꾸기 전에 기준선 점수를 파일로 남깁니다.
- `dense_vector`는 `cosine`, `bbq_hnsw`, `rescore_vector`로 고정하고 두 저장소가 같은 블록을 씁니다. `index_options`는 생성 시점에만 적용되므로 변경은 새 인덱스와 alias 전환으로 합니다.

## 다음 편 예고

4편에서는 BM25와 kNN을 한 요청으로 합치는 하이브리드 검색, 질의 구조화와 분류 키워드 반영, 기사 단위 중복 제거, 임베딩 상태 재처리와 일관성 검증, 그리고 의미 기반 캐시를 켜지 않은 이유를 다룹니다.
