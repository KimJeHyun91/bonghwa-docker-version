/**
 * @file reliableTransmitService.js
 * @description 보고 정보를 중앙 시스템에 신뢰성 있게 전송하고, 수신 확인(ACK/NACK)을 처리합니다.
 */

const logger = require('../utils/logger');
const config = require('../../config');
const sessionManager = require('../utils/sessionManager');
const { xmlParser, buildMessageBuffer } = require('../utils/protocolUtils');
const reportTransmitLogRepository = require('../repositories/reportTransmitLogRepository');
const disasterPublishLogRepository = require('../repositories/disasterPublishLogRepository');
const capService = require('./capService');

const TRANSMISSION_TIMEOUT = config.tcp.protocol.TIMERS.TRANSMISSION_TIMEOUT;
const MAX_RETRIES = config.reportTransmitWorker.MAX_RETRIES;

// 활성 타임아웃 타이머 ID를 저장하는 MAP (logId -> timeoutId)
const activeTimeouts = new Map();

const MESSAGE_IDS = {
    DEVICE_INFO: config.tcp.protocol.MESSAGE_IDS.ETS_NFY_DEVICE_INFO,
    DEVICE_STATUS: config.tcp.protocol.MESSAGE_IDS.ETS_NFY_DEVICE_STS,
    DISASTER_RESULT: config.tcp.protocol.MESSAGE_IDS.ETS_REQ_DIS_REPORT,
};

const LOG_CONTEXT = {
    DEVICE_INFO: '단말기 제원 정보 보고',
    DEVICE_STATUS: '단말기 상태 정보 보고',
    DISASTER_RESULT: '재난 정보 결과 보고',
};

/**
 * 전송 실패(타임아웃 또는 NACK) 시 상태를 PENDING으로 변경하여 다음 워커 주기에 재시도하도록 합니다.
 * 재시도 카운트 증가는 워커 담당. 최대 횟수 도달 시 FAILED 처리.
 * @param {bigint} logId - 실패한 로그의 ID 
 * @param {number} currentRetryCount - 현재 재시도 횟수 (워커가 전달)
 * @param {string} [failureReason] - 실패 사유 (로그용)
 */
async function processFailure(logId, currentRetryCount, failureReason = 'Unknwon failure') {

    // 실패 처리 시에도 해당 로그의 타임아웃 정리
    const timeoutIdToClear = activeTimeouts.get(logId);
    if (timeoutIdToClear) {
        clearTimeout(timeoutIdToClear);
        activeTimeouts.delete(logId);
        logger.debug(`[CentralService][ReliableTransmit] Log ID [${logId}] 타임아웃 타이머 취소됨 (실채 처리).`);
    }
    
    // 실패 처리 전에 현재 상태를 다시 확인하여 중복 업데이트 방지
    let currentLog;
    try {
        currentLog = await reportTransmitLogRepository.findById(logId)
    } catch (dbErr) {
        logger.error(`🚨 [CentralService][ReliableTransmit] processFailure 중 DB 조회 오류 (report_transmit_log ID: ${logId}): ${dbErr.message}`);
        // DB 조회 실패 시 더 이상 진행 불가, 오류 로깅 후 종료
        return;
    }
     
    if (!currentLog || currentLog.status === 'SUCCESS' || currentLog.status === 'FAILED') {
        logger.debug(`[CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 최종 상태(${currentLog?.status}). 실패 처리를 건너뜀.`);
        return;
    }

    const nextRetryCount = currentRetryCount + 1; // 여기서 계산만 하고 DB 업데이트는 워커 담당

    try {
        await reportTransmitLogRepository.updateStatusById(logId, 'PENDING', failureReason);
        logger.warn(`🔔 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 전송 실패 (${failureReason}). 재시도 예정 (시도 #${nextRetryCount})/${MAX_RETRIES}).`);
    } catch (updateErr) {
        logger.error(`🚨🚨 [CentralService][ReliableTransmit] PENDING 상태 업데이트 실패 (report_transmit_log ID: ${logId}): ${updateErr.message}`);
    }
    
    

}

/**
 * 처리되지 않은 메시지(로그) 하나를 받아 실제 전송을 시도합니다.
 * @param {object} log - 테이블의 행 데이터 객체 (워카가 재시도/시퀸스 업데이트 후 전달)
 */
