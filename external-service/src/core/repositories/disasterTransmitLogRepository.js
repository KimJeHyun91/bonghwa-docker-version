/**
 * @file disasterTransmitLogRepository.js
 * @description disaster_transmit_logs 테이블(재난 정보 아웃박스)과의 데이터베이스 상호작용을 담당합니다.
 */

const format = require('pg-format');
const pool = require('./pool');
const config = require('../../config');

/**
 * 여러 재난 정보 발신 로그를 아웃박스에 일괄적으로 생성합니다.
 * @param {Array<object>} logs - 생성할 로그 데이터 객체의 배열
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function createBulk(logs, client = pool) {
    
    if (!logs || logs.length === 0) {
        return [];
    }

    const values = logs.map((log) => [log.mqReceiveLogId, log.externalSystemId, log.identifier, log.rawMessage]);

    // ON CONFLICT DO NOTHING: 이미 존재하는 데이터는 무시하고 새로 추가될 데이터만 처리합니다.
    const query = format(
        `
            INSERT INTO disaster_transmit_logs (mq_receive_log_id, external_system_id, identifier, raw_message)
            VALUES %L
            ON CONFLICT (external_system_id, identifier) DO NOTHING
        `, 
        values
    );

    await client.query(query);

}

/**
 * 고유 식별자(identifier)로 발신 로그가 존재하는지 확인합니다. (API 유효성 검사용)
 * @param {string} identifier - 확인할 재난 정보의 고유 식별자
 * @returns {Promise<boolean>} 로그 존재 여부
 */
async function existsByIdentifier(identifier) {
    
    const query = `
        SELECT 1
        FROM disaster_transmit_logs
        WHERE identifier = $1
        LIMIT 1;
    `;
    const { rows } = await pool.query(query, [identifier]);
    return rows.length > 0;     

}

/**
 * 아직 처리되지 않은 (재발신이 필요한) 발신 로그 목록을 조회합니다. (워커용)
 * @returns {Promise<Array<object>>} 처리되지 않은 발신 로그 객체의 배열
 */
async function findUnprocessedMessages() {
    
    const query = `
        SELECT id
        FROM disaster_transmit_logs
        WHERE
            status = 'PENDING' OR
            (status = 'SENT' AND updated_at < NOW() - ($1 * interval '1 milliseconds'));
    `;
    const { rows } = await pool.query(query, [config.disasterTransmitWorker.TRANSMISSION_TIMEOUT]);
    return rows;

}

/**
 * ID를 기준으로 발신 로그의 전체 정보를 조회합니다. (NACK 처리용)
 * @param {number} logId - 조회할 로그의 ID
 * @returns {Promise<object | null>} 발신 로그 객체 또는 null
 */
async function findById(logId) {
    
    const query = `
        SELECT id, external_system_id, identifier, raw_message, retry_count, status
        FROM disaster_transmit_logs
        WHERE id = $1;
    `;
    const { rows } = await pool.query(query, [logId]);
    return rows[0] || null;

}

/**
 * ID를 기준으로 발신 로그의 상태(status)를 업데이트합니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @param {string} status - 새로운 상태 ('SENT', 'SUCCESS', 'FAILED')
 * @returns {Promise<void>}
 */
async function updateStatusById(logId, status) {
    
    const query = `
        UPDATE disaster_transmit_logs
        SET status = $1
        WHERE id = $2;
    `;
    const values = [status, logId];
    await pool.query(query, values);

}

/**
 * ID를 기준으로 발신 로그의 재시도 횟수(retry_count)를 1 증가시킵니다.
 * @param {number} logId - 업데이트할 로그의 ID
 * @returns {Promise<void>}
 */
async function incrementRetryCount(logId) {
    
    const query = `
        UPDATE disaster_transmit_logs
        SET retry_count = retry_count + 1
        WHERE id = $1;
    `;
    await pool.query(query, [logId]);

}

module.exports = {
    createBulk,
    existsByIdentifier,
    findUnprocessedMessages,
    findById,
    updateStatusById,
    incrementRetryCount,
};