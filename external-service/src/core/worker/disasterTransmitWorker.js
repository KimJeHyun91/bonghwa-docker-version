/**
 * @file disasterTransmitWorker.js
 * @description 주기적으로 DB를 폴링하여 처리되지 않은 재난 정보를 재전송하도록 요청하는 워커입니다.
 */

const config = require('../../config');
const logger = require('../utils/logger');
const disasterTransmitLogRepository = require('../repositories/disasterTransmitLogRepository');
const reliableTransmitService = require('../services/reliableTransmitService');

/**
 * setInterval의 타이머 ID를 저장하는 변수입니다.
 * @type {NodeJS.Timeout | null}
 */
let workerInterval = null;
let limit;
const { CONCURRENCY_LIMIT, POLLING_INTERVAL } = config.disasterTransmitWorker;

/**
 * 워커가 주기적으로 실행할 작업입니다.
 * 1. DB에서 미처리 메시지를 조회합니다.
 * 2. 각 메시지를 p-limit을 사용하여 제한된 병렬 방식으로 처리합니다.
 */
async function run() {
    
    logger.info('🚀 [ExternalService][DisasterTransmitWorker] 미처리 재난 정보 확인 시작...');
    try {

        const upProcessedMessages = await disasterTransmitLogRepository.findUnprocessedMessages();

        if (upProcessedMessages.length > 0) {
            logger.info(`✅ [ExternalService][DisasterTransmitWorker] 미처리 ${upProcessedMessages.length}건 발견. 처리 시작 (동시 처리 제한: ${CONCURRENCY_LIMIT}).`);

            // 조회된 모든 메시지에 대해 '제한된 병렬 처리' 방식으로 전송을 요청합니다.
            const tasks = upProcessedMessages.map((message) => {
                return limit(() => reliableTransmitService.transmitMessage(message.id));
            });

            // 생성된 모든 작업이 완료될 때까지 기다립니다.
            await Promise.all(tasks);
            logger.info(`✅ [ExternalService][DisasterTransmitWorker] ${upProcessedMessages.length}건 재난 정보 처리 완료.`);
        } else {
            logger.info(`✅ [ExternalService][DisasterTransmitWorker] 처리할 미처리 재난 정보 없음.`);
        }

    } catch (err) {
        
        logger.error(`🚨 [ExternalService][DisasterTransmitWorker] 미처리 재난 정보 확인 중 오류 발생: ${err.message}`);
    
    }

}

/**
 * 재난 정보 발신 워커를 시작합니다.
 */
async function start() {

    if (workerInterval) {
        logger.warn('🔔 [ExternalService][DisasterTransmitWorker] 워커 이미 실행 중.');
        return;
    }

    const pLimit = (await import('p-limit')).default;
    limit = pLimit(CONCURRENCY_LIMIT);

    workerInterval = setInterval(run, POLLING_INTERVAL);
    logger.info(`🚀 [ExternalService][DisasterTransmitWorker] 워커 시작 (주기: ${POLLING_INTERVAL / 1000}초).`);

}

/**
 * 재난 정보 발신 워커를 중지합니다.
 */
function stop() {

    if (workerInterval) {
        clearInterval(workerInterval);
        workerInterval = null;
        logger.info('🔌 [ExternalService][DisasterTransmitWorker] 워커 중지 완료.');
    } else {
        logger.debug('🔌 [ExternalService][DisasterTransmitWorker] 워커 이미 중지된 상태.');
    }

}

module.exports = {
    start,
    stop,
};