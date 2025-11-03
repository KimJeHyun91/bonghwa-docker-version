/**
 * @file disasterHandler.js
 * @description 재난 정보(CAP) 메시지 수신을 처리합니다. (인박스/아웃박스 패턴 적용)
 */

const logger = require('../../core/utils/logger');
const config = require('../../config');
const sessionManager = require('../../core/utils/sessionManager');
const tcpReceiveLogRepository = require('../../core/repositories/tcpReceiveLogRepository');
const disasterPublishLogRepository = require('../../core/repositories/disasterPublishLogRepository');
const { xmlParser } = require('../../core/utils/protocolUtils');
const {
    createCnfDisInfoBuffer,
    DuplicateMessageError,
    ValidationError,
    ProfileError,
    ParsingError,
} = require('../../core/utils/responseUtils');
const pool = require('../../core/repositories/pool');

// 유효한 이벤트 코드 목록을 중앙 config 파일에서 가져옵니다.
const VALID_EVNET_CODES = config.tcp.protocol.VALID_EVENT_CODES;

/** 
 * 중앙 시스템으로부터 받은 재난 정보 메시지(ETS_NFY_DIS_INFO)를 처리합니다.
 * @param {Buffer} messageBodyBuffer
 */
async function handleDisasterInfo(messageBodyBuffer) {

    let receivedData; // 외부 XML 래퍼 파싱 결과
    let tcpReceiveLogId; // tcp_receive_logs 테이블 ID
    let inboundId; // 수신된 transMsgId
    let inboundSeq; // 수신된 transMsgSeq
    let identifier; // CAP Identifier
    let alert; // 파싱된 CAP alert 객체
    let client; // DB 클라이언트

    logger.debug('🚀 [CentralService][DosasterHandler] 재난 정보 메시지 처리 시작...');

    try {
        
        client = await pool.getClient();
        
        // 1. 메시지를 파싱합니다.
        // 외부 XML 래퍼(wrapper)를 파싱합니다.
        logger.debug('🚀 [CentralService][DisasterHandler] 외부 XML 래퍼 파싱 시작...');
        try {

            const xmlString = messageBodyBuffer.toString('utf-8');
            const parsedXml = await xmlParser.parseStringPromise(xmlString);
            receivedData = parsedXml.data;

            logger.debug(`✅ [CentralService][DisasterHandler] 외부 XML 래퍼 파싱 완료.`);

            // 필수 필드 확인 전에 ID/Seq 저장
            inboundId = receivedData?.transMsgId;
            inboundSeq = receivedData?.transMsgSeq;
            identifier = receivedData?.capInfo?.alert?.identifier;

            if (!inboundId || inboundSeq === undefined || inboundSeq === null) {
                throw new Error('필수 필드(transMsgId, transMsgSeq) 누락.');
            }
            logger.debug(`[CentralService][DisasterHandler] Inbound ID: ${inboundId}, Seq: ${inboundSeq}, CAP ID: ${identifier}.`);

        } catch (parsingErr) {

            logger.warn(`🚨 [CentralService][DisasterHandler] 외부 XML 파싱 오류 (ID: ${inboundId}, Seq: ${inboundSeq}): ${parsingErr.message}`);
            // 외부 XML 래퍼 파싱에 실패하거나 transMsgId, transMsgSeq 값이 없다면 실패 메시지 자체를 보낼수 없으므로, 오류를 발생시킵니다. 
            throw new ParsingError('외부 XML 래퍼 파싱 실패.');

        }

        alert = receivedData.capInfo?.alert;

        // 2. 메시지 중복 확인 (Note Code: 300)
        logger.debug(`🚀 [CentralService][DisasterHandler] 메시지 중복 확인 시작 (Inbound ID: ${inboundId}, Seq: ${inboundSeq})...`);
        if (await tcpReceiveLogRepository.isDuplicate(inboundId, inboundSeq, client)) {
            logger.warn(`🔔 [CentralService][DisasterHandler] 메시지 중복 감지 (Inbound ID: ${inboundId}, Seq: ${inboundSeq}, CAP ID: ${identifier}).`)
            throw new DuplicateMessageError(`메시지 중복 (Inbound ID: ${inboundId}, Seq: ${inboundSeq})`);
        }
        logger.debug(`✅ [CentralService][DisasterHandler] 메시지 중복 아님 확인.`)        

        // 3. 수신한 재난 정보를 tcp_receive_logs에 저장합니다.
        logger.debug(`[CentralService][DisasterHandler] TCP 인박스 기록 시작 (Inbound ID: ${inboundId}, Seq: ${inboundSeq}).`);
        tcpReceiveLogId = await tcpReceiveLogRepository.create({
            inboundId: receivedData.transMsgId,
            inboundSeq: receivedData.transMsgSeq,
            rawMessage: receivedData,
        }, client);
        logger.debug(`✅ [CentralService][DisasterHandler] TCP 인박스 기록 완료 (tcp_receive_log ID: ${tcpReceiveLogId}).`);
        
        // --- 트랜잭션 시작 ---
        await client.query('BEGIN');
        logger.debug(`🚀 [CentralService][DisasterHandler] DB 트랜잭션 시작 (tcp_receive_log ID: ${tcpReceiveLogId})...`);
        
        // 4. CAP 메시지 유효성 검사 (Note Code: 210)
        logger.debug('🚀 [CentralService][DisasterHandler] CAP 메시지 유효성 검사 시작...');
        if (
            !alert || 
            !alert.identifier || 
            !alert.sender || 
            !alert.sent || 
            !alert.info?.eventCode?.value
        ) {
            throw new ValidationError('필수 필드(alert, identifier, sender, sent, eventCode)가 누락되었습니다.');
        }
        logger.debug('✅ [CentralService][DisasterHandler] CAP 메시지 필수 필드 확인 완료.');

        // 5.  프로파일 해석 오류 검사 (Note Code: 220)
        const eventCode = alert.info?.eventCode?.value;
        logger.debug(`🚀 [CentralService][DisasterHandler] Event Code 검사 시작 (Code: ${eventCode})...`);
        if (!VALID_EVNET_CODES.includes(eventCode)) {
            throw new ProfileError(`정의되지 않은 Event Code: ${eventCode}`);
        }
        logger.debug('✅ [CentralService][DisasterHandler] Event Code 유효함 확인.');

        // 6. MQ 아웃박스(disaster_publish_logs) 저장
        const routingKey = `disaster.${eventCode}`;
        logger.debug(`🚀 [CentralService][DisasterHandler] MQ 아웃박스 기록 시작 (RoutingKey: ${routingKey}, CAP ID: ${identifier})...`);
        await disasterPublishLogRepository.create({
            tcpReceiveLogId: tcpReceiveLogId,
            routingKey: routingKey,
            rawMessage: receivedData,
            identifier: identifier,
            eventCode: eventCode
        }, client);
        logger.debug('✅ [CentralService][DisasterHandler] MQ 아웃박스 기록 완료.');

        // 7. TCP 인박스(tcp_receive_logs) 상태 'SUCCESS' 업데이트
        logger.debug(`🚀 [CentralService][DisasterHandler] TCP 인박스 상태 SUCCESS 업데이트 시작 (tcp_receive_log ID: ${tcpReceiveLogId})...`);
        await tcpReceiveLogRepository.updateStatus(tcpReceiveLogId, 'SUCCESS', null, client);
        logger.debug('✅ [CentralService][DisasterHandler] TCP 인박스 상태 SUCCESS 업데이트 완료.');

        // --- 트랜잭션 커밋 ---
        await client.query('COMMIT');
        logger.debug(`✅ [CentralService][DisasterHandler] DB 트랜잭션 커밋 (tcp_receive_log ID: ${tcpReceiveLogId}).`);

        // 8. 성공 응답을 중앙 시스템으로 전송합니다 (Note Code: 000)
        const successBuffer = createCnfDisInfoBuffer(receivedData, receivedData.capInfo, null);
        if (successBuffer) {
            sessionManager.send(successBuffer, '재난 정보 수신 성공 응답');
            logger.info(`➡️ [CentralService][DisasterHandler] 재난 정보 처리 완료. 성공 응답(ACK) 전송 (Inbound ID: ${inboundId}, Seq: ${inboundSeq}, CAP ID: ${identifier}).`);
        } else {
            logger.error(`🚨 [CentralService][DisasterHandler] 성공 응답 버퍼 생성 실패 (Inbound ID: ${inboundId}). ACK 전송 불가.`);
        }

    } catch (err) {

        logger.error(`🚨 [CentralService][DisasterHandler] 재난 정보 처리 오류 (Inbound ID: ${inboundId}, Seq: ${inboundSeq}, CAP ID: ${identifier}): [${err.name}] ${err.message}`);

        // 롤백 시도
        if (client) {
            try {
                await client.query('ROLLBACK');
                logger.warn(`🔔 [CentralService][DisasterHandler] DB 트랜잭션 롤백 완료.`);
            } catch (rollbackErr) {
                logger.error(`🚨🚨 [CentralService][DisasterHandler] DB 트랜잭션 롤백 실패: ${rollbackErr.message}`);
            }
        }        

        // TCP 인박스(tcp_receive_logs) 상태 'FAILED' 업데이트 시도
        if (tcpReceiveLogId) {
            try {
                await tcpReceiveLogRepository.updateStatus(tcpReceiveLogId, 'FAILED', err.message, client || pool);
                logger.debug(`✅ [CentralService][DisasterHandler] TCP 인박스 상태 FAILED 업데이트 완료 (tcp_receive_log ID: ${tcpReceiveLogId}).`);
            } catch (updateErr) {
                logger.error(`🚨🚨 [CentralService][DisasterHandler] TCP 인박스 FAILED 상태 업데이트 실패 (tcp_receive_log ID: ${tcpReceiveLogId}): ${updateErr.message}`);
            }            
        }        

        // 실패 응답(NACK) 전송 시도
        if (receivedData) {
            const errorBuffer = createCnfDisInfoBuffer(receivedData, alert ? receivedData.capInfo : null, err);
            if (errorBuffer) {
                sessionManager.send(errorBuffer, '재난 정보 수신 실패 응답')
                logger.warn(`➡️ [CentralService][DisasterHandler] 재난 정보 처리 실패. 오류 응답(NACK) 전송 (Inbound ID: ${inboundId}, Seq: ${inboundSeq}, Error: ${err.name}).`);
            } else {
                logger.error(`🚨 [CentralService][DisasterHandler] 실패 응답 버퍼 생성 실패 (Inbound ID: ${inboundId}). NACK 전송 불가.`);
            }
        } else {
            logger.error(`🚨 [CentralService][DisasterHandler] receivedData 없음. 실패 응답(NACK) 전송 불가 (Inbound ID: ${inboundId}, Seq: ${inboundSeq}).`);
        }   

    } finally {

        if (client) {
            client.release();
            logger.debug(`✅ [CentralService][DisasterHandler] DB 클라이언트 반환 완료.`);
        }        

    }

}

module.exports = {
    handleDisasterInfo,
};