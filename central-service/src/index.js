/**
 * @file index.js
 * @description central-service 애플리케이션 메인 진입점.
 * 모든 서비스 모듈(TCP 클라이언트, 메시지 브로커)을 시작하고, 안정적인 종료를 관리합니다.
 */

// .env 파일에서 환경 변수를 가장 먼저 로드합니다.
require('dotenv').config();

const logger = require('./core/utils/logger');
const TCPClient = require('./tcp/client');
const messageBrokerService = require('./core/services/messageBrokerService');
const dbPool = require('./core/repositories/pool');
const disasterPublishWorker = require('./core/worker/disasterPublishWorker');
const reportTransmitWorker = require('./core/worker/reportTransmitWorker');

/**
 * 애플리케이션의 모든 서비스를 시작하는 비동기 함수입니다.
 */
async function startServer() {
    
    try {

        logger.info('🚀 [CentralService][App] 중앙 서비스 시작...');

        // 1. RabbitMQ 메시지 브로커 서비스를 시작합니다.
        await messageBrokerService.start();
        logger.info('✅ [CentralService][App] RabbitMQ 시작 완료.');

        // 2. 중앙 시스템으로 접속하는 TCP 클라이언트를 시작합니다.
        TCPClient.connect();
        logger.info('✅ [CentralService][App] TCP 클라이언트 시작 완료.');

        // 3. 재난 정보 발행 워커를 시작합니다.
        await disasterPublishWorker.start();
        logger.info('✅ [CentralService][App] 재난 정보 발행 워커 시작 완료.');

        // 4. 보고 정보 발신 워커를 시작합니다.
        await reportTransmitWorker.start();
        logger.info('✅ [CentralService][App] 보고 정보 발신 워커 시작 완료.');

        logger.info('✅ [CentralService][App] 모든 서비스 시작 완료.');

    } catch (err) {

        // startServer는 애플리케이션의 최상위 시작점이므로, 여기서 발생하는 오류는
        // 복구가 불가능한 심각한 오류(예: DB/MQ 연결 실패)일 가능성이 높습니다.
        // 따라서 로그를 남기고 프로세스를 종료하여 문제를 즉시 알립니다.
        logger.error(`🚨 [CentralService][App] 서비스 시작 중 심각한 오류 발생: ${err.message}. 프로세스 종료.`);
        // 오류 발생 시 프로세스를 비정상 종료 코드로 종료하여 문제를 알립니다.
        process.exit(1);

    }

}

/**
 * 애플리케이션 종료 신호를 받았을 때 모든 리소스를 순서대로 안전하게 정리합니다.
 * @param {string} signal - 수신된 신호 이름 (예: 'SIGINT')
 */
const gracefulShutdown = async (signal) => {

    logger.warn(`🔔 [CentralService][App] ${signal} 신호 수신. 정상 종료 시작...`);

    try {

        // 1. 새로운 요청을 더 이상 받지 않도록 워커들을 먼저 중지합니다.
        disasterPublishWorker.stop();
        logger.info('✅ [CentralService][App] 재난 정보 발행 워커 중지 완료.');
        reportTransmitWorker.stop();
        logger.info('✅ [CentralService][App] 보고 정보 발신 워커 중지 완료.');

        // 2. 중앙 시스템 접속용 TCP 클라이언트 연결을 종료합니다.
        await new Promise((resolve) => TCPClient.disconnect(resolve));
        logger.info('✅ [CentralService][App] TCP 클라이언트 연결 종료 완료.');

        // 3. RabbitMQ 연결을 종료합니다.
        await messageBrokerService.disconnect();
        logger.info('✅ [CentralService][App] RabbitMQ 연결 종료 완료.');

        // 4. 데이터베이스 커넥션 풀을 닫습니다.
        await dbPool.disconnect();
        logger.info('✅ [CentralService][App] DB 커넥션 풀 종료 완료.');

        // 5. 모든 작업이 성공적으로 완료되면 프로세스를 종료합니다.
        logger.info('✅ [CentralService][App] 모든 리소스 정리 완료. 애플리케이션 종료.');
        process.exit(0);

    } catch (err) {

        logger.error(`🚨 [CentralService][App] 정상 종료 처리 중 오류 발생: ${err.message}. 프로세스 강제 종료.`);
        // 오류 발생 시 프로세스를 비정상 종료 코드로 종료하여 문제를 알립니다.
        process.exit(1);

    }

};

// 처리되지 않은 예외(Uncaught Exception) 발생 시 로그 기록 후 종료합니다.
process.on('uncaughtException', (err, origin) => {

    logger.error(`🚨 [CentralService][UncaughtException] 발생 (Origin: ${origin}): ${err.message}`);
    gracefulShutdown('uncaughtException');

});

// 처리되지 않은 Promise 거부(Unhandled Rejection) 발생 시 기록 후 종료합니다.
process.on('unhandledRejection', (reason, promise) => {
    const reasonMsg = reason instanceof Error ? reason.message : reason;
    logger.error(`🚨 [CentralService][UnhandledRejection] 발생: ${reasonMsg}`);
    gracefulShutdown('unhandledRejection');

});

// 운영체제로부터 받는 종료 시그널을 받고 gracefulShutdown 함수를 호출하여 안전하게 종료하도록 합니다.
// SIGINT: Ctrl + C 입력 시 발생
process.on('SIGINT', () => {
    logger.debug('[CentralService][App] SIGINT 신호 수신.');
    gracefulShutdown('SIGINT')
});
// SIGTERM: 프로세스 종료 명령(예: kill) 시 발생
process.on('SIGTERM', () => {
    logger.debug('[CentralService][App] SIGTERM 신호 수신.');
    gracefulShutdown('SIGTERM')
});

// 애플리케이션을 시작합니다.
startServer();