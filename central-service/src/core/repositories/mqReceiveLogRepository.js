/**
 * @file mqReceiveLogRepository.js
 * @description mq_receive_logs 테이블(MQ 인박스)과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');

/**
 * MQ 수신 로그를 생성하고, 생성된 로그의 ID를 반환합니다.
 * @param {string} rawMessage - RabbitMQ로부터 수신한 메시지의 원본 문자열
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<number>} 생성된 로그의 ID
 */
async function create(rawMessage, client = pool) {
    
    const query = `
        INSERT INTO mq_receive_logs (raw_message, status)
        VALUES ($1, 'PENDING')
        RETURNING id;
    `;
    const { rows } = await client.query(query, [rawMessage]);
    return rows[0].id;

}

/**
 * ID를 기준으로 MQ 수신 로그의 상태를 업데이트합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @param {'SUCCESS' | 'FAILED'} status - 새로운 상태
 * @param {string | null} [errorMessage=null] - 실패 시 기록할 오류 메시지
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function updateStatus(logId, status, errorMessage = null, client = pool) {
    
    const query = `
        UPDATE mq_receive_logs
        SET status = $1, error_message = $2
        WHERE id = $3;
    `;
    await client.query(query, [status, errorMessage, logId]);

}

module.exports = {
    create,
    updateStatus,
};