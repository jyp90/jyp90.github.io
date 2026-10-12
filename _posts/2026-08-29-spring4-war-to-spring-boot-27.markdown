---
layout: post
title: "레거시 Java 웹 애플리케이션에서 만난 함정 (3) Spring 4 WAR를 Spring Boot 2.7로 옮길 때의 함정"
date: 2026-08-29 09:00:00 +0900
categories: blog
tags: [Java, Spring, Spring Boot, Tomcat, 마이그레이션]
excerpt: "Spring 4 WAR 애플리케이션을 Spring Boot 2.7로 옮길 때 컨텍스트 병합, ErrorPageFilter, 내장·외부 톰캣의 비대칭에서 생기는 함정과 확인 방법을 정리합니다."
---

> **시리즈: 레거시 Java 웹 애플리케이션에서 만난 함정**
>
> 1. [(1) 타임아웃 없는 외부 HTTP 호출이 스레드를 하나씩 잡아먹는 과정](/blog/2026/08/11/http-client-no-timeout-thread-exhaustion.html)
> 2. [(2) Integer == 비교가 127까지만 맞는 이유](/blog/2026/08/22/java-wrapper-equality-127.html)
> 3. **(3) Spring 4 WAR를 Spring Boot 2.7로 옮길 때의 함정**
> 4. [(4) 로컬 기동 100초를 커넥션 풀 설정 하나로 좁히기](/blog/2026/09/12/local-startup-connection-pool-bisect.html)

## 문제와 배경

JDK 8, Spring 4.3, JSP, 외부 톰캣에 올리는 WAR 패키징으로 된 레거시 웹 애플리케이션을 Spring Boot 2.7로 옮겼습니다. 목표 버전은 고를 여지가 거의 없습니다.

| Boot | Spring Framework | JDK | 판단 |
|---|---|---|---|
| 1.5.x | 4.3 | 6 이상 | 이미 지원이 끝난 라인입니다 |
| **2.7.x** | **5.3** | **8~17** | JDK를 올리지 않고 갈 수 있는 마지막 라인입니다 |
| 3.x | 6.x | 17 이상 | JDK 17 승급과 `javax.*` → `jakarta.*` 전환이 먼저 필요합니다 |

JSP를 쓰는 한 WAR 패키징은 유지해야 합니다. Boot의 실행 가능한 jar는 JSP를 제대로 서빙하지 못하기 때문입니다. 그래서 단일 jar 배포라는 Boot의 대표적인 이점은 이번 단계에서 얻지 못합니다. 그래도 옮기는 이유는 의존성 버전이 BOM 하나로 정렬되고, XML 설정을 Java로 옮길 발판이 생기고, Boot 3으로 가는 길이 열리기 때문입니다. 성능은 근거가 되지 못했습니다. 컨테이너가 기동하는 시간은 Boot 쪽이 몇 초 빨랐지만, 전체 기동 시간의 대부분은 두 방식 모두에 공통인 다른 초기화가 차지했습니다(이 부분은 4편에서 다룹니다).

작업하면서 만난 함정은 스무 개가 넘었습니다. 이 글에서는 다른 프로젝트에도 그대로 옮겨질 만한 것을 골라 세 갈래로 묶습니다.

1. 루트 컨텍스트와 서블릿 컨텍스트가 하나로 합쳐지면서 생기는 것
2. Boot가 WAR 배포에 자동으로 끼우는 `ErrorPageFilter`가 세션 쿠키를 지우는 것
3. 내장 톰캣과 외부 톰캣이 서로 다른 설정을 읽어서 한쪽만 깨지는 것

여기에 빌드와 패키징에서 조용히 틀어지는 것 두 가지와, Spring 4.3에서 5.3으로 함께 올라가며 생긴 변화 하나를 덧붙입니다.

## 진행 순서

단계마다 컴파일하고, 단계가 끝나면 서버를 띄워 확인합니다. 여러 단계를 한꺼번에 하면 어디서 깨졌는지 좁힐 수 없습니다.

| 단계 | 할 일 | 통과 확인 |
|---|---|---|
| 0 | 컨텍스트 병합 충돌 후보 조사 | 후보 목록이 나오면 통과 |
| 1 | 빌드 배선: Boot 플러그인, BOM, WAR 산출물 설정 | 전환 전 의존성 해석 결과와 대조 |
| 2 | 부트스트랩 클래스, `@ImportResource`, 자동설정 제외, `web.xml`에서 컨텍스트 선언 제거 | 기동(충돌이 여기서 하나씩 드러납니다) |
| 3 | `web.xml` 정리: 필터를 Java로 | 기동과 세션 쿠키 확인 |
| 4 | MVC 설정을 Java로 | 해당 기능 회귀 확인 |
| 5 | 로깅 정리 | 로그 파일이 실제로 쓰이는지 확인 |

