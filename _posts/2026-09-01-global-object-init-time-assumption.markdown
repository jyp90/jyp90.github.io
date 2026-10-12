---
layout: post
title: "브라우저와 URL에서 조용히 어긋나는 것들 (2) 초기화 시점에 전역 객체를 단정하는 함정"
date: 2026-09-01 09:00:00 +0900
categories: blog
tags: [JavaScript, 웹, 장애대응, 프론트엔드]
excerpt: "전역 객체가 있는지를 초기화 시점에 상수로 굳혀 두면 스크립트 로드 순서가 바뀌는 순간 기능이 에러 없이 사라지는 이유와, 확인 방법·교정 방법을 정리합니다."
---

> **시리즈: 브라우저와 URL에서 조용히 어긋나는 것들**
>
> 1. [(1) 뒤로가기 bfcache와 어긋나는 폼 상태](/blog/2026/08/04/bfcache-back-navigation-form-state.html)
> 2. **(2) 초기화 시점에 전역 객체를 단정하는 함정**
> 3. [(3) URL 정규화 301의 두 가지 부작용](/blog/2026/09/17/url-normalization-301-side-effects.html)

## 문제와 배경

서버가 렌더링하는 페이지에서는 공통 기능을 전역 객체로 노출하는 경우가 많습니다. 열린 레이어를 한곳에서 관리하는 `window.OverlayManager` 같은 객체를 공통 스크립트가 만들고, 각 화면의 스크립트는 그 객체가 있으면 거기에 자기 레이어를 등록하는 식입니다.

이때 흔히 쓰는 방어 코드가 있습니다.

```javascript
// 스크립트 상단, 초기화 시점에 한 번 평가됩니다
var hasManager = typeof window.OverlayManager !== 'undefined';

if (hasManager) {
  window.OverlayManager.register('top-menu', { onClose: closeMenu });
}

function openMenu() {
  panel.hidden = false;
  if (hasManager) {
    window.OverlayManager.open('top-menu');
  }
}
```

전역이 없는 페이지에서도 에러가 나지 않게 하려는 의도는 좋습니다. 문제는 `hasManager`가 **이 줄이 실행되는 순간의 사실**을 영구히 굳혀 둔다는 점입니다. 이 스크립트가 공통 스크립트보다 먼저 실행되면 `hasManager`는 `false`가 되고, 몇 밀리초 뒤에 `OverlayManager`가 생겨도 값은 바뀌지 않습니다. 등록도 일어나지 않습니다. 메뉴는 열리고 닫히지만, 레이어 관리자가 제공하던 기능(Escape로 닫기, 다른 레이어를 열 때 자동으로 닫기, 배경 클릭으로 닫기)은 그 메뉴에서만 통째로 사라집니다.

## 실행 순서는 생각보다 자주 바뀝니다

이 코드는 작성할 때는 맞았을 가능성이 큽니다. 공통 스크립트가 `<head>`에 있고 화면 스크립트가 본문 끝에 있으면 순서가 보장되기 때문입니다. 그런데 다음 중 하나만 일어나도 전제가 깨집니다.

| 변화 | 결과 |
|---|---|
| 화면 조각(헤더, 메뉴)을 공통 레이아웃으로 옮기면서 인라인 스크립트가 문서 앞쪽에 들어감 | 인라인이 외부 스크립트보다 먼저 실행됩니다 |
| 공통 스크립트에 `defer`나 `async`를 붙임 | `defer`는 파싱이 끝난 뒤, `async`는 다운로드가 끝나는 대로 실행되어 인라인보다 늦어집니다 |
| 공통 스크립트를 `type="module"`로 바꿈 | 모듈 스크립트는 기본적으로 `defer`처럼 동작합니다 |
| 공통 스크립트를 다른 스크립트가 동적으로 삽입하거나 태그 매니저가 넣음 | 실행 시점이 네트워크 상황에 따라 달라집니다 |

파서를 막는 일반 `<script>`는 문서에 나온 순서대로 실행됩니다. 인라인 스크립트도 마찬가지로 만나는 즉시 실행됩니다. 따라서 **문서상 위치**가 곧 실행 순서이고, 레이아웃 공통화처럼 기능과 무관해 보이는 변경이 그 위치를 바꿉니다.

## 왜 조용한가

이 결함은 발견이 늦습니다. 세 가지 확인 수단이 모두 「정상」을 가리키기 때문입니다.

