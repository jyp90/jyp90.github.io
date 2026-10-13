---
layout: post
title: "고전 문헌 RAG 서비스를 만들며 배운 것 (6) Prefect 배치 파이프라인 연동"
date: 2026-06-03 12:00:00 +0900
categories: blog
tags: [Python, Batch, Automation, Architecture, Monitoring]
excerpt: "고전 문헌 RAG의 배치 파이프라인에서 Prefect flow 분리와 트리거, 파라미터 출처 함정, 임베딩 책임을 배치로 옮긴 이유를 정리합니다."
series: "고전 문헌 RAG 서비스를 만들며 배운 것"
summary:
  - "Gemini Batch API 작업을 제출·감시·검증 flow로 나누고 스케줄은 monitor 하나에만 뒀습니다."
  - "flow 사이의 트리거 플래그는 deployment 기본값을 믿지 않고 호출하는 쪽이 매번 명시했습니다."
  - "임베딩 책임을 API 서버에서 배치로 옮기고 상태 컬럼은 flow마다 하나씩만 쓰게 나눴습니다."
---

5편에서는 채팅 API가 긴 LLM 요청 중 클라이언트 이탈을 감지하고 취소하는 법, 대명사 섞인 후속 질문을 푸는 법, 비본문 문서를 걸러내는 법을 다뤘습니다. 이 글은 같은 서비스의 배치 프로젝트(Prefect)가 문헌을 번역·해설하고 임베딩해 검색 인덱스를 채우는 과정에서 만난 문제를 다룹니다.

## Prefect로 배치 파이프라인 잇기

### 파이프라인의 모양: 제출·감시·검증의 분리

배치 프로젝트가 하는 일은 문헌 XML을 파싱해 DB에 넣고, LLM으로 번역과 해설을 만들고 해설을 한 번 더 확장한 뒤, 결과를 검색 인덱스에 싣고 임베딩하는 것입니다. LLM 호출은 Gemini Batch API를 씁니다. 요청을 JSONL로 묶어 클라우드 스토리지에 올리고 작업을 제출하면, 결과가 몇 분에서 몇 시간 뒤에 스토리지에 떨어집니다. 결과를 기다리며 프로세스를 잡아 두는 구조는 성립하지 않습니다.

그래서 flow를 역할별로 쪼갰습니다.

| flow | 실행 계기 | 하는 일 |
|---|---|---|
| parse | 수동 | XML → DB(문서 상태 「파싱됨」) |
| submit (번역·해설·해설 확장) | 수동 또는 앞 단계의 자동 트리거 | 대상 문서 조회 → JSONL 생성·업로드 → Batch 작업 제출 → 작업 행 「제출됨」 |
| monitor | cron | 「제출됨」 작업의 외부 상태 조회 → 완료면 validate 트리거 |
| validate | monitor의 트리거 | 결과 다운로드 → Pydantic 검증 → 인덱스 저장 → 다음 단계 submit 트리거 |
| embedding | validate의 트리거 | 청크 분할 → 임베딩 서버 호출 → 청크 인덱스 저장 |

상태는 두 종류를 따로 둡니다. **문서** 하나의 상태는 「파싱됨 → 번역 중 → 번역됨 → 해설 중 → 해설됨 → …」으로 나아가고, **작업**(배치 제출 단위) 하나의 상태는 「대기 → 제출됨 → 외부 완료 → 처리 중 → 완료」로 나아갑니다. 외부 API가 돌려주는 상태(`JOB_STATE_RUNNING`, `JOB_STATE_SUCCEEDED` …)는 내부 작업 상태로 변환해 별도 컬럼에 기록합니다. 내부 워크플로가 어디까지 왔는지와 외부 서비스가 뭐라고 하는지는 다른 질문이기 때문입니다. 검증에 실패한 문서는 문서 단위로 시도 횟수를 세어 이전 상태로 되돌리고(다음 submit에 자동 재포함), 횟수를 넘기면 영구 실패로 표시해 사람이 보게 합니다.

