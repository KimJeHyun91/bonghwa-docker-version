/**
 * @file index.js
 * @description external-service의 모든 설정 값을 관리하는 중앙 설정 파일입니다.
 * .env 파일의 환경 변수를 불러오고, 애플리케이션 동작 설정을 정의합니다.
 */

// .env 파일 로드는 애플리케이션의 메인 진입점(index.js)에서 처리됩니다.

module.exports = {

    // --- 일반 설정 ---
    isProduction: true, // 프로덕션 환경: true, 개발 환경: false

    // --- 로깅 설정 ---
    log: {
        LEVEL: 'debug',
    },

    // --- API & Socket.IO 서버 설정 ---
    http: {
        PORT: parseInt(process.env.HTTP_PORT, 10),
    },

    // --- 데이터베이스 설정 ---
    database: {
        HOST: process.env.PGHOST,
        PORT: parseInt(process.env.PGPORT, 10),
        DATABASE: process.env.PGDATABASE,
        USER: process.env.PGUSER,
        PASSWORD: process.env.PGPASSWORD,
    },

    // --- RabbitMQ 설정 ---
    rabbitmq: {
        URL: process.env.RABBITMQ_URL,
        NAMES: {
            // 재난 정보를 구독(수신)할 때 사용하는 Exchange
            DISASTER_EXCHANGE: 'disaster.topic',
            // 보고 메시지를 발행(발신)할 때 사용하는 Exchange
            REPORT_EXCHANGE: 'report.direct',
            // 수신한 재난 정보를 담을 Queue
            DISASTER_QUEUE: 'external_service_disaster_queue',
            // 처리 실패한 재난 정보를 보낼 Dead Letter Exchange
            DISASTER_DLX: 'disaster_dlx',
            // 처리 실패한 재난 정보를 담을 Dead Letter Queue
            DISASTER_DLQ: 'disaster_dlq',
            // 재시도 할 메시지를 보낼 Exchange
            DISASTER_RETRY_EXCHANGE: 'disaster_retry',
            // 재시도 할 메시지를 담을 Queue
            DISASTER_WAIT_QUEUE: 'disaster_wait',
            REPORT_ROUTING_KEY: 'report.external',
        },
        RETRY_DELAY: 10000, // 10초
        MAX_RETRIES: 3,
    },

    // --- CORS 관련 설정 ---
    cors: {
        // 허용된 Origin 목록을 DB에서 다시 가져올 주기 (단위: 밀리초)
        CACHE_DURATION: 60000, // 1분
    },

    // --- 재난 정보 발신 워커(Disaster Transmit Worker) 설정 ---
    disasterTransmitWorker: {
        // DB를 폴링하여 미처리 메시지를 확인할 주기 (단위: 밀리초)
        POLLING_INTERVAL: 5000, // 5초
        // 메시지 전송 후 기다리는 최대 시간 (단위: 밀리초)
        TRANSMISSION_TIMEOUT: 10000, // 10초
        // 최대 재시도 횟수
        MAX_RETRIES: 3,
        // 동시에 처리할 최대 작업 수
        CONCURRENCY_LIMIT: 5,
    },

    // --- 보고 정보 발행 워커(Report Publish Worker) 설정 ---
    reportPublishWorker: {
        // DB를 폴링하여 미발 보고를 확인할 주기 (단위: 밀리초)
        POLLING_INTERVAL: 5000, //5ch
        // 최대 재시도 횟수
        MAX_RETRIES: 3,
        // 동시에 처리할 최대 작업 수
        CONCURRENCY_LIMIT: 5,
    }

};