- **콘솔이 깨끗합니다.** 예외가 아니라 `if` 분기를 건너뛴 것이라 에러가 한 줄도 남지 않습니다. 방어 코드가 하는 일이 원래 그것입니다.
- **정적 점검을 통과합니다.** 소스에는 `OverlayManager.open(...)` 호출이 그대로 있습니다. 코드에 특정 호출이 있는지를 grep으로 세는 점검은 「적용됨」을 표시합니다.
- **눈으로 보는 검수도 통과합니다.** 메뉴가 열리고 닫히는 동작 자체는 화면 스크립트가 직접 하므로 멀쩡합니다. 사라진 것은 Escape나 다른 레이어와의 상호작용처럼 일부러 시험해야 보이는 부분입니다.

방어 코드가 실패를 「해당 없음」으로 바꿔 삼키는 구조입니다. 실제로 겪은 사례에서도 메뉴 두 개가 관리자에 등록되지 않은 상태로 몇 주를 지냈고, 그동안 코드 기반 상태 점검은 계속 「적용됨」을 표시했습니다.

## 확인 방법

### 렌더된 HTML에서 두 지점의 위치를 비교합니다

소스 파일이 아니라 서버가 실제로 내려준 HTML을 봐야 합니다. 템플릿 조합을 거치면 소스만으로는 순서를 알기 어렵습니다.

```bash
curl -s "https://example.com/some/page" -o page.html
python3 - <<'PY'
html = open('page.html', encoding='utf-8').read()
print('공통 스크립트 로드 위치:', html.find('overlay-manager.js'))
print('존재 검사 위치         :', html.find('typeof window.OverlayManager'))
PY
```

존재 검사 쪽 숫자가 더 작으면 그 인라인 코드가 먼저 실행된다는 뜻입니다. 공통 스크립트에 `defer`·`async`·`type="module"`이 붙어 있다면 위치와 상관없이 늦게 실행되므로 함께 확인합니다.

### 브라우저에서 등록 여부를 직접 봅니다

관리자 객체가 등록 목록을 들고 있다면 개발자 도구 콘솔에서 내 id가 있는지 확인합니다. 아래의 `_entries`는 예시 이름이며, 실제 내부 구조는 관리자 구현에 따라 다릅니다.

```javascript
Object.keys(window.OverlayManager._entries).includes('top-menu');
// false 이면 등록되지 않은 상태입니다
```

다른 레이어는 모두 있는데 내 것만 빠져 있다면 이 함정일 가능성이 높습니다. 정적 점검으로는 잡히지 않으므로, 실행 순서가 의심될 때는 브라우저에서 재현해 확인하는 수밖에 없습니다.

## 교정 방법

원칙은 하나입니다. **전역이 있는지는 쓰는 순간에 묻습니다.** 다만 상수 한 줄만 고치면 등록과 리스너 문제가 남으므로 세 군데를 함께 봐야 합니다. 아래 코드는 설명을 위해 새로 작성한 예시이며, 이 형태 그대로 실행해 보지는 않았습니다.

### 1. 상수를 호출 시점 조회로 바꾸고, 등록도 첫 사용 때로 미룹니다

```javascript
var registered = false;

function getManager() {
  var manager = window.OverlayManager;
  if (manager && !registered) {
    manager.register('top-menu', { onClose: closeMenu });
    registered = true;
  }
  return manager; // 없으면 undefined, 판단은 호출하는 쪽이 합니다
}

function openMenu() {
  panel.hidden = false;
  var manager = getManager();
  if (manager) {
    manager.open('top-menu');
  }
}
```

`register`를 초기화 시점에 그대로 두면 `hasManager`를 함수로 바꿔도 등록이 끝내 일어나지 않습니다. 조회와 등록을 한 함수에 묶어 두면 전역이 생긴 뒤 첫 사용 때 등록이 따라옵니다.

### 2. 리스너는 조건 없이 달고, 판단은 핸들러 안에서 합니다

```javascript
// 나쁜 예: 초기화 시점에 전역이 없으면 리스너 자체가 없습니다
// if (typeof window.OverlayManager === 'undefined') return;

document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  var manager = getManager();
  if (!manager) return;
  manager.closeTop();
});
```

`return`으로 리스너 등록을 건너뛰면, 나중에 전역이 로드되어도 이벤트를 받을 곳이 없습니다. 리스너를 다는 비용은 거의 없으니 항상 달고, 전역 여부는 이벤트가 왔을 때 확인합니다. 이것이 사용 지점에서 하는 기능 감지(feature detection)입니다.

### 3. 이미 열린 상태로 시작한 경우를 따라잡습니다

사용자 조작이 공통 스크립트보다 먼저 일어날 수도 있습니다. 마우스를 메뉴 위에 둔 채 새로고침하면, 브라우저가 페이지를 그리면서 그 좌표의 요소에 `mouseenter`를 발생시켜 인라인 스크립트만으로 메뉴가 열리는 것을 관찰했습니다. 이 동작이 브라우저마다 같다고 보장하는 문서를 확인하지는 못했습니다. 이렇게 열린 메뉴는 관리자가 모르는 상태로 남습니다.

