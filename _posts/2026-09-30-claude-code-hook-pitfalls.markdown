---
layout: post
title: "Claude Code 훅을 직접 써 보며 부딪힌 함정 6가지"
date: 2026-09-30 09:00:00 +0900
categories: blog
tags: [JavaScript, ClaudeCode, Performance, DevTools]
excerpt: "세션마다 한 번만 안내를 넣는 Claude Code 훅을 만들면서 겪은 병렬 발화 경합, 플랫폼 차이, 실패 이벤트, 타임아웃 단위, 압축 뒤 재주입, 주입 확인 방법을 해결 패턴과 함께 정리합니다."
summary:
  - "세션당 한 번만 안내를 넣는 Claude Code 훅이 중복 주입되거나 누락됐습니다."
  - "병렬 도구 호출의 경합, Bash로 가는 탐색, 분리된 실패 이벤트, 압축 후 문맥 소실이 원인이었습니다."
  - "대상별 표지 파일을 O_EXCL로 원자적으로 선점하고 이벤트별로 훅을 등록해 해결했습니다."
---

## 상황

Claude Code 훅은 대개 수십 줄짜리 스크립트입니다. 표준 입력으로 JSON을 받고, 필요하면 JSON을 출력하고, 종료 코드로 결과를 알립니다. 그래서 처음에는 가볍게 봤습니다.

만들려던 훅은 단순했습니다. 에이전트가 특정 디렉터리의 파일을 처음 건드리면, 그 디렉터리에 관한 참고 안내(관련 문서 위치, 주의할 점)를 문맥에 한 번 넣어 주는 훅입니다. 같은 세션에서 두 번째부터는 조용히 넘어가야 합니다.

그런데 하네스가 훅을 언제, 몇 번, 어떤 이벤트로 부르는지 정확히 모르고 쓰니 훅이 오류 없이 틀린 동작을 했습니다. 안내가 여러 번 들어가기도 하고, 정작 필요한 순간에는 아예 들어가지 않기도 했습니다. 아래 여섯 가지는 그 과정에서 재현하고 고친 함정입니다. 공식 문서(hooks, tools reference)에 근거가 있는 내용은 그 출처도 함께 적었습니다.

설정 예시는 모두 플러그인의 `hooks/hooks.json` 기준이고, 스크립트는 Node.js로 썼습니다.

## 1. 병렬 도구 호출이면 PostToolUse 훅도 동시에 뜹니다

### 증상

「세션당 한 번만 넣는다」는 훅이 같은 안내를 서너 번 넣었습니다. 반대로 이미 넣었다고 기록해 둔 대상을 잊어버리고 다시 넣는 일도 있었습니다.

### 원인

`PostToolUse`는 도구 호출 하나마다 한 번씩 발화합니다. 에이전트가 한 메시지 안에서 파일 여러 개를 동시에 읽으면 훅 프로세스도 그 수만큼 동시에 뜹니다. 공식 문서도 병렬 도구 호출 때 이 훅이 동시에 실행된다고 밝히고 있습니다.

처음 구현은 상태를 JSON 파일 하나에 모아 두고 「읽기 → 대상 추가 → 쓰기」를 했습니다. 잠금이 없으니 프로세스 여러 개가 같은 시점의 파일을 읽고 각자 덮어씁니다. 같은 대상을 여러 프로세스가 동시에 처리하면 모두 「아직 안 넣었다」고 판단해 중복 주입이 일어나고, 서로 다른 대상이면 나중에 쓴 쪽이 앞의 기록을 지웁니다. 운이 나쁘면 JSON 자체가 반쯤 쓰인 채로 깨집니다.

동시 실행을 수십 번 반복하는 재현 스크립트를 돌려 보니 거의 매번 이 증상이 나왔습니다. 가끔 생기는 일이 아니었습니다.

### 해결: 대상마다 표지 파일을 원자적으로 선점합니다

공유 상태 파일을 고치는 대신, 대상 하나당 빈 파일 하나를 `O_CREAT | O_EXCL`로 만듭니다. 운영체제가 「없을 때만 생성」을 원자적으로 보장하므로, 파일을 만든 프로세스 하나만 이깁니다. 이긴 프로세스만 안내를 넣고 나머지는 건너뜁니다.

