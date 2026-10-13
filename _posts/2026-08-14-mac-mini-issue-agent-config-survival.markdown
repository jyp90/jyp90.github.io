---
layout: post
title: "Mac mini에 이슈 자동 처리 에이전트 상주시키기 (2) 설정 관리와 생존 판정"
date: 2026-08-14 12:00:00 +0900
categories: blog
tags: [ClaudeCode, Automation, Monitoring, DevTools]
excerpt: "비밀값과 규칙을 분리한 설정 구조, 상태·로그·하트비트 파일의 역할, 로그가 아니라 스케줄과 mtime으로 생존을 판정하는 순서를 정리합니다."
series: "Mac mini에 이슈 자동 처리 에이전트 상주시키기"
summary:
  - "규칙 파일은 비밀값의 값이 아니라 환경변수 이름만 가리켜 git으로 관리할 수 있게 했습니다."
  - "상태 파일은 원자적 쓰기로, 이슈별 실행 기록은 따로 남겨 재현 가능하게 했습니다."
  - "생존 판정은 스케줄 확인 후 하트비트 mtime을 보는 순서로 고정해 오판을 줄였습니다."
---

1편에서는 Mac mini 한 대에 폴러와 Slack 리스너, 보조 배치를 올리면서 정한 디렉터리 구성과 cron·launchd 역할 분담을 다뤘습니다. 이번 편에서는 그 위에서 동작을 제어하는 설정 구조, 상태·로그·하트비트 파일의 역할, 그리고 「지금 에이전트가 살아 있나」를 판정하는 순서를 다룹니다.

## 설정의 단일 원천: 규칙 파일과 비밀값 파일

에이전트는 별도 DB 없이 두 파일로 모든 동작을 제어합니다.

- **규칙 파일** (`~/issue-agent/config/rules.json`): 어떤 상태의 이슈를 감시할지, 작업 유형별로 어떤 에이전트를 붙일지, 누구에게 알릴지, 헬스체크 임계값은 얼마인지 같은 동작 규칙입니다. 비밀값은 하나도 없습니다.
- **비밀값 파일** (`~/.issue-agent/secrets.env`): Jira·Slack·Jenkins 토큰과 검수용 계정 같은 자격증명만 담습니다. 권한은 `600`입니다.

핵심은 규칙 파일이 비밀값의 **값이 아니라 환경변수 이름**만 가리킨다는 점입니다.

```json
{
  "poll": { "interval_minutes": 1, "lookback_minutes": 3 },
  "jira": {
    "base_url": "https://jira.example.com",
    "env": { "email": "JIRA_EMAIL", "auth": "JIRA_API_TOKEN" }
  },
  "slack": {
    "method": "bot",
    "env": { "bot": "SLACK_BOT_TOKEN", "app": "SLACK_APP_TOKEN" }
  },
  "health_alert": {
    "consecutive_failures": 3,
    "heartbeat_stale_minutes": 15,
    "renotify_after_minutes": 30
  }
}
```

이렇게 나누면 규칙 파일은 git으로 관리하고 코드 리뷰에 그대로 올릴 수 있습니다. 비밀값 파일은 저장소 밖, 홈 디렉터리에만 둡니다. 런타임 홈의 `.gitignore`에 `*.env`를 넣어 두고, 커밋 전 훅으로 토큰 패턴을 검사하면 실수로 커밋하는 경로를 한 번 더 막을 수 있습니다.

### 스크립트가 설정을 읽는 방법

파이썬 스크립트는 셸 설정에 기대지 않고 env 파일을 직접 읽습니다. cron과 launchd 어느 쪽에서 실행되어도 같은 값을 보게 하기 위해서입니다.

```python
import json
import os
from pathlib import Path

ENV_FILE = Path.home() / ".issue-agent" / "secrets.env"
CONFIG_FILE = Path(os.environ.get("ISSUE_AGENT_CONFIG",
                                  Path.home() / "issue-agent" / "config" / "rules.json"))


def load_env_file(path: Path) -> None:
    """KEY=VALUE 와 export KEY=VALUE 를 모두 받습니다. 이미 설정된 값은 덮어쓰지 않습니다."""
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, sep, value = line.partition("=")
        if not sep:
            continue
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def secret(config_section: dict, name_key: str) -> str:
    env_name = config_section[name_key]
    value = os.environ.get(env_name)
    if not value:
        raise SystemExit(f"missing required env: {env_name}")  # 이름만 출력하고 값은 출력하지 않습니다
    return value


load_env_file(ENV_FILE)
config = json.loads(CONFIG_FILE.read_text())
jira_token = secret(config["jira"]["env"], "auth")
```

