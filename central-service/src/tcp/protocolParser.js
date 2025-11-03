/**
 * @file protocolParser.js
 * @description 중앙 시스템과의 TCP 데이터 스트림을 설계서의 프로토콜에 따라
 * 완전한 메시지 다위로 파싱하는 Transform 스트림입니다.
 */

const { Transform } = require('stream');
const logger = require('../core/utils/logger');
const config = require('../config');

// 프로토콜 헤더의 고정 길이
const HEADER_LENGTH = config.tcp.protocol.HEADER.HEADER_LENGTH;
// 프로토콜 식별을 위한 고유 번호 (Magic Number)
const MAGIC_NUMBER = config.tcp.protocol.HEADER.MAGIC_NUMBER;
// DoS 공격 방지를 위한 최대 바디 길이
const MAX_BODY_LENGTH = config.tcp.protocol.MAX_BODY_LENGTH;

class ProtocolParser extends Transform {

    // 수신 데이터를 임시로 저장할 내부 버퍼
    buffer = Buffer.alloc(0);
    // 현재 읽어야 할 데이터의 길이 (초기값은 헤더 길이)
    neededLength = HEADER_LENGTH;
    // 현재 파싱 상태 ('HEADER' 또는 'BODY')
    parsingState = 'HEADER';
    // 파싱된 헤더 정보를 임시 저장할 객체
    header = null;

    constructor(options) {
        
        // 객체 모드로 스트림을 설정하여 Buffer가 아닌 JavaScript 객체를 전달할 수 있도록 합니다.
        super({ ...options, objectMode: true });
        logger.debug('✅ [CentralService][Parser] ProtocolParser 인스턴스 생성 완료.');

    }

    /**
     * 스트림에서 새로운 데이터 조각(chunk)를 받았을 때 자동으로 호출되는 메소드
     * @param {Buffer} chunk - 수신되 데이터 조각
     * @param {string} encoding - 인코딩 (보통 무시됨)
     * @param {function} callback - 처리가 완료되었음을 알리는 콜백 함수
     */
    _transform(chunk, encoding, callback) {
        logger.debug(`⬅️ [CentralService][Parser] 데이터 수신 (${chunk.length} bytes). 버퍼 추가.`);

        // 새로 들어온 데이터를 내부 버퍼에 추가합니다.
        this.buffer = Buffer.concat([this.buffer, chunk]);
        logger.debug(`[CentralService][Parser] 현재 버퍼 크기: ${this.buffer.length} bytes.`);

        // 버퍼에 처리할 데이터가 남아있는 동안 계속 파싱을 시도합니다.
        while (this.buffer.length >= this.neededLength) {
            
            logger.debug(`[CentralService][Parser] 파싱 시도 (필요 길이: ${this.neededLength}, 상태: ${this.parsingState})`);

            try {

                if (this.parsingState === 'HEADER') {

                    this._parseHeader();

                } else if (this.parsingState === 'BODY') {

                    this._parseBody();

                }

            } catch (err) {

                // 파싱 오류(Macgic Number, Data Length 초과) 발생 시 초기화
                this._resetParserState();
                
                // 버퍼가 비워졌으므로 현재 while 루프를 중단하고
                // 다음 데이터 청크를 기다립니다.
                break;

            }
            
        }

        // 현재 청크에 대한 처리가 끝났음을 스트림에 알립니다.
        callback();

    }

