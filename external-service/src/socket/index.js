/**
 * @file index.js
 * @description Socket.IO 서버를 초기화하고 클라이언트 연결을 관리합니다.
 */

const logger = require('../core/utils/logger')
const socketAuth = require('./auth');
const sessionManager = require('./sessionManager');
const registerEventHandlers = require('./handlers/eventHandler');

/**
 * Socket.IO 서버 인스턴스를 초기화하고, 미들웨어와 이벤트 핸들러를 설정합니다.
 * @param {import('socket.io').Server} io - Socket.IO 서버 인스턴스
 */
function initializeSocket(io) {

    // 모든 소켓 연결 시도에 대해 인증 미들웨어를 적용합니다.
    io.use(socketAuth);

    // 'connection' 이벤트: 클라이언트가 성공적으로 인증하고 연결되었을 때 발생합니다.
    io.on('connection', (socket) => {
        // socket.system 객체는 인증 미들웨어(socketAuth)에서 추가해준 정보입니다.
        const systemName = socket.system.system_name;
        logger.info(`🔌 [ExternalService][Socket] 외부 시스템 연결 완료 (System: ${systemName}, Socket ID: ${socket.id}).`);

        // 세션 매니저에 현재 소켓 세션을 추가합니다.
        sessionManager.addSocket(socket).catch(err => {
            logger.error(`🚨 [ExternalService][Socket] 시스템 [${systemName}] 연결 초기화 오류. 소켓 종료됨: ${err.message}`);
            socket.disconnect(true);
        });

        // 해당 소켓에 대한 이벤트 핸들러들을 등록합니다. (예: 'ack', 'nack', 'heartbeat')
        registerEventHandlers(io, socket);

        // 'disconnect' 이벤트: 클라이언트와의 연결이 끊어졌을 때 발생합니다.
        socket.on('disconnect', (reason) => {
            logger.warn(`🔌 [ExternalService][Socket] 외부 시스템 연결 끊김 (System: ${systemName}, Socket ID: ${socket.id}, 사유: ${reason}).`);
            // 세션 매니저에서 해당 소켓 세션을 제거합니다.
            sessionManager.removeSocket(socket, reason).catch(err => {
                logger.error(`🚨 [ExternalService][Socket] 시스템 [${systemName}] 연결 해제 정리 중 오류 발생: ${err.message}`);
            });
        });
    });

}

module.exports = initializeSocket;