`web.xml`은 마지막까지 지우지 않습니다. WAR 배포에서는 `web.xml`과 `SpringBootServletInitializer`가 함께 있을 수 있으므로, 하나씩 옮기고 옮긴 것만 지웁니다. 뒤에서 보겠지만 끝까지 `web.xml`에 남겨야 하는 선언도 있습니다.

2단계의 부트스트랩 클래스는 대략 이런 모양이 됩니다. 아래 코드는 이 글을 위해 새로 쓴 예시이고, 이 형태 그대로 실행해 보지는 않았습니다.

```java
@SpringBootApplication(exclude = {
        DataSourceAutoConfiguration.class,      // XML이 이미 커넥션 풀을 만듭니다
        WebMvcAutoConfiguration.class,          // <mvc:annotation-driven>이 담당합니다
        TransactionAutoConfiguration.class      // <tx:annotation-driven>이 담당합니다
})
@ImportResource({
        "classpath:/spring/root-context.xml",
        "classpath:/spring/servlet-context.xml"
})
public class LegacyWebApplication extends SpringBootServletInitializer {

    public LegacyWebApplication() {
        setRegisterErrorPageFilter(false);      // 이유는 아래 「ErrorPageFilter」 절에서 설명합니다
    }

    @Override
    protected SpringApplicationBuilder configure(SpringApplicationBuilder builder) {
        return builder.sources(LegacyWebApplication.class);
    }

    public static void main(String[] args) {
        SpringApplication.run(LegacyWebApplication.class, args);
    }
}
```

`web.xml`의 `ContextLoaderListener`와 `DispatcherServlet` 선언은 이 클래스를 넣는 단계에서 함께 지웁니다. 남겨 두면 둘 다 루트 컨텍스트를 만들려고 해서 `there is already a root application context present`로 기동이 실패합니다.

## 함정 1: 두 컨텍스트가 하나로 합쳐집니다

전형적인 Spring MVC 레거시는 컨텍스트가 둘입니다.

```text
루트 컨텍스트     ContextLoaderListener가 읽는 XML
                  DataSource, 트랜잭션 매니저, 세션 저장소, 서비스 계층
서블릿 컨텍스트   DispatcherServlet의 init-param이 가리키는 XML
                  component-scan, 뷰 리졸버, 인터셉터, MVC 설정
```

Boot는 컨텍스트가 하나입니다. 두 XML을 `@ImportResource`로 한 컨텍스트에 불러오는 순간, 지금까지 서로 보이지 않던 빈들이 한 공간에 모입니다. 전환 중에 만난 문제 대부분이 여기서 나왔고, 형태는 두 가지입니다.

### 같은 이름의 빈이 두 번 등록됩니다

Boot 2.1부터 빈 정의 덮어쓰기가 기본으로 금지되어 있어서, 같은 이름이 두 번 나오면 `BeanDefinitionOverrideException`으로 기동이 실패합니다. 시끄럽게 실패하므로 오히려 다루기 쉽습니다. 흔한 경우는 셋입니다.

- XML에서 `id`로 정의한 클래스에 `@Component`도 붙어 있습니다. 컨텍스트가 둘일 때는 한쪽에 하나씩이라 드러나지 않았습니다.
- **클래스는 서로 다른데 빈 이름만 우연히 같습니다.** 예를 들어 XML에 `id="jsonView"`로 Jackson 뷰를 정의해 두었고, 프로젝트 안에 `JsonView`라는 `@Component` 클래스가 있으면 기본 빈 이름이 똑같이 `jsonView`가 됩니다. 「XML이 정의한 클래스에 `@Component`가 붙었나」를 찾는 조사로는 이 경우가 잡히지 않습니다.
- `<tx:annotation-driven>`이 두 XML에 모두 있습니다. XML 네임스페이스 선언은 파일에 보이지 않는 **내부 빈**을 등록하므로, `internalTransactionalEventListenerFactory`처럼 직접 정의한 적 없는 이름이 중복으로 나옵니다.

