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

그리고 버전 확인 

```shell
$ rbenv versions
system
* 3.3.0 (set by /Users/username/IdeaProjects/private/jyp90.github.io/.ruby-version)
```

루비 버전 확인 

```shell
$ ruby --version
ruby 2.6.10p210 (2022-04-12 revision 67958) [universal.arm64e-darwin23]
```
2-a. 루비 초기화

```shell
$ rbenv init
# Load rbenv automatically by appending
# the following to ~/.zshrc:

eval "$(rbenv init - zsh)"
```

이렇게 나오면 .zshrc 파일의 맨 하단에 `eval "$(rbenv init - zsh)"`를 넣어준다
```
$ vi .zshrc 
```

3. 설치

```shell
$ bundle install && bundle update jekyll
```

4. 실행

**방법 1: Docker Compose (권장)**
```shell
# 첫 실행 시 (이미지 빌드)
$ docker compose up --build

# 이후 실행
$ docker compose up

# 백그라운드 실행
$ docker compose up -d
```

**방법 2: 로컬 Ruby**
```shell
$ bundle exec jekyll serve
```

접속: http://localhost:4000 (LiveReload 자동 활성화)

* Constraint

ruby version 의 제약 조건이 있음
```
ruby : 2.6.4 이상이여야 함
```

Docker를 사용하면 Ruby 환경 설정 없이 바로 실행 가능합니다.