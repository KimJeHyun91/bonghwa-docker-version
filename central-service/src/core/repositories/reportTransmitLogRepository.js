/**
 * @file reportTransmitLogRepository.js
 * @description report_transmit_logs 테이블(보고 정보 아웃박스)과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');
const config = require('../../config');

/**
 * 보고 발신 로그를 생성합니다.
 * @param {number} mqReceiveLogId - 메시지큐 수신 로그 아이디
 * @param {string} type - 보고 종류
 * @param {string} outboundId - 중앙 서비스에서 생성한 transMsgId
 * @param {string} externalSystemName - 외부 시스템 이름
 * @param {object} rawMessage - RabbitMQ로부터 수신한 메시지의 원본 문자열
 */
async function create(mqReceiveLogId, type, outboundId, externalSystemName, rawMessage) {
    
    const query = `
        INSERT INTO report_transmit_logs (mq_receive_log_id, type, outbound_id, external_system_name, raw_message)
        VALUES ($1, $2, $3, $4, $5)
    `;
    const values = [mqReceiveLogId, type, outboundId, externalSystemName, rawMessage];
    await pool.query(query, values);    
    
}

/**
 * ID를 기준으로 발신 로그의 상태(status)를 업데이트합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @param {string} status - 새로운 상태 ('SENT', 'SUCCESS', 'FAILED')
 * @returns {Promise<void>}
 */
async function updateStatusById(logId, status, errorDetail = null) {
    
    const query = `
        UPDATE report_transmit_logs
        SET status = $2, error_detail = $3
        WHERE id = $1;
    `;
    const values = [logId, status, errorDetail];
    await pool.query(query, values);

}

/**
 * ID를 기준으로 발신 로그의 재시도 횟수(retry_count)와 보고 시퀸스(report_sequence) 1 증가시킵니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @returns {Promise<void>}
 */
async function incrementRetryCountAndReportSequence(logId) {
    
    const query = `
        UPDATE report_transmit_logs
        SET retry_count = retry_count + 1, report_sequence = report_sequence + 1
        WHERE id = $1;
    `;
    await pool.query(query, [logId]);

}

/**
 * Outbound Id와 Report Sequence로 보고 발신 로그를 조회합니다.
 * @param {string} outboundId - 중앙 서비스에서 생성한 transMsgId
 * @param {number} reportSequence - 중앙 서비스에서 생성한 transMsgSeq
 * @returns {Promise<object>} 발신 로그 객체
 */
async function findByOutboundIdAndReportSequence(outboundId, reportSequence) {
    
    const query = `
        SELECT *
        FROM report_transmit_logs
        WHERE outbound_id = $1 AND report_sequence = $2
        LIMIT 1;
    `;
    const values = [outboundId, reportSequence]
    const { rows } = await pool.query(query, values); 
    return rows[0];

}

/**
 * 아직 처리되지 않은 (재발신이 필요한) 발신 로그 목록을 조회합니다. (워커용)
 * @returns {Promise<Array<object>>} 처리되지 않은 발신 로그 객체의 배열
 */
async function findUnprocessedMessages() {

    const query = `
        SELECT id, external_system_name, raw_message, retry_count, report_sequence, outbound_id, type, status
        FROM report_transmit_logs
        WHERE
            status = 'PENDING' OR
            (status = 'SENT' AND updated_at < NOW() - ($1 * interval '1 millisecond'));
    `;
    const { rows } = await pool.query(query, [config.tcp.protocol.TIMERS.TRANSMISSION_TIMEOUT]);
    return rows;
    
}

/**
 * 
 */
async function findById(logId) {
    
    const query = `
        SELECT *
        FROM report_transmit_logs
        WHERE id = $1;
    `;
    const { rows } = await pool.query(query, [logId]);
    return rows[0];

}

    

module.exports = {
    findByOutboundIdAndReportSequence,
    findUnprocessedMessages,
    incrementRetryCountAndReportSequence,
    updateStatusById,
    create,
    findById,
};
