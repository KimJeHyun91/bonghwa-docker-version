/**
 * @file reportPublishWorker.js
 * @description 주기적으로 DB의 아웃박스(report_publish_logs)를 확인하여 보고 정보를 RabbitMQ로 발행하는 워커입니다.
 */

const config = require('../../config');
const logger = require('../utils/logger');
const reportPublishLogRepository = require('../repositories/reportPublishLogRepository');
const messageBrokerService = require('../services/messageBrokerService');

/**
 * setInterval의 타이머 ID를 저장하는 변수입니다.
 * @type {NodeJS.Timeout | null}
 */
let workerInterval = null;
let limit;
const { CONCURRENCY_LIMIT, MAX_RETRIES, POLLING_INTERVAL } = config.reportPublishWorker;

/**
 * 아웃박스에 있는 메시지 하나를 RabbitMQ로 발행합니다.
 * @param {object} message - report_publish_logs 테이블의 행 데이터
 */
async function processOutboxMessage(message) {
    
    const { 
        id: logId, 
        routing_key: routingKey, 
        raw_message: rawMessage, 
        retry_count: retryCount,
        external_system_name: externalSystemName,
        type
    } = message;

    try {
        // 1. 최대 재시도 횟수를 초과했는지 확인합니다.
        if (retryCount > MAX_RETRIES) {
            logger.warn(`🚨 [ExternalService][ReportPublishWorker] 최대 재시도(${MAX_RETRIES}) 초과. FAILED 처리 시작 (report_publish_log ID: ${logId}).`);
            await reportPublishLogRepository.updateStatusById(logId, 'FAILED');
            return;
        }

        const payload = {
            type,
            externalSystemName,
            rawMessage,
        }

        // 2. 메시지 브로커 서비스를 통해 메시지를 발행합니다.
        // publishReport 함수는 실패 시 오류를 던집니다.
        messageBrokerService.publishReport(payload, routingKey);

        // 3. 발행에 성공하면 상태를 'SUCCESS'로 즉시 업데이트합니다.
        await reportPublishLogRepository.updateStatusById(logId, 'SUCCESS');

        logger.info(`✅ [ExternalService][ReportPublishWorker] 보고 메시지 발행 완료 (report_publish_log ID: ${logId}). DB 상태 SUCCESS 업데이트.`);
    } catch (err) {
        logger.error(`🚨 [ExternalService][ReportPublishWorker] 처리 오류 (report_publish_log ID: ${logId}): ${err.message}`);
        // 4. 발행에 실패하면 재시도 횟수를 1 증가시킵니다.
        try {
            await reportPublishLogRepository.incrementRetryCount(logId);
            logger.debug(`[ExternalService][ReportPublishWorker] report_publish_log ID [${logId}] 재시도 카운트 증가 완료 (Next Retry: ${retryCount + 1})`);
        } catch (updateErr) {
            logger.error(`🚨🚨 [ExternalService][ReportPublishWorker] report_publish_log ID [${logId}] 재시도 카운트 증가 DB 오류: ${updateErr.message}`);
        }
        
    }

}

/**
 * 워커가 주기적으로 실행할 작업입니다.
 */
async function run() {
    
    logger.info('🚀 [ExternalService][ReportPublishWorker] 미발행 보고 메시지 확인 시작...');
    try {
        const unprocessedMessages = await reportPublishLogRepository.findUnprocessedMessages();

        if (unprocessedMessages.length > 0) {
            logger.info(`✅ [ExternalService][ReportPublishWorker] 미발행 ${unprocessedMessages.length}건 발견. 발행 시작 (동시 처리 제한: ${CONCURRENCY_LIMIT}).`);

            // 조회된 모든 메시지에 대해 '제한된 병렬 처리' 방식으로 발행을 요청합니다.
            const tasks = unprocessedMessages.map((message) => limit(() => processOutboxMessage(message)));
            await Promise.all(tasks);
            
            logger.info(`✅ [ExternalService][ReportPublishWorker] ${unprocessedMessages.length}건 발행 처리 완료.`);
        } else {
            logger.debug('[ExternalService][ReportPublishWorker] 미발행 보고 메시지 없음.');
        }
    } catch (err) {
        logger.error(`🚨 [ExternalService][ReportPublishWorker] 미발행 메시지 확인 중 오류 발생: ${err.message}`);
    }

}

/**
 * 보고 정보 발행 워커를 시작합니다.
 */
async function start() {
    
    if (workerInterval) {
        logger.warn('🔔 [ExternalService][ReportPublishWorker] 워커 이미 실행 중.');
        return;
    }

    const pLimit = (await import('p-limit')).default;
    limit = pLimit(CONCURRENCY_LIMIT);

    workerInterval = setInterval(run, POLLING_INTERVAL);
    logger.info(`✅ [ExternalService][ReportPublishWorker] 워커 시작 (주기: ${POLLING_INTERVAL / 1000}초).`);

}

/**
 * 보고 정보 발행 워커를 중지합니다.
 */
function stop() {

    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
        logger.info('🔌 [ExternalService][ReportPublishWorker] 워커 중지 완료.');
    } else {
        logger.debug('[ExternalService][ReportPublishWorker] 워커 이미 중지된 상태.');
    }

}

module.exports = {
    start,
    stop,
};