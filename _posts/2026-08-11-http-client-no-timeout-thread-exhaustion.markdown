---
layout: post
title: "레거시 Java 웹 애플리케이션에서 만난 함정 (1) 타임아웃 없는 외부 HTTP 호출이 스레드를 하나씩 잡아먹는 과정"
date: 2026-08-11 09:00:00 +0900
categories: blog
tags: [Java, Spring, Troubleshooting, Performance]
excerpt: "기본값으로 만든 HTTP 클라이언트가 응답 없는 외부 서버 앞에서 요청 스레드를 영원히 붙잡는 원리와, 스레드 덤프로 알아보는 법, 타임아웃 설정과 최악 대기 시간 계산을 정리합니다."
series: "레거시 Java 웹 애플리케이션에서 만난 함정"
featured: true
summary:
  - "외부 인증 서버가 응답하지 않자 로그인 요청 스레드가 반환되지 않고 쌓였습니다."
  - "기본값으로 만든 HTTP 클라이언트에는 connect·read 타임아웃이 없어 끝없이 기다렸기 때문입니다."
  - "세 타임아웃을 명시하고, 최악 대기 시간은 타임아웃 × 순차 호출 수로 따로 계산했습니다."
---

## 문제와 배경

Tomcat 위에서 도는 레거시 웹 애플리케이션 인스턴스 하나에서 처리 중인 요청 수가 다른 인스턴스보다 눈에 띄게 높게 유지됐습니다. CPU와 DB는 조용했고, 에러 로그에도 특별한 것이 없었습니다. 요청이 실패하는 것이 아니라 **끝나지 않고** 있었습니다.

스레드 덤프를 떠 보니 원인은 한곳으로 모였습니다. 로그인 처리 중 외부 인증 서버를 호출하는 코드가 응답을 기다리며 멈춰 있었고, 같은 지점에 물린 요청 스레드가 여러 개였습니다. 데드락도, 락 경합도 없었습니다. 그 HTTP 클라이언트는 기본값으로 생성돼 있었고, 기본값에는 타임아웃이 없었습니다.

이 글은 그 구조를 일반화해 정리합니다. 왜 스레드가 하나씩 사라지는지, 덤프에서 어떤 모양으로 보이는지, 타임아웃을 어디에 어떻게 두는지, 그리고 타임아웃을 넣은 뒤에도 최악 대기 시간을 따로 계산해야 하는 이유를 다룹니다.

## 기본값으로 만든 클라이언트는 기다림에 끝이 없습니다

Apache HttpClient 4.x에서 가장 흔한 생성 코드는 이렇습니다.

```java
CloseableHttpClient client = HttpClients.createDefault();
```

이렇게 만들면 `RequestConfig`의 세 타임아웃이 모두 정해지지 않은 상태(`-1`)로 남고, 소켓 수준에서는 운영체제와 JDK의 기본값, 곧 **무한 대기**가 적용됩니다.

| 설정 | 의미 | 기본값으로 만들었을 때 |
|---|---|---|
| `connectTimeout` | TCP 연결을 맺을 때까지 기다리는 시간 | 무한 (실제로는 OS의 SYN 재전송 한도에서 끝나는 경우가 많음) |
| `socketTimeout` | 연결 후 다음 데이터가 올 때까지 기다리는 시간 | 무한 |
| `connectionRequestTimeout` | 커넥션 풀에서 연결을 빌릴 때까지 기다리는 시간 | 무한 |

다른 클라이언트도 사정이 비슷합니다. 인자 없는 `new RestTemplate()`은 내부적으로 `HttpURLConnection`을 쓰는데, 여기의 connect·read 타임아웃 기본값도 0, 즉 무한입니다. "설정하지 않으면 적당한 값이 들어 있겠지"라는 기대는 Java의 HTTP 클라이언트 대부분에서 맞지 않습니다.

가장 위험한 경우는 상대 서버가 TCP 연결은 받아 주고 응답은 보내지 않는 상태입니다. 서버 프로세스가 과부하로 멈췄거나, 앞단 장비가 연결만 받아 두고 뒤로 넘기지 못하는 경우가 그렇습니다. 연결이 거부되면 바로 예외가 나지만, 연결된 채 침묵하면 `socketTimeout`이 없는 클라이언트는 끝없이 읽기를 기다립니다.

## 스레드가 하나씩 빠지는 과정

동기 서블릿 모델에서 요청 하나는 Tomcat 워커 스레드 하나를 차지합니다. 외부 호출이 반환되지 않으면 그 스레드도 풀로 돌아가지 않습니다.

