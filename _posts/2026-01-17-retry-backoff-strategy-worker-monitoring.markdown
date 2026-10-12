---
layout: post
title: "메시지 큐 Worker 설계 노트 (5) RabbitMQ DLQ, Retry/Backoff 전략과 Worker 모니터링"
date: 2026-01-17 09:00:00 +0900
categories: blog
tags: [RabbitMQ, DeadLetterQueue, Retry, Backoff, Monitoring, Worker, 장애대응]
excerpt: "RabbitMQ Dead Letter Queue(DLQ) 설계, Retry + Backoff 전략, Worker 모니터링 및 자동재시작 패턴을 정리합니다."
series: "메시지 큐 Worker 설계 노트"
summary:
  - "반복 실패하는 메시지를 무한 재전달하면 장애가 번지고 정상 메시지가 밀립니다."
  - "DLX로 실패 메시지를 분리하고, TTL 큐와 x-death 횟수로 지연 재시도를 구현합니다."
  - "큐·Worker 지표 감시와 프로세스 자동 재시작까지 함께 설계해야 합니다."
---

## 왜 Dead Letter Queue와 Retry가 필요한가

분산 메시지 시스템에서는 메시지 처리 실패가 흔하게 발생합니다.  
예기치 않은 예외, 외부 서비스 장애, 데이터 불일치 등으로 인해 **Consumer가 메시지 처리를 반복 실패**할 수 있습니다. 이때 동일 메시지를 무한 재전달하면 시스템 장애가 전파되거나 정상 메시지 처리가 지연될 수 있습니다.

