---
layout: post
title: "다중 서버 환경에서 DB 중심 Worker 장애 대응 전략"
date: 2026-01-16 09:00:00 +0900
categories: blog
tags: [Worker, RabbitMQ, 장애복구, 멱등성, 분산시스템, DB]
excerpt: "다중 서버 환경에서 Worker가 처리 중 중단되었을 때, DB 기반으로 안전하게 다시 처리하거나 재전달에 대응하는 전략을 정리합니다."
---

## 개요

RabbitMQ 기반 다중 서버 Worker 환경에서는 **한 서버에서 처리 중인 Work가 중단될 수 있습니다**.  
RabbitMQ의 *at-least-once delivery* 특성 때문에, 메시지는 ACK이 오기 전까지 **다른 서버의 Worker로 재전달**될 수 있습니다. 그러므로 메시지 처리 상태를 **DB 기반으로 정합성 있게 유지**하는 것이 중요합니다.  [oai_citation:0‡Backend Engineering Chronicles](https://backend-engineering-chronicles.github.io/2025/10/31/reliable-rabbitmq-preventing-message-loss-duplicates-and-ordering-issues.html?utm_source=chatgpt.com)

---

## RabbitMQ 전달 보장과 DB 중심 상태 저장

RabbitMQ는 기본적으로 **적어도 한 번(at-least-once)** 메시지를 전달합니다.  
즉, 소비자가 ACK을 보내기 전까지 메시지는 *재전달 가능 상태*로 남아 있습니다. 이 때문에 메시지는 여러 번 소비될 수 있고, **중복 처리 위험**이 존재합니다.  [oai_citation:1‡Backend Engineering Chronicles](https://backend-engineering-chronicles.github.io/2025/10/31/reliable-rabbitmq-preventing-message-loss-duplicates-and-ordering-issues.html?utm_source=chatgpt.com)

결론적으로 RabbitMQ는 메시지 전달 보증만 하고,  
**실제 처리 상태와 작업 결과는 DB 수준에서 보존/판단**해야 합니다.

---

## DB를 중심으로 한 Worker 처리 흐름

DB 중심 처리 흐름은 다음과 같습니다:

1. **DB 트랜잭션 시작**
2. **중복 처리 여부 체크**
3. **비즈니스 로직 수행**
4. **처리 상태 저장**
5. **DB 트랜잭션 커밋**
6. **RabbitMQ ACK 전송**

이 순서를 지키면 메시지 재전달 상황에서도 **중복 처리를 방지**할 수 있습니다.  
가령 워커가 처리 중 갑자기 실패했을 때, 트랜잭션이 커밋되지 않았다면 ACK이 보내지지 않습니다.  
RabbitMQ는 이 메시지를 다시 다른 워커로 전달합니다.  
그 경우 **DB에서 처리 상태를 보고 중복 여부를 판단**하여 처리 또는 건너뛸 수 있습니다.  [oai_citation:2‡Backend Engineering Chronicles](https://backend-engineering-chronicles.github.io/2025/10/31/reliable-rabbitmq-preventing-message-loss-duplicates-and-ordering-issues.html?utm_source=chatgpt.com)

---

## 멱등성(Idempotency) 설계

DB 기반 중복 체크는 **Idempotent Consumer 패턴**을 따릅니다.  
이 패턴은 동일한 메시지가 여러 번 도착하더라도 결과는 처음 처리한 것과 동일하게 유지됩니다.  [oai_citation:3‡microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com)

### 구현 전략 (DB)

- **유니크 메시지 ID 저장소**
  - 메시지를 처리할 때 유니크한 ID를 DB에 저장합니다.
  - `(ConsumerName, MessageID)` 조합이나 `(job_id, step)` 같은 유니크 제약 조건을 둡니다.

-> 이미 존재하는 ID라면, 이는 **중복 메시지**로 간주합니다.  
-> Worker는 **처리 스킵 + ACK 전송**으로 응답합니다.  [oai_citation:4‡microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com)

### 예시 테이블

ProcessedMessages

message_id (PK)
consumer_name
processed_at

또는 워크플로우 기반으로:

job_step

job_id
step_name
status
processed_at
UNIQUE(job_id, step_name)

이러한 구조는 메시지 재전달 상황에서도 **이미 처리된 작업 여부를 판단**하는 기반이 됩니다.

---

## 다중 서버 Worker 장애 시 대응 요약

아래는 일반적인 다중 서버 환경의 Worker 장애 상황과 처리 전략입니다:

| 상황 | 문제점 | DB 기반 대응 |
|------|---------|---------------|
| Worker 처리 중 중단 | 메시지 ACK 누락 → 재전달 발생 | DB 상태 조회로 중복 확인 및 ACK |
| 동일 메시지 중복 수신 | 중복 처리 위험 | 유니크키 기반 멱등 처리 |
| 여러 Worker 경쟁 | 동시성/상태 불일치 | DB 트랜잭션 기반 상태 업데이트 |
| 반복 오류 메시지 | 무한 재시도 | 재시도 횟수 및 Dead Letter Queue 정책 |

---

## 재전달 메시지 처리 패턴

RabbitMQ는 ACK이 없는 메시지를 다시 전달합니다.  
따라서 Worker는 다시 받은 메시지를 아래처럼 처리해야 합니다:

```text
메시지 수신 → DB에서 상태 확인
  | 이미 처리됨 → ACK + 스킵
  | 미처리 → 트랜잭션 + 처리 + 상태 기록 + ACK
```

이 흐름은 대부분의 중복 수신 시나리오를 안전하게 처리할 수 있는 기본 패턴입니다.

⸻

고려할 점

트랜잭션 일관성

RabbitMQ ACK과 DB 우선 커밋 구조는 분산 트랜잭션이 아니므로 100% 원자성을 보장하지는 않습니다.
그러나 DB 먼저 처리 + 그 뒤 ACK 패턴은 현재 업계에서도 표준으로 받아들여집니다.  ￼

⸻

마무리

다중 서버 Worker 환경에서는 메시지 재전달과 워커 실패 상황을 RabbitMQ 단의 처리 보장 범위 뿐 아니라,
DB 기반 상태 저장 및 멱등성 설계로 보완해야 합니다. 이렇게 설계하면 중단된 워커 이후에도 다른 서버의 워커가 안전하게 작업을 이어갈 수 있습니다.

이번 글에서는 DB 중심으로 Worker 장애 대응 패턴을 정리했습니다.
다음 글에서는 Retry, Dead Letter Message 설계와 모니터링 전략까지 이어서 다뤄보겠습니다.

---

### 포함된 핵심 포인트

- RabbitMQ는 **at-least-once delivery** 형태임을 전제로 설명했습니다 (재전달 발생 가능).  [oai_citation:6‡Backend Engineering Chronicles](https://backend-engineering-chronicles.github.io/2025/10/31/reliable-rabbitmq-preventing-message-loss-duplicates-and-ordering-issues.html?utm_source=chatgpt.com)  
- DB를 기준으로 **중복 처리 확인 + 상태 저장** 패턴으로 Worker 실패 대응을 정리했습니다.  [oai_citation:7‡microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com)  
- 멱등성 디자인은 **DB의 유니크 제약/ID 저장**을 기반으로 처리합니다.  [oai_citation:8‡microservices.io](https://microservices.io/patterns/communication-style/idempotent-consumer.html?utm_source=chatgpt.com)