async function processMessage(log) {

    const {
        id: logId,
        external_system_name: externalSystemName, 
        raw_message: rawMessage, 
        retry_count: currentRetryCount,
        report_sequence: reportSequence,
        outbound_id: identifier,
        type, 
    } = log;

    let capObject;
    const messageId = MESSAGE_IDS[type];
    const logContext = LOG_CONTEXT[type];
    let timeoutId = null;

    try {

        // --- 유효성 검사 ---
        if (!messageId) {
            throw new Error(`알 수 없는 메시지 타입: ${type}`);
        }
        if (currentRetryCount > MAX_RETRIES) {
            throw new Error(`최대 재시도 횟수(${MAX_RETRIES}) 초과`);
        }
        if (!sessionManager.isConnected()) {
            logger.warn(`🔌 [CentralService][ReliableTransmit] 연결 끊김. 전송 대기 (report_transmit_log ID: ${identifier}, Outbound ID: ${identifier}).`);
            return; // 연결이 없으면 조용히 종료, 다음 워커 주기 대기
        }

        // --- CAP 객체 생성 ---
        switch (type) {
            case 'DEVICE_INFO':
                capObject = capService.buildDeviceInfoCap(identifier, rawMessage, externalSystemName);
                break;
            case 'DEVICE_STATUS':
                capObject = capService.buildDeviceStatusCap(identifier, rawMessage, externalSystemName);
                break;
            case 'DISASTER_RESULT':
                const originalIdentifier = identifier.slice(0, -6);
                const disasterPublishLog = await disasterPublishLogRepository.findByIdentifier(originalIdentifier);
                if (!disasterPublishLog) {
                    throw new Error(`원본 재난 정보 식별자(${originalIdentifier}) 조회 실패. Outbound ID: ${identifier}`);
                }
                const originalCapInfo = (typeof disasterPublishLog.raw_message === 'object' && disasterPublishLog.raw_message !== null)
                                        ? disasterPublishLog.raw_message.capInfo
                                        : null;
                if (!originalCapInfo || !originalCapInfo.alert || !originalCapInfo.alert.sent || !originalCapInfo.alert.sender) {
                    throw new Error(`원본 재난 로그(${originalIdentifier})의 CAP 정보가 유효하지 않음`);
                }
                capObject = capService.buildDisasterResultCap(identifier, rawMessage, externalSystemName, originalCapInfo.alert.sent, originalCapInfo.alert.sender);
                break;
            default:
                throw new Error(`정의되지 않은 메시지 타입: ${type}`);
        }

        // --- 메시지 생성 및 전송 ---
        const messageXmlToSend = {
            data: {
                transMsgId: identifier,
                transMsgSeq: reportSequence,
                capInfo: capObject
            }            
        };
        const messageBuffer = buildMessageBuffer(messageId, messageXmlToSend);

        sessionManager.send(messageBuffer, logContext);
        await reportTransmitLogRepository.updateStatusById(logId, 'SENT');

        // --- ACK 타임아웃 설정 및 Map에 저장 ---
        const existingTimeoutId = activeTimeouts.get(logId);
        if (existingTimeoutId) {
            clearTimeout(existingTimeoutId);
            activeTimeouts.delete(logId);
            logger.warn(`🔔 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 이전 타임아웃 타이머 존재. 제거 완료.`);
        }

        timeoutId = setTimeout(async () => {
            try {

                // 타임아웃 콜백 실행 시 Map에서 제거
                activeTimeouts.delete(logId);
                logger.warn(`🔔 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] ACK 타임아웃 (${TRANSMISSION_TIMEOUT / 1000}초). 실패 처리 시작.`);
                await processFailure(logId, currentRetryCount, `ACK Timeout (${TRANSMISSION_TIMEOUT / 1000}초)`);

            } catch (timeoutErr) {

                // 타임아웃을 처리하다가 발생한 2차 오류 로깅
                logger.error(`🚨🚨 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 타임아웃 콜백 처리 오류: ${timeoutErr.stack}`);

            }           
        }, TRANSMISSION_TIMEOUT);

        // Map에 새로 생성된 timeoutId 저장
        activeTimeouts.set(logId, timeoutId);

        logger.info(`➡️ [CentralService][ReliableTransmit] ${logContext} 전송 시작 (시도 ${currentRetryCount + 1}/${MAX_RETRIES}, report_transmit_log ID: ${logId}, Outbound ID: ${identifier}, Seq: ${reportSequence}).`);
        
    } catch (err) {

        logger.error(`🚨 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 처리 중 오류 발생: ${err.stack}`);
        // 오류 발생 시에도 타임아웃 취소 및 Map에서 제거 시도
        const existingTimeoutId = activeTimeouts.get(logId);
        if (existingTimeoutId) {
            clearTimeout(existingTimeoutId);
            activeTimeouts.delete(logId);
        }
        // 최종 실패 처리(오류 메시지 포함)
        try {
            await reportTransmitLogRepository.updateStatusById(logId, 'FAILED', err.message);
            logger.error(`🚨 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] FAILED 처리 완료 (오류: ${err.message}).`);
        } catch (finalErr) {
            // FAILED로 업데이트하는 것조차 실패한 최악의 상황
            logger.error(`🚨 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] FAILED 상태 업데이트 실패: ${finalErr.stack}`);
        }
        
    }
    
}

