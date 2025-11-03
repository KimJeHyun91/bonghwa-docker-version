/**
 * @file messageRouter.js
 * @description 중앙 시스템으로부터 파싱된 메시지를 Message ID에 따라 
 * 적절한 핸들러로 분배(라우팅) 합니다.
 */

const config = require('../../config');
const logger = require('../../core/utils/logger');
const authHandler = require('./authHandler');
const sessionHandler = require('./sessionHandler');
const disasterHandler = require('./disasterHandler');
const reliableTransmitService = require('../../core/services/reliableTransmitService');

/**
 * 수신된 메시지를 적절한 핸들러로 전달합니다.
 * @param {object} message - 파싱이 완료된 메시지 객체 { header, body }
 */
async function route(message) {

    const { header, body } = message;
    const messageId = header?.messageId;
    const messageIdHex = messageId?.toString(16);

    logger.debug(`⬅️ [CentralService][MessageRouter] 메시지 수신 (ID: 0x${messageIdHex}), 라우팅 시작...`);

    try {
        
        if (messageId === undefined || messageId === null) {
            throw new Error('메시지 헤더 또는 messageId 누락.');
        }

        let handlerName = '알 수 없음';        

        switch (messageId) {

            // --- 인증 관련 메시지 ---
            case config.tcp.protocol.MESSAGE_IDS.ETS_RES_SYS_CON:
                handlerName = 'authHandler.handleAuthResponse';
                logger.debug(`[CentralService][MessageRouter] 라우팅: ${handlerName} 호출.`);
                await authHandler.handleAuthResponse(body);
                break;

            // --- 세션 체크 관련 메시지 ---
            case config.tcp.protocol.MESSAGE_IDS.ETS_RES_SYS_STS:
                handlerName = 'sessionHandler.handleSessionResponse';
                logger.debug(`[CentralService][MessageRouter] 라우팅: ${handlerName} 호출.`);
                await sessionHandler.handleSessionResponse(body);
                break;

            // --- 재난 정보 수신 ---
            case config.tcp.protocol.MESSAGE_IDS.ETS_NFY_DIS_INFO:
                handlerName = 'disasterHandler.handleDisasterInfo';
                logger.debug(`[CentralService][MessageRouter] 라우팅: ${handlerName} 호출.`);
                await disasterHandler.handleDisasterInfo(body);
                break;
            
            // --- 단말기 제원 보고에 대한 응답 ---
            case config.tcp.protocol.MESSAGE_IDS.ETS_CNF_DEVICE_INFO:
            // --- 단말기 상태 보고에 대한 응답 ---
            case config.tcp.protocol.MESSAGE_IDS.ETS_CNF_DEVICE_STS:
            // --- 재난 정보 결과 보고에 대한 응답 ---
            case config.tcp.protocol.MESSAGE_IDS.ETS_RES_DIS_REPORT:
                // 위 3가지 경우는 모두 우리가 보낸 메시지에 대한 응답(ACK)이므로,
                // 신뢰성 있는 전송 서비스에 처리를 위임합니다.
                handlerName = 'reliableTransmitService.processAck';
                logger.debug(`[CentralService][MessageRouter] 라우팅: ${handlerName} 호출.`);
                await reliableTransmitService.processAck(body);
                break;

            // --- 그 외 정의되지 않은 메시지 ---
            default:
                logger.warn(`🔔 [CentralService][MessageRouter] 알 수 없는 Message ID를 수신했습니다: 0x${messageIdHex}`);
                break;

        }

        logger.debug(`✅ [CentralService][MessageRouter] 메시지 처리 완료 (ID: 0x${messageIdHex}, Handler: ${handlerName}).`);

    } catch (err) {
        
        logger.error(`🚨 [CentralService][MessageRouter] 메시지 처리 오류 (ID: 0x${messageIdHex}): ${err.message}`);

    }    

}

module.exports = {
    route,
};