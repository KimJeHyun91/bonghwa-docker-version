/**
 * @file tcpReceiveLogRepository.js
 * @description tcp_receive_logs 테이블(TCP 인박스)과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');

/**
 * TCP 수신 로그를 생성하고, 생성된 로그의 ID를 반환합니다.
 * @param {object} logData - 로그 데이터
 * @param {string} logData.inboundId - 중앙 시스템의 transMsgId
 * @param {string} logData.inboundSeq - 중앙 시스템의 transMsgSeq
 * @param {object} logData.rawMessage - 파싱된 CAP 메시지 객체
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<number>} 생성된 로그의 ID
 */
async function create({ inboundId, inboundSeq, rawMessage }, client = pool) {
    
    const query = `
        INSERT INTO tcp_receive_logs (inbound_id, inbound_seq, raw_message)
        VALUES ($1, $2, $3)
        RETURNING id;
    `;
    const values = [inboundId, inboundSeq, rawMessage];
    const { rows } = await client.query(query, values);
    return rows[0].id;

}

/**
 * 중앙 시스템에서 보내온 메시지가 중복되었는지 여부를 반환합니다.
 * @param {string} inboundId - 중앙 시스템의 transMsgId
 * @returns {Promise<boolean>} inboundId, inboundSeq에 해당하는 수신 로그가 있는지 여부
 */
async function isDuplicate(inboundId, inboundSeq, client = pool) {

    const query = `
        SELECT 1
        FROM tcp_receive_logs
        WHERE inbound_id = $1 AND inbound_seq = $2
        LIMIT 1;
    `;
    const values = [inboundId, inboundSeq];
    const { rows } = await client.query(query, values);
    return rows.length > 0;

}

/**
 * ID를 기준으로 TCP 수신 로그의 상태를 업데이트합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @param {'SUCCESS' | 'FAILED'} status - 새로운 상태
 * @param {string | null} [errorMessage=null] - 실패 시 기록할 오류 메시지
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function updateStatus(logId, status, errorMessage = null, client = pool) {
    
    const query = `
        UPDATE tcp_receive_logs
        SET status = $1, error_message = $2
        WHERE id = $3;
    `;
    const values = [status, errorMessage, logId]
    await client.query(query, values);

}

module.exports = {
    create,
    isDuplicate,
    updateStatus,
};