두 번째 경우에 어느 쪽 이름을 바꿀지는 **문자열로 참조되는 쪽이 어디인지**로 정합니다. `new ModelAndView("jsonView")`처럼 뷰 이름으로 빈을 찾는 코드는 컴파일러가 잡아 주지 않습니다. XML의 `id`를 바꾸면 그 참조가 모두 런타임에 깨지므로, 참조되지 않는 쪽(예: 코드에서 `new`로 직접 생성해 쓰던 클래스)의 이름을 `@Component("plainJsonView")`처럼 바꾸는 편이 안전합니다.

### 타입 주입 후보가 늘어 다른 빈이 조용히 선택됩니다

이쪽이 더 위험합니다. 예외가 나지 않기 때문입니다. 루트 컨텍스트에서는 `RedisConnectionFactory` 후보가 하나뿐이었는데, 합치고 나니 서블릿 컨텍스트 쪽에 있던 다른 용도의 팩토리들까지 후보가 되고, 그중 하나가 이미 `@Primary`였습니다. 그대로 두면 세션 저장소가 엉뚱한 Redis 연결에 붙을 수 있었습니다.

여기에 `primary="true"`를 하나 더 붙이면 `more than one 'primary' bean found`로 실패합니다. primary 경쟁으로 풀지 말고 주입 지점에서 이름을 못 박습니다.

```java
@Bean
public RedisTemplate<String, Object> sessionRedisTemplate(
        @Qualifier("sessionRedisConnectionFactory") RedisConnectionFactory connectionFactory) {
    RedisTemplate<String, Object> template = new RedisTemplate<>();
    template.setConnectionFactory(connectionFactory);
    return template;
}
```

문제는 주입받는 쪽이 프레임워크의 `@Configuration` 클래스일 때입니다. 직접 고칠 수 없으므로 상속해서 해당 `@Bean` 메서드나 setter를 오버라이드하고, 그 파라미터에 `@Qualifier`를 붙입니다. 오버라이드할 메서드의 이름과 시그니처는 라이브러리 버전마다 다르므로 쓰고 있는 버전의 소스를 보고 맞춰야 합니다. Spring Session 2.x라면 연결 팩토리 빈에 `@SpringSessionRedisConnectionFactory`를 붙여 지정하는 방법도 있습니다.

### XML 선언은 Boot가 기대하는 마커 빈을 만들지 않습니다

Boot 자동설정은 「이미 같은 일을 하는 빈이 있으면 물러난다」는 조건으로 동작합니다. 그런데 그 조건이 보는 것은 특정 타입의 빈입니다. `<mvc:annotation-driven>`은 핸들러 매핑과 어댑터를 개별 빈으로 직접 등록할 뿐 `WebMvcConfigurationSupport`를 만들지 않으므로, `@ConditionalOnMissingBean(WebMvcConfigurationSupport.class)`가 만족되어 `WebMvcAutoConfiguration`이 켜집니다. 결과는 `mvcContentNegotiationManager` 같은 이름의 중복이거나, 더 나쁘면 핸들러 매핑이 두 벌 생겨 순서 문제로 조용히 나타납니다. 트랜잭션도 마찬가지입니다. MVC와 트랜잭션을 XML이 계속 담당하게 두려면 위 예시처럼 해당 자동설정을 제외합니다.

그런데 이 제외에는 뒷면이 있습니다. `WebMvcAutoConfiguration` 안에는 `DelegatingWebMvcConfiguration`의 하위 클래스가 들어 있고, 컨텍스트에서 `WebMvcConfigurer` 빈을 찾아 호출해 주는 것이 바로 이 클래스입니다. 자동설정을 제외하면 이것도 함께 사라지고, `<mvc:annotation-driven>`은 그 역할을 하지 않습니다. 그래서 4단계에서 인터셉터나 리소스 매핑을 `WebMvcConfigurer`로 옮기면 **빈으로는 등록되지만 아무도 호출하지 않는 설정**이 됩니다. 예외도 로그도 없습니다.

옮기기 전에 컨텍스트에 `DelegatingWebMvcConfiguration` 타입 빈이 있는지부터 확인합니다. 없다면 선택지는 둘입니다. 해당 설정을 XML에 남기거나, `@EnableWebMvc`로 MVC 전체를 Java로 가져오는 일을 별도 단계로 잡습니다.

### 충돌 후보는 조사보다 기동이 빨리 찾습니다

