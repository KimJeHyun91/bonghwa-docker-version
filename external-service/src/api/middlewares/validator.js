/**
 * @file validator.js
 * @description express-validator의 유효성 검사 결과를 처리하는 미들웨어입니다.
 */

const { validationResult } = require('express-validator');
const logger = require('../../core/utils/logger');

/**
 * express-validator의 유효성 검사 결과를 확인하고,
 * 오류가 있는 경우 400 Bad Request 응답을 보냅니다.
 * @param {import('express').Request} req - Express 요청 객체
 * @param {import('express').Response} res - Express 응답 객체
 * @param {import('express').NextFunction} next - 다음 미들웨어 함수
 */
const handleValidationErrors = (req, res, next) => {

    // 요청 객체에서 유효성 검사 결과를 가져옵니다.
    const errors = validationResult(req);

    // 유효성 검사 오류가 없는 경우, 다음 미들웨어로 제어를 넘깁니다.
    if (errors.isEmpty()) {
        logger.debug(`✅ [ExternalService][Validator] 유효성 검사 통과 (Path: ${req.path}).`);
        return next();
    }

    // 유효성 검사 오류가 있는 경우, 오류 메시지를 포맷하여 400 응답을 보냅니다.
    const extractedErrors = errors.array().map((err) => ({ [err.path]: err.msg }));

    logger.warn(`🚨 [ExternalService][Validator] 유효성 검사 실패 (Path: ${req.path}). 오류 ${extractedErrors.length}건 반환.`);

    return res.status(400).json({
        error: '요청 데이터 유효성 검사 실패.',
        details: extractedErrors,
    });

};

module.exports = handleValidationErrors;