/**
 * @file customValidators.js
 * @description express-validator를 위한 재사용 가능한 커스텀 유효성 검사 함수들을 정의합니다.
 */

const disasterTransmitLogRepository = require('../../core/repositories/disasterTransmitLogRepository');
const logger = require('../../core/utils/logger');

/**
 * 값이 'yyyymmddhhmiss' 형식이며, 유효한 과거 시간인지 검사합니다.
 * @param {string} value - 검사할 문자열 값
 * @param {boolean} - 유효성 검사를 통과하면 true
 * @throws {Error} - 유효성 검사를 통과하지 못하면 오류 발생
 */
const isValidPastTimestamp = (value) => {

    logger.debug(`🚀 [ExternalService][CustomValidator] isValidPastTimestamp 검사 시작 (Value: ${value}).`);

    // 1. 형식 검사 (14자리 숫자인지)
    if (!/^\d{14}/.test(value)) {
        logger.warn(`🚨 [ExternalService][CustomValidator] 시간 형식 오류: 14자리 숫자가 아님 (Value: ${value}).`);
        throw new Error('"yyyymmddhhmiss" 형식의 14자리 숫자여야 합니다.');
    }

    const year = parseInt(value.substring(0, 4), 10);
    const month = parseInt(value.substring(4, 6), 10);
    const day = parseInt(value.substring(6, 8), 10);
    const hour = parseInt(value.substring(8, 10), 10);
    const minute = parseInt(value.substring(10, 12), 10);
    const second = parseInt(value.substring(12, 14), 10);

    // JavaScript Data month는 0 - indexed (0 - 11) 입니다.
    const date = new Date(year, month - 1, day, hour, minute, second);

    // 2. 유효한 날짜인지 확인 (예: 2월 30일 같은 잘못된 날짜 방지)
    // Date 객체가 자동으로 날짜를 조정하는 것을 역으로 확인합니다.
    if (
        date.getFullYear() !== year || 
        date.getMonth() !== month - 1 || 
        date.getDate() !== day ||
        date.getHours() !== hour ||
        date.getMinutes() !== minute ||
        date.getSeconds() !== second
    ) {
        logger.warn(`🚨 [ExternalService][CustomValidator] 시간 논리 오류: 유효하지 않은 날짜 값 (Value: ${value}).`);
        throw new Error('유효하지 않은 날짜 형식입니다 (예: 월/일 범위 초과.');
    }

    // 3. 현재 시간 이전인지 확인
    if (date > new Date()) {
        throw new Error(`${value}는 현재 시간보다 이전이어야 합니다.`);
    }

    // 모든 검사를 통과하면 true를 반환합니다.
    logger.debug(`✅ [ExternalService][CustomValidator] isValidPastTimestamp 검사 완료 (Value: ${value}).`);
    return true;

};

/**
 * 주어진 identifier가 disaster_transmit_logs 테이블에 존재하는지 비동기적으로 검사합니다.
 * @param {string} identifier - 검사할 재난 정보의 고유 식별자
 * @returns {Promise<boolean>} 존재하면 true, 아니면 Error를 throw
 */
const isExistingIdentifier = async (identifier) => {

    logger.debug(`🚀 [ExternalService][CustomValidator] isExistingIdentifier 검사 시작 (Identifier: ${identifier})...`);
    
    const exists = await disasterTransmitLogRepository.existsByIdentifier(identifier);
    if (!exists) {
        logger.warn(`🚨 [ExternalService][CustomValidator] 식별자 존재 오류: 해당 재난 정보 없음 (Identifier: ${identifier}).`);
        throw new Error(`존재하지 않는 재난 정보 식별자(identifier)입니다: ${identifier}`);
    }

    logger.debug(`✅ [ExternalService][CustomValidator] isExistingIdentifier 검사 완료 (Identifier: ${identifier}).`);
    return true;

}

module.exports = {
    isValidPastTimestamp,
    isExistingIdentifier,
};