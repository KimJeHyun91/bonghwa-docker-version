/**
 * @file capService.js
 * @description CAP(Common Alerting Protocol) 관련 공통 로직(파싱, 생성 등)을 처리하는 통합 서비스입니다.
 */

const config = require('../../config');
const logger = require('../utils/logger');
const { xmlParser, xmlBuilder } = require('../utils/protocolUtils');
const { DateTime } = require('luxon');

const CENTRAL_SYSTEM_SENDER_ID = config.CENTRAL_SYSTEM_SENDER_ID;
const CENTRAL_SERVICE_SENDER_ID = config.CENTRAL_SERVICE_SENDER_ID;

// --- XML <-> JS Object 변환 ---

/**
 * CAP XML 문자열을 JavaScript 객체로 파싱합니다.
 * @param {string} capXmlString - 파싱할 CAP XML 문자열
 * @returns {Promise<object>} 파싱된 JavaScript 객체를 반환하는 Promise
 */
async function parseCap(capXmlString) {

    logger.debug('🚀 [CentralService][CapService] CAP XML 파싱 시작...');

    try {

        const result = await xmlParser.parseStringPromise(capXmlString);
        logger.debug('✅ [CentralService][CapService] CAP XML 파싱 완료.');
        return result;
    
    } catch (err) {

        logger.error(`🚨 [CentralService][CapService] CAP XML 파싱 중 오류 발생: ${err.message}`);
        // 파싱 실패 시, 상위 핸들러가 catch하여 처리할 수 있도록 에러를 던집니다.
        throw new Error('유효하지 않은 CAP XML 형식.');

    }

}

/**
 * JavaScript 객체를 CAP XML 문자열로 변환합니다.
 * CDATA 섹션을 포합하여 변환합니다.
 * @param {object} capObject - XML로 변환할 JavaScript 객체
 * @returns {string} 변환된 XML 문자열
 */
function buildCap(capObject) {

    logger.debug('🚀 [CentralService][CapService] CAP XML 빌드 시작...');

    try {
        
        const xmlString = xmlBuilder.buildObject(capObject);
        logger.debug('✅ [CentralService][CapService] CAP XML 빌드 완료.');
        return xmlString;

    } catch (err) {

        logger.error(`🚨 [CentralService][CapService] CAP XML 빌드 중 오류 발생: ${err.message}`);
        throw new Error('CAP XML 생성 실패.');

    }

}

// --- 수신(Inbound) 응답(ACK) CAP 객체 생성 ---

/**
 * 수신한 재난 정보(CAP)를 기반으로 성공/실패 응답(ACK) CAP 객체를 생성합니다.
 * @param {object} originalCap - 수신된 원본 CAP의 JavaScript 객체
 * @param {string} noteCode - note 코드 (예: '000', '300', '210' 등)
 * @param {string} noteMessage - 결과 메시지
 * @returns {object} 응답용 CAP JavaScript 객체
 */
function createAckCap(originalCap, noteCode, noteMessage) {

    logger.debug(`🚀 [CentralService][CapService] ACK CAP 객체 생성 시작 (Identifier: ${originalCap?.alert?.identifier}, Note: ${noteCode})...`);
    
    const dt = DateTime.local().setZone('Asia/Seoul');
    const customFormat = dt.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
    
    // originalCap 객체가 유효하지 않으면 , 응답 메시지 자체를 만들 수 없으므로 에러를 발생시킵니다.
    if (!originalCap || !originalCap.alert) {
        logger.error('🚨 [CentralService][CapService] 응답 CAP 생성을 위한 원본 CAP 객체가 유효하지 않음.');
        throw new Error('응답 CAP(ACK) 생성을 위한 원본 CAP 객체가 유효하지 않음.');
    }
    const originalAlert = originalCap.alert;
    const ackObject = {
        alert: {
            $: { xmlns: 'urn:oasis:names:tc:emergency:cap:1.2' },
            identifier: `${originalAlert.identifier}_ACK`,
            sender: CENTRAL_SERVICE_SENDER_ID, // 보내는 주체: 중앙 서비스
            sent: customFormat,
            status: 'System',
            msgType: 'Ack',
            scope: 'Private',
            address: CENTRAL_SYSTEM_SENDER_ID, // 받는 주체: 중앙 시스템
            code: '대한민국정부1.2',
            note: `${noteCode}|${noteMessage}`,
            references: `${originalAlert.sender},${originalAlert.identifier},${originalAlert.sent}`,
        },
    };
    
    logger.debug(`✅ [CentralService][CapService] ACK CAP 객체 생성 완료 (Identifier: ${ackObject.alert.identifier}).`);
    return ackObject;

}

