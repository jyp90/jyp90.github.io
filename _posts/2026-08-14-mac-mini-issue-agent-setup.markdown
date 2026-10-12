---
layout: post
title: "Mac mini에 이슈 자동 처리 에이전트 상주시키기 (1) 구성과 상주 프로세스"
date: 2026-08-14 09:00:00 +0900
categories: blog
tags: [ClaudeCode, 자동화, macOS, launchd, cron, Monitoring]
excerpt: "이슈 트래커를 감시하다가 헤드리스 Claude Code로 이슈를 처리하는 에이전트를 Mac mini 한 대에 올리면서 정한 디렉터리 구성, cron과 launchd 역할 분담, 설정과 비밀값 분리, 생존 판정 규칙을 정리합니다."
---

> **시리즈: Mac mini에 이슈 자동 처리 에이전트 상주시키기**
>
> 1. **(1) 구성과 상주 프로세스**
> 2. [(2) 이슈 감지와 헤드리스 Claude 실행](/blog/2026/08/19/mac-mini-issue-agent-headless-claude.html)
> 3. [(3) 통지와 안전장치](/blog/2026/08/25/mac-mini-issue-agent-guardrails.html)
> 4. [(4) 운영하며 배운 것: 비용과 조용한 실패](/blog/2026/09/10/mac-mini-issue-agent-operations.html)

## 무엇을 만들었나

Jira 이슈에 사람이 댓글을 남기면, 그 댓글을 지시로 받아 Claude Code가 코드를 고치고 결과를 다시 이슈와 Slack에 알려 주는 에이전트를 만들었습니다. 사람은 이슈 트래커와 Slack만 보고, 실제 작업은 전용 Mac mini 한 대가 처리합니다.

구성 요소는 세 가지입니다.

- **폴러**: 주기적으로 Jira를 조회해서 새 지시 댓글이 달린 이슈를 찾고, 이슈마다 헤드리스 Claude Code(`claude -p`) 세션을 띄웁니다.
- **Slack 리스너**: Slack 스레드에서 에이전트를 멘션하면 그 이슈의 Claude 세션을 이어서 대화합니다. 프로세스가 계속 떠 있어야 합니다.
- **보조 배치**: 하루·한 주 활동 요약 발송, 로그 정리, 헬스체크 같은 짧은 작업입니다.

이 글은 시리즈 첫 편으로, 이 세 가지가 장비 위에 어떻게 놓이는지를 다룹니다. 이슈를 감지하고 Claude를 실행하는 흐름은 2편, 알림과 안전장치는 3편, 비용과 운영 중 발견한 조용한 실패는 4편에서 이어집니다.

## 왜 전용 Mac mini 한 대인가

결론부터 말하면, 이 에이전트는 「항상 켜져 있고, 사내망 안쪽 자원에 닿고, 바깥에서 들어오는 연결 없이 동작하는」 자리가 필요했습니다. 그 자리로 전용 Mac mini를 고른 이유는 다음과 같습니다.

- **바깥에서 들어오는 연결이 필요 없습니다.** 사내망은 외부에서 안쪽으로 들어오는 연결을 막습니다. 그래서 Jira 웹훅을 받는 서버를 세우는 대신, 장비가 바깥으로 나가는 연결만 쓰도록 설계했습니다. 폴러는 Jira에 조회 요청을 보내고, Slack 리스너는 Slack의 Socket Mode로 장비 쪽에서 먼저 WebSocket을 열어 둡니다. 방화벽 정책을 바꿀 필요가 없습니다.
- **개발자 노트북과 같은 작업 환경을 그대로 재현할 수 있습니다.** 에이전트가 하는 일은 결국 개발자가 하는 일입니다. 저장소를 클론하고, 빌드하고, 사내 개발 DB와 캐시에 접속해 확인합니다. 개발에 쓰는 macOS 도구 체인과 VPN 클라이언트, Claude Code 설정을 그대로 옮겨 올 수 있어서, 에이전트가 「사람 노트북에서는 되는데 여기서는 안 되는」 차이를 덜 겪습니다.
- **사람의 작업 환경과 분리됩니다.** 개인 노트북에서 돌리면 노트북을 닫는 순간 에이전트도 멈추고, 개인 세션과 자동화 세션이 같은 설정 파일과 작업 디렉터리를 공유하게 됩니다. 전용 장비에 전용 사용자 계정을 두면 자동화가 쓰는 자격증명과 작업 트리를 사람의 것과 섞지 않을 수 있습니다.