```javascript
const fs = require('fs');
const path = require('path');

// 세션 ID 같은 외부 값이 경로에 들어가므로 허용 문자만 남깁니다.
function sanitize(value) {
  const cleaned = String(value).replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

function claimOnce(stateDir, sessionId, targetKey) {
  const file = path.join(stateDir, `${sanitize(sessionId)}-${sanitize(targetKey)}`);
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.closeSync(fs.openSync(file, 'wx')); // 'wx': 이미 있으면 EEXIST로 실패
    return true;
  } catch {
    return false;
  }
}
```

`catch`에서 `EEXIST`가 아닌 오류(쓰기 권한 없음 등)도 `false`로 처리한 데는 이유가 있습니다. 상태를 기록할 수 없는 환경에서 `true`를 돌려주면 도구를 호출할 때마다 같은 안내가 쏟아집니다. 기록을 못 하면 차라리 침묵하는 편이 낫습니다.

참고로 「임시 파일에 쓰고 rename」 패턴은 JSON이 깨지는 것만 막아 줍니다. 두 프로세스가 모두 「아직 없음」으로 판단하는 경합은 그대로 남으므로, 중복 주입을 막으려면 선점 방식이 필요합니다.

## 2. macOS·Linux에서는 탐색이 Grep·Glob이 아니라 Bash로 갑니다

### 증상

matcher를 `Read|Grep|Glob`으로 걸었는데, 에이전트가 코드를 한창 탐색할 때도 훅이 거의 뜨지 않았습니다.

### 원인

tools reference 문서에 따르면 macOS, Linux, WSL에서는 Grep과 Glob이 기본 도구 목록에서 빠져 있고, 에이전트는 Bash 도구로 `find`와 `grep`을 실행해 탐색합니다. 이 탐색은 훅과 권한 규칙에도 `Bash` 호출로 전달됩니다. 결국 `Grep|Glob` matcher는 이 환경에서 거의 일하지 않습니다.

### 해결: Bash 명령 문자열에서 경로를 뽑습니다

경로를 보고 판단하는 훅이라면 matcher에 `Bash`를 넣고 `tool_input.command`를 읽습니다. 단, 이 문자열은 **읽기만 하고 절대 실행하거나 셸로 해석하지 않습니다.**

```javascript
const SHELL_SPECIAL = /[*?[\]{}$`]/;