### Prefect 배포 정의: 같은 flow, 다른 파라미터

Prefect에서 flow 함수 하나는 여러 **deployment**로 배포할 수 있습니다. 같은 코드에 다른 기본 파라미터와 스케줄을 붙인 것입니다. 이 파이프라인은 그 점을 적극적으로 씁니다.

```yaml
# prefect.yaml (발췌)
definitions:
  work_pools:
    - &pool_name "batch-pool"
    - &job_vars
        command: "/srv/batch/venv/bin/python -m prefect.engine"
        env:
          APP_ENV: prod
          PYTHONPATH: /srv/batch

pull:
  - prefect.deployments.steps.set_working_directory:
      directory: /srv/batch

deployments:
  - name: monitor
    entrypoint: src/flows/monitor_flow.py:monitor_flow
    work_pool: { name: *pool_name, job_variables: *job_vars }
    parameters:
      job_type: null                       # 모든 작업 유형
      validate_deployment: "validate-flow/validate"
      embedding_deployment: "embedding-flow/embed"
    schedules:
      - cron: "*/30 * * * *"
        timezone: Asia/Seoul

  - name: monitor-translate                # 같은 flow, 번역 작업만, 수동 실행
    entrypoint: src/flows/monitor_flow.py:monitor_flow
    work_pool: { name: *pool_name, job_variables: *job_vars }
    parameters:
      job_type: translate
      validate_deployment: "validate-flow/validate"
      embedding_deployment: "embedding-flow/embed"
    schedules: []

  - name: validate
    entrypoint: src/flows/validate_flow.py:validate_flow
    work_pool: { name: *pool_name, job_variables: *job_vars }
    parameters:
      max_retries: 3
      trigger_next_stage: true
      trigger_embedding: true
      embedding_deployment: "embedding-flow/embed"

  - name: validate-no-trigger              # 수동 재처리용 — 연쇄 트리거 없음
    entrypoint: src/flows/validate_flow.py:validate_flow
    work_pool: { name: *pool_name, job_variables: *job_vars }
    parameters:
      max_retries: 3
      trigger_next_stage: false
      trigger_embedding: false
```

- **YAML 앵커**로 work pool 이름과 job variables(파이썬 경로, 환경변수)를 한 번만 적습니다. deployment가 열 개를 넘어가면 이것 없이는 손으로 맞추기 어렵습니다.
- **monitor**만 스케줄이 있습니다. 나머지는 수동이거나 다른 flow가 트리거합니다. 파이프라인의 심장 박동이 하나뿐이라는 뜻입니다.
- **`-no-trigger` 변형**은 운영 중 꼭 필요합니다. 검증만 다시 돌리고 싶은데 다음 단계까지 연쇄로 제출되면 곤란한 경우가 있습니다.
- **`job_type` 필터 변형**은 특정 유형만 손으로 다시 감시할 때 씁니다.

worker는 process 타입입니다. systemd로 떠 있는 worker가 서버를 폴링하다가 flow run을 받으면 지정한 가상환경의 파이썬으로 서브프로세스를 띄웁니다. `job_variables.command`에 가상환경 파이썬의 절대 경로를 적어 두는 것이 「worker의 파이썬과 flow의 파이썬이 다른」 사고를 막는 가장 확실한 방법이었습니다.

### flow가 flow를 부르기: run_deployment와 파라미터의 출처

monitor가 validate를, validate가 다음 submit과 embedding을 부릅니다. 모두 `run_deployment`입니다.

