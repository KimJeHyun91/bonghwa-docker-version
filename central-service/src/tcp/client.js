/**
 * @file client.js
 * @description 중앙 시스템에 접속하고 연결 상태를 관리하는 TCP 클라이언트입니다.
 * 자동 재연결 및 정상 종료 로직을 포함합니다.
 */

const net = require('net');
const config = require('../config');
const logger = require('../core/utils/logger');
const ProtocolParser = require('./protocolParser');
const { route } = require('./handlers/messageRouter');
const authHandler = require('./handlers/authHandler');
const sessionHandler = require('./handlers/sessionHandler');
const sessionManager = require('../core/utils/sessionManager');

class TCPClient {

    SERVER_IP = config.tcp.IP;
    SERVER_PORT = config.tcp.PORT;
    RECONNECT_INTERVAL = config.tcp.protocol.TIMERS.RECONNECT_INTERVAL;

    socket = null;
    parser = null;
    isConnecting = false;
    isConnected = false;
    shouldReconnect = true; // 정상 종료 시 재연결을 막기 위한 플래그

    constructor() {}

    /**
     * 중앙 시스템에 연결을 시도합니다.
     */
    connect() {

        logger.debug('🚀 [CentralService][TCPClient] 연결 시작...');

        if (this.isConnecting || this.isConnected) {

            logger.warn('🔔 [CentralService][TCPClient] 연결 시도 불필요. 이미 연결 중이거나 연결된 상태.');
            return;

        }

        try {

            this.isConnecting = true;
            this.shouldReconnect = true; // 재연결 시도 플래그 활성화
            logger.info(`🔌 [CentralService][TCPClient] 중앙 시스템 연결 시도 (${this.SERVER_IP}:${this.SERVER_PORT}).`);

            // net.connect를 사용하여 서버에 접속
            this.socket = net.connect({ host: this.SERVER_IP, port: this.SERVER_PORT });
            logger.debug('[CentralService][TCPClient] 소켓 객체 생성 및 연결 시도.');

            // 소켓의 생명주기 이벤트에 핸들러를 등록합니다.
            this.socket.on('connect', this.handleConnect.bind(this));
            this.socket.on('close', this.handleClose.bind(this));
            this.socket.on('error', this.handleError.bind(this));
            logger.debug('✅ [CentralService][TCPClient] 소켓 이벤트 핸들러 등록 완료.');

            // 이 연결을 위한 전용 프로토콜 파서 생성
            this.parser = new ProtocolParser();
            // 소켓에서 데이터가 들어오면 자동으로 파서로 연결(pipe)
            this.socket.pipe(this.parser);
            logger.debug('✅ [CentralService][TCPClient] 프로토콜 파서 생성 및 파이프 연결 완료.');

            // 파서가 완전한 메시지를 조립했을 때, 메시지 라우터로 전달합니다.
            this.parser.on('message', async (message) => {
                const messageIdHex = message?.header?.messageId?.toString(16);
                logger.debug(`⬅️ [CentralService][TCPClient] 파서 'message' 이벤트 수신 (ID: 0x${messageIdHex}).`);
                try {
                    await route(message);
                } catch (err) {
                    logger.error(`🚨 [CentralService][TCPClient] MessageRouter 처리 오류 (ID: 0x${messageIdHex}): ${err.message}`);
                }
            });

            logger.debug("✅ [CentralService][TCPClient] 파서 'message' 이벤트 핸들러 등록 완료.");

        } catch (err) {
            logger.error(`🚨 [CentralService][TCPClient] 연결 시도 중 치명적인 오류 발생: ${err.message}`);
            // 연결 시도 자체를 실패했으므로, isConnecting을 false로 되돌리고
            // handleClose 로직을 수동으로 트리거하여 재연결을 유도합니다.
            this.isConnecting = false;
            this.handleClose(true);
        }       

    }