`export`가 있는 줄과 없는 줄을 모두 받는 이유는, 같은 파일을 bash에서 `source`하는 경로(launchd plist)와 파이썬이 직접 파싱하는 경로(폴러)가 공존하기 때문입니다. 설정 파일 경로를 환경변수로 덮어쓸 수 있게 해 두면, 테스트용 규칙 파일로 폴러를 한 번 돌려 볼 때 편합니다.

리스너처럼 폴러와 같은 설정을 쓰는 프로세스는 폴러의 설정 로더를 모듈로 가져다 씁니다. 로더가 둘이면 키 이름 하나를 바꿀 때 한쪽만 고치는 일이 생깁니다.

### 단일 원천이 지켜지지 않는 곳

두 파일로 나눴다고 해서 모든 값이 한 곳에만 있는 것은 아닙니다. 운영하며 발견한 어긋남은 다음과 같습니다.

- **폴링 주기가 두 곳에 있었습니다.** 규칙 파일의 `interval_minutes`와 crontab의 `* * * * *`는 서로 자동으로 맞춰지지 않습니다. 규칙 파일만 바꾸면 실제 주기는 그대로입니다. 규칙 파일에 「crontab도 함께 바꿔야 한다」는 주석을 달아 두었지만, 주석은 사람이 읽어야만 효과가 있습니다. 하나로 합칠 수 없다면 실제 실행 주기는 crontab이 정하고 규칙 파일의 값은 「조회할 때 몇 분 전까지 훑을지」 같은 계산에만 쓴다는 식으로, 어느 쪽이 기준인지를 정해 두는 편이 낫습니다.
- **env 파일에 아무도 읽지 않는 키가 쌓였습니다.** 연동 방식을 바꿀 때마다 새 키가 추가되고 옛 키는 남습니다. 이름이 비슷한 키가 여럿 있으면 토큰을 갱신할 때 엉뚱한 키를 고치기 쉽습니다. 키를 지우기 전에는 런타임 홈 전체를 `grep`해서 어떤 스크립트도 그 이름을 읽지 않는지 확인했습니다. 폴러 하나만 확인하고 지우면 보조 스크립트가 깨질 수 있습니다.
- **같은 키가 두 번 정의되어 있었습니다.** `export` 유무만 다른 같은 키가 두 줄 있으면, `source`할 때는 뒤의 값이 이기고 위 로더처럼 `setdefault`로 읽으면 앞의 값이 이깁니다. 같은 파일을 읽는데도 프로세스마다 다른 값을 보게 됩니다.

## 상태·로그·하트비트 파일

### 상태 파일

폴러의 상태는 JSON 파일 하나에 모았습니다. 최상위 키는 대략 다음과 같습니다.

```json
{
  "last_poll": "2026-08-12T10:41:03+09:00",
  "issues": {
    "<이슈키>": {
      "processed_comment_ids": ["10001", "10007"],
      "last_trigger": "2026-08-12T10:12:40+09:00",
      "session_id": "<세션 식별자>"
    }
  },
  "health": {
    "consecutive_query_failures": 0,
    "consecutive_claude_failures": 0,
    "last_success_at": "2026-08-12T10:41:03+09:00"
  },
  "notified": { "last_build": 0 }
}
```

- `processed_comment_ids`는 같은 댓글로 두 번 실행하지 않기 위한 기록입니다.
- `health`의 연속 실패 횟수는 「한 번 실패하면 바로 알림」이 아니라 「연속 N회 실패하면 알림」으로 만들기 위한 카운터입니다. 네트워크가 잠깐 흔들릴 때마다 알림이 쏟아지는 것을 막습니다.
- `notified`는 같은 빌드 결과를 두 번 알리지 않기 위한 커서입니다.

상태 파일은 임시 파일에 쓴 뒤 `rename`으로 교체하는 편이 안전합니다. 쓰는 도중에 프로세스가 죽어도 반쯤 쓰인 JSON이 남지 않습니다. 손으로 고치기 전에는 날짜를 붙인 백업본을 따로 떠 둡니다. 권한은 비밀값 파일과 마찬가지로 `600`입니다. 세션 식별자처럼 다른 사람이 알 필요 없는 값이 들어 있기 때문입니다.

