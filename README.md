## Jekyll 블로그 사용하기 전 설치 사항

1. Ruby 설치 

```shell
$ brew install rbenv 
```

rbenv 를 통해 Ruby 설치
```shell
$ rbenv install -l ## 설치 가능한 ruby 버전 조회
$ rbenv install 3.3.0 ## 3.3.0 의 ruby install
```

자세한 Reference : https://codecamper.me/blog/122/

2. Ruby version 설정 (로컬에 2개 이상의 루비가 설치된 경우)

```shell
$ rbenv global 3.3.0
```

3. 설치

```shell
$ bundle install && bundle update jekyll
```

4. 실행 

```shell
$ bundle exec jekyll serve
```

* Constraint

ruby version 의 제약 조건이 있음
```
ruby : 2.6.4 이상이여야 함
```