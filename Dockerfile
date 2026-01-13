FROM ruby:3.3.0-alpine

# 필요한 패키지 설치
RUN apk add --no-cache \
    build-base \
    gcc \
    cmake \
    git \
    nodejs \
    npm

# 작업 디렉토리 설정
WORKDIR /srv/jekyll

# Jekyll 및 bundler 설치
RUN gem install jekyll bundler

# 포트 노출
EXPOSE 4000 35729

# 기본 명령어
CMD ["bundle", "exec", "jekyll", "serve", "--host", "0.0.0.0", "--livereload", "--force_polling"]
