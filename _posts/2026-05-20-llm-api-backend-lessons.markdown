---
layout: post
title: "고전 문헌 RAG 서비스를 만들며 배운 것 (1) LLM 호출 구조와 구조화 출력 복구"
date: 2026-05-20 09:00:00 +0900
categories: blog
tags: [Python, FastAPI, LLM, Architecture, Troubleshooting]
excerpt: "고전 문헌 질의응답 서비스에서 LLM 호출을 의도 분류와 답변 생성으로 나누고, 깨진 JSON 복구와 다중 키 쿨다운·모델 폴백으로 장애에 대응한 과정을 정리합니다."
series: "고전 문헌 RAG 서비스를 만들며 배운 것"
summary:
  - "Gemini API 호출을 의도 분류와 답변 생성 두 번으로 나눠 거절을 싸게 끝냈습니다."
  - "잘린 JSON은 부분 복구하고 파싱 실패와 API 실패를 구분해 재호출 여부를 갈랐습니다."
  - "다중 키 쿨다운과 폴백 모델로 한도 초과와 모델 단종에 대비했습니다."
---

## 무엇을 만들었나

한문 원문과 국역문이 짝을 이루는 고전 문헌을 대상으로, 사용자가 자연어로 질문하면 관련 기록을 찾아 근거와 함께 답하는 AI 질의응답 서비스를 만들었습니다. 채팅 API 서버는 FastAPI로 썼고, 검색은 Elasticsearch, 생성은 Gemini API를 씁니다. 요청 하나는 「질문을 분류한다 → 관련 기록을 검색한다 → 검색 결과를 근거로 답을 생성한다」 세 단계를 지납니다.

이 글은 그중 LLM 호출 구조와 구조화 출력 복구, 키 관리를 다룹니다. LLM은 결국 외부 HTTP API이고, 외부 API를 다룰 때의 일반 원칙(타임아웃, 재시도, 폴백, 키 관리)이 그대로 적용됩니다. 다만 응답이 비결정적이고, 구조화 출력이 중간에 잘릴 수 있고, 모델이 예고 없이 단종되며, 입력 길이가 곧 비용이라는 점에서 보통의 API와 다르게 다뤄야 하는 지점이 있습니다. 그 지점들을 하나씩 정리합니다. 프롬프트 거버넌스와 입력 방어는 2편, 벡터 임베딩과 하이브리드 검색은 3·4편, 한문 원문 채팅과 배치 연동은 5·6편에서 이어집니다.

## 호출을 둘로 나눈 이유: 의도 분류와 답변 생성

LLM 호출은 요청당 두 번입니다. 먼저 **분류기**가 질문을 받아 「답할 수 있는 질문인가, 어떤 유형인가, 검색에 쓸 키워드는 무엇인가」를 JSON으로 돌려주고, 그다음 **답변기**가 분류 결과와 검색 결과를 받아 최종 답변 JSON을 만듭니다. 프롬프트도 두 파일입니다.

한 번에 끝낼 수도 있었지만, 나눈 데는 이유가 있습니다.

- **거절을 싸게 끝냅니다.** 문헌 범위 밖의 질문, 너무 모호한 질문, 질문이 아닌 입력은 분류기 단계에서 거절 코드와 함께 끝납니다. 검색도 하지 않고, 긴 답변 프롬프트도 태우지 않고, 대화 세션도 만들지 않습니다.
- **분류 결과가 뒤 단계의 분기 조건이 됩니다.** 추출된 키워드는 검색에, 질문 유형은 모델 선택과 후처리에 씁니다. 인사말이나 서비스 자체에 대한 질문은 검색 결과를 비우고 더 가벼운 모델로 보냅니다.
- **온도를 다르게 둘 수 있습니다.** 분류는 같은 입력에 같은 결과가 나와야 하므로 temperature를 0에 가깝게 고정하고, 답변은 약간의 다양성을 허용합니다.
- **프롬프트를 따로 검수할 수 있습니다.** 분류 규칙을 고쳤을 때 답변 품질이 흔들리지 않고, 그 반대도 마찬가지입니다.

대신 호출이 하나 늘어난 만큼 지연이 늘어납니다. 분류 결과의 키워드를 검색에 넣으려면 분류 → 검색이 직렬이어야 하고, 지연을 줄이려면 분류와 검색을 동시에 시작해야 하는데 그러면 키워드를 검색에 쓸 수 없습니다. 두 방식을 모두 운영해 봤고, 하이브리드 검색이 키워드 부스트 없이도 충분한지에 따라 선택이 달라집니다. 어느 쪽이든 검색 실패는 빈 결과로 받아 답변기로 넘기고, 분류기 실패는 거절이 아니라 기본 유형으로 통과시켰습니다. 분류기 장애가 서비스 전체 장애가 되지 않게 하기 위해서입니다.