```python
from prefect import task, get_run_logger
from prefect.deployments import run_deployment


@task(name="trigger-validate", retries=1, retry_delay_seconds=30)
def trigger_validate(job: dict, validate_deployment: str, embedding_deployment: str) -> dict:
    log = get_run_logger()
    params = {
        "job_name": job["job_name"],
        "job_type": job["job_type"],
        # 연쇄 트리거 플래그는 호출하는 쪽이 항상 명시합니다 (아래 참고)
        "trigger_next_stage": True,
        "trigger_embedding": True,
        "embedding_deployment": embedding_deployment,
    }
    try:
        run = run_deployment(name=validate_deployment, parameters=params, timeout=0)
        log.info("validate triggered: %s (%s)", run.id, run.name)
        return {"ok": True, "flow_run_id": str(run.id)}
    except Exception as e:
        log.warning("deployment trigger failed, running inline: %s", e)
        from .validate_flow import validate_flow
        result = validate_flow(**params)   # 같은 파라미터로 서브플로우 실행
        return {"ok": True, "inline": True, "result": result}
```

세 가지가 중요합니다.

**`timeout=0`은 fire-and-forget입니다.** 기본값(`None`)은 트리거한 flow run이 끝날 때까지 기다립니다. monitor가 validate를 기다리고 validate가 다시 submit을 기다리면, cron으로 도는 monitor 한 번이 몇 시간짜리가 됩니다. `timeout=0`은 flow run을 만들기만 하고 바로 `FlowRun` 객체(id, name 포함)를 돌려줍니다.

**인라인 폴백.** Prefect 서버에 닿지 못하면 flow 함수를 직접 호출합니다. 현재 프로세스 안에서 서브플로우로 돌므로 일은 되지만, 호출한 flow의 실행 시간이 길어지고 worker 하나를 그만큼 점유합니다. 폴백이 자주 타면 서버 쪽 문제를 먼저 봐야 합니다.

**파라미터는 세 곳에서 올 수 있습니다.** 이것이 이번에 겪은 함정입니다.

| 출처 | 적용되는 경우 |
|---|---|
| flow 함수 시그니처의 파이썬 기본값 | 인라인으로 직접 호출할 때 |
| `prefect.yaml` deployment의 `parameters` | `run_deployment`로 실행할 때의 기본값 |
| `run_deployment(parameters=...)` | deployment 기본값을 덮어씀 |

validate flow에 「해설 확장이 끝나면 임베딩을 트리거한다」는 기능을 구현하고 deployment 정의에도 `true`를 적었는데, 운영에서 임베딩이 자동으로 돌지 않았습니다. 파이썬 기본값은 `False`였고, monitor가 넘기는 파라미터에는 그 플래그가 없었습니다. deployment 정의의 `true`가 왜 적용되지 않았는지는 그 자리에서 끝까지 좁히지 못했습니다. 정의를 바꾼 뒤 `prefect deploy`를 다시 올리지 않았을 가능성이 가장 컸지만, 인라인 폴백 경로는 어차피 파이썬 기본값만 보므로 그쪽은 확실히 `False`였습니다.

고친 방법은 단순합니다. **연쇄 트리거에 관한 플래그는 호출하는 쪽이 매번 명시**합니다. `run_deployment`의 `parameters`와 인라인 폴백 호출 양쪽에 같은 값을 넣고, 두 경로가 같은 파라미터를 넘기는지 확인하는 작은 테스트를 붙였습니다. 「deployment 기본값이 있으니 괜찮다」는 가정은 재배포 누락 한 번이면 무너집니다. flow 사이의 계약은 호출 코드에 있어야 합니다.

### 임베딩 책임을 API 서버에서 배치로 옮긴 이유

청크 임베딩은 처음에 채팅 API 서버의 몫이었습니다. validate flow가 해설 확장 결과를 저장한 뒤, API 서버의 「청크 생성 + 임베딩 + 인덱스 저장」 엔드포인트를 HTTP로 호출했습니다. 문서 ID를 수백 개씩 묶어 보내고 10분 타임아웃을 걸었습니다.

이 구조의 문제는 이렇습니다.

