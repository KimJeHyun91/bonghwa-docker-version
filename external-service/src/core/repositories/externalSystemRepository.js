/**
 * @file externalSystemRepository.js
 * @description external_systems 테이블과의 데이터베이스 상호작용을 담당합니다.
 */

const pool = require('./pool');

/**
 * 시스템명과 API 키로 활성화된 외부 시스템 정보를 조회합니다. (API/Socket 인증용)
 * @param {string} systemName - 외부 시스템 이름
 * @param {string} apiKey - 외부 시스템의 API 키
 * @returns {Promise<object|null>} 외부 시스템 객체 또는 null
 */
async function findByNameAndApiKey(systemName, apiKey) {
    
    const query = `
        SELECT id, system_name, api_key, origin_urls, subscribed_event_codes, is_active
        FROM external_systems
        WHERE system_name = $1 AND api_key = $2;
    `;
    const values = [systemName, apiKey];
    const { rows } = await pool.query(query, values);
    return rows[0] || null;

}

/**
 * 활성화된(is_active = true) 모든 외부 시스템의 Original URL 목록을 조회합니다. (CORS 관리용)
 * @returns {Promise<string[]>} Origin URL 문자열의 배열
 */
async function findAllActiveOrigins() {
    
    const query = `
        SELECT origin_urls
        FROM external_systems
        WHERE is_active = true;
    `;
    const { rows } = await pool.query(query);

    // 결과는 [{ origin_urls: ['url1', 'url2'] }, {origin_urls: ['url3'] }] 형태이므로
    // flat()을 사용하여 ['url1', 'url2', 'url3'] 형태의 1차원 배열로 변환합니다.
    return rows.flatMap((row) => row.origin_urls);

}

/**
 * 특정 재난 이벤트 코드를 구독하고 있는 모든 활성 외부 시스템 목록을 조회합니다. (메시지 브로컹요)
 * @param {string} eventCode - 조회할 재난 이벤트 코드 (예: 'FLL')
 * @returns {Promise<Array<object>>} 외부 시스템 정보 객체의 배열
 */
async function findBySubscribedEventCode(eventCode) {
    
    const query = `
        SELECT id, system_name
        FROM external_systems
        WHERE $1 = ANY(subscribed_event_codes) AND is_active = true;
    `;
    const { rows } = await pool.query(query, [eventCode]);
    return rows;

}

module.exports = {
    findByNameAndApiKey,
    findAllActiveOrigins,
    findBySubscribedEventCode,
};