/**
 * @file apiReceiveLogRepository.js
 * @description api_receive_logs 테이블과의 데이터베이스 상호작용을 담당합니다.
 * 모든 API 수신 내역을 기록합니다.
 */

const pool = require('./pool');

/**
 * API 수신 로그를 생성하고, 생성된 로그 ID를 반환합니다.
 * @param {object} logData - 로그 데이터
 * @param {number} logData.externalSystemId - 외부 시스템 ID
 * @param {string} logData.requestPath - 요청 API 경로
 * @param {object} logData.requestBody - 요청 본문
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<number>} 생성된 로그의 ID 
 */
async function create({ externalSystemId, requestPath, requestBody }, client = pool) {

   const query = `
            INSERT INTO api_receive_logs (external_system_id, request_path, request_body) 
            VALUES ($1, $2, $3)
            RETURNING id;
        `;
    const values = [externalSystemId, requestPath, requestBody]; 
    const { rows } = await client.query(query, values);
    return rows[0].id;

}

module.exports = {
    create,
};