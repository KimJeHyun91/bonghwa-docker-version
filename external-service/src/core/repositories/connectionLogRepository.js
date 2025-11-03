/**
 * @file connectionLogRepository.js
 * @description external_system_connection_logs 테이블과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');

/**
 * 접속 로그를 생성합니다.
 * @param {object} logData - 로그 데이터
 * @param {number} logData.externalSystemId - 외부 시스템 ID
 * @param {string} logData.eventType - 이벤트 타입 (예: 'API_AUTH_SUCCESS')
 * @param {string} logData.ipAddress - 클라이언트 IP 주소
 * @param {string} [logData.detail] - 상세 설명 (선택 사항)
 * @returns {Promise<void>}
 */
async function create({ externalSystemId, eventType, ipAddress, detail }) {
    
    const query = `
        INSERT INTO external_system_connection_logs (external_system_id, event_type, ip_address, detail)
        VALUES ($1, $2, $3, $4)
    `;
    const values = [externalSystemId, eventType, ipAddress, detail];
    await pool.query(query, values);

}

module.exports = {
    create,
};