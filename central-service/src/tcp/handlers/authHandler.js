/**
 * @file authHandler.js
 * @description 중앙 시스템과의 접속/인증 관련 메시지를 처리하는 핸들러입니다.
 */

const logger = require('../../core/utils/logger');
const config = require('../../config');
const authService = require('../../core/services/authService');
const sessionManager = require('../../core/utils/sessionManager');
const sessionHandler = require('./sessionHandler');
const { xmlParser, buildMessageBuffer } = require('../../core/utils/protocolUtils');

// 인증 응답을 기다리는 타이머 ID
let authTimeoutId = null;

const AUTH_TIMEOUT = config.tcp.protocol.TIMERS.RESPONSE_TIMEOUT;
const DEST_ID = config.auth.DEST_ID;
const ETS_REQ_SYS_CON = config.tcp.protocol.MESSAGE_IDS.ETS_REQ_SYS_CON;

/**
 * 인증 타임아웃 타이머를 설정합니다.
 * @param {string} waitingFor - 무엇을 기다리는지에 대한 로그 메시지
 */
function _startAuthTimeout(waitingFor) {
    
    _clearAuthTimeout(); // 이전 타이머 안전하게 제거
    logger.debug(`🚀 [CentralService][TCPAuth] 인증 타임아웃 타이머 시작 (${AUTH_TIMEOUT / 1000}초). 대기 대상: ${waitingFor}`);

    authTimeoutId = setTimeout(() => {
        authTimeoutId = null;
        logger.error(`🚨 [CentralService][TCPAuth] ${waitingFor} 응답 타임아웃 (${AUTH_TIMEOUT / 1000}초). 연결 종료.`);
        sessionManager.getConnection()?.destroy();
    }, AUTH_TIMEOUT);

}

/**
 * 설정된 인증 타임아웃 타이머를 해제합니다.
 */
function _clearAuthTimeout() {

    if (authTimeoutId) {
        clearTimeout(authTimeoutId);
        authTimeoutId = null;
        logger.debug('✅ [CentralService][TCPAuth] 인증 타임아웃 타이머 해제 완료.');
    }

}

/**
 * 서버에 연결 직후, 가장 처음으로 보내는 인증 요청 메시지를 전송합니다.
 */
function sendInitialAuthRequest() {

    logger.info('🚀 [CentralService][TCPAuth] 초기 인증 요청 전송 시작...');

    try {
        const xmlObject = { 
            data: { 
                destId: DEST_ID 
            } 
        };
        const messageBuffer = buildMessageBuffer(ETS_REQ_SYS_CON, xmlObject);

        if (messageBuffer === null) {
            throw new Error('buildMessageBuffer 반환값이 null.');
        }

        sessionManager.send(messageBuffer, '초기 인증 요청');

        // 서버의 인증 요구(401)를 기다리는 타이머를 시작합니다.
        _startAuthTimeout('서버의 인증 요구(401)');
    } catch (err) {
        logger.error(`🚨 [CentralService][TCPAuth] 초기 인증 요청 생성/전송 오류: ${err.message}. 연결 종료.`);
        sessionManager.getConnection()?.destroy(); // 치명적 오류로 간주하고 연결 종료
    }   

}

/**
 * 중앙 시스템으로부터 받은 인증 관련 응답 메시지(ETS_RES_SYS_CON)를 처리합니다.
 * @param {Buffer} messageBodyBuffer
 */
async function handleAuthResponse(messageBodyBuffer) {

    // 어떤 응답이든 도착했으므로, 이전 타이머를 해제합니다.
    _clearAuthTimeout();

    try {
        
        const xmlString = messageBodyBuffer.toString('utf-8');
        const result = await xmlParser.parseStringPromise(xmlString);
        const data = result.data;

        if (!data.resultCode) {
            throw new Error('인증 응답 resultCode 누락.');
        }

        logger.debug(`⬅️ [CentralService][TCPAuth] 인증 응답 수신 (Code: ${data.resultCode}, Msg: ${data.result})`);

        switch (String(data.resultCode)) {
            
            case '401':
                logger.info('⬅️ [CentralService][TCPAuth] 서버 인증 요구(401) 수신. 암호화된 응답 전송 시작...');
                const { realm, nonce } = data;

                if (!realm) {
                    throw new Error('인증 요구(401) realm 누락.');
                }
                if (!nonce) {
                    throw new Error('인증 요구(401) nonce 누락.');
                }

                const response = authService.calculateResponse({ realm, nonce });
                const responseXml = { 
                    data: { 
                        destId: DEST_ID, 
                        realm, 
                        nonce, 
                        response 
                    }
                };
                const messageBuffer = buildMessageBuffer(ETS_REQ_SYS_CON, responseXml);

                sessionManager.send(messageBuffer, '암호화된 인증 응답');
                logger.info('➡️ [CentralService][TCPAuth] 암호화된 인증 응답 전송 완료.');

                // 최종 인증 결과(200)을 기다리는 새로운 타이머를 시작합니다.
                _startAuthTimeout('최종 인증 결과(200)');
                break;

            case '200':
                logger.info('✅ [CentralService][TCPAuth] 서버 인증 성공. 세션 활성화.');
                // 주기적인 세션 체크(Ping/Pong)를 시작합니다.
                sessionHandler.startSessionCheck();
                break;

            case '400':
                logger.error('🚨 [CentralService][TCPAuth] 서버 응답: 잘못된 요청(400). destId 확인 필요. 연결 종료.');
                sessionManager.getConnection()?.destroy();
                break;

            case '404':
                logger.error('🚨 [CentralService][TCPAuth] 서버 응답: 사용자 없음(404). destId 확인 필요. 연결 종료.');
                sessionManager.getConnection()?.destroy();
                break;

            case '500':
                logger.error('🚨 [CentralService][TCPAuth] 서버 응답: 내부 오류(500). 연결 종료.');
                sessionManager.getConnection()?.destroy();
                break;

            default:
                logger.error(`🚨 [CentralService][TCPAuth] 알 수 없는 인증 응답 코드 수신: ${data.resultCode}. 연결 종료.`);
                sessionManager.getConnection()?.destroy();
                break;

        }

    } catch (err) {

        logger.error(`🚨 [CentralService][TCPAuth] 인증 응답 처리 오류: [${err.name}] ${err.message}`);
        logger.warn('🔔 [CentralService][TCPAuth] 비정상 인증 메시지 수신. 연결 종료.');
        sessionManager.getConnection()?.destroy();

    }

}

module.exports = {
    sendInitialAuthRequest,
    handleAuthResponse,
};