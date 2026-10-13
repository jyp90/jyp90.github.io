---
layout: post
title: "레거시 Java 웹 애플리케이션에서 만난 함정 (3) Spring 4 WAR를 Spring Boot 2.7로 옮길 때의 함정"
date: 2026-08-29 09:00:00 +0900
categories: blog
tags: [Java, Spring, Migration]
excerpt: "Spring 4 WAR를 Spring Boot 2.7로 옮길 때 두 컨텍스트가 하나로 합쳐지며 생기는 빈 충돌과 ErrorPageFilter의 세션 쿠키 유실을 정리합니다."
series: "레거시 Java 웹 애플리케이션에서 만난 함정"
summary:
  - "Spring 4 WAR를 Spring Boot 2.7로 옮기며 스무 개 넘는 함정을 만났습니다."
  - "루트·서블릿 두 컨텍스트가 하나로 합쳐지며 빈 이름 충돌과 타입 주입 선택이 조용히 틀어졌습니다."
  - "ErrorPageFilter가 큰 응답에서만 세션 쿠키를 지워 setRegisterErrorPageFilter(false)로 껐습니다."
---

## 문제와 배경

JDK 8, Spring 4.3, JSP, 외부 톰캣에 올리는 WAR 패키징으로 된 레거시 웹 애플리케이션을 Spring Boot 2.7로 옮겼습니다. 목표 버전은 고를 여지가 거의 없습니다.

| Boot | Spring Framework | JDK | 판단 |
|---|---|---|---|
| 1.5.x | 4.3 | 6 이상 | 이미 지원이 끝난 라인입니다 |
| **2.7.x** | **5.3** | **8~17** | JDK를 올리지 않고 갈 수 있는 마지막 라인입니다 |
| 3.x | 6.x | 17 이상 | JDK 17 승급과 `javax.*` → `jakarta.*` 전환이 먼저 필요합니다 |

JSP를 쓰는 한 WAR 패키징은 유지해야 합니다. Boot의 실행 가능한 jar는 JSP를 제대로 서빙하지 못하기 때문입니다. 그래서 단일 jar 배포라는 Boot의 대표적인 이점은 이번 단계에서 얻지 못합니다. 그래도 옮기는 이유는 의존성 버전이 BOM 하나로 정렬되고, XML 설정을 Java로 옮길 발판이 생기고, Boot 3으로 가는 길이 열리기 때문입니다. 성능은 근거가 되지 못했습니다. 컨테이너가 기동하는 시간은 Boot 쪽이 몇 초 빨랐지만, 전체 기동 시간의 대부분은 두 방식 모두에 공통인 다른 초기화가 차지했습니다(이 부분은 5편에서 다룹니다).

작업하면서 만난 함정은 스무 개가 넘었습니다. 이 글에서는 다른 프로젝트에도 그대로 옮겨질 만한 것을 골라 정리합니다. 이번 편에서는 두 갈래를 다룹니다.

1. 루트 컨텍스트와 서블릿 컨텍스트가 하나로 합쳐지면서 생기는 것
2. Boot가 WAR 배포에 자동으로 끼우는 `ErrorPageFilter`가 세션 쿠키를 지우는 것

나머지 — 내장 톰캣과 외부 톰캣이 서로 다른 설정을 읽어서 한쪽만 깨지는 것, 빌드와 패키징에서 조용히 틀어지는 것 두 가지, Spring 4.3에서 5.3으로 함께 올라가며 생긴 변화 — 는 다음 편에서 다룹니다.

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

다만 이 필터를 끄는 것과 오류 페이지를 어디에 등록하느냐는 별개 문제입니다. 필터를 끄고 나서 오류 페이지를 Boot 방식으로 옮기면 다음 편의 함정에 걸립니다.

### 확인 방법

판정 기준에 「작은 응답」이 아니라 **실제로 큰 응답을 내는 페이지**를 넣습니다.

```bash
# 쿠키 없이 큰 JSP 페이지를 요청하고 Set-Cookie와 본문 크기를 함께 봅니다
curl -s -o /dev/null -D - -w 'size=%{size_download}\n' http://localhost:8080/some/large/page \
  | grep -iE '^set-cookie|^size='
```

다음 편에서는 내장 톰캣과 외부 톰캣이 서로 다른 설정을 읽어서 한쪽만 깨지는 문제, 빌드는 통과하는데 산출물이 틀어지는 두 가지 경우, 그리고 Spring 4.3에서 5.3으로 함께 올라가며 생긴 변화를 다룹니다.