    /**
     * 연결 성공 시 처리 로직
     */
    handleConnect() {

        logger.debug("⬅️ [CentralService][TCPClient] 소켓 'connect' 이벤트 수신.");

        try {

            this.isConnecting = false;
            this.isConnected = true;
            logger.info(`🔌 [CentralService][TCPClient] 중앙 시스템 연결 완료 (${this.SERVER_IP}:${this.SERVER_PORT}).`);

            // sessionManager에 현재 활성화된 소켓을 등록합니다.
            sessionManager.setConnection(this.socket);
            // 연결 성공 후, 가장 먼저 인증 절차를 시작합니다.
            authHandler.sendInitialAuthRequest();

        } catch (err) {

            logger.error(`🚨 [CentralService][TCPClient] 연결 성공 후 초기화(handleConnect) 오류: ${err.message}`);
            // 인증 요청 실패는 치명적이므로, 연결을 강제 종료하여 재연결을 유도합니다.
            this.socket?.destroy();

        }      

    }

    /**
     * 연결 종료 시 처리 로직
     * @param {boolean} [isErrorClose=false]
     */
    handleClose(isErrorClose = false) {

        logger.warn(`🔔 [CentralService][TCPClient] 중앙 시스템 연결 끊김${isErrorClose ? ' (오류 발생)' : ''}.`);
        
        // 이전 상태 저장 (재연결 로직 결정용)
        const wasConnected = this.isConnected;
        const wasConnecting = this.isConnecting;

        this.isConnected = false;
        this.isConnecting = false;

        // 연결이 종료되었으므로 모든 관련 상태를 초기화합니다.
        sessionManager.clearConnection();
        sessionHandler.stopSessionCheck(); // 주기적인 세션 체크(Ping/Pong) 중지

        // 정상 종료(disconnect 호출)가 아닐 경우에만 재연결을 시도합니다.
        if (this.shouldReconnect && (wasConnected || wasConnecting)) {
            logger.info(`[CentralService][TCPClient] ${this.RECONNECT_INTERVAL / 1000}초 후 재연결 시도 예정.`);
            setTimeout(() => this.connect(), this.RECONNECT_INTERVAL);
        } else {
            logger.info('[CentralService][TCPClient] 재연결 시도 안 함.');
        }

    }

    /**
     * 소켓 에러 발생 시 처리 로직
     * @param {Error} err
     */
    handleError(err) {

        logger.error(`🚨 [CentralService][TCPClient] 소켓 에러 발생: ${err.message}`);
        // 에러 발생 시 소켓은 자동으로 'close' 이벤트를 발생시키므로,
        // handleClose에서 재연결 로직이 처리됩니다.
    
    }

    /**
     * 외부(index.js)에서 정상 종료를 위해 호출하는 메소드
     * @param {function} callback - 종료 완료 후 호출될 콜백 함수
     */
    disconnect(callback) {

        logger.info(`🔔 [CentralService][TCPClient] 정상 종료 시작: 연결을 해제 시도...`);
        this.shouldReconnect = false; // 재연결 시도 방지

        if (this.socket && !this.socket.destroyed) {
            logger.debug('[CentralService][TCPClient] 소켓 end() 호출.');
            // end()를 호출하여 정상적인 종료 절차를 시작합니다.
            // 완료되면 'close' 이벤트가 발생합니다.
            this.socket.end(() => {
                logger.debug('[CentralService][TCPClient] 소켓 end() 콜백 실행.');
                if (callback) {
                    callback();
                }
            });
            // 안전 장치: end() 후 일정 시간 내 close 이벤트 없으면 강제 종료
            setTimeout(() => {
                if (this.socket && !this.socket.destroyed) {
                    logger.warn('[CentralService][TCPClient] end() 후 close 지연. 강제 destroy() 호출.');
                    this.socket.destroy();
                }
            }, 5000);
        } else {
            logger.debug('[CentralService][TCPClient] 소켓 없음 또는 이미 파괴됨. 콜백 즉시 실행.');
            if (callback) {
                callback();
            }
        }

    }

    /**
     * 모니터링 API를 위한 현재 상태 반환 메소드
     */
    getStatus() {
        return {
            target: `중앙 시스템 (${this.SERVER_IP}:${this.SERVER_PORT})`,
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
        };
    }

}

// 싱글턴 패턴: 애플리케이션 전체에서 단 하나의 클라이언트 인스턴스만 사용하도록 보장
const TCPClientInstance = new TCPClient();

module.exports = TCPClientInstance;