전용 장비에는 잠자기 끄기, 정전 후 자동 부팅, 사용자 자동 로그인 같은 기본 설정이 필요합니다. 이 부분은 macOS 일반 설정이라 이 글에서는 따로 다루지 않습니다.

## 세 계층으로 나눈 디렉터리 구성

운영하면서 가장 먼저 정리한 것은 「무엇이 어디에 있는가」입니다. 장비 안의 파일을 성격에 따라 세 계층으로 나눴습니다.

| 계층 | 위치 예시 | 담는 것 | 담지 않는 것 |
|---|---|---|---|
| ① 런타임 홈 | `~/issue-agent/` | 실행 코드, 동작 규칙 설정, launchd 정의 원본, 가상환경 | 비밀값, 실행 중 상태 |
| ② 홈 상태 파일 | `~/.issue-agent/` | 비밀값 env 파일, 상태 JSON, 락, 하트비트, 로그, 이슈별 실행 기록 | 코드 |
| ③ 지식 자산 | 별도 git 저장소 | 설계 문서, 환경 문서, 판독법 | 코드, 상태 |

①은 「무엇을 실행하는가」, ②는 「지금 무슨 일이 있었는가」, ③은 「왜 이렇게 만들었고 어떻게 읽어야 하는가」에 답합니다. ①과 ②는 Mac mini에만 있고, ③은 git으로 관리되어 팀원 누구의 노트북에서도 읽을 수 있습니다.

```text
~/issue-agent/                    # ① 런타임 홈
├── scripts/
│   ├── poller.py                 # cron이 깨우는 폴러
│   ├── slack_listener.py         # launchd가 띄워 두는 리스너
│   ├── healthcheck.sh
│   ├── daily_digest.sh
│   └── log_cleanup.sh
├── config/
│   └── rules.json                # 동작 규칙 (비밀값 없음)
├── launchd/
│   └── com.example.issue-agent.listener.plist
└── .venv/

~/.issue-agent/                   # ② 홈 상태 파일
├── secrets.env                   # 비밀값 전용, 권한 600
├── state.json                    # 폴러 상태
├── poller.lock                   # 중복 실행 방지
├── heartbeat/
│   ├── poller
│   └── listener
├── logs/
│   ├── poller.log
│   ├── listener.log
│   └── listener.launchd.err.log
└── runs/
    └── <이슈키>/                  # 이슈별 프롬프트·실행 로그·완료 표지
```

데이터 흐름은 단순합니다. cron이 폴러를 깨우면 폴러가 ①의 규칙과 ②의 비밀값을 읽고, Jira를 조회한 뒤 필요하면 Claude 세션을 띄웁니다. 그 결과는 다시 ②의 상태 파일·하트비트·로그·실행 기록으로 남습니다. 리스너도 같은 설정과 비밀값을 읽어 Slack과 연결을 유지합니다. ③은 실행 경로에 끼지 않고, 사람이 ①과 ②를 해석할 때 펼쳐 보는 문서입니다.

이렇게 나눠 두면 수정 위치를 헷갈리지 않습니다. 동작을 바꾸려면 ①의 규칙 파일을, 토큰을 바꾸려면 ②의 env 파일을, 판독 기준이 틀렸으면 ③의 문서를 고칩니다. 반대로 이 구분이 흐려지면 문서에 적힌 주기와 실제 스케줄이 어긋나도 아무도 알아채지 못합니다. 실제로 메타데이터 설명에는 폴링 주기가 예전 값으로 남아 있었고, 규칙 파일과 crontab은 이미 다른 값으로 바뀌어 있었습니다. 문서는 실행 경로 밖에 있으므로 이런 어긋남은 스스로 드러나지 않습니다. 환경을 문서로 정리할 때는 설계 문서를 옮겨 적지 말고 `crontab -l`과 실제 파일을 열어 실측한 값을 적어야 합니다.

