/**
 * @file sessionHandler.js
 * @description 중앙 시스템과의 주기적인 세션 체크(Keep-Alive) 메시지를 처리하는 핸들러입니다.
 */

const logger = require('../../core/utils/logger');
const config = require('../../config');
const sessionManager = require('../../core/utils/sessionManager');
const { xmlParser, buildMessageBuffer } = require('../../core/utils/protocolUtils');
const { DateTime } = require('luxon');

let sessionCheckTimer = null;
let pongTimeoutId = null;

const SESSION_CHECK_INTERVAL = config.tcp.protocol.TIMERS.SESSION_CHECK_INTERVAL;
const PONG_TIMEOUT = config.tcp.protocol.TIMERS.RESPONSE_TIMEOUT;
const ETS_REQ_SYS_STS = config.tcp.protocol.MESSAGE_IDS.ETS_REQ_SYS_STS;
const DEST_ID = config.auth.DEST_ID;

/**
 * 주기적으로 중앙 시스템 서버에 세션 확인(ping)을 요청하는 내부 함수.
 */
function sendSessionCheckRequest() {

    logger.debug('[CentralService][SessionHandler] Ping 전송 시도.');

    try {
        
        const dt = DateTime.local().setZone('Asia/Seoul');
        const customFormat = dt.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");

        // 이전 Pong 타임아웃이 비정상적으로 남아있을 수 있으므로 안전하게 제거합니다.
        clearTimeout(pongTimeoutId);
        pongTimeoutId = null;

        logger.debug(`➡️ [CentralService][SessionHandler] 세션 체크(ping) 전송 시작...`);

        const xmlObject = {
            data: {
                destId: DEST_ID,
                cmd: 'alive',
                time: customFormat
            },
        };
        const messageBuffer = buildMessageBuffer(ETS_REQ_SYS_STS, xmlObject);

        if (messageBuffer === null) {
            throw new Error('buildMessageBuffer 반환갑이 null.');
        }

        sessionManager.send(messageBuffer, '세션 체크 요청');

        // Ping을 보낸 직후, Pong 타임아웃 타이머를 설정합니다.
        logger.debug(`[CentralService][SessionHandler] Pong 타임아웃 타이머 설정 (${PONG_TIMEOUT /1000}초).`);
        pongTimeoutId = setTimeout(() => {
            pongTimeoutId = null; // 타임아웃 발생 시 ID 초기화
            logger.error(`🚨 [CentralService][SessionHandler] Pong 응답 타임아웃 (${PONG_TIMEOUT /1000}초). 연결 종료.`);
            //연결을 강제로 종료하면 client의 'close' 이벤트가 발생하여 재연결 로직이 실행됩니다.
            sessionManager.getConnection()?.destroy();
        }, PONG_TIMEOUT);

    } catch (err) {

        // Ping 전송 실패(예: 메시지 생성 실패)는 Pong 타임아웃과 동일하게 치명적인 오류
        logger.error(`🚨 [CentralService][SessionHandler] Ping 메시지 생성/전송 오류: ${err.message}. 연결 종료.`);
        sessionManager.getConnection()?.destroy(); // 연결 종료하여 재연결 유도

    }    

}

/**
 * 주기적인 세션 체크를 시작합니다.
 * 이 함수는 인증 성공 시 'authHandler'에서 호출됩니다.
 */
function startSessionCheck() {

    if (sessionCheckTimer) {
        logger.warn(`🔔 [CentralService][SessionHandler] 세션 체크 이미 실행 중.`);
        return;
    }
    
    logger.info(`🚀 [CentralService][SessionHandler] 세션 체크 시작 (주기: ${SESSION_CHECK_INTERVAL / 1000}초)...`);

    // 첫 Ping은 즉시 보내고, 그 이후 SESSION_CHECK_INTERVAL 간격으로 보냅니다.
    sendSessionCheckRequest();
    sessionCheckTimer = setInterval(sendSessionCheckRequest, SESSION_CHECK_INTERVAL);

}

/**
 * 주기적인 세션 체크를 중지합니다,
 * 이 함수는 연결이 끊어졌을 때 'client'에서 호출됩니다.
 */
function stopSessionCheck() {
    
    let stopped = false;

    if (sessionCheckTimer) {
        clearInterval(sessionCheckTimer);
        sessionCheckTimer = null;
        stopped = true;
        logger.debug('✅ [CentralService][SessionHandler] 세션 체크 타이머(setInterval) 중지 완료.');
    }
    if (pongTimeoutId) {
        clearTimeout(pongTimeoutId);
        pongTimeoutId = null;
        stopped = true;
        logger.debug('✅ [CentralService][SessionHandler] Pong 타임아웃 타이머(setTimeout) 중지 완료.');
    }

    if (stopped) {
        logger.info('🔌 [CentralService][SessionHandler] 세션 체크 중지 완료.');
    } else {
        logger.debug('[CentralService][SessionHandler] 세션 체크 이미 중지된 상태.');
    }
    

}

/**
 * 중앙 시스템으로부터 받은 세션 체크 응답(ETS_RES_SYS_STS)을 처리합니다.
 * @param {Buffer} messageBodyBuffer
 */
async function handleSessionResponse(messageBodyBuffer) {

    logger.debug('🚀 [CentralService][SessionHandler] Pong 응답 수신. 처리 시작...');

    // Pong 응답을 받으면, 대기 중이던 PONG_TIMEOUT 타이머를 즉시 해제합니다.
    if (pongTimeoutId) {
        clearTimeout(pongTimeoutId);
        pongTimeoutId = null;
        logger.debug('✅ [CentralService][SessionHandler] Pong 타임아웃 타이머 해제 완료.');
    } else {
        logger.warn('🔔 [CentralService][SessionHandler] Pong 응답 수신 시 활성 타임아웃 타이머 없음.');
    }

    try {

        const xmlString = messageBodyBuffer.toString('utf-8');
        const result = await xmlParser.parseStringPromise(xmlString);
        const data = result.data;

        // 응답 코드 확인
        const resultCode = String(data?.resultCode);
        const resultMessage = data?.result;
        const cmd = data?.cmd;

        if (resultCode === '200') {
            logger.debug(`⬅️ [CentralService][SessionHandler] Pong 응답 수신: 정상 (Code: ${resultCode}, Msg: ${resultMessage}, Cmd: ${cmd}).`);
        } else {
            logger.warn(`⬅️ [CentralService][SessionHandler] Pong 응답 수신: 비정상  (Code: ${resultCode}, Msg: ${resultMessage}, Cmd: ${cmd}).`);
        }

    } catch (err) {

        logger.error(`🚨[CentralService] [SessionHandler] Pong 응답 처리 오류: ${err.message}`);

    }

}

module.exports = {
    handleSessionResponse,
    stopSessionCheck,
    startSessionCheck,
};