/**
 * 서버로부터 받은 보고 응답(ACK/NACK)을 처리합니다
 * @param {number} messageBodyBuffer - 수신된 메시지의 Body 버퍼
 */
async function processAck(messageBodyBuffer) {

    let logId; // report_transmit_log ID
    let currentRetryCount = 0;
    let outboundId; // TCP 전송 ID (transMsgId)
    let reportSequence; // TCP 전송 Seq (transMsgSeq)

    try {

        const xmlString = messageBodyBuffer.toString('utf-8');
        const result = await xmlParser.parseStringPromise(xmlString);
        const data = result.data;
        outboundId = data.transMsgId;
        reportSequence = data.transMsgSeq; // 파싱 실패 시 undefined
        const resultCode = String(data.resultCode); // 파싱 실패 시 undefined

        if (!outboundId) {
            throw new Error('응답 메시지에 outboundId(transMsgId) 누락.');
        }

        if (reportSequence === undefined || reportSequence === null || isNaN(reportSequence)) {
            throw new Error('응답 메시지에 reportSequence(transMsgSeq) 누락 또는 숫자 아님.');
        }

        if (!resultCode) {
            throw new Error('응답 메시지에 resultCode가 누락되었습니다.');
        }

        const currentLog = await reportTransmitLogRepository.findByOutboundIdAndReportSequence(outboundId, reportSequence);
        if (!currentLog) {
            logger.warn(`🔔 [CentralService][ReliableTransmit] 일치하는 전송 로그 없음 (Outbound ID: ${outboundId}, Seq: ${reportSequence}). 응답 무시.`);
            return; // 해당 로그 없음
        }
        logId = currentLog.id;
        currentRetryCount = currentLog.retry_count; // 실패 처리 시 사용

        const timeoutIdToClear = activeTimeouts.get(logId);
        if (timeoutIdToClear) {
            clearTimeout(timeoutIdToClear);
            activeTimeouts.delete(logId); // Map에서 제거
            logger.debug(`✅ [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] ACK/NACK 수신. 타임아웃 타이머 취소 완료.`);
        } else {
            logger.warn(`🔔 [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 활성 타임아웃 타이머 없음 (응답 수신 시점).`);
        }

        logger.debug(`⬅️ [CentralService][ReliableTransmit] 보고 응답 수신 (report_transmit_log ID: ${logId}, OutboundID: ${outboundId}, Seq: ${reportSequence}, Code: ${resultCode}).`);

        // 상태 확인 후 처리 (중복 처리 방지)
        if (currentLog.status === 'FAILED' || currentLog.status === 'SUCCESS') {
            logger.debug(`[CentralService][ReliableTransmit] report_transmit_log ID [${logId}] 최종 상태(${currentLog.status}). 응답 처리 건너뜀.`);
            return;
        }

        if (resultCode === '200') {

            // PENDING 또는 SENT 상태일 때만 SUCCESS로 변경
            await reportTransmitLogRepository.updateStatusById(logId, 'SUCCESS');
            logger.info(`✅ [CentralService][ReliableTransmit] report_transmit_log ID [${logId}] SUCCESS 처리 완료.`);

        } else {

            // NACK 또는 기타 오류 응답 처리
            const reason = data.result || `Error code ${resultCode}`;
            logger.warn(`🔔 [CentralService][ReliableTransmit] 서버 NACK 응답 수신 (report_transmit_log ID: ${logId}, Code: ${resultCode}, Resason: ${reason}). 실패 처리 시작.`);
            await processFailure(logId, currentRetryCount, `Received NACK Response: ${reason}`);

        }

    } catch (err) {

        logger.error(`🚨 [CentralService][ReliableTransmit] ACK/NACK 메시지 처리 중 오류 발생: ${err.stack}`);
        // logId가 있으면 실패 처리 시도
        if (logId !== undefined) {
            try {
                await processFailure(logId, currentRetryCount, `ACK/NACK 처리 오류: ${err.message}`);
            } catch (failureErr) {
                logger.error(`🚨🚨 [CentralService][ReliableTransmit] processFailure 호출 실패 (report_transmit_log ID: ${logId}): ${failureErr.message}`);
            }             
        }
    
    }

}

module.exports = {
    processMessage,
    processAck,
};