// --- 발신(Outbound) CAP 객체 생성 ---

/**
 * 단말기 제원 정보 보고 CAP 객체를 생성합니다.
 * @param {string} identifier - 이 메시지의 고유 식별자 (outbound_id와 동일)
 * @param {object} rawMessege - RabbitMQ로부터 수신한 원본 데이터 { deviceList: [...] }
 * @param {string} systemName - 요청을 보낸 외부 시스템의 이름
 * @returns {object} CAP alert 객체
 */
function buildDeviceInfoCap(identifier, rawMessege, systemName) {

    logger.debug(`🚀 [CentralService][CapService] 단말기 제원 정보 CAP 생성 시작 (ID: ${identifier}, System: ${systemName})...`);

    const dt = DateTime.local().setZone('Asia/Seoul');
    const customFormat = dt.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");

    const capObject = {
        alert: {
            $: { xmlns: 'urn:oasis:names:tc:emergency:cap:1.2' },
            identifier: identifier,
            sender: CENTRAL_SERVICE_SENDER_ID, // 보내는 주체: 중앙 서비스
            sent: customFormat,
            status: 'System',
            msgType: 'Alert',
            scope: 'Private',
            addresses: CENTRAL_SYSTEM_SENDER_ID, // 받는 주체: 중앙 시스템
            code: ['대한민국정부1.2', 'I-C-LAS1.0'],
            info: {
                category: 'Other',
                event: '단말장치 제원정보',
                urgency: 'Unknown',
                severity: 'Unknown',
                certainty: 'Unknown',
                eventCode: { valueName: 'KR.eventCode', value: 'DIS' },
                senderName: '봉화 재난 정보 게이트웨이',
                headline: `${systemName} 단말장치 제원정보`,
                parameter: {
                    valueName: 'DEVICE_DATA',
                    // CDATA 섹션으로 감싸기 위해 xml2js의 특별한 형식을 사용
                    value: JSON.stringify(rawMessege),
                },
            },
        },
    };

    logger.debug(`✅ [CentralService][CapService] 단말기 제원 정보 CAP 객체 생성 완료 (ID: ${identifier}).`);
    return capObject;

}

/**
 * 단말기 상태 정보 보고 CAP 객체를 생성합니다.
 * @param {string} identifier - 이 메시지의 고유 식별자 (outbound_id와 동일)
 * @param {object} rawMessege - RabbitMQ로부터 수신한 원본 데이터 { deviceList: [...] }
 * @param {string} systemName - 요청을 보낸 외부 시스템의 이름
 * @returns {object} CAP alert 객체
 */
