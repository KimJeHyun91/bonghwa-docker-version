/**
 * @file reportPublishLogRepository.js
 * @description report_publish_logs 테이블(보고 정보 아웃박스)과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');

/**
 * 보고 정보 발행 로그를 아웃박스에 생성합니다.
 * @param {object} logData - 로그 데이터
 * @param {string} logData.type - 보고 종류
 * @param {string} logData.externalSystemName - 보고를 보낸 외부 시스템 이름
 * @param {number} logData.apiReceiveLogId - 이 발신 요청을 유발한 API 수신 로그의 ID
 * @param {string} logData.routingKey - 메시지를 발행할 RabbitMQ 라우팅 키
 * @param {object} logData.rawMessage - 발행할 메시지의 내용
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function create({ type, externalSystemName, apiReceiveLogId, routingKey, rawMessage }, client = pool) {
    
    const query = `
        INSERT INTO report_publish_logs (type, external_system_name, api_receive_log_id, routing_key, raw_message)
        VALUES ($1, $2, $3, $4, $5);
    `;
    const values = [type, externalSystemName, apiReceiveLogId, routingKey, rawMessage];
    await client.query(query, values);

}

/**
 * 아직 전송되지 않은 (재전송이 필요한) 보고 로그 목록을 조회합니다. (워커용)
 * @returns {Promise<Array<object>>} 처리되지 않은 보고 로그 객체의 배열
 */
async function findUnprocessedMessages() {
    
    const query = `
        SELECT id, routing_key, raw_message, retry_count, status, external_system_name, type
        FROM report_publish_logs
        WHERE status = 'PENDING'
        ORDER BY created_at ASC;
    `;
    const { rows } = await pool.query(query);
    return rows;

}

/**
 * ID를 기준으로 발신 로그의 상태(status)를 업데이트합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @param {string} status - 새로운 상태 ('PENDING', 'SENT', 'SUCCESS', 'FAILED')
 * @returns {Promise<void>}
 */
async function updateStatusById(logId, status) {
    
    const query = `
        UPDATE report_publish_logs
        SET status = $1
        WHERE id = $2;
    `;
    await pool.query(query, [status, logId]);

}

/**
 * ID를 기준으로 발신 로그의 재시도 횟수(retry_count)를 1 증가시킵니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @returns {Promise<void>}
 */
async function incrementRetryCount(logId) {
    
    const query = `
        UPDATE report_publish_logs
        SET retry_count = retry_count + 1
        WHERE id = $1;
    `;
    await pool.query(query, [logId]);

}

module.exports = {
    create,
    findUnprocessedMessages,
    updateStatusById,
    incrementRetryCount,
};