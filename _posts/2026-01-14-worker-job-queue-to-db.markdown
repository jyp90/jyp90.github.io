---
layout: post
title: "메시지 큐 Worker 설계 노트 (2) DB 기반 Worker/Job Queue 설계 시 고민 포인트"
date: 2026-01-14 09:00:00 +0900
categories: blog
tags: [Worker, Job Queue, Database, RabbitMQ, 아키텍처]
excerpt: "Worker/Job Queue를 DB 기반으로 설계할 때 고려해야 할 주요 포인트를 정리합니다."
series: "메시지 큐 Worker 설계 노트"
summary:
  - "브로커 없이 DB 테이블을 큐로 쓰는 Worker 구조의 설계 포인트를 다룹니다."
  - "폴링 부하와 동시 할당이 핵심이며, 행 잠금으로 한 Worker만 Job을 잡게 합니다."
  - "Job 상태 흐름, 폴링과 push 방식, 모니터링과 참고 라이브러리를 정리했습니다."
---

## DB 기반 Worker/Job Queue란?

메시지 브로커(RabbitMQ 등) 대신 또는 보완적으로 **DB를 큐 저장소로 활용하여 Worker가 Job을 가져와 처리하는 구조**를 말합니다.  
이 구조는 브로커보다 단순하고, 기존 인프라(예: Postgres)만으로 구현할 수 있지만, 설계와 운영 시 고려해야 할 사항들이 존재합니다.

---

## 1. 작업 폴링(Polling)과 데이터베이스 부하

DB 기반 Worker는 보통 **주기적으로 테이블을 폴링해서 새로운 Job을 가져오는 방식**을 사용합니다.  
그러나 잘못 설계하면 많은 쿼리가 발생하면서 DB 부하가 커질 수 있습니다.  

