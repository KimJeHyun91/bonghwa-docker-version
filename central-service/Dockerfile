# 1. Node.js 18 버전을 기반으로 합니다.
FROM node:18-alpine

# 2. 전체 프로젝트를 복사할 루트 디렉터리 설정
WORKDIR /usr/src/app

# 3. central-service의 package.json 파일 복사
COPY central-service/package.json ./central-service/
COPY central-service/package-lock.json ./central-service/

# 4. 루트에서 모든 의존성을 설치합니다.
RUN npm install --prefix ./central-service

# 5. 프로젝트 소스 코드 전체를 복사합니다.
COPY . .

# 6. 서비스 시작 명령어를 지정합니다. (pacakge.json의 "start" 스크립트)
CMD [ "npm", "start", "--prefix", "./central-service" ]