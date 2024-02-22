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

```shell
$ bundle exec jekyll serve
```

* Constraint

ruby version 의 제약 조건이 있음
```
ruby : 2.6.4 이상이여야 함
```