착수 전에 XML의 빈 `id`, `@Bean` 메서드 이름, `@Component`가 붙은 클래스를 뽑아 대조해 두면 일부는 미리 보입니다. 이때 XML 주석을 먼저 지우고 세야 합니다. 레거시 XML에는 주석 처리된 `<bean>`과 `<filter>`가 쌓여 있어서, 지우지 않고 세면 있지도 않은 충돌을 찾거나 이관 규모를 크게 잘못 봅니다.

```python
import re, pathlib

for path in pathlib.Path("src/main/resources").rglob("*.xml"):
    text = re.sub(r"<!--.*?-->", "", path.read_text(encoding="utf-8"), flags=re.S)
    for m in re.finditer(r'<(?:beans:)?bean\b[^>]*\bid="([^"]+)"', text):
        print(m.group(1), path.name)
```

다만 이 조사로 다 나오지는 않습니다. 네임스페이스 선언이 만드는 내부 빈, XML로 등록한 프레임워크 `@Configuration`이 만드는 `@Bean`, Boot 자동설정이 만드는 빈은 예측하기 어렵습니다. 결국 **하나 고치고 다시 띄우는** 반복이 가장 빨랐습니다.

덧붙여 Boot 2.6부터는 순환 참조도 기본으로 금지됩니다. 필드 주입으로 서로를 참조하는 조합이 흔한 레거시라면 `spring.main.allow-circular-references=true`로 종전 동작을 유지하고, 구조 개선은 이번 단계에서 하지 않는 편이 낫습니다.

## 함정 2: 큰 응답에서만 세션 쿠키가 사라집니다

가장 찾기 어려웠던 문제입니다.

### 증상

기동, 회귀 확인, 화면이 모두 정상이었습니다. 그런데 처음 방문한 브라우저로 JSP를 렌더링하는 페이지를 열면 응답에 `Set-Cookie: SESSION=...`이 없었습니다. 세션 저장과 조회는 정상이라, 쿠키를 직접 넣어 요청하면 그 세션을 그대로 이어 썼습니다. 새 쿠키를 **발급하는 순간만** 빠지는 것이었습니다.

결정적인 단서는 응답 크기였습니다. 수백 바이트짜리 응답에서는 쿠키가 나갔고, 수백 KB짜리 JSP 응답에서는 나가지 않았습니다. 헬스체크 같은 작은 경로만 확인하면 통과로 보입니다.

### 원리

`SpringBootServletInitializer`는 WAR로 배포될 때 `ErrorPageFilter`를 자동으로 등록합니다. 내장 톰캣이 하는 오류 페이지 처리를 외부 컨테이너에서도 흉내 내려는 필터로, 이를 위해 응답을 자기 래퍼로 한 겹 더 감쌉니다.

한편 Spring Session의 `SessionRepositoryFilter`는 응답이 커밋되는 순간을 감지하는 래퍼(`OnCommittedResponseWrapper`)를 씌워 두었다가, 커밋 직전에 세션을 저장하고 `Set-Cookie` 헤더를 씁니다. 요청 처리가 끝난 뒤에도 한 번 더 저장을 시도하지만, 그때 이미 응답이 커밋되었다면 헤더를 더 실을 수 없습니다.

응답 크기에 따라 갈리는 이유가 여기에 있습니다.

```text
작은 응답   본문이 컨테이너 버퍼 안에 들어감
            → 요청 종료 시점에도 아직 커밋 전
            → 마지막 저장 단계에서 Set-Cookie를 실을 수 있음

큰 응답     본문이 버퍼를 넘침 → 렌더링 도중 컨테이너가 커밋
            → 래퍼가 겹친 상태에서 세션 필터가 이 커밋을 놓침
            → 요청 종료 시점에는 헤더를 쓸 수 없음
```

커밋 감지가 정확히 어느 래퍼 경계에서 어긋나는지는 필터 순서와 라이브러리 버전에 따라 달라질 수 있습니다. 위 설명은 소스를 읽고 세운 해석이고, 확인한 사실은 두 가지입니다. `ErrorPageFilter`를 끄면 큰 응답에서도 쿠키가 나왔고, 켜면 다시 사라졌습니다.

원인을 좁히는 과정에서 배제한 후보도 적어 둡니다. 같은 증상을 만나면 시간을 아낄 수 있습니다. 압축 필터를 꺼도 재현됐고, 필터 체인에 들어가기 전에 세션을 강제로 만들어도 재현됐고, Boot가 세션 필터를 중복 등록하지 못하게 막아도 재현됐습니다.

### 처방

부트스트랩 클래스 생성자에서 `setRegisterErrorPageFilter(false)`를 호출합니다. 위 예시 코드에 이미 들어 있는 한 줄입니다.

