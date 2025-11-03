/**
 * @file auth.js
 * @description Socket.IO 연결에 대한 인증 미들웨어를 정의합니다.
 */

const logger = require('../core/utils/logger');
const externalSystemRepository = require('../core/repositories/externalSystemRepository');
const connectionLogRepository = require('../core/repositories/connectionLogRepository');

/**
 * Socket.IO 연결 요청을 인증합니다.
 * @param {import('socket.io').Socket} socket - 소켓 인스턴스
 * @param {import('socket.io').NextFunction} next - 다음 미들웨어로 제어를 넘기는 함수
 */
async function socketAuth(socket, next) {
    
    // 클라이언트가 연결 시도 시 'auth' 객체에 담아 보낸 인증 정보를 추출합니다.
    const { systemName, apiKey } = socket.handshake.auth;
    const ipAddress = socket.handshake.address;

    logger.debug(`[ExternalService][SocketAuth] API 인증 시작 (System: ${systemName || 'N/A'}, IP: ${ipAddress}).`);

    if (!systemName || !apiKey) {
        logger.warn(`🚨 [ExternalService][SocketAuth] 인증 정보 누락 (IP: ${ipAddress}). 401 반환.`);
        const err = new Error('인증에 실패했습니다. systemName과 apiKey가 필요합니다.');
        err.data = { code: 401 };
        return next(err); // 클라이언트에게 반환
    }

    try {

        const externalSystem = await externalSystemRepository.findByNameAndApiKey(systemName, apiKey);

        // 1. 시스템이 존재하지 않는 경우
        if (!externalSystem) {
            logger.warn(`🚨 [ExternalService][SocketAuth] 인증 실패: 시스템 [${systemName}] 정보 없음. 401 반환.`);
            const err = new Error(`인증에 실패했습니다. 제공된 정보가 유효하지 않습니다.`);
            err.data = { code: 401 };
            return next(err);
        }

        // 2. 시스템이 비활성화 된 경우
        if (!externalSystem.is_active) {
            await connectionLogRepository.create({
                externalSystemId: externalSystem.id,
                eventType: 'SOCKET_AUTH_FAILED',
                ipAddress,
                detail: '비활성화된 시스템 접근 시도',
            });
            logger.warn(`🚨 [ExternalService][SocketAuth] 인증 실패: 시스템 [${systemName}] 비활성화. 401 반환.`);
        
            const err = new Error('인증에 실패했습니다. 제공된 정보가 유효하지 않습니다.');
            err.data = { code: 401 };
            return next(err);
        }

        // 인증 성공
        await connectionLogRepository.create({
            externalSystemId: externalSystem.id,
            eventType: 'SOCKET_AUTH_SUCCESS',
            ipAddress,
        });

        logger.info(`✅ [ExternalService][SocketAuth] 인증 성공 (System: ${systemName}, ID: ${externalSystem.id}). Next 호출.`);

        // 소켓 객체에 시스템 정보를 첨부하여, 이후 이벤트 핸들러에서 사용할 수 있도록 합니다.
        socket.system = externalSystem;
        next();

    } catch (err) {

        logger.error(`🚨 [ExternalService][SocketAuth] DB 오류 발생. 인증 처리 실패 (System: ${systemName}, IP: ${ipAddress}): ${err.message}`, { stack: err.stack });
        
        const dbErr = new Error('인증 처리 중 서버 내부 오류가 발생했습니다.');
        dbErr.data = { code: 500 };
        next(dbErr);

    }

}

module.exports = socketAuth;