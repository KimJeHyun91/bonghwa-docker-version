/**
 * @file responseUtils.js
 * @description 오류 유형에 따라 설계서 규격에 맞는 응답 메시지를 생성하는 유틸리티입니다.
 */

const config = require('../../config');
const capService = require('../services/capService');
const logger = require('./logger');
const { buildMessageBuffer } = require('./protocolUtils');

// --- 커스텀 에러 클래스 정의 ---
// 각 클래스 특정 실패 시나리오를 나타내며, mapErrorToResponseCodes에서 식별자로 사용됩니다.

/**
 * 메시지 유효성(구조, 형식) 오류 (Note Code: 210)
 */
class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

/**
 * 프로파일(내용, 규칙) 해석 오류 (Note Code: 220)
 */
class ProfileError  extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProfileError';
    }    
}

/**
 * 메시지 중복 오류 (Note Code: 300)
 */
class DuplicateMessageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DuplicateMessageError';
    }
}

/**
 * 파싱 오류 (Note Code: 810)
 */
class ParsingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ParsingError';
    }
}

/**
 * 오류 객체를 기반으로 resultCode, resultText, noteCode, noteMessage를 모두 포함하는 응답 코드 객체를 생성합니다.
 * @param {Error} [error] - 발생한 오류 객체
 * @returns {{resultCode: string, resultText: string, noteCode: string, noteMessage: string}}
 */
function _mapErrorToResponseCode(error) {

    // 에러가 없으면 성공으로 간주하고 '000' 코드를 반환합니다.
    if (!error) {
        return { resultCode: '200', resultText: 'OK', noteCode: '000', noteMessage: '메시지 수신 확인' };
    }

    // 에러 객체의 이름(name)을 기준으로 실패 유형을 식별합니다.
    switch (error.name) {
        case 'ValidationError':
            return { resultCode: '400', resultText: 'Bad Request', noteCode: '210', noteMessage: `메시지 유효성 오류: ${error.message}` };
        case 'ProfileError':
            return { resultCode: '400', resultText: 'Bad Request', noteCode: '220', noteMessage: `프로파일 해석 오류: ${error.message}` };
        case 'DuplicateMessageError':
            return { resultCode: '400', resultText: 'Bad Request', noteCode: '300', noteMessage: `메시지 중복 확인: ${error.message}` };
        case 'ParsingError':
            return { resultCode: '500', resultText: 'Internal Server Error', noteCode: '810', noteMessage: `CAP 파싱 실패: ${error.message}` };
        default: // 그 외 모든 예상치 못한 내부 오류 (DB 오류 등)
            return { resultCode: '500', resultText: 'Internal Server Error', noteCode: '810', noteMessage: `재난 정보 게이트웨이 내부 오류: ${error.message}` };
    }

}

/**
 * 재난 정보 수신 결과(성공/실패)에 대한 최종 응답 메시지 버퍼를 생성합니다.
 * @param {object} receivedData - 수신된 메시지의 외부 XML 래퍼 객체
 * @param {object|null} capInfoObject - 성공적으로 파싱된 CAP 객체 (파싱 실패 시 null)
 * @param {Error|null} [error] - 발생된 오류 객체 (성공 시에는 null)
 * @returns {Buffer} 전송할 최종 메시지 버퍼 
 */
function createCnfDisInfoBuffer(receivedData, capInfoObject, error = null) {

    const inboundId = receivedData?.transMsgId;
    logger.debug(`🚀 [CentralService][ResponseUtils] 응답 버퍼 생성 시작 (Inbound ID: ${inboundId}, Error: ${error?.name || '없음'})...`);
    
    try {

        // receivedData 자체가 null일 가능성 방지
        if (!receivedData?.transMsgId || receivedData.transMsgSeq === undefined) {
            throw new Error('receivedData 또는 필수 필드(transMsgId, transMsgSeq) 누락.');
        }

        const { transMsgId, transMsgSeq } = receivedData;
        const { resultCode, resultText, noteCode, noteMessage } = _mapErrorToResponseCode(error);
        
        let ackCapObject = null;
        // capInfoObject가 있을 경우 ACK CAP 메시지를 생성합니다.
        if (capInfoObject) {
            ackCapObject = capService.createAckCap(capInfoObject, noteCode, noteMessage);
        } 

        const responseXmlObject = {
            data: {
                resultCode: resultCode,
                result: resultText,
                transMsgSeq: transMsgSeq,
                transMsgId: transMsgId,
                capInfo: ackCapObject,
            },
        };

        const finalBuffer = buildMessageBuffer(config.tcp.protocol.MESSAGE_IDS.ETS_CNF_DIS_INFO, responseXmlObject);

        // buildMessageBuffer가 null을 반환하면 생성 실패로 간주
        if (finalBuffer === null) {
            throw new Error('buildMessageBuffer 함수가 null 반환.');
        }

        logger.debug(`✅ [CentralService][ResponseUtils] 응답 버퍼 생성 완료 (Inbound ID: ${inboundId}, Code: ${resultCode}, Note: ${noteCode}).`);

        return finalBuffer;

    } catch (err) {

        // 응답 메시지 '생성 자체'를 실패한 치명적인 상황
        // 이 경우, 응답 전송을 포기하고 로그만 남깁니다.
        logger.error(`🚨 [CentralService][ResponseUtils] 응답 버퍼 생성 오류(Inbound ID: ${inboundId}): ${err.message}`);
        // null 또는 빈 버퍼를 반환하여, 상위 핸들러가 전송을 시도하지 않도록 할 수 있습니다.
        return null;

    }  

}

module.exports = {
    createCnfDisInfoBuffer,
    ValidationError,
    ProfileError,
    DuplicateMessageError,
    ParsingError,
};