다만 이 필터를 끄는 것과 오류 페이지를 어디에 등록하느냐는 별개 문제입니다. 필터를 끄고 나서 오류 페이지를 Boot 방식으로 옮기면 다음 절의 함정에 걸립니다.

### 확인 방법

판정 기준에 「작은 응답」이 아니라 **실제로 큰 응답을 내는 페이지**를 넣습니다.

```bash
# 쿠키 없이 큰 JSP 페이지를 요청하고 Set-Cookie와 본문 크기를 함께 봅니다
curl -s -o /dev/null -D - -w 'size=%{size_download}\n' http://localhost:8080/some/large/page \
  | grep -iE '^set-cookie|^size='
```

## 함정 3: 내장 톰캣과 외부 톰캣은 서로 다른 설정을 읽습니다

개발 중에는 `bootRun`(내장 톰캣)으로 띄우고, 배포는 WAR를 외부 톰캣에 올리는 구성이 흔합니다. 이 두 방식은 읽는 설정이 다릅니다. 방향이 둘이라 헷갈리기 쉽습니다.

| 설정 수단 | 내장 톰캣 | 외부 톰캣(WAR) |
|---|---|---|
| `web.xml` (`<error-page>`, `<session-config>`, `<jsp-config>` 등) | 읽지 않습니다 | 읽습니다 |
| `FilterRegistrationBean`, `ServletRegistrationBean` | 적용됩니다 | 적용됩니다 |
| `ErrorPageRegistrar` | 적용됩니다 | 적용되지 않습니다 |
| `server.servlet.*` 프로퍼티 | 적용됩니다 | 적용되지 않습니다 |
| `WebServerFactoryCustomizer` | 적용됩니다 | 적용되지 않습니다 |

### 방향 1: 배포에서만 빠지는 것

`web.xml`의 `<error-page>`를 걷어내고 `ErrorPageRegistrar`로 옮겼습니다. `bootRun`에서는 커스텀 오류 화면이 잘 나왔습니다. 그런데 WAR를 외부 톰캣에 올리자 404, 500에서 톰캣 기본 오류 화면이 나왔고, 거기에 예외 스택트레이스와 톰캣 버전이 그대로 실렸습니다. `ErrorPageRegistrar`는 Boot가 내장 컨테이너를 만들 때만 호출되기 때문입니다.

`server.servlet.session.timeout` 같은 값도 같습니다. `server.*`는 Boot가 내장 컨테이너를 구성할 때 쓰는 값이고, 외부 톰캣은 자기 `web.xml`과 `conf/`만 봅니다. Spring Session을 쓰면 실제 만료는 세션 저장소 설정이 정하므로 증상이 드러나지 않을 수 있지만, 선언이 무효인 것은 같습니다.

처방은 `<error-page>`와 `<session-config>`를 `web.xml`에 남겨 두는 것입니다. 내장 톰캣용으로 Boot 쪽 설정을 두고 싶다면 함께 두어도 충돌하지 않습니다. `bootRun`으로만 검증하면 이 부류는 통과로 보이므로 특히 위험합니다.

### 방향 2: 개발 환경에서만 빠지는 것

반대로 내장 톰캣은 `web.xml`을 읽지 않으므로, 필터를 Java로 옮기기 전에 `bootRun`을 띄우면 필터가 전부 빠진 채로 동작합니다. 필터는 `FilterRegistrationBean`으로 옮기면 양쪽에 모두 적용되므로 옮겨도 안전합니다. 이때 `web.xml`에서는 `<filter-mapping>` 선언 순서가 곧 실행 순서였지만, Java 등록은 순서가 자동으로 따라오지 않으므로 `setOrder`로 못 박아야 합니다. 응답을 감싸는 필터(세션, 압축)의 상대 순서가 바뀌면 커밋 시점이 달라지고, 앞 절의 쿠키 문제 같은 일이 다시 생길 수 있습니다.

```java
@Bean
public FilterRegistrationBean<Filter> sessionFilterRegistration(SessionRepositoryFilter<?> sessionFilter) {
    FilterRegistrationBean<Filter> registration = new FilterRegistrationBean<>(sessionFilter);
    registration.addUrlPatterns("/*");
    // ERROR가 빠지면 오류 페이지로 포워드된 요청에서 세션을 쓸 수 없습니다
    registration.setDispatcherTypes(DispatcherType.REQUEST, DispatcherType.ERROR);
    registration.setOrder(100);
    return registration;
}
```