function pathTokens(command) {
  // 공백, 따옴표, =, (, :, 셸 메타문자를 경계로 자릅니다.
  // 그래서 -C dir, "dir/file", --path=dir/file 모두 잡힙니다.
  return String(command)
    .split(/[\s"'=(:;|&<>]+/)
    .filter((t) => t.includes('/') && !SHELL_SPECIAL.test(t));
}

function targetsOf(command, resolveTarget) {
  const targets = new Set(pathTokens(command).map(resolveTarget).filter(Boolean));
  // 한 명령이 대상을 여럿 가리키면 일괄 작업으로 보고 넣지 않습니다.
  return targets.size >= 3 ? [] : [...targets];
}
```

글롭이나 변수 전개(`*`, `$DIR`, `{a,b}`)가 들어간 토큰은 실제로 어떤 경로가 될지 알 수 없으므로 대상에서 뺐습니다. 또 반복문 하나가 여러 디렉터리를 훑는 명령에서 안내 수십 개가 한꺼번에 들어가지 않도록, 대상이 일정 개수 이상이면 침묵하게 했습니다.

이 방식에도 한계는 있습니다. grep 패턴이나 커밋 메시지 안에 들어간 경로 모양 문자열도 잡히고, `cd`로 옮겨 간 위치는 따라가지 않습니다. 그래도 명령을 실행할 위험이 전혀 없다는 점이 더 중요하다고 판단했습니다.

## 3. 실패한 도구 호출은 PostToolUseFailure로 갑니다

### 증상

일치하는 줄이 없어 종료 코드 1로 끝난 `grep`이나, 없는 경로를 `ls`한 뒤에는 훅이 아무것도 넣지 않았습니다. 탐색 초반에는 이런 「실패」가 오히려 흔합니다.

### 원인

실행을 시작한 도구가 실패하면 하네스는 `PostToolUse`가 아니라 `PostToolUseFailure` 이벤트를 발화합니다. Bash에서는 0이 아닌 종료 코드가 실패에 해당합니다. 입력에는 `tool_name`과 `tool_input`이 그대로 들어 있고 `error` 같은 필드가 더해지며, 이 이벤트도 `additionalContext`를 받을 수 있습니다.

### 해결: 같은 스크립트를 두 이벤트에 등록합니다

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read|Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/inject-once.js", "timeout": 10 }]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "Read|Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/inject-once.js", "timeout": 10 }]
      }
    ]
  }
}
```

출력의 `hookSpecificOutput.hookEventName`은 필수 필드이므로, 입력으로 받은 이벤트 이름을 그대로 돌려줍니다.

```javascript
function emit(input, text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name, // PostToolUse 또는 PostToolUseFailure
      additionalContext: text,
    },
  }));
}
```

다만 실행 전에 거절된 호출(알 수 없는 도구 이름, 입력 검증 실패, 권한 거부)은 두 이벤트 어느 쪽도 발화하지 않습니다. 이 경우까지 잡으려면 `PreToolUse`를 써야 합니다.

## 4. `timeout`의 단위는 초입니다

훅 설정의 `timeout`은 밀리초가 아니라 **초** 단위이고, 지정하지 않으면 command 훅은 600초입니다.

다른 도구의 습관대로 `"timeout": 10000`이라고 적으면 약 2시간 47분입니다. 평소에는 훅이 금방 끝나니 차이가 드러나지 않습니다. 그러다 표준 입력이 닫히지 않거나 네트워크 드라이브에서 파일 상태 조회가 멈추는 날, 세션이 그 시간만큼 붙잡힙니다.

판정만 하는 짧은 훅이라면 `10` 정도면 충분합니다. 직접 재 보니 Node.js 훅 한 번이 수십 밀리초 걸렸고, 그 대부분은 런타임 기동 시간이었습니다. 기존 훅을 점검할 때 `timeout` 값이 네 자리 이상이면 단위를 착각한 것인지 먼저 의심해 볼 만합니다.

## 5. 문맥 압축 뒤에는 넣은 안내가 사라집니다

### 증상

「이미 넣었음」 표지는 세션이 끝날 때까지 남습니다. 그런데 `/compact`나 자동 압축이 일어나면 앞서 넣은 안내도 요약 과정에서 문맥에서 빠집니다. 표지는 남아 있으니 훅은 다시 넣지 않습니다. 세션이 길어질수록, 즉 안내가 가장 필요할 때 훅이 침묵하게 됩니다.

### 해결: SessionStart(compact)에서 표지를 지웁니다

`SessionStart`는 `source` 필드로 시작 사유(`startup`, `resume`, `clear`, `compact`)를 알려 줍니다. 같은 스크립트를 matcher `compact`로 붙이고, 압축으로 시작된 경우에만 그 세션의 표지를 지웁니다.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [{ "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/inject-once.js", "timeout": 10 }]
      }
    ]
  }
}
```

```javascript
function resetAfterCompact(stateDir, input) {
  if (input.hook_event_name !== 'SessionStart' || input.source !== 'compact') return;
  const prefix = `${sanitize(input.session_id)}-`;
  for (const name of fs.readdirSync(stateDir)) {
    if (name.startsWith(prefix)) fs.rmSync(path.join(stateDir, name), { force: true });
  }
}
```

세션 ID는 길이가 고정된 UUID이므로 「세션 ID + 구분자」 접두로 지워도 다른 세션의 표지와 겹치지 않습니다. `startup`이나 `resume`에서는 지우지 않습니다. 재개된 세션은 이전 문맥을 그대로 갖고 있기 때문입니다.

## 6. 주입이 실제로 들어갔는지 확인하는 방법

### 서브에이전트에서도 훅이 돕니다

공식 문서에 따르면 설정 파일과 플러그인의 훅은 서브에이전트 안에서도 실행됩니다. 이때 입력에 `agent_id`와 `agent_type`이 들어오고, 메인 스레드에서는 이 필드가 없습니다.

서브에이전트는 부모의 문맥을 물려받지 않습니다. 따라서 중복 방지 키에 에이전트 식별자를 넣어 에이전트마다 한 번씩 받게 해야 합니다.

```javascript
const scope = input.agent_id ? sanitize(input.agent_id) : 'main';
const key = `${scope}-${targetKey}`;
```

내장 Explore·Plan 같은 일부 에이전트는 `CLAUDE.md`를 읽어 들이지 않습니다. 이런 에이전트에게 규칙을 전하려면 `CLAUDE.md`보다 훅 주입이 더 확실한 경로입니다.

### 세션 기록으로 확인합니다

훅이 「잘 돈 것 같다」는 느낌만으로는 부족합니다. 세션 기록 파일(`~/.claude/projects/<프로젝트>/<세션>.jsonl`)을 보면 훅 관련 줄이 `type: "attachment"`로 남습니다. 직접 확인한 형태는 대략 이렇습니다.

```json
{"type":"attachment","attachment":{"type":"hook_success","hookEvent":"PostToolUse","toolUseID":"...","stdout":"..."}}
{"type":"attachment","attachment":{"type":"hook_additional_context","hookEvent":"PostToolUse","toolUseID":"...","content":["..."]}}
```

첫 줄은 훅이 성공적으로 끝났다는 기록이고, 두 번째 줄이 실제로 문맥에 들어간 내용입니다. 주입 횟수를 세려면 두 번째를 셉니다. `toolUseID`로 어느 도구 호출 뒤에 들어갔는지도 이을 수 있습니다.

```bash
# 한 세션에서 실제로 문맥에 들어간 훅 주입 횟수
jq -c 'select(.type=="attachment" and .attachment.type=="hook_additional_context")
       | {event: .attachment.hookEvent, tool: .attachment.toolUseID}' session.jsonl | wc -l
