/**
 * @file sessionManager.js
 * @description 활성 Socket.IO 연결(세션)을 관리합니다.
 * 외부 시스템 ID 하나당 하나의 소켓만 허용하도록 변경
 */

const logger = require('../core/utils/logger');
const connectionLogRepository = require('../core/repositories/connectionLogRepository');

/**
 * 활성 소켓 연결을 저장하는 Map 객체입니다.
 * Key: external_system_id (number)
 * Value: Socket 객체 (Socket)
 * @type {Map<number, import('socket.io').Socket>}
 */
const activeSockets = new Map();

/**
 * 새로운 소켓 연결을 추가합니다.
 * 동일한 external_system_id로 이미 연결된 소켓이 있다면, 기존 연결을 끊고 새로운 연결로 대체합니다.
 * @param {import('socket.io').Socket} socket - 새로 연결된 소켓 객체
 */
async function addSocket(socket) {
    
    const systemId = socket.system.id;
    const systemName = socket.system.system_name;
    const socketId = socket.id;
    const ipAddress = socket.handshake.address;

    // 동일한 systemId로 기존 연결이 있는지 확인
    const existingSocket = activeSockets.get(systemId);
    if (existingSocket) {
        logger.warn(`🔔 [ExternalService][SessionManager] 기본 연결 감지. 시스템 [${systemName}] (System ID: ${systemId})의 소켓 [${existingSocket.id}] 종료 후 새 소켓 [${socket.id}]로 대체.`);
        
        await connectionLogRepository.create({
            externalSystemId: systemId,
            eventType: 'SOCKET_DISCONNECTED',
            ipAddress: existingSocket.handshake.address,
            detail: `기존 연결(Socket ID: ${existingSocket.id})을 끊고 새 연결(Socket ID: ${socketId}) 시도.`,
        });
        logger.debug(`✅ [ExternalService][SessionManager] 기존 연결 종료 로그 기록 완료.`);

        // 기존 소켓 강제 종료
        existingSocket.disconnect(true);
        // Map에서 제거 (새 소켓 등록 전에 제거)
        activeSockets.delete(systemId);
    }

    // 새로운 소켓을 Map에 등록
    activeSockets.set(systemId, socket);
    logger.info(`✅ [ExternalService][SessionManager] 소켓 등록 완료 (System: ${systemName}, System ID: ${systemId}, Socket ID: ${socketId}).`);

    await connectionLogRepository.create({
        externalSystemId: systemId,
        eventType: 'SOCKET_CONNECTED',
        ipAddress: ipAddress,
        detail: `새로운 연결(Socket ID: ${socketId}) 완료.`,
    });
    logger.debug(`✅ [ExternalService][SessionManager] 새 연결 로그 기록 완료 (System ID: ${systemId}).`);
    
}

/**
 * 소켓 연결 해제을 제거합니다.
 * @param {import('socket.io').Socket} socket - 연결 해제된 소켓 객체
 * @param {string} reason - 연결 해제 사유
 */
async function removeSocket(socket, reason) {

    const systemId = socket.system?.id;
    const systemName = socket.system?.system_name;
    const socketId = socket.id;
    const ipAddress = socket.handshake.address;

    if (!systemId) {
        logger.debug(`[ExternalService][SessionManager] 미인증/미추적 소켓 해제 (Socket ID: ${socketId}, 사유: ${reason}). 로그 기록 생략.`);
        return;
    }

    if (systemId && activeSockets.has(systemId)) {

        // Map에 저장된 소켓이 현재 연결 해제된 소켓과 동일한 경우에만 제거
        if (activeSockets.get(systemId) === socket) {
            activeSockets.delete(systemId);
            logger.info(`🔌 [ExternalService][SessionManager] 소켓 연결 완료 (System: ${systemName}, System ID: ${systemId}, Socket ID: ${socketId}, 사유: ${reason}).`);
            
            try {
                await connectionLogRepository.create({
                    externalSystemId: systemId,
                    eventType: 'SOCKET_DISCONNECTED',
                    ipAddress: ipAddress,
                    detail: reason,
                });
                logger.debug(`✅ [ExternalService][SessionManager] 연결 해제 로그 기록 완료 (System ID: ${systemId}).`);
            } catch (dbErr) {
                logger.error(`🚨 [ExternalService][SessionManager] DB 로그 기록 실패: 연결 해제 이벤트 (System ID: ${systemId}, Error: ${dbErr.message})`);
                throw dbErr;
            }
            

            logger.debug(`✅ [ExternalService][SessionManager] 연결 해제 로그 기록 완료 (System ID: ${systemId})`);
        } else {
            logger.warn(`🔔 [ExternalService][SessionManager] 해제 소켓 [${socketId}]은 시스템 [${systemName}]의 현재 활성 소켓이 아님. 무시.`);
        }

    } else {

        // 인증 전에 끊긴 경우 등 systemId가 없는 경우
        logger.debug(`[ExternalService][SessionManager] 미인증/미추적 소켓 해제 (Socket ID: ${socketId}, 사유: ${reason}).`);

    }

}

/**
 * 주어진 external_system_id에 해당하는 활성 소켓을 반환합니다.
 * @param {number} systemId - 외부 시스템ID
 * @returns {import('socket.io').Socket | undefined} 활성 소켓 객체 또는 undefined
 */
function getSocketBySystemId(systemId) {
    return activeSockets.get(systemId);
}

/**
 * 주어진 외부 시스템 이름에 해당하는 활성 소켓을 반환합니다.
 * @param {string} systemName - 외부 시스템 이름
 * @return {import('socket.io').Socket | undefined} 찾은 유일한 활성 소켓 객체 또는 undefined
 */
function getSocketBySystemName(systemName) {
    // Map의 값(소켓 객체)들을 순회하며 system_name이 일치하는 유일한 소켓을 찾습니다.
    for (const socket of activeSockets.values()) {
        if (socket.system?.system_name === systemName) {
            return socket;
        }
    }
    return undefined;
}

/**
 * 현재 활성 상태인 모든 소켓 목록을 반환합니다.
 * @returns {Array<import('socket.io').Socket>} 활성 소켓 객체의 배열 
 */
function getAllActiveSockets() {
    return Array.from(activeSockets.values());
}


module.exports = {
    addSocket,
    removeSocket,
    getSocketBySystemId,
    getSocketBySystemName,
    getAllActiveSockets,
};