이슈별 실행 기록은 상태 파일과 따로 둡니다. Claude를 한 번 띄울 때마다 `runs/<이슈키>/` 아래에 실행한 명령, 넘긴 프롬프트, 출력 로그, 완료 표지 파일을 한 세트로 남깁니다. 상태 파일은 「다음에 무엇을 할지」를 판단하는 데 쓰고, 실행 기록은 「그때 무엇을 했는지」를 사람이 재현하는 데 씁니다. 로그만으로는 어느 줄이 어느 실행에 속하는지 가려내기 어렵습니다.

### 락 파일

cron이 매분 폴러를 깨우는데 한 사이클이 1분을 넘기면 두 폴러가 동시에 돕니다. 그러면 같은 댓글로 Claude 세션이 두 개 뜰 수 있습니다. 그래서 시작할 때 락 파일에 자기 PID를 씁니다. 락이 이미 있으면 그 PID가 아직 살아 있는지 확인해서, 살아 있으면 조용히 종료하고 죽어 있으면 이전 실행이 비정상 종료한 것으로 보고 락을 가져오는 방식이 일반적입니다.

### 로그

로그는 출처에 따라 세 종류가 생깁니다.

| 종류 | 누가 쓰나 | 용도 |
|---|---|---|
| 앱 로그 | 스크립트의 로깅 핸들러 | 조회·실행·알림의 상세 흐름 |
| cron 리다이렉트 로그 | crontab의 `>> ... 2>&1` | 앱 로거가 뜨기 전의 오류, 예외 스택 |
| launchd 로그 | plist의 `StandardOutPath`/`StandardErrorPath` | 상주 프로세스의 시작 실패, 크래시 |

앱 로그는 파이썬의 `RotatingFileHandler`로 크기 기준 회전(예: 10MB씩 5개)을 걸었습니다. 그래도 회전이 걸리지 않은 로그는 계속 자라므로, 매일 새벽 정리 배치가 일정 기간(예: 30일)보다 오래된 줄을 잘라 냅니다. 앞서 말한 것처럼 정상 폴링은 DEBUG 수준으로 기록하므로, 운영 로그 수준에서는 아무 일이 없는 날 로그가 거의 늘지 않습니다.

### 하트비트

하트비트는 「이 프로세스가 방금 한 바퀴를 돌았다」는 표시 파일입니다. 폴러는 사이클을 마칠 때마다, 리스너는 이벤트 루프에서 주기적으로 갱신합니다.

```python
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def beat(name: str) -> None:
    hb_dir = Path.home() / ".issue-agent" / "heartbeat"
    hb_dir.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=hb_dir)
    with os.fdopen(fd, "w") as f:
        f.write(datetime.now(timezone.utc).isoformat())
    os.replace(tmp, hb_dir / name)  # 교체는 원자적이고, 교체된 파일의 mtime이 곧 생존 시각입니다
```

내용에 시각을 적어 두면 사람이 `cat`으로 읽기 편하지만, 판정에는 파일의 **mtime**을 씁니다. 내용이 비어 있는 `touch` 방식 하트비트도 같은 규칙으로 판정할 수 있기 때문입니다. 헬스체크처럼 「실행됐다」는 사실만 남기면 되는 잡은 내용 없이 `touch`만 합니다.

## 생존 판정 규칙: 로그가 아니라 mtime으로, 스케줄부터

운영하면서 가장 자주 받은 질문은 「지금 에이전트가 살아 있나」였습니다. 그리고 이 질문에 로그로 답하면 틀리기 쉽습니다.

- **로그가 조용해도 죽은 것이 아닙니다.** 처리할 이슈가 없는 정상 폴링은 DEBUG로만 남기므로, 운영 로그 수준에서는 며칠씩 새 줄이 없을 수 있습니다.
- **하트비트가 멈춰도 장애가 아닐 수 있습니다.** 사람이 일부러 crontab에서 폴러를 주석 처리한 기간에는 하트비트가 멈추는 것이 정상입니다. 실제로 사용량을 점검하느라 폴러를 의도적으로 멈춘 기간이 있었는데, 하트비트만 보고 판단했다면 장애로 오판했을 것입니다.

