/**
 * @file deviceRepository.js
 * @description devices 테이블과의 데이터베이스 상호작용을 담당합니다.
 */

const format = require('pg-format');
const pool = require('./pool');

/**
 * 여러 단말기 정보를 일괄적으로 등록하거나 수정합니다. (UPSERT)
 * 이미 존재하는 device_id의 경우 정보를 업데이트하고, 존재하지 않은 경우 새로 추가합니다.
 * @param {number} externalSystemId - 외부 시스템 ID
 * @param {Array<object>} devices - 등록/수정할 단말기 정보 객체의 배열
 * @param {import('pg').PoolClient} [client=pool] - 데이터베이스 클라이언트 (트랜잭션용)
 * @returns {Promise<void>}
 */
async function upsertDevices(externalSystemId, devices, client = pool) {

    if (devices.length === 0) {
        return;
    } 
    
    // 배열 형태의 단말기 데이터를 PostgreSQL의 VALUES 형식에 맞게 2차원 배열로 변환합니다.
    const values = devices.map((device) => [
        externalSystemId,
        device.device_id,
        device.device_type,
        device.device_name,
        device.server_ip,
        device.server_name,
        device.device_model,
        device.device_lat,
        device.device_lon,
        device.device_address,
        device.note,
    ]);

    // pg-format을 사용하여 여러 행의 데이터를 안전하고 효율적으로 INSERT/UPDATE 하는 쿼리를 생성합니다.
    const query = format(`
        INSERT INTO devices (
            external_system_id,
            device_id,
            device_type,
            device_name,
            server_ip,
            server_name,
            device_model,
            device_lat,
            device_lon,
            device_address,
            note
        )
        VALUES %L
        ON CONFLICT (external_system_id, device_id) 
        DO UPDATE SET
            device_type = EXCLUDED.device_type,
            device_name = EXCLUDED.device_name,
            server_ip = EXCLUDED.server_ip,
            server_name = EXCLUDED.server_name,
            device_model = EXCLUDED.device_model,
            device_lat = EXCLUDED.device_lat,
            device_lon = EXCLUDED.device_lon,
            device_address = EXCLUDED.device_address,
            note = EXCLUDED.note
    `, values);

    await client.query(query);

}

module.exports = {
    upsertDevices,
};