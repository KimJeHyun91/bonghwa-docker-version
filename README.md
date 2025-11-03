# 컨테이너 중지, 제거 및 볼륨 제거 (DB 데이터 초기화)
docker compose -f docker-compose.yml down -v

# 이미지 캐시 없이 재빌드 (새로운 설정 반영)
docker compose -f docker-compose.yml build --no-cache

# 서비스 실행
docker compose -f docker-compose.yml up -d

# 필수 외부 이미지(PostgreSQL, RabbitMQ, Node.js, Nginx 등) 모든 베이스 이미지 다운로드
docker pull postgres:latest
docker pull rabbitmq:latest
docker pull node:18-alpine
docker pull nginx:alpine

# 각 서비스 이미지 파일 저장
docker save -o bonghwa-external-latest.tar bonghwa-external:latest
docker save -o bonghwa-central-latest.tar bonghwa-central:latest
docker save -o postgres-latest.tar postgres:latest
docker save -o rabbitmq-latest.tar rabbitmq:latest


# 설치/실행 순서
- Docker Desktop 설치
- Docker Desktop 실행
- Install.exe 실행
- start.exe 실행

# 이미지 파일 암호화
- pkg와 Multi-stage Dockerfile 사용(.js 소스 코드를 이미지에 넣는 대신, Node.js 런타임과 모든 소스 코드를 합쳐 **하나의 실행 파일(바이너리)**로 만든 뒤, 이 실행 파일만 이미지에 넣습니다.)
1단계: 빌드 단계 (조립실: builder)
- 이 단계의 유일한 목적은 모든 소스 코드와 개발 도구(npm, pkg)를 사용하여 my-server라는 단 하나의 실행 파일을 만드는 것입니다.
- 이 단계에서 사용된 모든 도구, node_modules, 그리고 원본 .js 소스 코드는 최종 이미지에 전혀 포함되지 않고 이 단계가 끝나면 버려집니다.
- 도커 파일 예시:
------------------------------------------------------------------------------------------
node:18-alpine 이미지를 기반으로 합니다. 여기엔 Node.js와 npm이 설치되어 있습니다.
FROM node:18-alpine AS builder

작업할 폴더를 만듭니다.
WORKDIR /usr/src/app

[최적화 팁]
package.json 파일을 먼저 복사하고 npm install을 실행합니다.
이렇게 하면 소스 코드만 변경되었을 때 npm install 과정을 건너뛰어 빌드 속도가 빨라집니다.
COPY package*.json ./
RUN npm install --production
(만약 pkg가 devDependency라면 --production 플래그를 빼고 npm install을 실행하세요.)

이제 나머지 모든 소스 코드(.js 파일, routes 등)를 복사합니다.
COPY . .

'pkg' 도구를 이 조립실 안에 설치합니다.
RUN npm install -g pkg

[가장 핵심적인 부분]
pkg를 실행하여 'my-server'라는 이름의 실행 파일을 만듭니다.
--targets: 도커 이미지는 리눅스(linux) 환경이므로, node18-linux-x64용으로 만듭니다.
--output: 결과물의 이름을 /usr/src/app/my-server로 지정합니다.

(참고: package.json에 "main": "app.js" 또는 "bin": "app.js" 항목이 있어야
pkg가 어떤 파일을 메인으로 삼을지 알 수 있습니다.)
RUN pkg . --targets node18-linux-x64 --output /usr/src/app/my-server
------------------------------------------------------------------------------------------


2단계: 최종 단계 (제품 포장실: final image)
- 이 단계는 완전히 새로운 이미지에서 시작합니다. 여기서는 1단계(builder)에서 만든 my-server 실행 파일 단 하나만 가져와 깨끗한 상자에 담습니다.
- 도커 파일 예시:
------------------------------------------------------------------------------------------
'scratch'는 말 그대로 "아무것도 없는 빈" 이미지입니다.
OS도, 셸(sh)도, ls 같은 기본 명령어조차 없습니다.
이것이 소스 코드를 숨기고 보안을 극대화하는 가장 강력한 방법입니다.
FROM scratch

앱이 실행될 폴더를 만듭니다.
WORKDIR /app

[마법의 명령어: --from]
--from=builder: "1단계(조립실)"에서
/usr/src/app/my-server 파일을 (1단계의 경로)
현재 폴더(.)로 복사해옵니다.
COPY --from=builder /usr/src/app/my-server .

(선택 사항)
만약 Express가 HTML 템플릿(views)이나 정적 파일(public)을 사용하고,
이를 pkg로 묶지 않았다면(pkg.json의 assets 설정),
해당 폴더도 1단계에서 복사해와야 합니다.
COPY --from=builder /usr/src/app/views ./views
COPY --from=builder /usr/src/app/public ./public

Express 서버가 3000번 포트를 사용한다고 도커에게 알려줍니다. (메타데이터)
EXPOSE 3000

컨테이너가 시작될 때 실행할 유일한 명령어입니다.
셸이 없으므로, JSON 배열 형식을 사용해야 합니다.
CMD ["/app/my-server"]
------------------------------------------------------------------------------------------


만약 scratch 이미지가 작동하지 않는다면?
- scratch는 정말로 아무것도 없기 때문에, 만약 앱이 HTTPS(SSL/TLS) 통신을 위해 시스템의 루트 인증서(ca-certificates)를 필요로 하는 경우 오류가 발생할 수 있습니다. 그럴 때는 FROM scratch 대신 FROM alpine:latest를 사용하면 됩니다.
- 도커 파일 예시:
------------------------------------------------------------------------------------------
FROM alpine:latest

Alpine은 최소한의 OS이므로, SSL 인증서 등을 포함하고 있습니다.
RUN apk add --no-cache ca-certificates

WORKDIR /app
COPY --from=builder /usr/src/app/my-server .
(필요시 정적 파일도 복사)

EXPOSE 3000
CMD ["/app/my-server"]
------------------------------------------------------------------------------------------