1. 사용자가 로그인을 시도합니다. 워커 스레드가 외부 인증 서버로 요청을 보냅니다.
2. 외부 서버가 연결만 받고 응답하지 않습니다. 스레드는 `socketRead0`에서 멈춥니다.
3. 사용자는 기다리다 브라우저를 닫거나 다시 시도합니다. 재시도는 **새 스레드**를 하나 더 붙잡습니다.
4. 앞단 프록시나 로드밸런서가 타임아웃으로 클라이언트 연결을 끊어도, 서버 쪽 스레드는 이를 알지 못한 채 계속 읽기를 기다립니다.
5. 이 과정이 반복되면 워커 풀(`maxThreads`, Tomcat 기본 200)이 줄어들고, 바닥나면 그 인스턴스는 **외부 호출과 무관한 요청까지** 받지 못합니다.

얼마나 빨리 바닥나는지는 간단히 셈해 볼 수 있습니다. 붙잡힌 스레드 수는 대략 "그 경로로 들어오는 요청 속도 × 한 요청이 스레드를 쥐고 있는 시간"입니다. 쥐고 있는 시간이 무한이면, 요청 속도가 아무리 낮아도 시간이 지나면 결국 풀 전체를 덮습니다. 트래픽이 적은 기능이라 괜찮다는 판단이 통하지 않는 이유입니다.

### 상한이 없으면 누적을 막는 장치도 없습니다

커넥션 풀이 있으면 그 상한이 일종의 방파제가 됩니다. `PoolingHttpClientConnectionManager`의 기본값은 대상(route)당 2개, 전체 20개라서, 같은 서버로의 동시 호출은 2개를 넘지 못하고 나머지는 연결을 빌리려고 기다립니다. 물론 `connectionRequestTimeout`도 무한이면 이 대기 역시 끝나지 않지만, 적어도 외부로 나가는 연결 수는 묶입니다.

그런데 요청마다 클라이언트를 새로 만드는 코드라면 이 방파제마저 없습니다. 클라이언트마다 자기 풀을 따로 갖기 때문에 상한이 사실상 사라지고, 붙잡히는 스레드 수에 제한이 없어집니다. 레거시 코드에서 헬퍼 클래스를 `new`로 만들어 쓰는 패턴이 흔한데, 그 헬퍼가 필드로 `HttpClients.createDefault()`를 들고 있다면 이 경우에 해당합니다.

## 스레드 덤프에서 알아보는 법

이 유형은 스택 모양이 독특해서 한 번 보면 알아볼 수 있습니다. 아래는 JDK 8 기준으로, 클래스 이름을 일반화해 재구성한 예입니다.

```text
"http-nio-8080-exec-17" #63 daemon prio=5 os_prio=0 tid=... nid=... runnable [...]
   java.lang.Thread.State: RUNNABLE
        at java.net.SocketInputStream.socketRead0(Native Method)
        at java.net.SocketInputStream.socketRead(SocketInputStream.java:116)
        at java.net.SocketInputStream.read(SocketInputStream.java:171)
        at sun.security.ssl.InputRecord.readFully(InputRecord.java:465)
        ...
        at org.apache.http.impl.io.SessionInputBufferImpl.fillBuffer(...)
        at org.apache.http.impl.conn.DefaultHttpResponseParser.parseHead(...)
        at org.apache.http.impl.DefaultBHttpClientConnection.receiveResponseHeader(...)
        ...
        at com.example.auth.ExternalAuthClient.post(ExternalAuthClient.java:...)
        at com.example.auth.LoginService.login(LoginService.java:...)
```

읽는 요령은 세 가지입니다.

- **상태가 `RUNNABLE`이어도 CPU를 쓰는 것이 아닙니다.** 네이티브 소켓 읽기에서 막힌 스레드는 JVM 입장에서 `RUNNABLE`로 표시됩니다. `BLOCKED`나 `WAITING`만 찾으면 놓칩니다.
- **`receiveResponseHeader`가 핵심 단서입니다.** 요청은 다 보냈고 응답의 첫 줄(상태 줄)조차 받지 못했다는 뜻입니다. 응답 본문을 읽다 멈췄다면 `EntityUtils`나 본문 스트림 읽기 프레임이 보입니다.
- **JDBC·MyBatis 프레임이 없다면 기다리는 대상은 DB가 아닙니다.** 같은 `socketRead0`라도 아래쪽에 JDBC 드라이버 프레임이 있으면 DB 응답 대기이므로 원인이 전혀 다릅니다.

같은 지점에 물린 스레드 수를 세면 누적 규모가 바로 나옵니다.