```python
import json
import logging

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class IntentResult(BaseModel):
    fail: bool = False
    fail_code: str | None = None          # out_of_scope, ambiguous, invalid_input ...
    question_type: str | None = None      # single, multi, greeting, about_service ...
    keywords: list[str] = Field(default_factory=list)


# 분류기 자체가 실패하면 거절하지 않고 기본 유형으로 통과시킵니다.
_PASS_THROUGH = IntentResult(question_type="single")


class IntentClassifier:
    def __init__(self, llm, prompts):
        self.llm = llm
        self.prompts = prompts

    async def classify(self, question: str, level: str) -> IntentResult:
        system = self.prompts.load("classification.md")   # 매 호출 읽어 핫 리로드
        user = json.dumps(
            {"query": f"<user_query>{question}</user_query>", "level": level},
            ensure_ascii=False,
        )
        try:
            result = await self.llm.invoke_json(system, user, temperature=0.0, max_tokens=4000)
            return IntentResult.model_validate(result.data)
        except Exception as e:
            logger.warning("분류 호출 실패 — 기본 유형으로 통과: %s", e)
            return _PASS_THROUGH
```

### 프롬프트 두 번 고쳐서 안 되면 코드로 막습니다

분류기에는 모델이 프롬프트 규칙을 일관되게 무시하는 패턴이 있었습니다. 예를 들어 서로 다른 두 시기를 접속어로 이은 복합 질문을 「반드시 복합 질문으로 분류한다」는 규칙을 굵게 쓰고, 예시를 덧붙이고, 위치를 앞으로 옮겨도 모델은 단일 질문으로 분류했습니다. 모델의 학습 편향으로 보이며, 이는 공식 문서의 계약이 아니라 직접 관찰한 결과입니다.

그래서 규칙을 정했습니다. **프롬프트를 두 번 강화해도 같은 케이스가 실패하면 백엔드 후처리로 옮깁니다.** 위 경우는 「질문에 서로 다른 시기 표지가 둘 이상 있고 접속어나 물음표가 둘 이상이면 복합 질문으로 덮어쓴다」는 정규식 후처리로 끝냈습니다. 프롬프트를 더 강화하면 토큰만 늘고 효과는 줄어듭니다. 답변기 쪽도 마찬가지여서, 후속 질문 유도 문구가 비어 오면 유형별 기본 문구를 넣고, 키워드가 빈 배열이면 검색 결과의 키워드로 채우는 식의 안전망을 코드에 두었습니다. 결정론이 필요한 값은 프롬프트가 아니라 코드가 보장합니다.

## 구조화 출력: JSON은 잘리고, 깨지고, 비어 있습니다

두 호출 모두 JSON 모드(`response_mime_type="application/json"`)로 받습니다. 그래도 파싱이 실패하는 경우는 꾸준히 있었습니다.

- 마크다운 코드 펜스(백틱 세 개와 `json` 표시)로 감싸거나 앞에 한 줄 설명을 붙여 보냅니다.
- JSON이 아니라 파이썬 dict 표기(작은따옴표)로 보냅니다.
- 문자열 안에 JSON이 허용하지 않는 제어 문자가 섞여 옵니다.
- **출력 토큰 상한에 걸려 JSON이 중간에서 끊깁니다.** 가장 자주, 그리고 가장 아프게 겪은 경우입니다.

마지막 경우가 아픈 이유는 구조화 출력의 성격 때문입니다. 자유 텍스트는 잘려도 앞부분이 살아 있지만, JSON은 닫는 괄호 하나가 없으면 전체가 무효가 됩니다. 긴 답변 본문 뒤에 키워드, 출처, 후속 질문 같은 필드가 오는 구조라면 본문이 길어질수록 뒤 필드가 잘리고, 그 순간 본문까지 함께 버려집니다.

### 단계적으로 파싱하고, 잘린 JSON은 부분 복구합니다

파서는 성공할 때까지 느슨한 방법으로 내려갑니다. 마지막 단계가 잘린 JSON의 부분 복구인데, 완성된 문자열·불리언·숫자 필드만 정규식으로 긁어 dict를 만듭니다. 중첩 객체와 배열은 살리지 못하므로, 「본문은 왔는데 뒤가 잘린」 경우에 본문만이라도 건지는 용도입니다.

