/**
 * @file auth.js
 * @description API 요청에 대한 인증을 처리하는 미들웨어입니다.
 * API 키(x-api-key)와 시스템명(x-system-name)를 검증하여 유효한 외부 시스템인지 확인합니다.
 */

const logger = require('../../core/utils/logger');
const externalSystemRepository = require('../../core/repositories/externalSystemRepository');
const connectionLogRepository = require('../../core/repositories/connectionLogRepository');

/**
 * API 요청 헤더를 검증하여 인가된 외부 시스템인지 확인합니다.
 * @param {import('express').Request} req - Express 요청 객체
 * @param {import('express').Response} res - Express 응답 객체
 * @param {import('express').NextFunction} next - 다음 미들웨어 함수
 */

async function authMiddleware(req, res, next) {

    try {
        
        logger.debug(`🚀 [ExternalService][AuthMiddleware] API 인증 시작 (Path: ${req.path})...`);

        // 'x-system-name'과 'x-api-key' 헤더에서 인증 정보를 추출합니다.
        const systemName = req.get('x-system-name');
        const apiKey = req.get('x-api-key');
        const ipAddress = req.ip;

        if (!systemName || !apiKey) {
            logger.warn(`🚨 [ExternalService][AuthMiddleware] 인증 헤더 누락. 접근 시도(IP: ${ipAddress}).`);
            // 401 Unauthorized: 클라이언트가 인증되지 않았음을 의미합니다.
            return res.status(401).json({ error: '인증에 실패했습니다. x-system-name과 x-api-key 헤더 모두 필요.' });
        }

        // 시스템명과 API 키로 외부 시스템 정보 조회
        const externalSystem = await externalSystemRepository.findByNameAndApiKey(systemName, apiKey);

        // 시스템이 존재하지 않거나 비활성화된 경우
        if (!externalSystem) {
            logger.warn(`🚨 [ExternalService][AuthMiddleware] 인증 실패: 시스템 [${systemName}] 정보 없음.`);
            return res.status(401).json({ error: '인증에 실패했습니다. 유효하지 않은 인증 정보입니다.'});
        }

        if (!externalSystem.is_active) {
            await connectionLogRepository.create({ 
                externalSystemId: externalSystem.id,
                eventType: 'API_AUTH_FAILED',
                ipAddress,
                detail: '비활성화된 시스템으로 접근 시도',
            });
            logger.warn(`🚨 [ExternalService][AuthMiddleware] 인증 실패: 시스템 [${systemName}] 비활성화.`);
            return res.status(401).json({ error: '인증에 실패했습니다. 유효하지 않은 인증 정보입니다.' });
        }

        // 인증 성공 로그 기록
        await connectionLogRepository.create({
            externalSystemId: externalSystem.id,
            eventType: 'API_AUTH_SUCCESS',
            ipAddress,
        });
        logger.info(`✅ [ExternalService][AuthMiddleware] 인증 성공 (System: ${systemName}, ID: ${externalSystem.id}).`);

        // req 객체에 인증된 시스템 정보를 추가하여 다음 미들웨어나 핸들러에서 사용할 수 있도록 합니다.
        req.externalSystem = externalSystem;

        // 다음 미들웨어로 제어를 넘깁니다.
        next();        

    } catch (err) {

        logger.error(`🚨 [ExternalService][AuthMiddleware] DB 오류 발생. 인증 처리 실패: ${err.message}`);
        // DB 오류 등 서버 내부 문제 발생 시 500 에러를 반환합니다.
        res.status(500).json({ error: '인증 처리 중 서버 오류가 발생했습니다.' });

    }

};

module.exports = authMiddleware;