```bash
# 덤프 두 개를 수십 초 간격으로 떠서, 같은 스레드가 계속 같은 자리에 있는지 봅니다
jstack <pid> > dump1.txt; sleep 30; jstack <pid> > dump2.txt

# 외부 호출 지점에 물린 스레드 수
grep -c 'ExternalAuthClient.post' dump1.txt dump2.txt

# 그중 응답 헤더를 기다리는 스레드 이름
awk '/^"/{name=$1} /receiveResponseHeader/{print name}' dump2.txt | sort -u
```

덤프 한 장은 순간 사진이라 우연히 느린 호출이 찍혔을 수도 있습니다. 시간 간격을 두고 뜬 두 장에서 **같은 스레드 이름이 같은 프레임에** 남아 있다면 지나가는 지연이 아니라 멈춘 것입니다.

### 덤프 다음에 확인할 것

- 호출 대상 URL: 클라이언트 쪽 로그에 남아 있다면 가장 빠릅니다. 없다면 이번 기회에 남기도록 고칩니다(아래 구현 참고).
- 대상 서버의 상태: 연결은 되는데 응답이 없는지, 연결 자체가 안 되는지 `curl -v --max-time 10`으로 직접 확인합니다. 두 경우는 필요한 타임아웃 종류가 다릅니다.
- 한 요청이 외부를 몇 번 호출하는지: 아래 「최악 대기 시간」에서 다룹니다.

## 구현: 타임아웃을 명시하고 응답을 닫습니다

### 핵심 코드

아래는 이 글을 위해 새로 쓴 최소 예시입니다. 원래 코드를 그대로 옮긴 것이 아니며, 이 형태 그대로 실행해 본 것은 아닙니다. Apache HttpClient 4.5 계열 API를 기준으로 했습니다.

```java
public class ExternalAuthClient implements Closeable {

    private static final Logger log = LoggerFactory.getLogger(ExternalAuthClient.class);
    private static final int TIMEOUT_MILLIS = 3000;

    private static final RequestConfig REQUEST_CONFIG = RequestConfig.custom()
            .setConnectTimeout(TIMEOUT_MILLIS)            // TCP 연결 수립
            .setSocketTimeout(TIMEOUT_MILLIS)             // 다음 데이터가 올 때까지
            .setConnectionRequestTimeout(TIMEOUT_MILLIS)  // 풀에서 연결 대여
            .setRedirectsEnabled(false)                   // 리다이렉트는 직접 제한해서 따라갑니다
            .build();

    private final CloseableHttpClient client;

    public ExternalAuthClient() {
        PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
        cm.setMaxTotal(20);
        cm.setDefaultMaxPerRoute(10);
        // 새 연결의 TLS 핸드셰이크 구간까지 소켓 읽기 타임아웃을 겁니다
        cm.setDefaultSocketConfig(SocketConfig.custom().setSoTimeout(TIMEOUT_MILLIS).build());

        this.client = HttpClients.custom()
                .setConnectionManager(cm)
                .setDefaultRequestConfig(REQUEST_CONFIG)
                .build();
    }

    public String post(String url, List<NameValuePair> form) {
        HttpPost post = new HttpPost(url);
        post.setEntity(new UrlEncodedFormEntity(form, StandardCharsets.UTF_8));

        try (CloseableHttpResponse response = client.execute(post)) {
            return EntityUtils.toString(response.getEntity(), StandardCharsets.UTF_8);
        } catch (ConnectTimeoutException e) {
            log.warn("external auth connect timeout: {}", url);
        } catch (SocketTimeoutException e) {
            log.warn("external auth read timeout: {}", url);
        } catch (IOException e) {
            log.warn("external auth call failed: {} ({})", url, e.toString());
        }
        return "";
    }

    @Override
    public void close() throws IOException {
        client.close();
    }
}
```

설정마다 이유가 있습니다.