```python
import ast
import json
import re

_FENCE = re.compile(r"`{3}(?:json)?\s*\n?(.*?)\n?`{3}", re.DOTALL)   # 코드 펜스 안의 본문
_BRACES = re.compile(r"\{.*\}", re.DOTALL)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
# 닫는 따옴표가 없어도 잡습니다 — 잘린 마지막 문자열 필드를 살리기 위해서입니다.
_STR_FIELD = re.compile(r'"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)')
_SCALAR_FIELD = re.compile(r'"([^"\\]+)"\s*:\s*(true|false|null|-?\d+(?:\.\d+)?)')


class LLMError(Exception):
    pass


def parse_json(text: str) -> dict:
    text = _CONTROL.sub("", text.strip())
    if not text:
        raise LLMError("응답이 비어 있습니다")

    candidates = [text]
    if (m := _FENCE.search(text)):
        candidates.insert(0, m.group(1).strip())
    if (m := _BRACES.search(text)):
        candidates.append(m.group())
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    if text.startswith(("{'", "[{")):            # 파이썬 dict 표기로 온 경우
        try:
            obj = ast.literal_eval(text)
            if isinstance(obj, list) and obj:
                obj = obj[0]
            if isinstance(obj, dict):
                return obj
        except (ValueError, SyntaxError):
            pass

    if (partial := recover_truncated(text)):
        return partial
    raise LLMError(f"JSON 파싱 실패: {text[:200]}")


def recover_truncated(text: str) -> dict:
    if not text.lstrip().startswith("{"):
        return {}
    out: dict = {}
    for m in _STR_FIELD.finditer(text):
        out[m.group(1)] = (m.group(2).replace('\\"', '"').replace("\\n", "\n")
                           .replace("\\t", "\t").replace("\\\\", "\\"))
    for m in _SCALAR_FIELD.finditer(text):
        out[m.group(1)] = json.loads(m.group(2))
    return out
```

부분 복구가 돌아갔다는 사실은 경고 로그로 남깁니다. 복구된 키 목록을 함께 적어 두면 어느 필드가 잘렸는지 나중에 셀 수 있습니다.

### 파싱 실패는 API 실패가 아닙니다

파서가 생기기 전에는 파싱 실패를 호출 실패와 같은 `except`에서 받아 「상태 없는 방식으로 다시 호출」했습니다. 응답은 이미 왔는데 또 수십 초짜리 호출을 하는 셈이어서, 유난히 느린 요청을 추적하면 이 재호출이 나왔습니다. 지금은 `try/except/else`로 나눠, API 수준 실패(네트워크, 인증, 사용량 한도)에만 재호출하고 파싱 실패는 부분 복구한 결과를 그대로 씁니다.

```python
async def _generate_in_session(self, session, system, user_msg, history, per_call_config) -> LLMResult:
    try:
        response = await session.send_message(user_msg, config=per_call_config)
    except Exception as e:                       # API 수준 실패만 재호출 대상입니다
        if isinstance(e, LLMRateLimitError):
            self.pool.mark_failed(self.llm)
        return await self._invoke_with_history_fallback(system, user_msg, history)
    else:                                        # 응답은 왔으니 파싱 실패는 재호출하지 않습니다
        try:
            data = parse_json(response.text or "")
        except LLMError as e:
            logger.warning("세션 응답 파싱 실패 — 재호출 없이 빈 결과로 진행: %s", e)
            data = {}
        return LLMResult(data=data, usage=usage_of(response))
```

### 출력 토큰 상한은 「답변 길이」가 아니라 「JSON 전체」 기준입니다

처음에는 출력 상한을 난이도별 답변 길이에 맞춰 잡았습니다. 그러면 거절 안내문처럼 예상보다 긴 필드가 하나만 끼어도 잘립니다. 분류기 상한을 두 번 올렸고, 답변기는 난이도와 무관하게 넉넉한 값 하나로 통일했습니다. 상한은 모델이 그만큼 쓰라는 뜻이 아니라 「여기까지는 잘리지 않는다」는 보장이므로, 비용은 실제 출력 길이가 정하고 상한은 여유 있게 두는 편이 맞습니다. 다만 상한을 올리는 것은 증상 완화이고, 근본 원인은 입력이 너무 커서 모델이 장황해지는 쪽에 있었습니다. 이 부분은 2편의 토큰 절감 절에서 다룹니다.

### 대화 세션에 호출별 설정을 넘기면 시스템 지시가 사라졌습니다