눈에 덜 띄는 것은 `<jsp-config>`입니다. `.jspf` 조각 파일의 인코딩을 지정하는 선언으로 알고 있기 쉬운데, 실제로는 두 가지 일을 합니다.

1. `*.jspf`를 지정한 인코딩으로 해석합니다.
2. `*.jspf`를 JSP 서블릿에 매핑합니다. 톰캣의 기본 매핑은 `*.jsp`와 `*.jspx`뿐이고, 외부 톰캣은 `<jsp-property-group>`의 `url-pattern`을 읽어 이 매핑을 대신 만들어 줍니다.

내장 톰캣에서는 둘 다 빠집니다. 한글이 깨지는 것은 눈에 띄므로 인코딩만 고치고 끝내기 쉬운데, 그러면 `<jsp:include page="header.jspf"/>`처럼 요청으로 포함하는 조각이 404가 되어 **통째로 사라집니다.** 조각이 화면의 일부가 아니라 전역 스크립트 변수를 정의하는 역할이라면, 화면은 멀쩡해 보이고 그 변수를 쓰는 기능만 비어 있게 됩니다. 확인은 간단합니다. `.jspf`를 직접 GET해 보면 외부 톰캣은 200, 매핑이 없는 내장 톰캣은 404를 냅니다.

`web.xml`의 선언은 그대로 두고, 내장 톰캣에는 커스터마이저로 같은 값을 넣습니다.

```java
@Bean
public WebServerFactoryCustomizer<TomcatServletWebServerFactory> jspfCustomizer() {
    return factory -> factory.addContextCustomizers(context -> {
        context.setJspConfigDescriptor(new JspfConfigDescriptor("UTF-8")); // 1. 인코딩
        context.addServletMappingDecoded("*.jspf", "jsp");                // 2. JSP 서블릿 매핑
    });
}
```

`JspfConfigDescriptor`는 `javax.servlet.descriptor.JspConfigDescriptor`를 직접 구현한 작은 클래스입니다. 값이 `web.xml`과 Java 두 곳에 생기므로, 한쪽을 고치면 다른 쪽도 고쳐야 한다는 점은 비용으로 남습니다.

### 판정은 두 방식을 나란히 띄워서

이 부류는 한쪽 방식으로만 확인해서는 절대 드러나지 않습니다. 전환 후 코드를 WAR(외부 톰캣)와 `bootRun` 두 방식으로 동시에 띄우고 같은 경로 목록을 양쪽에 보내 상태 코드, 본문, 헤더를 비교합니다. 같은 코드끼리 비교하므로 기동 방식 때문에 갈리는 것만 남습니다. 전환 전 코드와 비교하는 축은 그와 별도로 둡니다. 이때 두 서버가 같은 DB와 같은 프로파일을 보고 있는지 먼저 확인해야 합니다. 프로파일이 다르면 본문 차이가 잔뜩 나오는데, 전부 데이터 차이일 수 있습니다.

로그도 양쪽에 똑같이 붙입니다. 한쪽에만 로그 설정을 켜 두면, 다른 쪽 로그가 비어 있는 것을 「그 기능이 동작하지 않는다」로 잘못 읽게 됩니다.

## 함정 4: 빌드는 통과하는데 산출물이 틀립니다

### BOM을 붙이는 방식에 따라 의존성이 내려갑니다

Gradle에서 Boot BOM을 적용하는 방법은 둘입니다. `io.spring.dependency-management` 플러그인을 쓰는 방법과, Gradle 네이티브 `platform()`을 쓰는 방법입니다.

앞의 방법은 Maven 방식의 해석 규칙을 적용합니다. 버전을 명시한 직접 의존성이 전이 의존성의 더 높은 요구보다 우선하므로, 레거시 빌드 파일에 오래된 버전이 명시되어 있으면 그 버전으로 **끌어내립니다.** 실제로 JSON 라이브러리가 두 단계 아래 버전으로 내려가면서 새 API를 쓰던 코드가 컴파일에 실패했고, 컴파일 에러가 나지 않는 다른 라이브러리도 함께 내려가 있었습니다.

`platform()`으로 BOM을 제약으로만 넣으면 Gradle의 「가장 높은 버전이 이긴다」 규칙이 유지됩니다.

```groovy
dependencies {
    implementation platform('org.springframework.boot:spring-boot-dependencies:2.7.18')
    // providedRuntime 같은 다른 구성에도 제약이 필요하면 따로 선언해야 합니다
    providedRuntime platform('org.springframework.boot:spring-boot-dependencies:2.7.18')
}
```