- **세 타임아웃을 모두 명시합니다.** 이번 같은 장애는 `socketTimeout`이 막아 주지만, 상대 서버의 앞단이 SYN에 응답하지 않으면 `connectTimeout`이, 풀이 가득 차면 `connectionRequestTimeout`이 필요합니다. 하나만 넣으면 나머지 구멍으로 같은 일이 생깁니다.
- **`SocketConfig`의 `soTimeout`도 겁니다.** HttpClient 4.x에서 `RequestConfig`의 `socketTimeout`은 연결이 준비된 뒤에 적용되고, 새 연결을 만드는 단계에서는 연결 관리자의 소켓 설정이 쓰입니다. 세부 동작은 버전에 따라 다르므로, 둘 다 걸어 두는 편이 안전합니다.
- **응답을 반드시 닫습니다.** `try-with-resources`로 응답을 닫아야 연결이 풀로 돌아갑니다. 타임아웃만 넣고 닫기를 빠뜨리면 스레드는 풀려도 연결이 새고, 풀을 쓰는 구성이라면 이번에는 풀 대여 대기로 같은 증상이 재현됩니다.
- **클라이언트는 한 번 만들어 공유합니다.** Spring이라면 빈으로 등록해 싱글턴으로 쓰고, 종료 시 `close()`가 불리게 합니다. 요청마다 만들면 풀의 상한이 의미를 잃습니다.
- **연결 실패와 응답 없음을 나눠 로깅합니다.** `ConnectTimeoutException`은 상대에 닿지 못한 것이고, `SocketTimeoutException`은 닿았는데 답이 없는 것입니다. 원인 추적의 방향이 다릅니다.
- **로그에 요청 파라미터 값을 남기지 않습니다.** 인증 요청의 폼 전체를 찍는 로그는 계정과 비밀번호를 평문으로 남깁니다. URL과 파라미터 이름만으로도 진단에는 충분합니다.

`RestTemplate`을 쓴다면 요청 팩토리에 타임아웃을 넣습니다.

```java
HttpComponentsClientHttpRequestFactory factory =
        new HttpComponentsClientHttpRequestFactory(httpClient);   // 위에서 만든 클라이언트를 재사용
factory.setConnectTimeout(3000);
factory.setReadTimeout(3000);
factory.setConnectionRequestTimeout(3000);
RestTemplate restTemplate = new RestTemplate(factory);
```

### 타임아웃 값은 기다리는 사람을 기준으로 정합니다

처음에는 넉넉하게 60초로 넣었다가 3초로 낮췄습니다. 로그인처럼 사용자가 버튼을 누르고 화면 앞에서 기다리는 동기 흐름이라면, 응답이 몇 초를 넘는 순간 사용자는 이미 떠났거나 다시 누르고 있습니다. 그 뒤에 도착하는 응답은 아무도 받지 않고, 그동안 스레드만 붙잡습니다. 값이 클수록 스레드 회수가 늦어지고 누적 방어 효과가 약해집니다.

대신 대가가 있습니다. **정상이지만 원래 느린 외부 서버는 이제 실패로 떨어집니다.** 위 예시처럼 타임아웃 시 빈 문자열을 돌려주는 구조라면, 호출부는 이를 "인증 실패"로 처리하게 됩니다. 사용자는 비밀번호가 틀렸다는 메시지를 볼 수도 있습니다. 그래서 배포 뒤에는 타임아웃 경고 로그를 지켜보며 특정 대상이 반복해서 걸리는지 확인해야 하고, 가능하면 호출부에서 "응답 없음"과 "인증 거부"를 다른 메시지로 구분하는 편이 좋습니다.

## 최악 대기 시간 = 타임아웃 × 순차 호출 수

타임아웃을 넣었다고 한 요청의 대기 상한이 그 값이 되는 것은 아닙니다. 한 요청 안에서 외부를 여러 번 **순서대로** 호출하면 각각의 타임아웃이 더해집니다.

이번 경우가 그랬습니다. 로그인 한 번이 외부 인증 서버를 세 번 호출했습니다. 세션을 얻기 위한 선행 페이지 GET, 자격증명 POST, 로그인 후 페이지 GET입니다.

| 타임아웃 | 순차 호출 수 | 요청 하나의 최악 대기 |
|---|---|---|
| 3초 | 1 | 3초 |
| 3초 | 3 | 9초 |
| 60초 | 3 | 3분 |

상대가 연결은 받는데 응답하지 않는 상황이라면 세 호출이 차례로 타임아웃까지 기다리므로 실제로 이 상한에 붙습니다. 계산에 넣어야 할 것이 몇 가지 더 있습니다.

- **연결 단계도 더해집니다.** 엄밀히는 호출 하나마다 `connectionRequestTimeout + connectTimeout + socketTimeout`까지 걸릴 수 있습니다. 연결 실패와 응답 없음이 한 호출에서 겹치는 일은 드물지만, 상한을 말할 때는 이 합이 기준입니다.
- **`socketTimeout`은 전체 시간이 아니라 "두 데이터 사이의 공백" 기준입니다.** 상대가 2초마다 몇 바이트씩 흘려보내면 3초 타임아웃은 한 번도 걸리지 않고 응답은 몇 분이 걸릴 수 있습니다. HttpClient 4.x에는 요청 전체 마감 시간 설정이 없으므로, 이것까지 막으려면 별도 스케줄러로 일정 시간 뒤 `HttpRequestBase.abort()`를 부르는 식의 장치를 따로 둬야 합니다.
- **재시도와 리다이렉트는 곱셈입니다.** 재시도 정책이 켜져 있으면 호출 수가 배로 늘고, 리다이렉트를 따라가는 코드에 홉 상한이 없다면 상대가 리다이렉트 루프를 돌려줄 때 타임아웃이 있어도 끝없이 반복됩니다. 앞의 예시에서 리다이렉트 자동 추적을 끈 것은 이 상한을 호출부에서 직접 정하기 위해서입니다.