SDK의 대화 세션 객체(히스토리를 SDK가 관리하는 방식)를 쓰면서, 난이도별 출력 상한을 호출마다 다르게 주려고 `send_message`에 설정 객체를 넘겼습니다. 그러자 세션을 만들 때 넣은 시스템 지시가 적용되지 않았고, 모델은 스키마 없이 자유 텍스트를 돌려줬습니다. 결과는 `answer_body`가 빈 문자열인 「성공」 응답이었습니다. 호출별 설정이 세션 설정에 합쳐지는 것이 아니라 통째로 대체되는 동작으로 보이며, 이것도 문서에서 확인한 계약이 아니라 관찰한 결과입니다. 호출별 설정에 시스템 지시(또는 아래의 캐시 참조)를 항상 함께 넣는 것으로 해결했습니다.

이 일로 빈 답변 방어를 두 겹으로 두었습니다. 스키마 검증이 실패하면 원본 dict에서 `answer`, `content` 같은 대체 키를 찾아보고, 그래도 비어 있으면 「원문에서 해당 내용을 확인하기 어렵습니다」라는 표준 문구를 넣되 경고 로그를 남깁니다. 빈 문자열을 성공으로 내보내는 것이 가장 나쁜 결과이기 때문입니다.

## 키 여러 개, 쿨다운, 모델 단종

### 다중 키 라운드로빈과 쿨다운

사용량 한도는 키 단위로 걸립니다. 키를 쉼표로 여러 개 등록하고 요청마다 돌아가며 쓰되, 한도 초과(429)를 받은 키는 일정 시간 건너뛰게 했습니다. 서킷브레이커의 가장 단순한 형태입니다.

```python
import time

_COOLDOWN_SECONDS = 60.0


class KeyPool:
    """LLM_API_KEYS=k1,k2 처럼 등록한 키를 라운드로빈으로 돌리고, 실패한 키는 쿨다운합니다."""

    def __init__(self, keys: list[str], make_client):
        self._clients = [make_client(k) for k in keys]
        self._failed_at = [0.0] * len(keys)      # 0.0 이면 정상
        self._next = 0

    def pick(self):
        now = time.monotonic()
        n = len(self._clients)
        for offset in range(n):
            i = (self._next + offset) % n
            if self._failed_at[i] == 0.0 or now - self._failed_at[i] >= _COOLDOWN_SECONDS:
                self._next = (i + 1) % n
                return self._clients[i]
        # 전부 쿨다운이면 가장 먼저 풀릴 키를 그냥 씁니다. 거절보다 한 번 더 시도가 낫습니다.
        i = min(range(n), key=lambda j: self._failed_at[j])
        logger.warning("모든 키가 쿨다운 중 — index=%d 강제 사용", i)
        self._next = (i + 1) % n
        return self._clients[i]

    def mark_failed(self, client) -> None:
        self._failed_at[self._clients.index(client)] = time.monotonic()
```

FastAPI 의존성으로 `pool.pick()`을 노출하면 요청마다 다른 키의 클라이언트가 주입됩니다. 주의할 점은 **실패 표시를 호출한 쪽에서 해 줘야 한다**는 것입니다. 클라이언트는 자기가 풀의 몇 번째인지 모르므로, 서비스 계층에서 한도 초과 예외를 잡을 때 `mark_failed`를 부릅니다. 이 연결을 빠뜨리면 풀은 있지만 쿨다운은 한 번도 동작하지 않습니다. 키가 살아 있는지 확인하는 헬스체크는 출력 토큰 상한을 1로 둔 최소 요청으로 했습니다.

### 에러를 분류해야 폴백을 고를 수 있습니다

SDK가 던지는 예외는 한 가지 타입에 메시지만 다른 경우가 많아서, 메시지 문자열로 유형을 나눴습니다. 깨지기 쉬운 방법이고 SDK 버전이 바뀌면 같이 봐야 하지만, 유형별로 다른 폴백을 걸려면 이 분류가 먼저 필요합니다.

```python
def classify_error(exc: Exception) -> str:
    msg = str(exc).lower()
    if "429" in msg or "quota" in msg or "rate" in msg:
        return "rate_limit"            # 키 쿨다운
    if "timeout" in msg or "deadline" in msg:
        return "timeout"               # 사용자에게 재시도 안내
    if "404" in msg or "not found" in msg:
        return "model_not_found"       # 폴백 모델로 재시도
    if any(k in msg for k in ("too long", "exceeds", "token limit", "context length")):
        return "context_too_long"      # 히스토리 줄여 재시도
    return "other"
```

### 모델 단종에 대비한 폴백 모델

