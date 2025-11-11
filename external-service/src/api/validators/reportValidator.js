/**
 * @file reportValidator.js
 * @description /reports API에 대한 요청 값 유효성 검사 규칙을 정의합니다.
 * express-validator 라이브러리를 사용합니다.
 */

const { body } = require('express-validator');
const { isValidPastTimestamp, isExistingIdentifier } = require('./customValidators');

// POST /api/reports/device-info 요청에 대한 유효성 검사 규칙
const validateDeviceInfoReport = [
    
    body('deviceList')
        .notEmpty().withMessage('deviceList는 필수값입니다.')
        .isArray({ min: 1 }).withMessage('deviceList는 1개 이상의 항목을 포함하는 배열이어야 합니다.'),
    
    body('deviceList.*.server_ip')
        .notEmpty().withMessage('server_ip는 필수값입니다.')
        .isIP().withMessage('server_ip는 IP 형식이어야 합니다.'),
    
    body('deviceList.*.server_name')
        .notEmpty().withMessage('server_name는 필수값입니다.')
        .isString().withMessage('server_name는 문자열이어야 합니다.'),

    body('deviceList.*.device_type')
        .notEmpty().withMessage('device_type는 필수값입니다.')
        .isString().withMessage('device_type는 문자열이어야 합니다.'),

    body('deviceList.*.device_id')
        .notEmpty().withMessage('device_id는 필수값입니다.')
        .isString().withMessage('device_id는 문자열이어야 합니다.'),

    body('deviceList.*.device_name')
        .notEmpty().withMessage('device_name는 필수값입니다.')
        .isString().withMessage('device_name는 문자열이어야 합니다.'),

    body('deviceList.*.device_model')
        .notEmpty().withMessage('device_model는 필수값입니다.')
        .isString().withMessage('device_model는 문자열이어야 합니다.'),

    body('deviceList.*.device_output')
        .notEmpty().withMessage('device_output는 필수값입니다.')
        .isString().withMessage('device_output는 문자열이어야 합니다.'),
        
    body('deviceList.*.device_company')
        .notEmpty().withMessage('device_company는 필수값입니다.')
        .isString().withMessage('device_company는 문자열이어야 합니다.'),    

    body('deviceList.*.device_bjdong')
        .notEmpty().withMessage('device_bjdong는 필수값입니다.')
        .isNumeric().withMessage('device_bjdong는 숫자이여야 합니다.'),  

    body('deviceList.*.device_lat')
        .notEmpty().withMessage('device_lat는 필수값입니다.')
        .isFloat().withMessage('device_lat는 숫자(소수)이어야 합니다.'),

    body('deviceList.*.device_lon')
        .notEmpty().withMessage('device_lon는 필수값입니다.')
        .isFloat().withMessage('device_lon는 숫자(소수)이어야 합니다.'),

    body('deviceList.*.device_address')
        .notEmpty().withMessage('device_address는 필수값입니다.')
        .isString().withMessage('device_address는 문자열이어야 합니다.'),

    body('deviceList.*.device_inst_date')
        .notEmpty().withMessage('device_inst_date는 필수값입니다.')
        .isNumeric().withMessage("device_inst_date는 날짜형식 'YYYYMMDD'이어야 합니다.")
        .isLength({ min: 8, max: 8 }).withMessage("device_inst_date는 8자리 'YYYYMMDD' 형식이어야 합니다."),   

    body('deviceList.*.device_allow_dist_min')
        .notEmpty().withMessage('device_allow_dist_min는 필수값입니다.')
        .isNumeric().withMessage('device_allow_dist_min는 숫자이여야 합니다.'),  
    
    body('deviceList.*.device_allow_dist_max')
        .notEmpty().withMessage('device_allow_dist_max는 필수값입니다.')
        .isNumeric().withMessage('device_allow_dist_max는 숫자이여야 합니다.'),

    body('deviceList.*.note')
        .optional()
        .isString().withMessage('note는 문자열이어야 합니다.'),   

];

// POST /api/reports/device-status 요청에 대한 유효성 검사 규칙
const validateDeviceStatusReport = [
    
    body('deviceList')
        .notEmpty().withMessage('deviceList는 필수값입니다.')
        .isArray({ min: 1 }).withMessage('deviceList는 1개 이상의 항목을 포함하는 배열이어야 합니다.'),


    body('deviceList.*.server_ip')
        .notEmpty().withMessage('server_ip는 필수값입니다.')
        .isIP().withMessage('server_ip는 IP 형식이어야 합니다.'),

    body('deviceList.*.device_id')
        .notEmpty().withMessage('device_id는 필수값입니다.')
        .isString().withMessage('device_id는 문자열이어야 합니다.'),

    body('deviceList.*.device_status')
        .notEmpty().withMessage('device_status는 필수값입니다.')
        .isIn(['Y', 'N']).withMessage("device_status는 'Y' 또는 'N'이어야 합니다."),

    body('deviceList.*.note')
        .optional()
        .isString().withMessage('note는 문자열이어야 합니다.'),   

];

// POST /api/reports/disaster-result 요청에 대한 유효성 검사 규칙
const validateDisasterResultReport = [

    body('identifier')
        .notEmpty().withMessage('identifier은 필수값입니다.')
        .isString().withMessage('identifier은 문자열이어야 합니다.')
        .custom(isExistingIdentifier), // disaster_transmit_logs 테이블에 해당 identifier가 존재하는지 확인
    
    body('reportList')
        .notEmpty().withMessage('reportList는 필수값입니다.')
        .isArray({ min: 1 }).withMessage('reportList는 1개 이상의 항목을 포함하는 배열이어야 합니다.'),
        

    body('reportList.*.server_ip')
        .notEmpty().withMessage('server_ip는 필수값입니다.')
        .isIP().withMessage('server_ip는 IP 형식이어야 합니다.'),

    body('reportList.*.device_id')
        .notEmpty().withMessage('device_id는 필수값입니다.')
        .isString().withMessage('device_id는 문자열이어야 합니다.'),

    body('reportList.*.sent_time')
        .notEmpty().withMessage('sentTime는 필수값입니다.')
        .custom(isValidPastTimestamp), // 'yyyymmddhhmiss' 형식 및 과거 시간인지 확인

    body('reportList.*.result_yn')
        .notEmpty().withMessage('result_yn는 필수값입니다.')
        .isIn(['Y', 'N']).withMessage("result_yn는 'Y' 또는 'N'이어야 합니다."),

    body('reportList.*.note')
        .optional()
        .isString().withMessage('note는 문자열이어야 합니다.'),   

];

module.exports = {
    validateDeviceInfoReport,
    validateDeviceStatusReport,
    validateDisasterResultReport,
}