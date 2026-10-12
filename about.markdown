---
layout: page
title: 소개
permalink: /about/
---

<p class="page-lead">오래된 Java·Spring 웹 애플리케이션을 운영하고 고쳐 나가는 백엔드 개발자입니다. 오류 없이 조용히 틀리는 문제를 끝까지 추적해서 원리와 확인 방법까지 남기는 일을 좋아합니다.</p>

## 주로 하는 일

- **레거시 웹 애플리케이션 장애 분석과 개선**: 스레드 고갈, 래퍼 타입 비교, 커넥션 풀 설정처럼 예외 없이 동작이 틀어지는 문제를 재현하고 원인을 좁힙니다.
- **데이터베이스와 인프라 계층**: JDBC 전송 중 문자 손실, 리눅스 메모리 오버커밋과 JVM 기동 실패, 정적 파일의 CDN 이전을 다뤘습니다.
- **검색·LLM 기반 서비스 백엔드**: 고전 문헌 질의응답 서비스에서 LLM API 호출, 벡터 임베딩과 하이브리드 검색, 배치 파이프라인을 만들었습니다.
- **개발 자동화**: 이슈를 감시하다가 Claude Code로 처리하는 에이전트를 상주시키고, 비용과 안전장치를 운영하며 다듬었습니다.

글에서 주로 다룬 기술은 Java, Spring, Spring Boot, Tomcat, JDBC, SQL Server, Elasticsearch, Python, FastAPI, JavaScript, Git, Linux입니다.

## 글 쓰는 방식

실제로 겪은 문제에서 출발해서 원리, 확인 방법, 해결책과 그 한계 순서로 씁니다. 회사와 서비스 이름, 내부 수치는 빼고 다른 프로젝트에도 적용할 수 있게 일반화합니다. 긴 글은 맨 위의 요약 세 줄만 읽어도 무엇을 다루는지 알 수 있게 했습니다.

## 먼저 읽어 볼 글

{% assign featured = site.posts | where: "featured", true %}
<ul class="about-featured">
{%- for p in featured -%}
  <li><a class="post-link" href="{{ p.url | relative_url }}">{{ p.title | escape }}</a></li>
{%- endfor -%}
</ul>

여러 편으로 이어지는 글은 [시리즈]({{ '/series/' | relative_url }}) 페이지에 모아 두었습니다.

## 연락처

- GitHub: [github.com/jyp90](https://github.com/jyp90)
- 이메일: [jyp90@kakao.com](mailto:jyp90@kakao.com)