## cron과 launchd: 무엇을 어디에 맡기나

### 판단 기준

기준은 프로세스의 수명입니다.

- **잠깐 돌고 끝나는 작업은 cron**에 맡깁니다. 폴러, 요약 발송, 로그 정리, 헬스체크가 여기에 해당합니다. 정해진 시각에 한 번 실행되고, 끝나면 프로세스가 사라집니다.
- **계속 떠 있어야 하는 프로세스는 launchd**에 맡깁니다. Slack 리스너는 WebSocket 연결을 쥐고 있어야 메시지를 받으므로 종료되면 안 되고, 죽으면 곧바로 다시 떠야 합니다.

폴러를 상주 루프로 만들지 않고 cron으로 매분 깨운 데는 이유가 있습니다. 한 번 돌고 끝나는 구조라 메모리 누수나 꼬인 상태가 다음 실행으로 넘어가지 않고, 코드를 고친 뒤 재시작 절차 없이 다음 실행부터 바로 반영됩니다. 대신 이전 실행이 아직 끝나지 않았을 때 다음 실행이 겹칠 수 있으므로 락 파일이 필요합니다(아래 「상태 파일」 참고).

macOS에서는 cron 대신 launchd의 `StartInterval`이나 `StartCalendarInterval`로 주기 실행을 걸 수도 있습니다. 여기서는 주기 작업이 여러 개이고 한 화면(`crontab -l`)에서 전부 보이는 편이 운영에 유리해서 cron을 택했습니다.

### crontab 예시

```bash
# m h dom mon dow  command
* * * * *     cd $HOME/issue-agent && ./.venv/bin/python scripts/poller.py >> $HOME/.issue-agent/logs/poller.cron.log 2>&1
0 18 * * 1-5  $HOME/issue-agent/scripts/daily_digest.sh   >> $HOME/.issue-agent/logs/digest.log 2>&1
30 4 * * *    $HOME/issue-agent/scripts/log_cleanup.sh    >> $HOME/.issue-agent/logs/cleanup.log 2>&1
0 * * * *     $HOME/issue-agent/scripts/healthcheck.sh    >> $HOME/.issue-agent/logs/health.log 2>&1
@reboot       sleep 60 && $HOME/issue-agent/scripts/healthcheck.sh >> $HOME/.issue-agent/logs/health.log 2>&1
```

`@reboot` 줄은 장비가 재부팅된 직후에 헬스체크를 한 번 돌립니다. 정전이나 OS 업데이트로 재부팅된 뒤 정시가 될 때까지 기다리지 않고 바로 상태를 확인하기 위해서입니다. 부팅 직후에는 네트워크와 VPN이 아직 올라오지 않았을 수 있어 `sleep 60`으로 1분을 기다린 뒤 실행합니다.

잡을 멈출 때는 줄을 지우지 않고 주석으로 바꾸면서 날짜와 사유를 같이 적었습니다.

```bash
# [PAUSED 2026-08-10 사용량 점검 중 — 폴러 일시 정지]
# * * * * *     cd $HOME/issue-agent && ...
# [PAUSED 2026-08-10 폴러 정지에 따른 오알람 방지]
# 0 * * * *     $HOME/issue-agent/scripts/healthcheck.sh ...
```

cron 문법상으로는 그냥 주석이지만, 나중에 「이 잡은 왜 꺼져 있나」를 물을 때 crontab 자체가 답을 줍니다. 그리고 폴러를 멈출 때는 폴러의 생존을 감시하는 헬스체크도 같이 멈춰야 합니다. 그대로 두면 정지가 의도된 것인데도 헬스체크가 매시간 「폴러가 죽었다」고 알립니다.

### cron 환경은 로그인 셸과 다릅니다