```

이 기록 형식은 공식 문서에 명시된 계약이 아니라 직접 관찰한 결과이므로, 버전이 바뀌면 다시 확인해야 합니다.

## 다른 프로젝트에 적용하려면

여섯 가지 외에, 훅을 만들며 지키게 된 원칙이 몇 가지 있습니다.

- **훅은 절대 작업을 막지 않습니다.** 깨진 입력, 없는 파일, 파싱 실패 등 어떤 오류든 조용히 `exit 0`으로 끝냅니다. 안내를 넣는 훅이 도구 호출을 막으면 원래 작업보다 피해가 큽니다.

  ```javascript
  async function main() {
    try {
      const input = JSON.parse(await readStdin());
      run(input);
    } catch {
      // 판정 훅은 실패해도 침묵합니다.
    }
    process.exit(0);
  }
  ```

- **넣을 내용을 훅 안에 복사하지 않습니다.** 원본 문서가 있으면 실행할 때마다 그 문서를 읽습니다. 파일 하나 읽는 비용은 몇 밀리초입니다. 복사본을 두면 언젠가 문서와 훅이 어긋납니다. 대신 실제 문서를 훅과 같은 파서로 읽는 테스트를 두어, 문서 형식이 바뀌면 테스트가 깨지게 합니다.
- **경합 테스트는 표준 입력을 한꺼번에 닫습니다.** 프로세스를 하나씩 띄워 입력을 넣으면 판정 구간이 겹치지 않아, 「확인 후 쓰기」 같은 결함이 테스트를 통과합니다. 모든 프로세스를 띄워 입력 대기 상태로 세워 둔 뒤 동시에 표준 입력을 닫아야 경합이 재현됩니다.
- **테스트가 결함을 잡는지도 확인합니다.** 일부러 결함을 하나씩 심은 복사본으로 테스트를 돌려 실패하는지 봅니다. 처음 쓴 테스트는 심어 둔 결함 상당수를 그대로 통과시켰습니다. 서로 접두가 되는 이름처럼 경계에 걸린 사례가 테스트 데이터에 없었기 때문입니다.

## 정리

| 함정 | 해결 패턴 |
|---|---|
| 병렬 도구 호출 때 훅이 동시에 실행됨 | 대상별 표지 파일을 `O_EXCL`로 선점 |
| macOS·Linux에서 탐색이 Bash로 감 | matcher에 `Bash`, 명령 문자열에서 경로만 추출(실행 금지) |
| 실패한 호출은 다른 이벤트 | `PostToolUseFailure`에도 같은 스크립트 등록, `hookEventName` 그대로 반환 |
| `timeout` 단위 착각 | 초 단위, 짧은 훅은 10초 안팎 |
| 압축 뒤 안내 소실 | `SessionStart` matcher `compact`에서 그 세션 표지 삭제 |
| 주입 여부 불확실 | 서브에이전트별 키, 세션 기록의 `hook_additional_context`로 확인 |

훅은 하네스의 실행 모델 위에서 도는 코드입니다. 스크립트 자체보다 「언제, 몇 번, 어떤 이벤트로 불리는가」를 먼저 확인하고, 그 확인을 재현 테스트로 남겨 두는 편이 결국 시간을 아낍니다.