    /**
     * 헤더를 파싱하는 내부 메소드
     */
    _parseHeader() {

        // --- 헤더 파싱 단계 ---
        const headerBuffer = this.buffer.subarray(0, HEADER_LENGTH);

        logger.debug(`🚀 [CentralService][Parser] 헤더 파싱 시작: ${headerBuffer.toString('hex')}...`);

        // 1. 헤더에서 각 필드 값을 읽습니다. (Big Endian 형식)
        const messageId = headerBuffer.readUint32BE(0);
        const dataFormat = headerBuffer.readUint32BE(4);
        const magicNumber = headerBuffer.readUint32BE(8);
        const dataLength = headerBuffer.readUint32BE(12);
        logger.debug(`[CentralService][Parser] 헤더 필드: MsgID=0x${messageId.toString(16)}, Format=${dataFormat}, Magic=0x${magicNumber.toString(16)}, Length=${dataLength}`);

        // 2. Magic Number를 검증하여 유효한 프로토콜인지 확인합니다.
        if (magicNumber !== MAGIC_NUMBER) {
            const errMsg = `유효하지 않은 Magic Number 수신: 0x${magicNumber.toString(16)}. 기대값: 0x${MAGIC_NUMBER.toString(16)}`;
            logger.error(`🚨 [CentralService][Parser] 헤더 오류: ${errMsg}`);
            // 오류를 발생시켜 _transform의 catch 블록으로 전달합니다.
            throw new Error(errMsg);
        }

        // 3. Data Length가 설정한 최대값을 초과하는지 검사합니다. (DoS 방지)
        if (dataLength > MAX_BODY_LENGTH) {
            const errMsg = `데이터 길이 초과: ${dataLength} bytes. (최대 허용: ${MAX_BODY_LENGTH} bytes)`;
            logger.error(`🚨 [CentralService][Parser] 헤더 오류: ${errMsg}`);
            // 오류를 발생시켜 _transform의 catch 블록으로 전달합니다.
            throw new Error(errMsg);
        }

        // 4. 파싱된 헤더 정보를 저장하고, 다음 단계(BODY)로 상태를 변경합니다.
        this.header = { messageId, dataFormat, magicNumber, dataLength };
        this.neededLength = dataLength;
        this.parsingState = 'BODY';
        logger.debug(`✅ [CentralService][Parser] 헤더 파싱 완료. 다음 상태: BODY, 필요 길이: ${dataLength} bytes.`);

        // 5. 내부 버퍼에서 처리된 헤더 부분을 제거합니다.
        this.buffer = this.buffer.subarray(HEADER_LENGTH);

        // 만약 바디 길이가 0이라면 (헤더만 있는 메시지), 즉시 메시지를 완성하고 다음 헤더를 기다립니다.
        if (this.neededLength === 0) {
            logger.debug('[CentralService][Parser] Body 길이 0 확인. 메시지 즉시 완성.');
            this.emitCompleteMessage();
        }

    }

    /**
     * 바디를 파싱하는 내부 메소드
     */
    _parseBody() {

        const bodyLengthToParse = this.neededLength;
        logger.debug(`🚀 [CentralService][Parser] Body 파싱 시작 (${bodyLengthToParse} bytes)...`);

        // 1. 버퍼에서 필요한 길이만큼 바디 데이터를 잘라냅니다.
        const bodyBuffer = this.buffer.subarray(0, bodyLengthToParse);

        // 2. 완성된 메시지(헤더 + 바디)를 'message' 이벤트로 발생시킵니다.
        this.emitCompleteMessage(bodyBuffer);

        // 3. 내부 버퍼에서 처리된 바디 부분을 제거합니다.
        this.buffer = this.buffer.subarray(bodyLengthToParse);
        logger.debug(`✅ [CentralService][Parser] Body 파싱 완료. 버퍼에서 ${bodyLengthToParse} bytes 제거.`);
    
    }

    /**
     * 완성된 메시지를 'message' 이벤트로 발생시키고 상태를 초기화합니다.
     * @param {Buffer} [bodyBuffer] - 메시지의 바디 버퍼 (없을 수도 있음)
     */
    emitCompleteMessage(bodyBuffer = Buffer.alloc(0)) {

        const completeMessage = {
            header: this.header,
            body: bodyBuffer,
        };
        const messageIdHex = this.header.toString(16);
        const dataLength = this.header.dataLength;

        logger.debug(`🔔 [CentralService][Parser] 'message' 이벤트 발생 (ID: 0x${messageIdHex}, Size: ${dataLength} bytes).`);

        this.emit('message', completeMessage);

        // 다음 메시지를 파싱하기 위해 상태를 초기화합니다.
        this.header = null;
        this.neededLength = HEADER_LENGTH;
        this.parsingState = 'HEADER';
        logger.debug('✅ [CentralService][Parser] 파서 상태 초기화 완료 (다음 상태: HEADER).');

        logger.debug(`✅ [CentralService][Parser] 메시지 파싱 완료 (ID: 0x${messageIdHex}, Size: ${dataLength} bytes)`);       

    }

    /**
     * 파서의 상태를 초기화하고 버퍼를 비웁니다.
     */
    _resetParserState() {
        logger.warn(`🚨 [CentralService][Parser] 프로토콜 오류 감지. 파서의 상태 초기화 및 버퍼 비움.`);
        this.buffer = Buffer.alloc(0);
        this.header = null;
        this.neededLength = HEADER_LENGTH;
        this.parsingState = 'HEADER';
    }

}

module.exports = ProtocolParser;