cron으로 실행한 스크립트는 터미널에서 직접 실행할 때와 환경이 다릅니다.

- `PATH`가 `/usr/bin:/bin` 정도로 짧습니다. Homebrew나 `~/.local/bin`에 설치한 `claude`, `jq`, `git-lfs` 같은 도구를 찾지 못합니다.
- `.zshrc`나 `.zprofile`을 읽지 않습니다. 셸 설정에서 export한 토큰이나 alias는 없습니다.
- 작업 디렉터리는 홈입니다. 상대 경로로 파일을 열면 의도와 다른 위치를 봅니다.

그래서 스크립트는 셸 설정에 기대지 않고, 필요한 경로와 비밀값을 스스로 읽도록 만들었습니다. 실행 파일은 절대 경로로 부르거나 스크립트 첫머리에서 `PATH`를 직접 지정합니다. 또 macOS에서는 cron이 접근할 수 있는 폴더에 개인정보 보호 제한이 걸릴 수 있으므로, 작업 디렉터리를 「문서」나 「데스크탑」 같은 보호 폴더 밖에 두는 편이 안전합니다.

### launchd plist의 핵심 키

리스너를 띄우는 plist는 아래와 같습니다. `~/Library/LaunchAgents/`에 두면 해당 사용자가 로그인할 때 로드됩니다. 전용 장비에서 자동 로그인을 켜 두면 재부팅 후에도 별도 조작 없이 뜹니다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.example.issue-agent.listener</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; . "$HOME/.issue-agent/secrets.env"; set +a; exec "$HOME/issue-agent/.venv/bin/python" "$HOME/issue-agent/scripts/slack_listener.py"</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/Users/agent/issue-agent/scripts</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/agent/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>/Users/agent/.issue-agent/logs/listener.launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/agent/.issue-agent/logs/listener.launchd.err.log</string>
</dict>
</plist>
```

키마다 이유가 있습니다.

- **`RunAtLoad`**: plist가 로드되는 순간(로그인, `launchctl bootstrap`) 바로 실행합니다.
- **`KeepAlive`**: 프로세스가 어떤 이유로든 끝나면 다시 띄웁니다. 리스너는 「떠 있는 것이 정상」인 프로세스입니다.
- **`ThrottleInterval`**: 재시작 사이의 최소 간격(초)입니다. 시작하자마자 죽는 프로세스가 쉬지 않고 재시작되며 CPU와 로그를 잡아먹는 것을 막습니다.
- **`EnvironmentVariables`**: launchd는 로그인 셸의 `PATH`를 물려주지 않습니다. 필요한 경로를 여기서 직접 넣습니다. 비밀값은 여기에 넣지 않습니다. plist는 ① 계층에 원본을 두고 git으로 관리하기 때문입니다.
- **`ProgramArguments`**: 비밀값은 실행 직전에 env 파일을 읽어 주입하고, `exec`으로 셸을 파이썬 프로세스로 바꿉니다. `exec`을 빼면 launchd가 감시하는 대상이 bash가 되어, 종료 신호와 재시작 판단이 한 단계 어긋날 수 있습니다.
- **`StandardOutPath` / `StandardErrorPath`**: launchd가 받아 적는 표준 출력·표준 에러입니다. 애플리케이션이 직접 남기는 로그와는 별개입니다. 앱 로그 핸들러를 초기화하기 전에 죽으면(예: import 오류, 필수 환경변수 누락) 흔적은 이쪽에만 남습니다. 리스너가 이상하면 두 로그를 모두 봐야 합니다.

`WorkingDirectory`, `PATH`, 로그 경로에는 `$HOME`이나 `~`를 쓸 수 없습니다. plist 값은 셸을 거치지 않으므로 절대 경로로 적어야 합니다. 위 예시에서 `ProgramArguments` 안의 `$HOME`만 동작하는 것은 그 문자열을 bash가 해석하기 때문입니다.

자주 쓰는 명령은 다음과 같습니다.

```bash
PLIST=~/Library/LaunchAgents/com.example.issue-agent.listener.plist
launchctl bootstrap gui/$(id -u) "$PLIST"               # 등록과 기동
launchctl print gui/$(id -u)/com.example.issue-agent.listener | grep -E 'state|pid|last exit'
launchctl kickstart -k gui/$(id -u)/com.example.issue-agent.listener   # 코드 수정 후 재시작
launchctl bootout gui/$(id -u) "$PLIST"                 # 내리기
```

### KeepAlive가 만드는 크래시 루프

`KeepAlive`는 죽은 프로세스를 살려 주지만, 「시작하자마자 죽는」 원인까지 고쳐 주지는 않습니다. 대표적인 경우가 필수 토큰 누락입니다. Slack Socket Mode에 필요한 앱 토큰이 env 파일에 없으면 리스너는 연결을 시도하기도 전에 종료되고, launchd는 `ThrottleInterval` 간격으로 끝없이 다시 띄웁니다. 겉으로는 「launchd에 등록되어 있고 PID도 계속 바뀌니 살아 있다」처럼 보입니다.

이 전제 조건은 plist 주석에도 적어 두었습니다. 덧붙여 상주 프로세스는 시작할 때 필수 환경변수를 먼저 확인하고, 없으면 어떤 이름이 없는지(값이 아니라 이름만) 표준 에러에 한 줄 남긴 뒤 종료하게 만드는 편이 좋습니다. 그 한 줄이 launchd 에러 로그에 쌓이므로 크래시 루프가 생기면 그 로그부터 열어 보면 됩니다. `launchctl print`의 `last exit code`와 `runs` 횟수가 빠르게 늘어나는지도 같이 봅니다.

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

여기서 한 가지 주의할 점이 있습니다. 헬스체크 자신도 cron으로 도는 프로세스이므로, 헬스체크가 죽으면 아무도 알려 주지 않습니다. 헬스체크가 실패를 감지하지 못하고 exit 0으로 끝나는 경로가 남아 있으면 「알림이 없으니 정상」이라는 착각이 생깁니다. 이 문제는 [실패했는데 성공으로 끝나는 시스템 — 종료 코드 0과 fail-open 게이트](/blog/2026/10/07/silent-failure-exit-code-fail-open.html)에서 따로 정리했고, 이 에이전트에서 실제로 겪은 사례는 4편에서 다룹니다.

## 정리

- 전용 Mac mini는 「항상 켜짐, 사내 자원 접근, 바깥으로 나가는 연결만 사용」이라는 조건을 개발자와 같은 작업 환경으로 맞추기 위한 선택이었습니다.
- 파일은 런타임 홈(코드·규칙), 홈 상태 파일(비밀값·상태·하트비트·로그·실행 기록), 지식 자산(문서) 세 계층으로 나눴습니다. 수정 위치와 판독 위치가 분명해집니다.
- 잠깐 돌고 끝나는 작업은 cron, 계속 떠 있어야 하는 프로세스는 launchd에 맡겼습니다. 두 환경 모두 로그인 셸의 `PATH`와 셸 설정을 물려주지 않으므로 스크립트가 경로와 비밀값을 스스로 읽어야 합니다.
- 규칙 파일은 비밀값의 이름만 가리키고, 값은 권한 `600`인 env 파일에만 둡니다. 그래도 주기처럼 두 곳에 나뉘어 있는 값은 어느 쪽이 기준인지 명시해야 합니다.
- 생존 판정은 「스케줄이 켜져 있는가 → 하트비트 mtime과 마지막 성공 시각 → 로그는 원인 확인용」 순서로 합니다.

## 다음 편 예고

2편에서는 폴러가 Jira에서 「지시 댓글」을 골라내는 방법과, 이슈마다 헤드리스 Claude Code 세션을 띄우고 이어 가는 방법을 다룹니다. 자기 댓글에 다시 반응하지 않게 막는 법, 이슈마다 격리된 git worktree에서 작업시키는 이유, `claude -p`에 넘기는 프롬프트와 도구 제한, 세션 재개(resume)를 상태 파일과 묶는 방법을 정리할 예정입니다.