미리보기(preview) 이름이 붙은 모델은 예고 기간을 두고 사라집니다. 설정에 폴백 모델을 하나 두고, 주 모델 호출이 「모델 없음」으로 실패하면 같은 요청을 폴백 모델로 한 번 더 보냅니다. 폴백 모델이 비어 있으면 그대로 실패합니다.

```python
async def invoke_json(self, system, user, *, history=None, max_tokens=2048,
                      temperature=0.3, model=None, cached=None) -> LLMResult:
    config = self._build_config(system, temperature, max_tokens, cached, json_mode=True)
    contents = self._build_contents(user, history)
    target = model or self.model

    async def call(m: str):
        return await self._client.aio.models.generate_content(model=m, contents=contents, config=config)

    try:
        response = await call(target)
    except Exception as e:
        if classify_error(e) == "model_not_found" and self.fallback_model:
            logger.warning("모델 %s 없음 — %s 로 재시도", target, self.fallback_model)
            try:
                response = await call(self.fallback_model)
            except Exception as fe:
                raise to_llm_error(fe) from fe
        else:
            raise to_llm_error(e) from e
    return LLMResult(data=parse_json(response.text or ""), usage=usage_of(response))
```

폴백 모델은 「있으면 좋은」 설정이 아니라 운영 환경의 필수 설정으로 두는 편이 좋습니다. 비워 두면 주 모델이 사라지는 순간 서비스 전체가 즉시 실패합니다. 다만 폴백 모델은 프롬프트가 맞춰진 모델이 아니므로 품질이 떨어질 수 있고, 그래서 폴백이 발동했다는 경고 로그는 반드시 남겨 사람이 알게 해야 합니다.

### 컨텍스트 초과는 히스토리를 줄여 재시도합니다

긴 대화는 히스토리가 쌓여 입력 한도를 넘깁니다. 이때는 히스토리를 절반으로, 그래도 넘치면 없이 보냅니다. 답변 품질은 떨어지지만 요청이 실패하는 것보다 낫습니다.

```python
async def _invoke_with_history_fallback(self, system, user, history, **kw) -> LLMResult:
    attempts = [history, history[len(history) // 2:], []]
    for i, hist in enumerate(attempts):
        try:
            return await self.llm.invoke_json(system, user, history=hist or None, **kw)
        except LLMRateLimitError:
            self.pool.mark_failed(self.llm)
            raise
        except LLMContextTooLongError:
            if i == len(attempts) - 1:
                raise
            logger.warning("컨텍스트 초과 — 히스토리 %d → %d 로 줄여 재시도", len(hist), len(attempts[i + 1]))
```

이 폴백 경로들은 실제 API 없이 검증했습니다. 에러 분류 함수와 폴백 로직을 가짜 클라이언트로 감싸, 「주 모델 404 → 폴백 성공」, 「둘 다 404 → 예외 전파」, 「컨텍스트 초과 두 번 → 히스토리 없이 호출」 같은 경우를 표준 라이브러리 `unittest`만으로 돌렸습니다. 외부 API가 끼는 경로일수록 폴백 자체는 API 없이 테스트할 수 있게 만들어 두는 편이 좋습니다.

## 정리

- LLM 호출은 의도 분류와 답변 생성 둘로 나눴습니다. 거절을 싸게 끝내고, 분류 결과로 검색·모델·후처리를 분기하고, 프롬프트를 따로 검수하기 위해서입니다. 분류기 실패는 거절이 아니라 통과로 처리합니다.
- 프롬프트를 두 번 강화해도 같은 케이스가 실패하면 백엔드 후처리로 옮깁니다. 결정론이 필요한 값은 코드가 보장합니다.
- JSON 모드여도 파싱은 실패합니다. 단계적 파서와 잘린 JSON의 부분 복구를 두고, 파싱 실패를 API 실패와 분리해 재호출하지 않습니다. 출력 상한은 답변 길이가 아니라 JSON 전체 기준으로 넉넉히 둡니다.
- 키는 여러 개를 라운드로빈으로 돌리고 한도 초과 키는 쿨다운합니다. 에러를 유형별로 분류해 모델 단종에는 폴백 모델로, 컨텍스트 초과에는 히스토리 축소로 대응하며, 폴백 경로는 API 없이 테스트합니다.

## 다음 편 예고

2편에서는 프롬프트가 소비하는 입력을 줄이는 법, 프롬프트를 버전과 대상 모델을 적은 설정 파일처럼 다루고 회귀 검수하는 법, 프롬프트 인젝션을 세 겹으로 막는 법, 그리고 근거 없이 「기록이 없다」고 답하는 응답을 감지해 실패로 돌리는 법을 다룹니다.