- **배치가 API 서버의 가동에 묶입니다.** API 서버 배포로 프로세스가 재시작되면 진행 중이던 10분짜리 요청이 끊기고, 어디까지 됐는지는 배치도 API도 모릅니다.
- **요청을 처리해야 할 프로세스가 배치 일을 합니다.** 수백 문서의 청크 분할과 임베딩 호출은 이벤트 루프를 오래 붙잡습니다. 사용자 요청과 자원을 나눠 쓰는 자리에 둘 일이 아닙니다.
- **재시도와 관측이 어느 쪽에도 없습니다.** Prefect의 task 재시도는 HTTP 호출 한 번을 통째로 다시 하는 것이고, API 쪽에는 작업 단위가 없어 「이 문서까지는 됐다」를 표시할 곳이 없습니다.

그래서 임베딩을 배치 프로젝트의 flow로 옮겼습니다. flow가 사내 임베딩 서버를 직접 호출하고 Elasticsearch에 직접 bulk 저장합니다. API 서버에서는 해당 엔드포인트와 서비스 코드를 지우고, 청크 인덱스의 매핑·분석기 설정을 만드는 초기화 엔드포인트만 남겼습니다. 매핑은 검색하는 쪽(API)이 소유하고, 데이터를 채우는 일은 배치가 소유하는 분담입니다.

옮길 때 한 가지를 조심했습니다. 청크 임베딩 텍스트의 포맷(제목·시대 구분·키워드·해설·본문 순서)은 이미 색인된 청크와 **글자 단위로 같아야** 합니다. 포맷이 조금이라도 달라지면 같은 문서의 옛 청크와 새 청크가 다른 벡터 분포에 놓입니다. 그래서 포맷 함수를 그대로 복제한 뒤 API 쪽 원본을 지웠습니다. 양쪽에 남겨 두면 언젠가 한쪽만 고쳐집니다.

embedding flow 자체는 다음 순서입니다.

1. DB의 작업 행(`job_type=embedding`, 대기 상태)을 집어 「처리 중」으로 바꿉니다.
2. 대상 문서를 기사 인덱스에서 `mget`으로 읽습니다.
3. 국역문을 청크로 나누고 메타데이터를 붙여 임베딩 텍스트를 만듭니다.
4. 청크 텍스트의 해시를 청크 인덱스의 기존 문서와 비교해 같으면 건너뜁니다. 재실행할 때 임베딩 비용을 아낍니다.
5. 임베딩 서버를 배치 크기 단위로 호출하고(세마포어로 동시성 제한, 재시도), 청크 인덱스에 bulk upsert합니다.
6. 문서의 임베딩 상태와 작업 행을 완료 또는 실패로 갱신합니다.

작업 행은 `chunk_id`에 유니크 제약을 걸고 `ON CONFLICT DO NOTHING`으로 만듭니다. validate가 재시도로 두 번 돌아도 임베딩 작업은 하나만 생깁니다.

### 병렬 트리거와 상태 컬럼 분리

처음에는 임베딩을 파이프라인의 맨 끝(해설 확장 완료 후)에 붙였습니다. 그런데 임베딩 텍스트에 들어가는 것은 국역문과 해설까지이고, 해설 확장 단계의 결과는 쓰지 않습니다. 해설 단계가 끝난 시점에 임베딩을 시작할 수 있다는 뜻입니다. 해설 확장 배치는 몇 시간이 걸리므로, 그만큼 검색 가능 시점이 앞당겨집니다.

Prefect task는 `submit()`으로 띄우면 future를 돌려주고, 기본 task runner가 스레드로 동시에 실행합니다. 두 트리거를 모두 `submit()`한 뒤에 `result()`를 받으면 됩니다.

```python
# validate flow 안, 해설 단계 결과를 저장한 직후
if job_type == "commentary" and success_ids:
    f_extend = f_embed = None
    if trigger_next_stage:
        f_extend = trigger_submit.submit(stage="commentary_extend", article_ids=success_ids)
    if trigger_embedding_from_commentary:
        f_embed = trigger_embedding.submit(article_ids=success_ids)
    if f_extend:
        result["extend"] = f_extend.result()
    if f_embed:
        result["embed"] = f_embed.result()
```

