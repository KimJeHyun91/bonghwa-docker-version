/**
 * @file authService.js
 * @description Digest 인증 방식의 응답 값을 계산하는 서비스입니다.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../../config');

/**
 * 주어진 문자열의 MD5 해시 값을 계산하여 대문자 HEX 문자열로 반환하는 헬퍼 함수입니다.
 * @param {string} string - 해시할 문자열
 * @returns {string} MD5 해시 결과
 * @private
 */
function _md5(string) {
    return crypto.createHash('md5').update(string).digest('hex').toUpperCase();
}

const authService = {

    /**
     * 중앙 시스템 설계서의 Digest 인증 방식에 따라 암호화된 response 값을 계산합니다.
     * @param {object} params - 계산에 필요한 파라미터 객체
     * @param {string} params.realm - 서버가 제공한 realm 값
     * @param {string} params.nonce - 서버가 제공한 nonce 값
     * @returns {string} 최종적으로 계산된 암호화된 response 값
     */
    calculateResponse({ realm, nonce }) {

        const { DEST_ID, PASSWORD } = config.auth;

        // 1단계: A1 = MD5(<destId>:<realm>:<비밀번호>)
        const a1String = `${DEST_ID}:${realm}:${PASSWORD}`;
        const a1 = _md5(a1String);
        logger.debug(`✅ [CentralService][AuthService] A1 계산: MD5("${a1String}") -> ${a1}`);

        // 2단계: response = MD5(A1:<nonce>)
        const responseString = `${a1}:${nonce}`;
        const response = _md5(responseString);
        logger.debug(`✅ [CentralService][AuthService] Response 계산: MD5("${responseString}") -> ${response}`);

        return response;

    },

};

module.exports = authService;