대부분의 메시징 시스템은 **Dead Letter Queue**라고 불리는 별도 큐를 통해 처리가 어려운 메시지를 분리하고, **Retry/Backoff** 정책을 통해 일시적인 장애에 대응하도록 설계할 수 있습니다. ([출처: RabbitMQ](https://www.rabbitmq.com/docs/dlx))

---

## 1. RabbitMQ Dead Letter Queue (DLQ) 설계

### Dead Letter Queue란?

Dead Letter Queue(DLQ)는 **처리할 수 없는 메시지를 모아두는 큐**입니다.  
RabbitMQ에서는 메시지에 다음 조건이 발생하면 DLQ로 이동(Dead-Lettering)합니다:

- Consumer가 메시지를 reject/nack하며 requeue를 false로 설정한 경우  
- 메시지가 TTL(time-to-live) 만료된 경우  
- 큐 길이 제한(max length) 초과로 인해 삭제된 경우 ([출처: RabbitMQ](https://www.rabbitmq.com/docs/dlx))

이렇게 분리된 메시지는 문제 원인을 분석하거나, 재처리·수동 대응을 위해 별도 큐에 저장됩니다.

---

### RabbitMQ에서 DLQ 구성 방법

RabbitMQ에서는 **Dead Letter Exchange(DLX)**를 설정한 뒤 이를 통해 DLQ로 메시지를 라우팅합니다. DLX는 일반 Exchange와 동일하게 동작하며, 큐 선언 시 `x-dead-letter-exchange` 및 `x-dead-letter-routing-key`를 지정합니다. ([출처: RabbitMQ](https://www.rabbitmq.com/docs/dlx))

```java
queueBuilder
  .durable("main_queue")
  .withArgument("x-dead-letter-exchange", "dead_letter_exchange")
  .withArgument("x-dead-letter-routing-key", "dlq_routing_key")
  .build();

```

- dead_letter_exchange: 실패 메시지를 재전달할 Exchange
- dlq_routing_key: DLQ로 라우팅할 키

DLQ는 정상 흐름과 분리된 큐이므로, 별도의 Consumer를 두어 수동/자동 대응 로직을 운영할 수 있습니다.

---

### DLQ 응용 예시

DLQ를 단순 장애 저장소 외에도 다음과 같이 활용할 수 있습니다:

- 실패 원인 라벨링(에러 코드 기반 분리 큐)
- 재처리 또는 재발행(운영 정책 기반)
- 경보/알림 트리거
- 운영자가 직접 문제 해결 후 다시 메인 큐로 재투입

---

## 2. Retry + Backoff 전략

### RabbitMQ 기본 Retry 한계

RabbitMQ 자체는 retry 메커니즘을 제공하지 않습니다. 메시지 재전달이나 재시도는 Consumer 측에서 제어해야 합니다.

즉 다음과 같은 패턴을 설계해야 합니다:

1. 실패 시 바로 재시도 → 시스템 과부하 유발 가능
2. 즉시 Dead Letter 이동 → 일시 장애 복구 불가
3. Backoff(지연 + 점증 재시도) 설계 필요

---

### TTL + DLX 기반 Backoff 패턴

RabbitMQ는 **TTL(time-to-live)**와 DLX를 조합해 재시도 딜레이를 구현할 수 있습니다.
기본 아이디어는 다음과 같습니다:

1. 원래 큐(main_queue)에서 메시지 처리 실패 시, Retry 큐로 Dead-Letter
2. Retry 큐는 x-message-ttl로 일정 지연 시간을 둔다
3. TTL 만료 후 메시지는 다시 원래 큐로 Dead-Letter
4. x-death 헤더 기반으로 재시도 횟수 누적 및 제한 판단

이 패턴은 Consumer가 장애가 일시적인 경우에만 여러 번 재시도하게 하고, 정상적인 처리를 유지하도록 설계합니다.

---

### 재시도 횟수 제한

RabbitMQ 메시지 헤더 x-death는 메시지가 몇 번 Dead Letter 되었는지를 기록합니다. 이를 기반으로 재시도 횟수를 제한할 수 있습니다.

- Consumer가 메시지를 받을 때 헤더의 x-death.count를 확인
- 재시도 횟수 한계를 넘으면 DLQ로 분리 최종 저장
- 그렇지 않으면 Backoff 재시도 큐로 재배치

이를 통해 무한 반복 처리 방지 및 일정 회수 이상 실패한 메시지 분리 운영이 가능해집니다.

---

## 3. Worker 모니터링 & 자동 재시작

RabbitMQ DLQ와 Retry는 메시지 장애 대응에 중점을 두었지만, Worker 자체의 장애 대응, 모니터링, 자동 수복도 매우 중요합니다.

---

### 모니터링 핵심 지표

다중 서버 또는 컨테이너 기반 환경에서 Worker의 상태를 관리하려면 아래 지표를 실시간으로 관찰해야 합니다:

**메시지 / 큐 레벨 지표**

- 메인 큐 처리율, DLQ 큐 적재량
- Retry 큐 대기 메시지 수
- 메시지 지연시간(TTL 활용)

**워커 프로세스 지표**

- Worker 프로세스 가용 상태(CPU, 메모리)
- 메시지 처리 오류율
- 재시도/Backoff 큐 순환 비율

이를 통해 이상 징후 조기 탐지 및 대응이 가능해집니다.

---

### 자동재시작(Worker Recovery)

Worker 프로세스가 비정상 종료되었을 때 자동으로 재기동 하는 전략도 중요합니다.

**운영환경 예시**

- systemd / supervisor: 프로세스 모니터링 및 재시작
- Docker + Kubernetes: Liveness/Readiness Probe 기반 자동재배치
- PM2 / Forever: Node 생태계 워커 자동화 도구

이 방법들은 워커가 죽었을 때 자동으로 다시 올라오도록 설정해 작업 중단 상황을 줄이는 역할을 합니다.

---

## 4. 장애 대응 흐름 요약

아래는 메시지 처리 실패 시 전체 장애 대응 흐름입니다.

```text
메시지 처리 실패
   ↓
1. 실패 메시지 → DLQ 또는 Retry 큐
   ↓                  ↓
2. Retry 큐 TTL 적용 후 재전달 → 메시지 재처리 시도
   ↓
3. 재시도 횟수 제한 초과 → 최종 DLQ
   ↓
4. 운영 모니터링 / 알람 / 수동 처리
```

## 마무리

RabbitMQ 환경에서 안정적인 메시지 처리를 위해서는 DLQ/Retry/Backoff + Worker 모니터링/자동 복구 패턴을 함께 설계해야 합니다.
특히 일시 장애나 처리 실패가 반복되는 경우에는 지연 재시도 + 재시도 횟수 제한 + DLQ 분리는 안정성과 유지보수성을 크게 향상시킵니다.