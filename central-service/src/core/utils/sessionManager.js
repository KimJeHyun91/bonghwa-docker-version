/**
 * @file sessionManager.js
 * @description 중앙 시스템과의 단일 TCP 연결(소켓) 상태를 중앙에서 관리하고,
 * 안전한 데이터 전송을 위한 인터페이스를 제공합니다.
 */

const logger = require('./logger');

const sessionManager = {

    // 현재 활성화된 중앙 시스템과의 소켓 연결을 저장하는 변수
    currentSocket: null,

    /**
     * 중앙 시스템과 새로운 소켓 연결이 맺어졌을 때 호출됩니다.
     * @param {import('net').Socket} socket - 연결된 소켓 객체
     */
    setConnection(socket) {
        logger.info('🔌 [CentralService][SessionManager] 새 소켓 연결 등록 완료.');
        this.currentSocket = socket;
    },

    /**
     * 중앙 시스템과의 소켓 연결이 끊어졌을 때 호출됩니다.
     */
    clearConnection() {
        logger.info('✅ [CentralService][SessionManager] 소켓 연결 정보 제거 완료');
        this.currentSocket = null;
    },

    /**
     * 현재 활성화된 소켓 객체를 반환합니다.
     * @returns {import('net').Socket | null} 현재 소켓 객체 또는 null 
     */
    getConnection() {
        return this.currentSocket;
    },

    /**
     * 현재 중앙 시스템과의 연결 상태를 확인합니다.
     * @returns {boolean} 연결되어 있으면 true, 아니면 false
     */
    isConnected() {
        // 소켓이 존재하고, 파괴되지 않았으며, 쓰기 가능한 상태인지 모드 확인하여 안정성을 높입니다.
        return this.currentSocket && !this.currentSocket.destroyed && this.currentSocket.writable;
    },

    /**
     * 중앙 시스템으로 메시지를 안전하게 전송합니다.
     * @param {Buffer} messageBuffer - 전송할 메시지 버퍼
     * @param {string} [logContext='메시지'] - 로그에 표시할 메시지 종류
     */
    send(messageBuffer, logContext = '메시지') {
        if (this.isConnected()) {
            try {
                this.currentSocket.write(messageBuffer);
                logger.debug(`➡️ [CentralService][SessionManager] 메시지 전송 완료 (${logContext}, Size: ${messageBuffer.length} bytes).`);
            } catch (writeErr) {
                logger.error(`🚨 [CentralService][SessionManager] 메시지 전송(write) 중 오류 발생 (${logContext}): ${writeErr.message}`);
                // 오류 발생 시 연결 강제 종료
                this.currentSocket?.destroy();
            }
            
        } else {
            logger.error(`🚨 [CentralService][SessionManager] 연결이 끊김. ${logContext} 전송 불가.`);
            // 전송 실패 시, reliableTransmitService의 재시도 호직이 처리하므로 여기서 별도 처리는 불필요합니다.
        }
    },

};

// 싱글턴(Singleton)으로 객체 자체를 내보내서 애플리케이션 전체에서 동일한 인스턴스를 공유하도록 합니다.
module.exports = sessionManager;