이렇게 구한 최악 대기 시간을 앞단 프록시와 로드밸런서의 타임아웃과 비교해 봅니다. 앞단이 30초에 끊는데 서버 쪽 최악 대기가 3분이라면, 사용자는 30초에 오류를 보고 서버 스레드는 2분 30초를 더 붙잡혀 있습니다. **앞단 타임아웃은 서버 스레드를 회수해 주지 않습니다.** 클라이언트 연결이 끊겨도 서버는 외부 호출에서 돌아올 때까지 그 사실을 모르기 때문입니다.

## 함정과 트레이드오프

| 선택 | 얻는 것 | 잃거나 주의할 것 |
|---|---|---|
| 짧은 타임아웃 | 스레드 회수가 빠르고 누적이 묶입니다 | 느리지만 정상인 상대가 실패로 처리됩니다 |
| 긴 타임아웃 | 느린 상대도 성공합니다 | 상대가 멈추면 스레드가 오래 묶이고, 순차 호출에서 곱해집니다 |
| 공유 클라이언트 + 풀 상한 | 외부로 나가는 동시 연결 수가 묶입니다 | 풀이 차면 다른 요청이 대여 대기를 합니다. `connectionRequestTimeout`이 반드시 필요합니다 |
| 외부 호출 전용 스레드 풀(벌크헤드) | 외부 장애가 웹 워커 풀 전체로 번지지 않습니다 | 코드 구조가 바뀝니다. 레거시 동기 코드에 넣기에는 변경 범위가 큽니다 |
| 서킷 브레이커 | 상대가 죽은 동안 호출 자체를 건너뜁니다 | 라이브러리 도입이 필요하고, 레거시 Spring 버전과의 호환을 확인해야 합니다 |

레거시 애플리케이션에서는 첫 단계로 타임아웃 명시, 응답 닫기, 클라이언트 공유까지만 해도 변경 범위가 클래스 하나로 끝나는 경우가 많습니다. 벌크헤드나 서킷 브레이커는 그다음에 따져 볼 일입니다.

이 조치는 피해가 번지는 것을 막을 뿐, 상대 서버를 고치지는 못합니다. 응답하지 않는 외부 서버가 무엇인지는 로그로 특정해 그쪽에 알려야 합니다. 또 이미 붙잡혀 있는 스레드는 새 코드가 배포되거나 인스턴스를 재기동해야 풀립니다. 배포 전까지 급하게 막아야 한다면 해당 대상으로의 호출을 설정으로 끄거나, 인스턴스를 순차로 재기동하는 것이 현실적인 완화책입니다.

## 정리

- `HttpClients.createDefault()`, 인자 없는 `new RestTemplate()`처럼 기본값으로 만든 HTTP 클라이언트는 connect·read 타임아웃이 사실상 무한입니다.
- 상대 서버가 연결만 받고 응답하지 않으면 요청 스레드가 영원히 반환되지 않고, 요청 속도가 낮아도 시간이 지나면 워커 풀 전체가 바닥납니다. 요청마다 클라이언트를 새로 만들면 커넥션 풀 상한마저 사라집니다.
- 스레드 덤프에서 `RUNNABLE` 상태의 `socketRead0` + `receiveResponseHeader` + 외부 호출 클래스 조합이 보이고 JDBC 프레임이 없으면 이 유형입니다. 간격을 두고 뜬 두 덤프로 같은 스레드가 머물러 있는지 확인합니다.
- `RequestConfig`의 세 타임아웃과 연결 관리자의 `soTimeout`을 모두 명시하고, 응답은 반드시 닫고, 클라이언트는 공유합니다. 값은 기다리는 사람을 기준으로 정합니다.
- 한 요청의 최악 대기 시간은 타임아웃 × 순차 호출 수이고, 재시도와 리다이렉트는 여기에 곱해집니다. `socketTimeout`은 전체 시간 상한이 아니라는 점도 기억해 둡니다.
