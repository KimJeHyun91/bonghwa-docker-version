/**
 * @file reliableTransmitService.js
 * @description disaster_transmit_logs의 메시지를 외부 시스템(Socket.IO)에 신뢰성 있게 전송하고, 수신 확인(ACK/NACK)을 처리합니다.
 */

const logger = require('../utils/logger');
const config = require('../../config');
const disasterTransmitLogRepository = require('../repositories/disasterTransmitLogRepository');
const sessionManager = require('../../socket/sessionManager');

const TRANSMISSION_TIMEOUT = config.disasterTransmitWorker.TRANSMISSION_TIMEOUT;
const MAX_RETRIES = config.disasterTransmitWorker.MAX_RETRIES;

/**
 * 전송 실패 시 재시도 횟수를 증가시키거나 상태를 FAILED로 변경합니다.
 * @param {bigint} logId - 실패한 로그의 ID
 * @param {number} currentRetryCount - 현재 재시도 횟수
 */
async function _processFailure(logId, currentRetryCount) {

    // 실패 처리 전에 현재 상태를 다시 확인하여 중복 업데이트 방지
    let currentLog;
    try {
        currentLog = await disasterTransmitLogRepository.findById(logId);
    } catch (dbErr) {
        logger.error(`🚨 [ExternalService][ReliableTransmit] _porcessFailure DB 조회 오류 (disaster_transmit_log ID: ${logId}): ${dbErr.message}`)
        return;
    }

    if (!currentLog || currentLog.status === 'SUCCESS' || currentLog.status === 'FAILED') {
        logger.debug(`🚨 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 최종 상태(${currentLog?.status}) 확인. 실패 처리 건너뜀.`);
        return;
    }

    let assumedNexRetryCount = currentRetryCount + 1;

    // 재시도 카운트 증가
    try {
        await disasterTransmitLogRepository.incrementRetryCount(logId);
    } catch (dbErr) {
        logger.error(`🚨🚨 [ExternalService][ReliableTransmit] 재시도 카운트 증가 DB 오류 (disaster_transmit_log ID: ${logId}): ${dbErr.message}`);
    }

    try {
        if (assumedNexRetryCount > MAX_RETRIES) {
            await disasterTransmitLogRepository.updateStatusById(logId, 'FAILED');
            logger.warn(`🚨 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 최대 재시도(${MAX_RETRIES}) 도달. FAILED 처리 완료.`);
        } else {
            await disasterTransmitLogRepository.updateStatusById(logId, 'PENDING');
            logger.warn(`🔔 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 전송 실패. PENDING 상태 업데이트 완료. 재시도 예정 (시도 ${assumedNexRetryCount}/${MAX_RETRIES}).`);
        }
    } catch (updateErr) {
        logger.error(`🚨🚨 [ExternalService][ReliableTransmit] PENDING/FAILED 상태 업데이트 실패 (disaster_transmit_log ID: ${logId}): ${updateErr.message}`);
    }   

}

/**
 * 클라이언트로부터 받은 ACK(수신 확인)를 처리합니다.
 * @param {number} logId - 수신 확인된 로그의 ID
 */
async function _processAck(logId) {

    try {
        const currentLog = await disasterTransmitLogRepository.findById(logId);

        if (currentLog?.status === 'SUCCESS') {
            logger.debug(`🔔 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 이미 SUCCESS 상태. ACK 무시.`);
            return;
        }
        if (currentLog?.status === 'FAILED') {
            logger.warn(`🔔 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 이미 FAILED 상태. ACK 무시.`);
            return;
        }
        await disasterTransmitLogRepository.updateStatusById(logId, 'SUCCESS');
        logger.info(`✅ [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] SUCCESS 처리 완료.`);
    } catch (err) {
        logger.error(`🚨 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] ACK 처리 중 DB 오류 발생: ${err.message}`);
    }

}

/**
 * 처리할 메시지 로그 ID를 받아 실제 전송을 시도합니다.
 * @param {object} logId - disaster_transmit_logs 테이블의 행 데이터 객체
 */
