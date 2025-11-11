/**
 * @file protocolUtils.js
 * @description 프로토콜 관련 공통 유틸리티 함수 및 객체를 관리합니다.
 * (XML 파서/빌더, 메시지 버퍼 생성 등)
 */

const xml2js = require('xml2js');
const { create } = require('xmlbuilder2');
const config = require('../../config');
const logger = require('./logger');

// 애플리케이션 전체에서 사용할 xml2js 파서/빌더 인스턴스
const xmlParser = new xml2js.Parser({ explicitArray: false });

/**
 * 메시지 헤더와 XML 바디를 포함하는 완전한 TCP 메시지 버퍼를 생성합니다.
 * @param {number} messageId - 메시지 ID
 * @param {object} xmlObject - XMl로 변환될 JavaScript 객체
 * @returns {Buffer} 전송을 위한 최종 버퍼
 */
function buildMessageBuffer(messageId, xmlObject) {

    logger.debug(`🚀 [CentralService][ProtocolUtils] 메시지 버퍼 생성 시작 (Msg ID: 0x${messageId.toString(16)})...`);

    try {
        logger.error(`1`);
        const xmlBody = create(xmlObject).end({ headless: true, cdata: true });

        
        logger.error(`2`);
        logger.debug(`[CentralService][ProtocolUtils] 전송될 XML 문자열 (Msg ID: 0x${messageId.toString(16)}):\n${xmlBody}`);
        logger.error(`3`);
        const bodyBuffer = Buffer.from(xmlBody, 'utf-8');
        logger.error(`4`);
        const headerBuffer = Buffer.alloc(config.tcp.protocol.HEADER.HEADER_LENGTH);
        headerBuffer.writeUInt32BE(messageId, 0); // Message ID
        headerBuffer.writeUInt32BE(config.tcp.protocol.HEADER.DATA_FORMAT, 4); // Data Format
        headerBuffer.writeUInt32BE(config.tcp.protocol.HEADER.MAGIC_NUMBER, 8); // Magic Number
        headerBuffer.writeUInt32BE(bodyBuffer.length, 12); // Data Length

        logger.debug(`[CentralService][ProtocolUtils] 헤더 HEX: ${headerBuffer.toString('hex')}`);
        logger.debug(`[CentralService][ProtocolUtils] ID=0x${headerBuffer.readUInt32BE(0).toString(16)}, Length=${headerBuffer.readUInt32BE(12)}`);

        const finalBuffer =  Buffer.concat([headerBuffer, bodyBuffer]);
        logger.debug(`✅ [CentralService][ProtocolUtils] 메시지 버퍼 생성 완료 (Msg ID: 0x${messageId.toString(16)}, Size: ${finalBuffer.length} bytes).`);

        return finalBuffer;

    } catch (err) {

        // 이 함수를 호출한 곳에서 오류를 처리할 수 있도록 다시 던짐
        logger.error(`🚨 [CentralService][ProtocolUtils] 메시지 버퍼 생성 오류 (Msg ID: 0x${messageId.toString(16)}): ${err.message}`);
        return null;

    }    

}

module.exports = {
    xmlParser,
    buildMessageBuffer,
};
