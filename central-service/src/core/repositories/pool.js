/**
 * @file pool.js
 * @description node-postgres(pg)를 사용하여 데이터베이스 커넥션 풀을 생성하고 관리합니다.
 * 애플리케이션 전체에서 이 단일 인스턴스를 공유하여 사용합니다.
 */

const { Pool } = require('pg');
const format = require('pg-format');
const config = require('../../config');
const logger = require('../utils/logger');

// config 파일의 데이터베이스 설정 값을 사용하여 커넥션 풀을 생성합니다.
const pool = new Pool({
    host: config.database.HOST,
    port: config.database.PORT,
    database: config.database.DATABASE,
    user: config.database.USER,
    password: config.database.PASSWORD,
    max: 20, // 커넥션 풀의 최대 클라이언트 수
    idleTimeoutMillis: 30000, // 클라이언트가 유휴 상태로 있을 수 있는 시간 (ms)
    connectionTimeoutMillis: 10000, // 연결 시도 타임아웃 (ms)
});

// 커넥션 풀에서 새로운 클라이언트가 연결될 때마다 로그를 남깁니다.
pool.on('connect', (client) => {
    logger.debug('✅ [CentralService][DBPool] 새 DB 클라이언트 연결 완료.');
});

// 커넥션 풀에서 오류가 발생했을 때 로그를 기록합니다.
pool.on('error', (err, client) => {
    logger.error('🚨 [CentralService][DBPool] DB 커넥션 풀에서 예기치 않은 오류 발생.', err);
});

// 커넥션 풀에서 클라이언트가 제거(연결 종료)될 때 로그를 남깁니다.
pool.on('remove', (client) => {
        logger.debug('✅ [CentralService][DBPool] DB 클라이언트 풀에서 제거 완료.');
});

/**
 * 데이터베이스에 쿼리를 실행하는 중앙 함수입니다.
 * 모든 리포지토리는 이 함수를 통해 DB에 접근해야 합니다.
 * SQL Injection을 방지하기 위해 파라미터화된 쿼리를 사용합니다.
 * @param {string} text - 실행할 SQL 쿼리 문자열
 * @param {Array} [params] - 쿼리에 바인딩할 파라미터 배열 (선택 사항)
 * @returns {Promise<import('pg').QueryResult>} 쿼리 실행 결과를 담은 Promise
 */
const query = async (text, params) => {

    const start = Date.now();
    try {

        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        logger.debug(`✅ [CentralService][DBQuery] 쿼리 실행 완료 (${duration}ms): ${text}.`);
        return result;

    } catch (err) {

        logger.error(`🚨 [CentralService][DBQuery] 쿼리 실행 중 오류 발생: ${text}\n${err.stack}`);
        throw err; // 에러를 다시 던져 상위 서비스에서 처리하도록 합니다.

    }

};

/**
 * SQL Injection을 방지하기 위해 테이블/컬럼과 같은 식별자를 안전하게 이스케이프 처리합니다.
 * @param {string} str - 이스케이프할 식별자 문자열
 * @returns {string} 안전하게 포멧팅된 식별자 (예: "my-column")
 */
const escapeIdentifier = (str) => {
    return format('%I', str);
};

/**
 * 커넥션 풀에서 클라이언트 하나를 가져옵니다.
 * 트랜잭션과 같이 여러 쿼리를 동일한 클라이언트에서 실행해야 할 때 사용됩니다.
 * @returns {Pormise<import('pg').PoolClient>} PoolClient 객체를 담은 Promise
 */
const getClient = async () => {
    logger.debug('[CentralService][DBPool] 클라이언트 요청.');
    const client = await pool.connect();
    logger.debug('✅ [CentralService][DBPool] 클라이언트 획득 완료.');
    return client;
};

/**
 * 애플리케이션이 종료 시 커넥션 풀을 안전하게 닫습니다.
 * @returns {Promise<void>}
 */
const disconnect = async () => {

    logger.info('🔌 [CentralService][DBPool] DB 커넥션 풀 종료 시작.');
    await pool.end();  
    logger.info('✅ [CentralService][DBPool] DB 커넥션 풀 종료 완료.');

};

module.exports = {
    query,
    escapeIdentifier,
    getClient,
    disconnect,  
};

