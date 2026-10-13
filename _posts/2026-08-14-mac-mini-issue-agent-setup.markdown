---
layout: post
title: "Mac mini에 이슈 자동 처리 에이전트 상주시키기 (1) 구성과 상주 프로세스"
date: 2026-08-14 09:00:00 +0900
categories: blog
tags: [ClaudeCode, Automation, Monitoring, DevTools]
excerpt: "이슈 트래커를 감시하다가 헤드리스 Claude Code로 이슈를 처리하는 에이전트를 Mac mini 한 대에 올리면서 정한 디렉터리 구성과 cron·launchd 역할 분담을 정리합니다."
series: "Mac mini에 이슈 자동 처리 에이전트 상주시키기"
featured: true
summary:
  - "Jira 댓글을 지시로 받아 Claude Code가 코드를 고치는 에이전트를 전용 Mac mini에 올렸습니다."
  - "잠깐 도는 작업은 cron, 상주하는 Slack 리스너는 launchd에 맡기고 파일은 세 계층으로 나눴습니다."
  - "launchd의 KeepAlive는 죽은 프로세스를 살리지만 시작하자마자 죽는 원인까지 고쳐 주지는 않습니다."
---

## 무엇을 만들었나

Jira 이슈에 사람이 댓글을 남기면, 그 댓글을 지시로 받아 Claude Code가 코드를 고치고 결과를 다시 이슈와 Slack에 알려 주는 에이전트를 만들었습니다. 사람은 이슈 트래커와 Slack만 보고, 실제 작업은 전용 Mac mini 한 대가 처리합니다.

구성 요소는 세 가지입니다.

- **폴러**: 주기적으로 Jira를 조회해서 새 지시 댓글이 달린 이슈를 찾고, 이슈마다 헤드리스 Claude Code(`claude -p`) 세션을 띄웁니다.
- **Slack 리스너**: Slack 스레드에서 에이전트를 멘션하면 그 이슈의 Claude 세션을 이어서 대화합니다. 프로세스가 계속 떠 있어야 합니다.
- **보조 배치**: 하루·한 주 활동 요약 발송, 로그 정리, 헬스체크 같은 짧은 작업입니다.

이 글은 시리즈 첫 편으로, 이 세 가지가 장비 위에 어떻게 놓이는지를 다룹니다. 설정 분리와 생존 판정 규칙은 바로 다음 2편, 이슈를 감지하고 Claude를 실행하는 흐름은 3~4편, 알림과 안전장치는 5~6편, 비용과 운영 중 발견한 조용한 실패는 7~8편에서 이어집니다.

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

## 정리

- 전용 Mac mini는 「항상 켜짐, 사내 자원 접근, 바깥으로 나가는 연결만 사용」이라는 조건을 개발자와 같은 작업 환경으로 맞추기 위한 선택이었습니다.
- 파일은 런타임 홈(코드·규칙), 홈 상태 파일(비밀값·상태·하트비트·로그·실행 기록), 지식 자산(문서) 세 계층으로 나눴습니다. 수정 위치와 판독 위치가 분명해집니다.
- 잠깐 돌고 끝나는 작업은 cron, 계속 떠 있어야 하는 프로세스는 launchd에 맡겼습니다. 두 환경 모두 로그인 셸의 `PATH`와 셸 설정을 물려주지 않으므로 스크립트가 경로와 비밀값을 스스로 읽어야 합니다.

## 다음 편 예고

2편에서는 두 파일로 동작을 제어하는 설정 구조(규칙 파일과 비밀값 파일), 상태·로그·하트비트 파일의 역할, 그리고 「지금 에이전트가 살아 있나」를 로그가 아니라 스케줄과 하트비트 mtime으로 판정하는 순서를 다룹니다.
