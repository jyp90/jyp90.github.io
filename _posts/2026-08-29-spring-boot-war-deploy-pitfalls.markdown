---
layout: post
title: "레거시 Java 웹 애플리케이션에서 만난 함정 (4) WAR 배포에서만 깨지는 설정과 빌드 산출물의 함정"
date: 2026-08-29 12:00:00 +0900
categories: blog
tags: [Java, Spring, Migration]
excerpt: "내장 톰캣과 외부 톰캣이 서로 다른 설정을 읽어 한쪽만 깨지는 문제와, 빌드는 통과해도 의존성·WAR 구성이 틀어지는 함정을 정리합니다."
series: "레거시 Java 웹 애플리케이션에서 만난 함정"
summary:
  - "내장 톰캣과 외부 톰캣은 web.xml, ErrorPageRegistrar, server.servlet 설정을 다르게 읽습니다."
  - "빌드는 통과해도 BOM 해석 방식과 providedRuntime 설정 때문에 의존성과 WAR 구성이 틀어집니다."
  - "Spring 4.3에서 5.3으로 오르며 정적 리소스 응답에 Vary 헤더가 새로 붙었습니다."
---

이 글은 [레거시 Java 웹 애플리케이션에서 만난 함정 (3) Spring 4 WAR를 Spring Boot 2.7로 옮길 때의 함정](/blog/2026/08/29/spring4-war-to-spring-boot-27.html)에서 이어집니다. 앞 편에서는 루트·서블릿 컨텍스트가 하나로 합쳐지며 생기는 빈 충돌과, WAR 배포에서 큰 응답일 때만 세션 쿠키가 사라지는 문제를 다뤘습니다. 이 편에서는 나머지 세 갈래 — 내장 톰캣과 외부 톰캣의 설정 차이, 빌드는 통과해도 틀어지는 산출물, Spring 4.3에서 5.3으로 함께 올라가며 생긴 변화 — 를 다룹니다.

## 함정 1: 내장 톰캣과 외부 톰캣은 서로 다른 설정을 읽습니다

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

반대로 내장 톰캣은 `web.xml`을 읽지 않으므로, 필터를 Java로 옮기기 전에 `bootRun`을 띄우면 필터가 전부 빠진 채로 동작합니다. 필터는 `FilterRegistrationBean`으로 옮기면 양쪽에 모두 적용되므로 옮겨도 안전합니다. 이때 `web.xml`에서는 `<filter-mapping>` 선언 순서가 곧 실행 순서였지만, Java 등록은 순서가 자동으로 따라오지 않으므로 `setOrder`로 못 박아야 합니다. 응답을 감싸는 필터(세션, 압축)의 상대 순서가 바뀌면 커밋 시점이 달라지고, 앞 편의 쿠키 문제 같은 일이 다시 생길 수 있습니다.

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

## 함정 2: 빌드는 통과하는데 산출물이 틀립니다

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

## 함정 3: Spring 4.3에서 5.3으로 함께 올라갑니다

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

- 내장 톰캣은 `web.xml`을 읽지 않고, `ErrorPageRegistrar`와 `server.servlet.*`는 외부 톰캣에 적용되지 않습니다. 필터는 Java로 옮겨도 되지만 오류 페이지, 세션 설정, `jsp-config`는 `web.xml`에 남깁니다.
- 빌드가 통과해도 의존성이 내려가거나 WAR에서 Boot가 빠질 수 있습니다. 전환 전 의존성 해석 결과와 대조하고 산출물을 직접 엽니다.
- Boot BOM을 붙이는 순간 Spring Framework도 함께 올라갑니다. 정적 리소스에 `Vary` 헤더가 새로 붙는 것처럼 상태 코드와 본문만으로는 보이지 않는 변화가 섞여 있습니다.
- 판정은 전환 전과 후, 그리고 WAR와 `bootRun`의 두 축으로 하고, 상태 코드와 본문뿐 아니라 응답 헤더와 쿠키까지 비교합니다.