예를 들어 Vendure는 기본적으로 DB에서 Job을 폴링하도록 구성되며, 여러 큐가 있다면 폴링 쿼리가 지속적으로 발생합니다.  
이때 각 큐는 200ms 간격으로 DB를 조회하므로 큐가 많아지면 부하가 증가할 수 있습니다. ([출처: Vendure Docs](https://docs.vendure.io/guides/developer-guide/worker-job-queue/))

이 문제를 해결하기 위해서는 **push 기반 큐나 Redis 같은 별도 메시지 큐를 도입하는 전략**을 고민해볼 수 있습니다. ([출처: Vendure Docs](https://docs.vendure.io/guides/developer-guide/worker-job-queue/))

---

## 2. 작업 할당과 동시성

다중 Worker가 동시에 Job을 처리해야 할 때 **동시성(Concurrency) 제어**가 주요 고민입니다.  
예를 들어 여러 Worker가 동시에 같은 Job을 가져가면 **중복 처리 또는 Lock 경쟁** 문제가 발생할 수 있습니다.

PostgreSQL과 같은 관계형 DB에서는 `SELECT … FOR UPDATE SKIP LOCKED` 등의 SQL 문을 활용해,  
한 Worker가 선택한 Job을 잠금 처리하고 다른 Worker가 해당 로우를 건너뛰도록 할 수 있습니다. ([출처: while true do;](https://www.danieleteti.it/post/building-a-simple-yet-robust-job-queue-system-using-postgresql/))

이 방법은 동시에 여러 Worker가 있는 상황에서 작업을 **단일 Worker가 담당하도록 보장**해 주기 때문에 매우 유용합니다. ([출처: Stack Overflow](https://stackoverflow.com/questions/297280/the-best-way-to-use-a-db-table-as-a-job-queue-a-k-a-batch-queue-or-message-queu))

---

## 3. Job 상태 및 처리 흐름 관리

단순히 DB의 Job 테이블에 상태 플래그만 넣는 것에서 끝나지 않습니다.

- `PENDING`, `IN_PROGRESS`, `FAILED`, `COMPLETED` 등 상태를 명확히 나누기  
- 실패한 Job에 대해 **재시도/지연 재시도 전략** 설계  
- 작업 처리 시간, 재시도 횟수 제한 등 **상태 추적 및 제한 정책** 마련

이러한 요소는 Worker 시스템의 **신뢰도와 예측 가능성**에 큰 영향을 줍니다.

---

## 4. Worker 설계 기본 패턴

### 4-1. 폴링 방식
Worker는 주기적으로 DB에서 작업을 조회해 가져옵니다.  
장점: 구조가 단순하고 메시지 브로커가 필요 없음  
단점: DB 폴링 쿼리가 빈번하면 오버헤드 증가  

### 4-2. Push 방식
Redis, RabbitMQ 같은 메시지 큐와 연계해 **브로커가 Worker에게 작업을 PUSH**하도록 하는 방식  
장점: Worker가 작업을 기다리기만 하면 됨, 낮은 오버헤드  
단점: 추가 인프라가 필요

두 접근을 비교할 때 **서비스의 처리량(Throughput)**과 **지연(Latency)**의 요구를 기준으로 결정하는 것이 좋습니다.

---

## 5. 성능 문제와 모니터링

DB 기반 Worker는 **DB 연결과 쿼리 성능에 크게 의존**합니다.  
실시간 트래픽이 몰릴 때 DB가 병목이 되거나, Worker가 지연되면 전체 처리속도가 낮아질 수 있습니다.

아래는 대표적인 고려 포인트입니다.

- Worker 폴링 빈도와 DB 쿼리 비용  
- IN_PROGRESS 상태로 머물러 있는 작업의 감지  
- 실패한 작업의 리트라이 관리 및 백오프(backoff) 전략

이러한 요소는 Worker가 안정적으로 운영되기 위한 **모니터링 지표와 알람 정책**을 필요로 합니다.

---

## 6. 라이브러리 및 도구 참고

DB 기반 Worker/Queue를 구현할 때 참고할 수 있는 오픈소스 툴도 존재합니다.  
예를 들어 **yoomoney/db-queue**는 Java 기반으로 **DB를 Queue 저장소로 사용하는 작업자 패턴**을 구현해 놓은 라이브러리입니다.  
이 라이브러리는 PostgreSQL, Oracle 등 여러 DB를 지원하며, 강력한 신뢰성 요소(지연 실행, 리트라이, 실행 추적 등)를 제공합니다. ([출처: GitHub](https://github.com/yoomoney/db-queue))

이처럼 이미 검증된 라이브러리를 참고하거나 활용하면 **직접 모든 구조를 설계/구현하는 부담**을 줄일 수 있습니다.

---

## 7. 정리: 주요 고민 포인트

아래는 DB 기반 Worker/Job Queue 설계 시 **핵심 고민 포인트 정리**입니다.

| 고려 항목 | 주요 질문 |
|-----------|------------|
| 폴링 전략 | 폴링 쿼리가 DB 부하를 유발하지 않는가? |
| 동시성 제어 | 다중 Worker가 같은 작업을 가져가지 않는가? |
| 상태 관리 | Job 상태 전이가 명확하고 추적 가능한가? |
| 실패/재시도 | 실패한 작업 처리 정책은 어떻게 설계할 것인가? |
| 성능 보장 | Worker가 충분한 처리량을 유지하는가? |
| 모니터링 | 처리 지연, 오류 등을 모니터링하고 있는가? |

---

## 마무리

DB 기반 Worker/Queue는 **간단한 구조와 인프라 관리 편의성** 때문에 매력적인 선택입니다.  
그러나 제대로 설계하지 않으면 **DB 부하, 동시성 문제, 상태 관리 복잡성** 등의 부작용이 발생할 수 있습니다.  
이 글에서는 이러한 고민 포인트를 중심으로 정리했으며, 다음 글에서는 **구체적인 테이블 구조 예시와 Worker 코드 흐름**을 함께 다뤄 보겠습니다.