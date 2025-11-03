/**
 * @file deviceStatusRepository.js
 * @description device_status_logs 테이블과의 데이터베이스 상호작용을 담당합니다.
 */

const format = require('pg-format');
const pool = require('./pool');

/**
 * 여러 단말기의 상태 변경 로그를 일괄적으로 생성합니다.
 * @param {number} externalSystemId - 외부 시스템의 ID
 * @param {Array<object>} deviceStatusList - 상태 보고 객체의 배열
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function createBulk(externalSystemId, deviceStatusList, client = pool) {
    
    if (deviceStatusList.length === 0) {
        return;
    }

    // 1. device_id 문자열 목록을 사용하여 devices 테이블에 실제 id(FK)를 조회합니다.
    const deviceIdStrings = deviceStatusList.map((deviceStatus) => deviceStatus.device_id);
    const idQuery = format(
        'SELECT id, device_id FROM devices WHERE external_system_id = %L AND device_id IN (%L)',
        externalSystemId,
        deviceIdStrings
    );
    const { rows: deviceRows } = await client.query(idQuery);

    // device_id(string)를 key로, 실제 id(bigint)를 value로 하는 맵을 생성하여 조회를 빠르게 합니다.
    const deviceIdMap = new Map(deviceRows.map((row) => [row.device_id, row.id]));

    // 2. INSERT할 데이터를 준비합니다. (실제 device_id(FK) 사용)
    const values = deviceStatusList
        .map((statusReport) => {
            const deviceFkId = deviceIdMap.get(statusReport.device_id);
            if (!deviceFkId) {
                // 제원 정보가 DB에 없는 단말기에 대한 상태 보고는 로그를 기록하지 않습니다.
                return null;
            }
            // 'Y' -> 'ONLINE', 'N' -> 'OFFLINE'으로 상태 코드를 변환합니다.
            const statusCode = statusReport.device_status === 'Y' ? 'ONLINE' : 'OFFLINE';
            return [deviceFkId, statusCode, statusReport.note]; 
        })
        .filter(Boolean); // null 값(매칭되는 단말기가 없는 경우)을 배열에서 제거합니다.

    if (values.length === 0) {
        // 유효한 상태 보고가 없는 경우, 여기서 종료합니다.
        return;
    }

    // 3. 상태 로그를 일괄 INSERT 합니다.
    const logQuery = format(
        `
            INSERT INTO device_status_logs (device_id, status_code, status_message)
            VALUES %L
        `,
        values
    );
    await client.query(logQuery);

}

module.exports = {
    createBulk,
};