```javascript
function syncIfAlreadyOpen() {
  if (panel.hidden) return;
  var manager = getManager();
  if (manager) {
    manager.open('top-menu');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', syncIfAlreadyOpen);
} else {
  syncIfAlreadyOpen();
}
```

`DOMContentLoaded`는 파서를 막는 스크립트와 `defer` 스크립트가 모두 실행된 뒤에 발생하므로, 공통 스크립트가 그런 방식으로 로드된다면 이 시점에는 전역이 있습니다. `async`나 동적 삽입이라면 이 보장이 없으므로 다음 방법이 필요합니다.

### 공통 스크립트를 고칠 수 있다면 준비 신호를 제공합니다

로드 시점을 예측할 수 없는 구조라면, 공통 스크립트 쪽에서 「준비됐다」는 신호를 내보내는 편이 근본적입니다.

```javascript
// 공통 스크립트 끝
window.OverlayManager = createOverlayManager();
document.dispatchEvent(new CustomEvent('overlay-manager:ready'));
```

```javascript
// 화면 스크립트
function whenManagerReady(callback) {
  if (window.OverlayManager) {
    callback(window.OverlayManager);
    return;
  }
  document.addEventListener('overlay-manager:ready', function () {
    callback(window.OverlayManager);
  }, { once: true });
}

whenManagerReady(function () {
  getManager(); // 등록을 수행합니다
  syncIfAlreadyOpen();
});
```

이벤트만 기다리면 이미 지나간 이벤트를 놓치므로, 먼저 전역이 있는지 보고 없을 때만 기다리는 것이 핵심입니다. 같은 일을 `Promise`로 감싸 `window.overlayManagerReady.then(...)` 형태로 제공해도 됩니다. Promise는 이미 이행된 뒤에 `then`을 붙여도 콜백이 실행되므로 「먼저 확인하고 기다리기」를 호출하는 쪽마다 반복하지 않아도 됩니다.

## 함정과 트레이드오프

**고친 뒤에 새 증상이 드러날 수 있습니다.** 관리자 기능이 되살아나면 그동안 가려져 있던 상호작용 문제가 보입니다. 실제 사례에서는 Escape로 메뉴를 닫는 순간 마우스 아래 요소가 다시 메뉴 트리거가 되면서 `mouseenter`가 다시 발생해 메뉴가 곧바로 다시 열렸습니다. 명시적으로 닫은 직후에는 hover로 다시 여는 것을 잠시 막고, 포인터가 트리거를 벗어나는 즉시 그 억제를 풀어야 합니다. 메뉴 영역 전체를 벗어날 때까지 기다리면, 옆 항목을 거쳐 돌아왔을 때 메뉴가 열리지 않는 반대 문제가 생깁니다.

**호출 시점 조회는 공짜에 가깝지만 등록 시점이 늦어집니다.** 첫 사용 때 등록하는 방식에서는 사용자가 한 번도 메뉴를 건드리지 않으면 관리자 쪽 목록에 메뉴가 없습니다. 관리자가 「등록된 레이어 전체 닫기」 같은 기능을 제공한다면, 준비 신호에서 등록까지 해 두는 쪽이 안전합니다.

**정적 점검은 이 종류의 결함을 잡지 못합니다.** 「코드에 호출이 있다」는 것과 「실행 시점에 그 호출이 일어난다」는 것은 다른 사실입니다. 대신 같은 모양의 코드가 새로 들어오는 것은 막을 수 있습니다. 변경분 리뷰 단계에서 아래 패턴을 경고로 걸어 두면 됩니다.

```bash
git diff --cached -U0 -- '*.js' '*.html' \
  | grep -nE '^\+.*(var|let|const)[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[[:space:]]*typeof[[:space:]]+window\.'
```

이 검사는 「전역 존재 여부를 변수에 담는 줄」만 찾습니다. 초기화 시점의 `if (typeof window.X === 'undefined') return;`처럼 상수 없이 같은 일을 하는 코드는 따로 검토해야 합니다.

## 정리

- 전역 객체가 있는지는 초기화 시점이 아니라 사용하는 순간에 확인합니다. 초기화 시점에 굳힌 `false`는 다시는 바뀌지 않습니다.
- 등록과 리스너도 같은 원칙을 따릅니다. 등록은 첫 사용이나 준비 신호 시점으로 미루고, 리스너는 조건 없이 달아 핸들러 안에서 판단합니다.
- 로드 전에 이미 열린 상태는 `DOMContentLoaded`나 준비 신호에서 따라잡습니다.
- 이 결함은 콘솔, 정적 점검, 눈 검수를 모두 통과합니다. 실행 순서가 의심되면 렌더된 HTML에서 위치를 비교하고 브라우저에서 등록 상태를 직접 확인합니다.
