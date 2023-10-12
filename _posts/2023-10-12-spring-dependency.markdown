---
layout: post
title:  "Apache ListUtils "
date:   2023-10-12 15:37:15 +0900
categories: spring
---

오늘은 스프링 부트에서 자주 사용하는 내용들을 가져와보았습니다.

1. Spring web

웹 개발자에게는 없어서는 안될 web

{% highlight gradle %}
implementation 'org.springframework.boot:spring-boot-starter-web'
{% endhighlight %}


2. Spring Data JPA

ORM 사용자들에게는 필수

{% highlight gradle %}
implementation 'org.springframework.boot:spring-boot-starter-data-jpa'
implementation 'com.querydsl:querydsl-core'
implementation 'com.querydsl:querydsl-jpa'
{% endhighlight %}

3. Lombok 

없어서는 안될 클래스계의 친구같은 존재

{% highlight gradle %}
buildscript {
    ext.lombok_version = '1.18.22'
}

implementation "org.projectlombok:lombok:${lombok_version}"
annotationProcessor "org.projectlombok:lombok:${lombok_version}"
testAnnotationProcessor "org.projectlombok:lombok:${lombok_version}"
{% endhighlight %}

4. Spring Data Redis

Redis 를 사용한다면 

{% highlight gradle %}
implementation 'org.springframework.boot:spring-boot-starter-data-redis'
{% endhighlight %}

5. Spring Configuration

스프링에 의존성을 주입했지만 특정 커스텀을 할때 필요한 의존성

{% highlight gradle %}
implementation 'org.springframework.boot:spring-boot-configuration-processor'
{% endhighlight %}

6. Spring Devtools

개발자의 작업속도를 늘리고 싶으면

{% highlight gradle %}
runtimeOnly 'org.springframework.boot:spring-boot-devtools'
{% endhighlight %}

7. Util

조건 처리를 하거나 기본적인 Collection 객체를 컨트롤하기 쉽게 하려면 

{% highlight gradle %}
implementation 'org.apache.commons:commons-lang3:3.12.0'
{% endhighlight %}

Map 또는 Object의 DTO 매핑을 편리하게 하기 위해 

{% highlight gradle %}
implementation 'org.modelmapper:modelmapper:3.1.0'
implementation 'org.jsoup:jsoup:1.14.3'
{% endhighlight %}

Json Web Token을 쓴다면 

{% highlight gradle %}
implementation 'io.jsonwebtoken:jjwt:0.9.1'
{% endhighlight %}

외부 API 을 쓴다면

{% highlight gradle %}
implementation 'org.apache.httpcomponents:httpclient:4.5.12'
{% endhighlight %}

8. AWS

AWS 기반으로 된 프로젝트라면

{% highlight gradle %}
implementation 'com.amazonaws:aws-java-sdk:1.11.154'
implementation 'com.amazonaws:aws-java-sdk-s3:1.11.934'
implementation 'com.amazonaws:aws-java-sdk-sns:1.11.934'
implementation 'com.amazonaws:aws-java-sdk-sqs:1.11.934'
implementation 'com.amazonaws:aws-java-sdk-ses:1.11.889'
testImplementation 'software.amazon.awssdk:s3:2.17.57'
{% endhighlight %}

9. Test

TDD에 관심이 있거나 단위 테스트를 쓰기 위해 꼭 필요한 내용 


{% highlight gradle %}
testImplementation("org.springframework.boot:spring-boot-starter-test") {
    exclude(
            group: "com.vaadin.external.google",
            module: "android-json"
    )
}
implementation 'org.springframework:spring-test:5.3.22'
testImplementation 'org.springframework.restdocs:spring-restdocs-mockmvc:2.0.4.RELEASE'
{% endhighlight %}