반대로 BOM이 원치 않게 **올리는** 것도 있습니다. 세션 라이브러리처럼 메이저 버전이 바뀌면 API가 달라지는 것은 `version { strictly '...' }`로 눌러 두고 별도 단계에서 올립니다. 이때 같은 계열(`spring-data-*` 등)을 함께 고정하지 않으면 세대가 섞여 `NoSuchMethodError`가 납니다.

어느 경우든 방법은 하나입니다. 전환 전에 해석 결과를 저장해 두고 전환 후와 비교합니다.

```bash
./gradlew dependencies --configuration runtimeClasspath > deps-before.txt
# 전환 작업 후
./gradlew dependencies --configuration runtimeClasspath > deps-after.txt
diff deps-before.txt deps-after.txt | grep -E '^[<>].*->'
```

### WAR에서 Boot 자체가 빠집니다

외부 톰캣에 배포할 WAR에 내장 톰캣이 실리지 않게 하려고 흔히 이렇게 씁니다.

```groovy
dependencies {
    implementation('org.springframework.boot:spring-boot-starter-web') {
        exclude group: 'org.springframework.boot', module: 'spring-boot-starter-tomcat'
    }
    providedRuntime 'org.springframework.boot:spring-boot-starter-tomcat'
}
```

그런데 war 플러그인은 `providedRuntime`이 해석한 것을 **전이 의존성까지** `WEB-INF/lib`에서 뺍니다. `spring-boot-starter-tomcat`의 전이에는 `spring-boot`와 `spring-boot-autoconfigure`가 들어 있으므로, 이 둘이 WAR에서 통째로 빠집니다. 컴파일은 `compileClasspath`로 하므로 통과하고, `war` 태스크도 통과하고, 외부 톰캣에 올려 기동하는 순간 `SpringBootServletInitializer`를 찾지 못합니다.

외부 톰캣으로만 띄운다면 `providedRuntime` 선언을 아예 두지 않고, starter에서 톰캣을 제외하는 것만으로 충분합니다. `bootRun` 때문에 꼭 필요하다면 WAR 안에 `spring-boot` jar가 있는지를 확인 단계로 박아 둡니다. Boot 플러그인을 붙이면 기본 산출물이 `bootWar`로 바뀌고 일반 `war` 파일 이름에 `-plain`이 붙는다는 점도 배포 스크립트를 깨뜨리기 쉬우니 함께 봅니다.

WAR 구성은 빌드 로그로 보이지 않으므로 산출물을 직접 엽니다. 큰 WAR는 zip64 형식이라 일부 `unzip`이 조용히 실패할 수 있어서 파이썬으로 읽었습니다.

```python
import sys, zipfile

libs = [n.rsplit("/", 1)[-1] for n in zipfile.ZipFile(sys.argv[1]).namelist()
        if n.startswith("WEB-INF/lib/")]
for keyword, expected in [("spring-boot", True), ("tomcat-embed", False)]:
    found = [l for l in libs if keyword in l]
    status = "OK" if bool(found) == expected else "FAIL"
    print(f"{status} {keyword}: {found or '(없음)'}")
```

## 함정 5: Spring 4.3에서 5.3으로 함께 올라갑니다

Boot 2.7 BOM을 붙이는 순간 Spring Framework가 4.3에서 5.3으로 두 세대 올라갑니다. Boot 배선만 한 것 같지만 실제로는 프레임워크 메이저 승급을 겸하는 셈이라, 원인을 찾을 때 Boot 쪽만 보면 안 됩니다. 가능하면 Boot 없이 Spring 버전만 먼저 올려 보는 단계를 따로 두면 「Spring 탓인지 Boot 배선 탓인지」를 나눌 수 있습니다. Spring 버전을 붙잡는 다른 프레임워크 jar에 의존하고 있다면 이 단계가 전환 가능 여부를 정합니다.

이렇게 섞여 들어온 변화 중 상태 코드와 본문만 비교해서는 끝까지 보이지 않았던 것이 하나 있습니다. 정적 리소스 응답에 `Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers`가 새로 붙었습니다. Spring 5.x의 `DefaultCorsProcessor`는 요청에 `Origin`이 있든 없든 이 `Vary` 헤더를 먼저 붙이고, `<mvc:resources>`가 만드는 `ResourceHttpRequestHandler`는 CORS 설정 소스를 겸하고 있어 정적 리소스마다 이 프로세서를 거칩니다. 기능은 멀쩡하지만 CDN이나 브라우저 캐시가 `Origin` 값마다 갈릴 수 있습니다.

