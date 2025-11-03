/**
 * @file disasterPublishLogRepository.js
 * @description disaster_publish_logs 테이블(재난 정보 MQ 아웃박스)과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');

/**
 * 재난 정보 발행 로그를 아웃박스에 생성합니다.
 * @param {object} logData - 로그 데이터
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function create(logData, client = pool) {
    
    const { tcpReceiveLogId, routingKey, rawMessage, identifier, eventCode } = logData;
    const query = `
        INSERT INTO disaster_publish_logs (tcp_receive_log_id, routing_key, raw_message, identifier, event_code)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (identifier) DO NOTHING;
    `;
    await client.query(query, [tcpReceiveLogId, routingKey, rawMessage, identifier, eventCode]);

}

/**
 * 고유 식별자(identifier)로 발행 로그가 존재하는지 확인합니다.
 * @param {string} identifier - 확인할 재난 정보의 고유 식별자
 * @returns {Promise<boolean>} 로그 존재 여부
 */
async function existsByIdentifier(identifier) {
    
    const query = `
        SELECT 1
        FROM disaster_publish_logs
        WHERE identifier = $1
        LIMIT 1;
    `;
    const { rows } = await pool.query(query, [identifier]);
    return rows.length > 0;     

}

/**
 * 고유 식별자(identifier)로 로그를 조회합니다.
 * @param {string} identifier - 확인할 재난 정보의 고유 식별자
 * @returns {Promise<object>} 로그 객체
 */
async function findByIdentifier(identifier) {
    
    const query = `
        SELECT *
        FROM disaster_publish_logs
        WHERE identifier = $1
        LIMIT 1;
    `;
    const { rows } = await pool.query(query, [identifier]);
    return rows[0];

}

/**
 * ID를 기준으로 발행 로그의 상태(status)를 업데이트합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @param {string} status - 새로운 상태 ('SENT', 'SUCCESS', 'FAILED')
 * @returns {Promise<void>}
 */
async function updateStatusById(logId, status) {
    
    const query = `
        UPDATE disaster_publish_logs
        SET status = $1
        WHERE id = $2;
    `;
    await pool.query(query, [status, logId]);

}

/**
 * ID를 기준으로 발신 로그의 재시도 횟수(retry_count)를 1 증가합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @returns {Promise<void>}
 */
async function incrementRetryCount(logId) {
    
    const query = `
        UPDATE disaster_publish_logs
        SET retry_count = retry_count + 1
        WHERE id = $1;
    `;
    await pool.query(query, [logId]);

}

/**
 * 아직 발행되지 않은 재난 정보 목록을 조회합니다. (워커용)
 * @returns {Promise<Array<object>>} 처리되지 않은 로그 객체의 배열
 */
async function findUnprocessedMessages() {
    
    const query = `
        SELECT id, routing_key, raw_message, retry_count, status, identifier, event_code
        FROM disaster_publish_logs
        WHERE status = 'PENDING'
        ORDER BY created_at ASC;
    `;
    const { rows } = await pool.query(query);
    return rows;

}

module.exports = {
    create,
    findUnprocessedMessages,
    existsByIdentifier,
    findByIdentifier,
    updateStatusById,
    incrementRetryCount,
};