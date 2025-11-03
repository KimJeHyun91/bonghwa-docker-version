/**
 * @file originManager.js
 * @description 데이터베이스에서 허용된 Origin 목록을 동적으로 관리하고 캐싱합니다.
 * CORS 미들웨어에 사용됩니다.
 */

const logger = require('./logger');
const externalSystemRepository = require('../repositories/externalSystemRepository');
const config = require('../../config');

const CACHE_DURATION = config.cors.CACHE_DURATION;

/**
 * 허용된 Origin 목록을 저장하는 캐시입니다.
 * @type {Set<string>}
 */
let allowedOriginsCache = new Set();

/**
 * 캐시가 마지막으로 업데이트된 시간을 기록합니다.
 * @type {number}
 */
let lastCacheUpdateTime = 0;

/**
 * DB에서 최신 Origin 목록을 가져외 캐시를 업데이트하는 함수입니다.
 */
async function updateAllowedOriginsCache() {

    logger.debug('🚀 [ExternalService][OriginManager] Origin 캐시 업데이트 시작...');

    try {
        const origins = await externalSystemRepository.findAllActiveOrigins();
        // Set을 사용하여 중복을 제거하고 빠른 조회를 가능하게 합니다.
        allowedOriginsCache = new Set(origins);
        lastCacheUpdateTime = Date.now();
        logger.info(`✅ [ExternalService][OriginManager] 허용된 Origin 캐시 업데이트 완료 (${origins.length}개).`);
    } catch (err) {
        logger.error(`🚨 [ExternalService][OriginManager] Origin 목록 DB 조회 오류: ${err.message}. 이전 캐시 유지.`);
    }

}

/**
 * CORS 미들웨어의 origin 옵션으로 사용될 함수입니다.
 * 요청이 들어올 때마다 이 함수가 호출되어 Origin 허용 여부를 결정합니다.
 * @param {string | undefined} requestOrigin - 클라이언트 요청 헤더의 Origin 값
 * @param {(err: Error | null, allow?: boolean) => void} callback - 결과를 전달할 콜백 함수
 */
async function initializeOriginManager(requestOrigin, callback) {

    logger.debug(`⬅️ [ExternalService][OriginManager] CORS 검증 요청 수신 (Origin: ${requestOrigin || 'N/A'}).`);
    
    const now = Date.now();
    const isCacheExpired = now - lastCacheUpdateTime > CACHE_DURATION;

    // 캐시가 비어있거나, 설정된 유효 기간이 지났으면 캐시를 업데이트합니다.
    if (lastCacheUpdateTime === 0 || isCacheExpired) {
        logger.debug('[ExternalService][OriginManager] 캐시 만료 또는 초기 상태. 업데이트 시도.');
        await updateAllowedOriginsCache();
    } else {
        logger.debug('[ExternalService][OriginManager] 유효한 캐시 사용.');
    }

    // 요청의 Origin이 캐시에 존재하는지 확인합니다.
    // requestOrigin이 없는 경우(예: Postman 같은 서버 간 요청)는 허용합니다.
    if (!requestOrigin || allowedOriginsCache.has(requestOrigin)) {
        // null: 오류 없음, true: 요청 허용
        logger.debug(`✅ [ExternalService][OriginManager] Origin 허용 완료 (Origin: ${requestOrigin || '내부/CORS 없음'}).`);
        callback(null, true);
    } else {
        logger.warn(`🚨 [ExternalService][OriginManager] 허용되지 않은 Origin 접근 거부 (Origin: ${requestOrigin}).`);
        // new Error: 오류 발생, false: 요청 거부
        callback(new Error('CORS 정책에 의해 허용되지 않은 Origin입니다.'), false);
    }

}

module.exports = { 
    initializeOriginManager,
    updateAllowedOriginsCache,
};