`submit()` 직후에 바로 `result()`를 부르면 순차 실행과 같습니다. 두 submit을 먼저 끝내고 result를 뒤로 모으는 것이 핵심입니다.

병렬로 돌리자 바로 드러난 문제가 **상태 컬럼의 소유권**이었습니다. 문서 테이블의 `status` 컬럼을 파이프라인 단계(해설 확장 중 → 해설 확장 완료)와 임베딩(임베딩 중 → 임베딩 완료)이 함께 쓰고 있었습니다. 둘이 동시에 돌면 나중에 쓴 쪽이 이깁니다. 해설 확장이 끝났는데 임베딩이 뒤에 완료되면 문서 상태가 「임베딩 완료」가 되어 「해설 확장 완료」 기록이 사라지고, 반대도 마찬가지입니다.

해법은 컬럼을 나누는 것입니다. `embedding_status` 컬럼을 따로 두고, **이 컬럼은 embedding flow만 씁니다.** 다른 flow는 손대지 않습니다. 파이프라인 상태는 submit·validate flow가 소유하고, 임베딩 상태는 embedding flow가 소유합니다. 한 컬럼에 쓰는 주체가 둘이면 병렬화는 할 수 없습니다.

```sql
ALTER TABLE article ADD COLUMN embedding_status VARCHAR(20) NULL;
-- NULL: 미처리, EMBEDDING: 처리 중, COMPLETED: 완료, FAILED: 재처리 대기
```

### flow run 정보를 DB에 남기기

운영 중 가장 자주 하는 일은 「이 작업 행이 어느 flow run에서 처리됐는가」를 찾는 것입니다. 작업 행에는 외부 Batch 작업 이름이 있고 Prefect UI에는 flow run이 있는데, 둘을 잇는 끈이 없으면 시각을 맞춰 가며 눈으로 찾아야 합니다.

`prefect.runtime`이 현재 실행 중인 flow run과 task run의 정보를 줍니다.

```python
from prefect.runtime import flow_run, task_run


def current_run_ids() -> tuple[str | None, str | None]:
    fr = str(flow_run.id) if flow_run.id else None
    tr = str(task_run.id) if task_run.id else None
    return fr, tr
```

작업 행에 flow run id, task run id, 사람이 읽을 표시 이름(`embedding_{YYYYMMDDHHMMSS}_{run id 앞 5자}`)을 저장했습니다. 쓰는 곳이 두 군데입니다.

- **트리거하는 쪽**(validate의 트리거 task): `run_deployment`가 돌려준 `FlowRun`의 id와 name을 바로 저장합니다. 트리거 task 자신의 task run id도 함께 넣습니다.
- **트리거된 쪽**(embedding flow 시작 직후): 자기 `flow_run.id`를 저장합니다. 인라인 폴백으로 돌았을 때는 `run_deployment` 반환값이 없으므로 이쪽이 유일한 기록입니다.

같은 행에 두 번 쓰므로 UPDATE는 `COALESCE`로 **비어 있을 때만 채우고 이미 있는 값은 덮어쓰지 않도록** 했습니다. 어느 쪽이 먼저 도달하든 결과가 같습니다. flow run id는 양쪽이 같은 값이라 그냥 덮어씁니다.

```sql
UPDATE batch_job
   SET prefect_flow_run_id = %s,
       prefect_task_run_id = COALESCE(prefect_task_run_id, %s),
       display_name        = COALESCE(display_name, %s),
       updated_at          = CURRENT_TIMESTAMP
 WHERE id = %s;
```

### monitor flow가 보지 않는 것