CORS를 웹 서버 계층에서 처리하고 Spring 쪽 설정이 비어 있는 경우라면, CORS 요청이 아닐 때 프로세서를 그냥 통과시키도록 바꿔 4.3 때 동작으로 되돌릴 수 있습니다. Spring이 실제로 CORS를 처리한다면 이 처방은 쓰면 안 됩니다. 응답이 `Origin`에 따라 달라지는데 `Vary`를 빼면 캐시가 오염됩니다.

```java
public class OriginAwareCorsProcessor extends DefaultCorsProcessor {
    @Override
    public boolean processRequest(CorsConfiguration config, HttpServletRequest request,
                                  HttpServletResponse response) throws IOException {
        if (!CorsUtils.isCorsRequest(request)) {
            return true;    // CORS 요청이 아니면 Vary도 붙이지 않습니다
        }
        return super.processRequest(config, request, response);
    }
}
```

핸들러 매핑이 XML에서 만들어진다면 `BeanPostProcessor`에서 `AbstractHandlerMapping#setCorsProcessor`로 끼워 넣습니다. 교훈은 처방보다 확인 쪽에 있습니다. 응답 헤더 이름 집합과 주요 헤더 값을 비교 대상에 넣어야 합니다.

## 그 밖의 함정

이 글에서 다루지 않은 것도 여럿 있습니다. 큰 갈래만 적으면 다음과 같습니다.

- 로깅: 클래스패스의 로깅 라이브러리 조합에 따라 Boot가 고른 로깅 시스템과 실제 바인딩이 맞지 않아 기동 즉시 실패할 수 있습니다. 로깅 정리를 마지막 단계로 미루려면 `LoggingSystem.NONE`을 지정해 Boot가 로깅 초기화에 손대지 않게 합니다.
- 자동설정과 구버전 라이브러리: 특정 클래스가 클래스패스에 있다는 이유만으로 켜지는 자동설정이 구버전 라이브러리의 없는 API를 호출합니다. 쓰지 않는 기능임을 코드로 확인한 뒤 제외합니다.
- 내장 톰캣의 클래스패스: `providedCompile`로 둔 오래된 서블릿·JSP API jar가 내장 톰캣의 EL 구현을 가리거나, `/WEB-INF/` 경로로 지정한 리소스가 내장 톰캣에서는 classpath로 해석되는 문제가 있습니다.
- 검증 환경: 검증 중 DB 연결이 끊기면 서킷 브레이커가 열려 결과가 실행마다 흔들립니다. 회귀를 의심하기 전에 의존 시스템에 닿는지부터 확인합니다.

## 정리

- Spring 4 WAR를 Boot 2.7로 옮기는 일의 본질은 라이브러리 승급이 아니라 **두 컨텍스트가 하나로 합쳐지는 것**입니다. 이름 중복은 시끄럽게 실패하지만, 타입 주입 후보가 늘어 다른 빈이 선택되는 것은 조용히 일어납니다. 주입 지점에서 `@Qualifier`로 이름을 못 박습니다.
- `<mvc:annotation-driven>` 같은 XML 선언은 Boot 자동설정이 물러나는 조건을 만족시키지 못합니다. 자동설정을 제외하면 `WebMvcConfigurer`를 호출하는 쪽도 함께 사라진다는 점을 기억해 둡니다.
- WAR 배포에서 `ErrorPageFilter`가 켜져 있으면 큰 응답에서만 세션 쿠키가 빠질 수 있습니다. `setRegisterErrorPageFilter(false)`로 끄고, 판정에는 큰 응답을 내는 페이지를 넣습니다.
- 내장 톰캣은 `web.xml`을 읽지 않고, `ErrorPageRegistrar`와 `server.servlet.*`는 외부 톰캣에 적용되지 않습니다. 필터는 Java로 옮겨도 되지만 오류 페이지, 세션 설정, `jsp-config`는 `web.xml`에 남깁니다.
- 빌드가 통과해도 의존성이 내려가거나 WAR에서 Boot가 빠질 수 있습니다. 전환 전 의존성 해석 결과와 대조하고 산출물을 직접 엽니다.
- 판정은 전환 전과 후, 그리고 WAR와 `bootRun`의 두 축으로 하고, 상태 코드와 본문뿐 아니라 응답 헤더와 쿠키까지 비교합니다.
