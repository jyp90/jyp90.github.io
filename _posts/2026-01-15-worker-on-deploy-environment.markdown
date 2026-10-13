---
layout: post
title: "PDF AI 분석 서비스 백엔드 설계 (3) API 데몬과 세 갈래 워커로 나눈 이유"
date: 2026-01-15 09:00:00 +0900
categories: blog
tags: [Python, FastAPI, Architecture, Troubleshooting, Batch]
excerpt: "PDF 파싱·임베딩·LLM 요약을 한 프로세스에서 처리할 때의 블로킹과 메모리 문제를 피하려고 API 데몬, 역할별 워커 3개, 감시 전담 매니저로 나눈 구조를 정리합니다."
series: "PDF AI 분석 서비스 백엔드 설계"
summary:
  - "PDF 파싱·임베딩·LLM 호출을 한 프로세스에서 처리하면 메모리 누수와 블로킹이 함께 생깁니다."
  - "API 데몬은 요청만 받고, 무거운 일은 역할별 워커가 각자의 프로세스에서 맡습니다."
  - "역할별 워커 3개와 감시 전담 매니저로 분리하고, 배포 종료 순서를 고정했습니다."
---

## 문제와 배경

업로드된 PDF 문서를 파싱하고, 임베딩을 만들어 검색엔진에 넣고, 이어서 LLM으로 요약·번역까지 처리하는 백엔드가 있습니다. 상태를 어디에 두고 큐를 어떻게 쓸지는 [이전 글](/blog/2026/01/14/worker-job-queue-to-db.html)에서 다뤘고, 이번 글은 그 작업들을 프로세스 단위로 어떻게 나눴는지를 다룹니다.

파싱·임베딩·LLM 처리를 FastAPI 프로세스 하나 안에서 모두 수행하면 메모리 누수와 블로킹이 함께 생깁니다. 무거운 PDF 하나가 메모리를 붙잡으면 같은 프로세스의 요청 처리까지 영향을 받고, 역할이 나뉘어 있지 않으니 배포할 때도 전체를 한 번에 재시작해야 합니다.

## 접근

작업 성격별로 프로세스를 나누기로 했습니다. 요청을 받는 부분(API 데몬)과 실제로 무거운 일을 하는 부분(워커)을 먼저 분리하고, 워커도 다시 역할별로 쪼갰습니다.

- **API 데몬**: 요청 검증, 인증, 클라이언트로의 스트리밍 응답만 맡습니다. 무거운 작업은 직접 하지 않고 큐에 넘깁니다.
- **Parse 워커**: PDF 텍스트·이미지 추출(OCR 포함)만 맡는 별도 프로세스.
- **Index 워커**: 추출된 텍스트를 사내 GPU 임베딩 API로 보내고, 결과를 검색엔진에 저장만 맡는 별도 프로세스.
- **LLM 워커**: 요약·번역·분류처럼 LLM 호출이 필요한 작업만 맡는 별도 프로세스.
- **Manager 워커**: 위 세 워커의 헬스 체크와 로드밸런싱만 맡고, 직접 PDF나 요청을 처리하지 않습니다.

프로세스를 나누면 한쪽이 느려지거나 메모리를 많이 써도 그 프로세스 경계 안에 갇힙니다. 그리고 배포할 때 바뀐 역할의 워커만 재시작할 수 있습니다.

## 구현

전체 흐름은 다음과 같습니다.

```text
API Daemon (FastAPI) ── 큐 ──▶ Parse Worker
                               Index Worker
                               LLM Worker
Manager Worker ─ (헬스 체크·로드밸런싱, 위 세 워커를 감시) ─┘
```

### 핵심 코드

```python
# api_daemon.py — 요청만 받고 무거운 작업은 큐로 넘긴다
@app.post("/documents")
async def upload_document(file: UploadFile):
    doc_id = await store_raw_file(file)          # 원본 저장
    await queue.publish("parse", {"doc_id": doc_id})
    return {"doc_id": doc_id, "state": "COLLECTING"}
```

```python
# parse_worker.py — 파싱만, 다른 역할은 모른다
def handle_parse(message):
    doc_id = message["doc_id"]
    text, images = extract_pdf(doc_id)            # OCR 포함, 무거운 작업
    save_extracted_text(doc_id, text, images)
    queue.publish("index", {"doc_id": doc_id})
```

```python
# manager_worker.py — 처리는 하지 않고 감시만 한다
def watch_loop(workers: list[WorkerHandle]):
    while running:
        for worker in workers:
            if not worker.heartbeat_recent():
                logger.warning("worker not responding: %s", worker.name)
                worker.restart()
        sleep(HEALTH_CHECK_INTERVAL)
```

`manager_worker`는 파싱이나 임베딩 코드를 전혀 모릅니다. 아는 것은 "워커가 살아 있는가"뿐이고, 그래서 어떤 워커가 추가되거나 역할이 바뀌어도 감시 로직은 그대로 둘 수 있습니다.

## 함정과 트레이드오프

가장 까다로웠던 지점은 배포할 때 워커를 내리는 순서입니다. 정해 둔 규칙은 Manager 워커를 먼저 내리고, 그다음 Parse/Index/LLM 워커를 내리는 것입니다. 역순으로 내리면 경쟁 상태가 생긴다는 것이 이유입니다.

Manager가 워커보다 먼저 빠지면, 남은 워커가 내려가는 동안 그 상태를 "응답 없음"으로 보고 재시작을 시도할 주체 자체가 없어집니다. 반대로 워커를 먼저 내리면 아직 떠 있는 Manager가 그 공백을 장애로 오인해 재시작 명령을 내릴 수 있고, 배포 스크립트가 동시에 새 프로세스를 올리는 중이라면 같은 역할의 워커가 중복으로 뜨는 경쟁 상태로 이어질 수 있습니다. 그래서 종료 순서는 코드 리뷰로 걸러지지 않는, 배포 규칙 쪽에 둬야 하는 지식입니다.

역할을 셋으로 나눈 트레이드오프도 있습니다. 프로세스가 늘어난 만큼 배포 단위와 모니터링 대상도 셋으로 늘었고, 워커 사이의 상태는 결국 큐와 DB를 거쳐야 알 수 있어 문제가 생기면 로그를 여러 프로세스에서 맞춰 봐야 합니다.

## 정리

- 파싱·임베딩·LLM 처리를 한 프로세스에 몰아넣으면 블로킹과 메모리 증가가 함께 옵니다.
- API 데몬과 역할별 워커(Parse/Index/LLM)를 분리하면 느려지거나 메모리를 많이 쓰는 부분이 프로세스 경계 안에 갇힙니다.
- 감시 전담 Manager 워커는 처리 로직을 모르는 채로 헬스 체크만 맡아, 역할이 늘어나도 감시 로직을 그대로 둘 수 있습니다.
- 배포 때 워커를 내리는 순서(Manager를 먼저)가 고정돼 있지 않으면 재시작 시도와 배포 스크립트가 겹치는 경쟁 상태가 생길 수 있습니다. 벡터 저장소를 하나로 모은 이야기는 [다음 글](/blog/2026/01/16/multi-server-db-base-worker.html)에서 이어집니다.