monitor는 30분마다 돌며 두 가지 상태의 작업만 봅니다. 외부에 제출된 작업은 외부 상태를 조회해 완료·실패로 옮기고, 동시 제출 한도에 걸려 대기 중인 작업은 자리가 나면 다시 제출합니다. 외부 Batch API에는 동시 실행 개수 제한이 있어 submit flow가 한도를 넘기면 작업을 대기 상태로 두고 monitor에 넘깁니다. submit flow가 기다리지 않고 끝날 수 있는 구조입니다.

```python
from prefect import flow, task


@task(retries=3, retry_delay_seconds=30)
def check_external_state(job: dict) -> str:
    state = batch_client.get_state(job["job_name"])     # 외부 API 상태
    internal = to_internal_state(state)                 # 완료·실패·진행 중으로 변환
    jobs.update_state(job["id"], internal, external=state)
    return internal


@flow(name="monitor-flow")
def monitor_flow(job_type: str | None = None,
                 validate_deployment: str = "validate-flow/validate",
                 embedding_deployment: str = "embedding-flow/embed") -> dict:
    done = []
    for job in jobs.list_submitted(job_type):
        if check_external_state(job) == "EXTERNAL_DONE":
            done.append(job)
    for job in jobs.list_waiting(job_type):
        resubmit_if_slot_available(job)
    for job in done:
        trigger_validate.submit(job, validate_deployment, embedding_deployment).result()
    return {"checked": len(done)}
```

문제는 이 두 상태 **밖**에 있는 작업입니다. validate가 결과를 받아 「처리 중」으로 바꾼 뒤 중간에 죽으면 작업은 영원히 「처리 중」입니다. monitor는 보지 않고, validate는 다시 트리거되지 않습니다. 「외부 완료」로 바뀌었는데 트리거가 실패한 작업도 마찬가지입니다. 이런 작업은 운영 스크립트로 사람이 상태를 되돌려 다시 태워야 했습니다.

이것은 상태 머신을 설계할 때의 일반 규칙으로 남았습니다. **종료 상태가 아닌 모든 상태에는 그 상태를 다시 들여다보는 주체가 있어야 합니다.** 「처리 중」이 일정 시간을 넘기면 실패로 돌리는 규칙을 monitor에 넣거나, 「외부 완료」 상태도 monitor의 조회 대상에 넣어 validate를 다시 트리거하게 하는 식입니다. 처음 만들 때는 정상 경로만 그리게 되는데, 각 상태에 「여기서 프로세스가 죽으면 누가 알아채나」를 한 번씩 물어 보는 것이 재시도·백오프 설계의 출발점입니다. 워커 재시도 일반론은 [이전 글](/blog/2026/01/17/retry-backoff-strategy-worker-monitoring.html)에 정리해 두었습니다.

## 정리

- 결과가 몇 시간 뒤에 나오는 외부 Batch API는 제출·감시·검증 flow로 나누고, 스케줄은 monitor 하나에만 둡니다.
- 같은 flow를 파라미터만 다른 여러 deployment로 배포하면 수동 재처리·부분 감시 변형을 코드 없이 얻습니다.
- flow 사이의 트리거 플래그는 호출하는 쪽이 매번 명시합니다. deployment 기본값과 파이썬 기본값은 믿을 계약이 아닙니다.
- 배치 일은 배치 프로젝트가 합니다. API 서버의 HTTP 엔드포인트를 배치 작업의 실행 장소로 쓰면 재시작·재시도·관측이 모두 어긋납니다.
- 병렬로 도는 flow가 한 컬럼을 같이 쓰면 안 됩니다. 상태 컬럼마다 쓰는 주체를 하나로 정합니다.
- 종료 상태가 아닌 모든 상태에는 다시 들여다보는 주체가 필요합니다.

여섯 편에 걸쳐 LLM API 연동, 임베딩과 하이브리드 검색, 그리고 운영에서 만난 문제를 정리했습니다. 공통된 결론은 LLM이 들어간 서비스도 결국 긴 요청·외부 의존·상태 머신이라는 평범한 백엔드 문제의 조합이고, 그 각각을 평소처럼 다루면 된다는 것입니다.