async function _processMessage(logId) {

    // 1단계: 로그 정보 조회 및 상태 확인
    let currentLog;
    try {
        currentLog = await disasterTransmitLogRepository.findById(logId);
    } catch (err) {
        logger.error(`🚨 [ExternalService][ReliableTransmit] 메시지 조회 오류 (disaster_transmit_log ID: ${logId}): ${err.message}. 처리 중단.`);
        return;
    } 

    if (!currentLog || currentLog.status === 'SUCCESS' || currentLog.status === 'FAILED') {
        logger.debug(`🚨 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 최종 상태(${currentLog?.status}) 확인. 처리 건너뜀.`);
        return;
    }
    
    const {
        external_system_id: externalSystemId,
        identifier,
        raw_message: rawMessage,
        retry_count: currentRetryCount
    } = currentLog;

    const systemName = sessionManager.getSocketBySystemId(externalSystemId)?.system?.system_name || `external_system ID: ${externalSystemId}`; // 로그용 시스템 이름

    try {

        // 1. 최대 재시도 횟수를 초과했는지 확인합니다.
        if (currentRetryCount >= MAX_RETRIES) {
            logger.warn(`🚨 [ExternalService][ReliableTransmit] 최대 재시도(${MAX_RETRIES}) 초과. disaster_transmit_log ID[${logId}] FAILED 처리 시작.`);
            if (currentLog.status !== 'FAILED') {
                await disasterTransmitLogRepository.updateStatusById(logId, 'FAILED'); 
            }
            return;
        }

        // 2. 현재 해당 외부 시스템에 연결된 활성 소켓이 있는지 확인합니다.
        const targetSocket = sessionManager.getSocketBySystemId(externalSystemId);
        if (!targetSocket) {
            logger.debug(`🔔 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 전송 대상(${systemName}) 활성 소켓 없음. 건너뜀.`);
            if (currentLog.status === 'SENT') {
                await disasterTransmitLogRepository.updateStatusById(logId, 'PENDING');
            }
            return;
        }

        // 3. 메시지 페이로드를 구성합니다. (전송 로그 ID 포함)
        const payload = {
            logId,
            identifier,
            rawMessage,
        };

        // 전송 시도 후 즉시 상태를 SENT로 업데이트
        await disasterTransmitLogRepository.updateStatusById(logId, 'SENT');
        logger.info(`➡️ [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] (${systemName}) 전송 시작 (시도 ${currentRetryCount + 1}/${MAX_RETRIES}).`);

        // 4. 소켓에 전송 시도 및 결과 처리
        let ackReceived = false;
        let timeoutId = null;

        timeoutId = setTimeout(async () => {
            if (!ackReceived) {
                logger.warn(`🔔 [ExternalService][ReliableTransmit] ACK 타임아웃 (${TRANSMISSION_TIMEOUT / 1000}초). disaster_transmit_log ID [${logId}] 실패 처리 시작.`);
                await _processFailure(logId, currentRetryCount);
            }
        }, TRANSMISSION_TIMEOUT);

        try {
            logger.info(`[ExternalService][ReliableTransmit] Socket [${targetSocket.id}]으로 emit 호출.`);

            targetSocket.emit('disaster', payload, async (response) => {
                if (ackReceived) {
                    return;
                }

                ackReceived = true;
                clearTimeout(timeoutId);
                
                try {
                    if (response?.status === 'ack' && response.logId === logId) {
                        logger.info(`⬅️ [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] ACK 수신 (Socket: ${targetSocket.id}).`);
                        await _processAck(logId);
                    } else {
                        const reason = (response?.status === 'nack') ? `NACK (${response.message || '이유 없음'})` : `Invalid Response (${JSON.stringify(response)})`;
                        logger.warn(`🔔 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] ${reason} 수신. 실패 처리 시작.`);
                        await _processFailure(logId, currentRetryCount);
                    }
                } catch (ackProcessErr) {
                    logger.error(`🚨🚨 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] ACK/NACK 처리 중 2차 오류 발생: ${ackProcessErr.message}`);
                }
            });
        } catch (emitErr) {
            clearTimeout(timeoutId);
            logger.error(`🚨 [ExternalService][ReliableTrnasmit] Socket.IO emit 오류 (disaster_transmit_log ID: ${logId}, Socket: ${targetSocket.id}): ${emitErr.message}.`);
            await _processFailure(logId, currentRetryCount);
        }

    } catch (err) {

        logger.error(`🚨 [ExternalService][ReliableTransmit] disaster_transmit_log ID [${logId}] 메시지 처리 실패 (Init/DB): ${err.message}`);
        await _processFailure(logId, currentRetryCount);

    }
    
}

/**
 * 전송할 메시지 로그 ID를 받아 전송을 시작합니다.
 * @param {bigint} logId - disaster_transmit_logs 행 ID (워커가 전달) 
 */
async function transmitMessage(logId) {
    await _processMessage(logId);
}

module.exports = {
    transmitMessage,
};