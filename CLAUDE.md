# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Jekyll 기반 GitHub Pages 블로그로, 개발 도구 및 유틸리티 페이지를 제공하는 정적 사이트입니다.
주요 기능으로 JWT Debugger, JSON Prettier, Unix Timestamp 변환기 등의 웹 기반 도구를 포함합니다.

## Development Commands

/agents/org 오케스트레이션 서브 에이전트를 활용하여 병렬로 작업을 진행하며, 문서 단위 기반의 커뮤니케이션을 진행합니다.

### Ruby 환경 설정
```bash
# Ruby 버전 확인 (3.3.0 사용 권장)
rbenv versions
ruby --version

# Ruby 버전 설정
rbenv global 3.3.0
```

### 의존성 설치 및 업데이트
```bash
bundle install && bundle update jekyll
```

### 로컬 개발 서버 실행

#### 방법 1: Docker Compose (권장)
Ruby 환경 설정 없이 바로 실행 가능:
```bash
# 서버 시작 (첫 실행 시 이미지 빌드)
docker compose up --build

# 백그라운드 실행
docker compose up -d

# 로그 확인
docker compose logs -f

# 서버 중지
docker compose down
```

접속: `http://localhost:4000`
LiveReload: 자동으로 활성화되어 파일 변경 시 브라우저 자동 새로고침

**주의**:
- Gemfile 변경 시 `docker compose up --build`로 재빌드 필요
- Apple Silicon (M1/M2/M3) Mac에서도 정상 작동

#### 방법 2: 로컬 Ruby 환경
```bash
bundle exec jekyll serve
```

**중요**: `_config.yml` 파일을 변경한 경우 서버를 재시작해야 변경사항이 반영됩니다.

## Architecture

### 디렉토리 구조
- `_posts/`: Jekyll 블로그 포스트 (마크다운 파일)
- `_includes/`: 재사용 가능한 HTML 컴포넌트 및 레이아웃
  - `_layouts/default.html`: 기본 레이아웃
  - `head.html`, `header.html`, `footer.html`: 공통 컴포넌트
  - `YYYY-MM-DD-[page-name].html`: 각 도구 페이지의 HTML 템플릿
- `assets/`: 정적 파일
  - `js/`: JavaScript 파일
    - `common.js`: 날짜 포맷팅 등 공통 유틸리티 함수
    - `YYYY/MM/DD/[tool-name].js`: 각 도구별 JavaScript 로직
  - `css/`: 스타일시트 (`main.css`, `style.css`, `reset.css`)
- `templates/`: 새 포스트 작성용 템플릿

### 페이지 구조 패턴

각 도구 페이지는 다음 3개 파일로 구성됩니다:

1. **포스트 파일** (`_posts/YYYY-MM-DD-[tool-name].markdown`):
   - Jekyll 포스트 메타데이터와 include 지시문 포함
   - HTML 템플릿과 JavaScript를 로드

2. **HTML 템플릿** (`_includes/YYYY-MM-DD-[tool-name].html`):
   - 도구의 UI 구조와 스타일 정의
   - textarea, input 등 인터랙티브 요소

3. **JavaScript 로직** (`assets/js/YYYY/MM/DD/[tool-name].js`):
   - 도구의 핵심 기능 구현
   - 이벤트 리스너 및 DOM 조작

### 예시: JWT Debugger
```
_posts/2024-02-22-jwt-debugger.markdown
  → include: _includes/2024-02-22-jwt-debugger.html
  → script: assets/js/2024/02/22/jwt-debugger.js
```

## 새로운 도구 추가하기

1. `_posts/YYYY-MM-DD-[tool-name].markdown` 생성:
```markdown
---
layout: post
title: "Tool Name"
date: YYYY-MM-DD HH:MM:SS +0900
categories: article
---

<html>
<body>
  {% include YYYY-MM-DD-[tool-name].html %}
  <script src="{{ site.baseurl }}/assets/js/YYYY/MM/DD/[tool-name].js">
</body>
</html>
```

2. `_includes/YYYY-MM-DD-[tool-name].html`에 UI 구현

3. `assets/js/YYYY/MM/DD/[tool-name].js`에 로직 구현

4. 필요시 `assets/js/common.js`의 공통 함수 활용 (예: `dateFormat`)

## Configuration

- `_config.yml`: Jekyll 사이트 전역 설정
- `.ruby-version`: Ruby 버전 제약 (2.6.4 이상 필요)
- `Gemfile`: Jekyll 4.2.x, minima 테마 사용