function buildDeviceStatusCap(identifier, rawMessege, systemName) {

    logger.debug(`🚀 [CentralService][CapService] [CapService] 단말기 상태 정보 CAP 생성 시작 (ID: ${identifier}, System: ${systemName})...`);

    const dt = DateTime.local().setZone('Asia/Seoul');
    const customFormat = dt.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");

    const capObject = {
        alert: {
            $: { xmlns: 'urn:oasis:names:tc:emergency:cap:1.2' },
            identifier: identifier,
            sender: CENTRAL_SERVICE_SENDER_ID, // 보내는 주체: 중앙 서비스
            sent: customFormat,
            status: 'System',
            msgType: 'Alert',
            scope: 'Private',
            addresses: CENTRAL_SYSTEM_SENDER_ID, // 받는 주체: 중앙 시스템
            code: ['대한민국정부1.2', 'I-C-LAS1.0'],
            info: {
                category: 'Other',
                event: '단말장치 상태정보',
                urgency: 'Unknown',
                severity: 'Unknown',
                certainty: 'Unknown',
                eventCode: { valueName: 'KR.eventCode', value: 'DIS' },
                senderName: '봉화 재난 정보 게이트웨이',
                headline: `${systemName} 단말장치 상태정보`,
                parameter: {
                    valueName: 'DEVICE_STATUS',
                    // CDATA 섹션으로 감싸기 위해 xml2js의 특별한 형식을 사용
                    value: JSON.stringify(rawMessege),
                },
            },
        },
    };

    logger.debug(`✅ [CentralService][CapService] 단말기 상태 정보 CAP 객체 생성 완료 (ID: ${identifier}).`);
    return capObject;

}

/**
 * 재난 정보 결과 보고 CAP 객체를 생성합니다.
 * @param {string} identifier - 이 메시지의 고유 식별자 (호출하는 쪽에서 'OriginalIdentifier_RPT_1' 형식으로 생성해야 함) 
 * @param {object} rawMessege - RabbitMQ로부터 수신한 원본 데이터 { identifier: ..., reportList: [...] }
 * @param {string} systemName - 요청을 보낸 외부 시스템의 이름 (이 함수에서는 사용되지 않음)
 * @param {string} originalSentTime - 원본 재난 정보의 sent 시간
 * @param {string} originalSender - 원본 재난 정보의 sender
 * @returns {object} CAP alert 객체
 */
function buildDisasterResultCap(identifier, rawMessege, systemName, originalSentTime, originalSender) {

    logger.debug(`🚀 [CentralService][CapService] 재난 정보 결과 보고 CAP 생성 시작 (ID: ${identifier}, System: ${systemName})...`);
    
    const dt = DateTime.local().setZone('Asia/Seoul');
    const customFormat = dt.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
    
    const capObject = {
        alert: {
            $: { xmlns: 'urn:oasis:names:tc:emergency:cap:1.2' },
            identifier: identifier,
            sender: CENTRAL_SERVICE_SENDER_ID, // 보내는 주체: 중앙 서비스
            sent: customFormat,
            status: 'System',
            msgType: 'Ack',
            scope: 'Private',
            addresses: CENTRAL_SYSTEM_SENDER_ID, // 받는 주체: 중앙 시스템
            code: ['대한민국정부1.2', 'I-C-LAS1.0'],
            note: '800', // 800: 경보 서비스 확인 (결과 보고 시 고정값)
            references: `${originalSender},${rawMessege.identifier},${originalSentTime}`,
            info: {
                category: 'Other',
                event: '결과 보고',
                urgency: 'Unknown',
                severity: 'Unknown',
                certainty: 'Unknown',
                eventCode: { valueName: 'KR.eventCode', value: 'DIM' },
                senderName: '봉화 재난 정보 게이트웨이',
                headline: '재난 정보 처리결과',
                parameter: {
                    valueName: 'LASReport',
                    // CDATA 섹션으로 감싸기 위해 xml2js의 특별한 형식을 사용
                    value: JSON.stringify(rawMessege),
                },
            },
        },
    };

    logger.debug(`✅ [CentralService][CapService] 재난 정보 결과 CAP 객체 생성 완료 (ID: ${identifier}).`);
    return capObject;

}

module.exports = {
    parseCap,
    buildCap,
    createAckCap,
    buildDeviceInfoCap,
    buildDeviceStatusCap,
    buildDisasterResultCap,
};