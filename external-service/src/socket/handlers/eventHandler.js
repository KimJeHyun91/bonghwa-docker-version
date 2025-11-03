/**
 * @file eventHandler.js
 * @description 개별 소켓 연결에 대한 이벤트 핸들러를 등록합니다.
 */

const logger = require('../../core/utils/logger');

/**
 * 주어진 소켓에 대한 모든 이벤트 핸들러에 등록합니다.
 * @param {import('socket.io').Server} io - Socket.IO 서버 인스턴스
 * @param {import('socket.io').Socket} socket - 개별 클라이언트 소켓 인스턴스
 */
function registerEventHandlers(io, socket) {
    
    const systemName = socket.system.system_name;
    
    logger.debug(`🚀 [ExternalService][EventHandler] 이벤트 핸들러 등록 시작 (System: ${systemName}, Socket ID: ${socket.id})`);

    // 'heartbeat' 이벤트 핸들러: 클라이언트가 연결 상태를 확인하기 위해 주기적으로 보냅니다.
    socket.on('heartbeat', (payload, callback) => {
        logger.debug(`⬅️ [ExternalService][EventHandler] Heartbeat 수신 (System: ${systemName}, Socket ID: ${socket.id}).`);
        // 클라이언트에게 즉시 응답(ack)을 보내 서버가 살아있음을 알립니다.
        // callback 함수를 사용하면 클라이언트에서 응답을 받을 수 있습니다.
        if (typeof callback === 'function') {
            callback({ status: 'ok' });
            logger.debug(`➡️ [ExternalService][EventHandler] Heartbeat 응답(ACK) 전송 완료.`);
        }
    });

}

module.exports = registerEventHandlers;