그래서 판정 순서를 다음과 같이 고정했습니다.

1. **스케줄이 켜져 있는지 먼저 봅니다.** `crontab -l`에서 해당 줄이 주석이 아닌지, launchd 잡이라면 `launchctl print`에서 로드되어 있는지 확인합니다. 꺼져 있다면 하트비트가 멈춘 것은 장애가 아닙니다.
2. **켜져 있다면 하트비트 mtime과 마지막 성공 시각을 봅니다.** 하트비트가 임계값(예: 15분)보다 오래되었거나, 상태 파일의 `last_success_at`이 오래 갱신되지 않았다면 이상으로 판정합니다.
3. **로그는 원인을 볼 때만 엽니다.** 로그가 조용하다는 사실 자체는 장애의 근거로 삼지 않습니다.

이 순서를 헬스체크 스크립트로 옮기면 다음과 같습니다(macOS의 `stat -f %m` 기준).

```bash
#!/bin/bash
set -u
HB="$HOME/.issue-agent/heartbeat/poller"
STALE_MIN=15

# 1) 스케줄이 꺼져 있으면 판정하지 않습니다.
if ! crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -q 'scripts/poller.py'; then
  echo "$(date '+%F %T') poller schedule disabled — skip"
  exit 0
fi

# 2) 하트비트 mtime으로 판정합니다. 파일이 없으면 가장 오래된 것으로 봅니다.
now=$(date +%s)
mtime=$(stat -f %m "$HB" 2>/dev/null || echo 0)
age_min=$(( (now - mtime) / 60 ))

if (( age_min > STALE_MIN )); then
  echo "$(date '+%F %T') poller heartbeat stale: ${age_min}m"
  "$HOME/issue-agent/scripts/notify.sh" "폴러 하트비트가 ${age_min}분째 갱신되지 않았습니다."
  exit 1
fi
echo "$(date '+%F %T') poller ok (${age_min}m)"
```

헬스체크는 이상이 있을 때만 알립니다. 정상일 때마다 「정상입니다」를 보내면 사람들이 그 채널을 읽지 않게 되고, 정작 이상 알림도 묻힙니다. 위 예시는 폴러만 보지만, 실제 헬스체크는 몇 가지를 더 봤습니다.

- 상태 파일에서 「처리 중」으로 표시된 지 너무 오래된 이슈가 있는지(세션이 걸려 있는지)
- 비밀값 파일 권한이 `600`인지
- `claude` 실행 파일이 그 경로에 있고 실행 가능한지
- 보조 배치의 하트비트와 연속 실패 횟수

여기서 한 가지 주의할 점이 있습니다. 헬스체크 자신도 cron으로 도는 프로세스이므로, 헬스체크가 죽으면 아무도 알려 주지 않습니다. 헬스체크가 실패를 감지하지 못하고 exit 0으로 끝나는 경로가 남아 있으면 「알림이 없으니 정상」이라는 착각이 생깁니다. 이 문제는 [실패했는데 성공으로 끝나는 시스템 — 종료 코드 0과 fail-open 게이트](/blog/2026/10/07/silent-failure-exit-code-fail-open.html)에서 따로 정리했고, 이 에이전트에서 실제로 겪은 사례는 8편에서 다룹니다.

## 정리

- 규칙 파일은 비밀값의 이름만 가리키고, 값은 권한 `600`인 env 파일에만 둡니다. 그래도 주기처럼 두 곳에 나뉘어 있는 값은 어느 쪽이 기준인지 명시해야 합니다.
- 상태 파일은 임시 파일에 쓴 뒤 `rename`으로 교체하고, 이슈별 실행 기록은 상태 파일과 따로 둡니다.
- 생존 판정은 「스케줄이 켜져 있는가 → 하트비트 mtime과 마지막 성공 시각 → 로그는 원인 확인용」 순서로 합니다.

## 다음 편 예고

3편에서는 폴러가 Jira에서 「지시 댓글」을 골라내는 방법과, 이슈마다 헤드리스 Claude Code 세션을 띄우는 방법을 다룹니다. 세 갈래 조회를 합치는 이슈 수집, AI 차례와 게이트를 가르는 레인 상태 머신, 자기 댓글에 다시 반응하지 않게 막는 중복 방지, `claude -p`에 넘기는 프롬프트 조립과 도구 제한을 정리합니다.
