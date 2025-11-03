/**
 * @file index.js
 * @description central-service의 모든 설정 값을 관리하는 중앙 설정 파일입니다.
 * .env 파일의 환경 변수를 불러옵니다. 이 설정 파일은 기본값을 제공하지 않으므로,
 * 모든 필수 값은 .env 파일에 반드시 정의되어야 합니다.
 */

// 애플리케이션 시작 시 .env 파일을 읽어 process.env에 설정합니다.
require('dotenv').config();

module.exports = {

    // --- 로깅 설정 ---
    log: {
        LEVEL: 'debug', // 로그 레벨 (debug, info, warn, error)
    },

    // --- 중앙 시스템 인터페이스 설정 ---
    CENTRAL_SYSTEM_SENDER_ID: process.env.CENTRAL_SYSTEM_SENDER_ID,
    CENTRAL_SERVICE_SENDER_ID: process.env.CENTRAL_SERVICE_SENDER_ID,
    
    tcp: {
        IP: process.env.CENTRAL_SERVER_IP,
        PORT: parseInt(process.env.CENTRAL_SERVER_PORT, 10),
        protocol: {
            HEADER: {
                HEADER_LENGTH: 16,
                DATA_FORMAT: 1, // 1: xml
                MAGIC_NUMBER: parseInt(process.env.CENTRAL_PROTOCOL_MAGIC_NUMBER),
            },
            // DoS 공격 방지를 위한 최대 바디 크기 (20MB)
            MAX_BODY_LENGTH: 20 * 1024 * 1024,
            // 타이머 설정 (단위: ms)
            TIMERS: {
                // T2: 주기적인 세션 체크(Ping) 간격
                SESSION_CHECK_INTERVAL: 30000,
                // T3: Ping 전송 후 Pong 응답, 또는 인증 요청 후 응답을 기다리는 시간
                RESPONSE_TIMEOUT: 10000,
                // T4: 연결 끊김 후 재접속을 시도하는 간격
                RECONNECT_INTERVAL: 60000,
                // T5: 메시지 전송 후 ACK 응답을 기다리는 시간
                TRANSMISSION_TIMEOUT: 10000,
            },
            // 메시지 ID 상수 (16진수)
            MESSAGE_IDS: {
                // 접속/인증
                ETS_REQ_SYS_CON: 0xFFEE1001,
                ETS_RES_SYS_CON: 0xFFEE2001,
                // 세션 체크
                ETS_REQ_SYS_STS: 0xFFEE1010,
                ETS_RES_SYS_STS: 0xFFEE2010,
                // 재난 정보
                ETS_NFY_DIS_INFO: 0xFFEE3020,
                ETS_CNF_DIS_INFO: 0xFFEE4020,
                // 재난 정보 결과 보고
                ETS_REQ_DIS_REPORT: 0xFFEE5020,
                ETS_RES_DIS_REPORT: 0xFFEE6020,
                // 단말장치 제원정보
                ETS_NFY_DEVICE_INFO: 0xFFEE7010,
                ETS_CNF_DEVICE_INFO: 0xFFEE7020,
                // 단말장치 상태정보
                ETS_NFY_DEVICE_STS: 0xFFEE8010,
                ETS_CNF_DEVICE_STS: 0xFFEE8020,
            },
            // 유효한 CAP Event Code 목록
            VALID_EVENT_CODES: [

                'EQI', 'EQW', 'EEW', 'FEI', 'TSA', 'TSL', 'TSW', 'TSC', 'TSO', 'TSR', 'TSI', 'VOI', 'VOA',
                'VOL', 'VOW', 'VOC', 'VOO', 'VOR', 'FLA', 'FLL', 'FLG', 'FLW', 'FLC', 'FLN', 'FLS', 'HWA',
                'HWG', 'HWL', 'HWW', 'HWN', 'HWC', 'HWE', 'HWS', 'HRA', 'HRG', 'HRL', 'HRW', 'HRN', 'HRC',
                'HRE', 'HRS', 'CWA', 'CWG', 'CWL', 'CWW', 'CWN', 'CWC', 'CWE', 'CWS', 'HAA', 'HAG', 'HAL',
                'HAW', 'HAN', 'HAC', 'HAE', 'HAS', 'SSA', 'SSG', 'SSL', 'SSW', 'SSN', 'SSC', 'SSE', 'SSS',
                'WWA', 'WWG', 'WWL', 'WWW', 'WWN', 'WWC', 'WWE', 'WWS', 'TPA', 'TPG', 'TPL', 'TPW', 'TPN',
                'TPC', 'TPE', 'TPS', 'HSA', 'HSG', 'HSL', 'HSW', 'HSN', 'HSC', 'HSE', 'HSS', 'YSW', 'YSN',
                'YSC', 'YSE', 'YSS', 'HTA', 'HTG', 'HTL', 'HTW', 'HTN', 'HTC', 'HTE', 'HTS', 'HFA', 'HFG',
                'HFL', 'HFW', 'HFN', 'HFC', 'HFE', 'HFS', 'THW', 'THS', 'DRW', 'DRS', 'NSD', 'NSW', 'NSV',
                'NSS', 'AVA', 'AVW', 'AVC', 'AVS', 'NHW', 'NHS', 'MFA', 'MFW', 'MFV', 'MFC', 'MFE', 'MFS',
                'CPW', 'CAW', 'CCW', 'CNW', 'CDC', 'GFD', 'GFS', 'NDA', 'NDW', 'NDS', 'ASD', 'ASW', 'ASV',
                'ASS', 'GRW', 'GRS', 'FDA', 'FDW', 'FDE', 'FDS', 'CWD', 'CWI', 'CHD', 'CHC', 'CHE', 'CHS',
                'DEW', 'DES', 'DEC', 'LDW', 'LDA', 'POA', 'POW', 'POS', 'POD', 'GAD', 'COD', 'RWD', 'RWS',
                'RWC', 'RWI', 'SWD', 'SWS', 'SWC', 'BCW', 'BCS', 'ISD', 'MSD', 'MSS', 'MAE', 'MPD', 'MPS',
                'FND', 'FNE', 'FNS', 'DOW', 'DOE', 'DOS', 'DBA', 'DBW', 'DBS', 'RVD', 'DWW', 'DFD', 'DFS',
                'TEW', 'TES', 'FHD', 'FHV', 'FHS', 'FRW', 'FRV', 'FRC', 'FRS', 'WHD', 'RLD', 'RLE', 'RLS',
                'RHW', 'RHS', 'NRD', 'NRS', 'CME', 'CMC', 'CAE', 'CAC', 'SHW', 'SHS', 'LAW', 'NPT', 'DIS', 'DIM'
            ],
        },
    },

    auth: {
        DEST_ID: process.env.CENTRAL_AUTH_ID,
        PASSWORD: process.env.CENTRAL_AUTH_PASSWORD,
    },

    // --- 보고 정보 발신 워커 설정 ---
    reportTransmitWorker: {
        // DB를 폴링하여 미처리 메시지를 확인할 주기 (단위: 밀리초)
        POLLING_INTERVAL: 5000, // 5초
        // 최대 재시도 횟수
        MAX_RETRIES: 3,
        // 동시에 처리할 최대 작업 수
        CONCURRENCY_LIMIT: 5,
    },

    // --- 재난 정보 발행 워커 설정 ---
    disasterPublishWorker: {
        // DB를 폴링하여 미발행 보고를 확인할 주기 (단위: 밀리초)
        POLLING_INTERVAL: 5000, //5ch
        // 최대 재시도 횟수
        MAX_RETRIES: 3,
        // 동시에 처리할 최대 작업 수
        CONCURRENCY_LIMIT: 5,        
    },

    // --- 데이터베이스 설정 ---
    database: {
        HOST: process.env.PGHOST,
        PORT: parseInt(process.env.PGPORT, 10),
        DATABASE: process.env.PGDATABASE,
        USER: process.env.PGUSER,
        PASSWORD: process.env.PGPASSWORD,
    },

    // --- RabbitMQ 설정 ---
    rabbitmq: {
        URL: process.env.RABBITMQ_URL,
        NAMES: {
            // 재난 정보를 발행(발신)할 때 사용하는 Exchange
            DISASTER_EXCHANGE: 'disaster.topic',
            // 보고 메시지를 구독(수신)할 때 사용하는 Exchange
            REPORT_EXCHANGE: 'report.direct',
            // 수신한 보고 정보를 담을 Queue
            REPORT_QUEUE: 'central_service_report_queue',
            // 처리 실패한 보고 정보를 보낼 Dead Letter Exchange
            REPORT_DLX: 'report_dlx',
            // 처리 실패한 보고 정보를 담을 Dead Letter Queue
            REPORT_DLQ: 'report_dlq',
            // 재시도 할 메시지를 보낼 Exchange
            REPORT_RETRY_EXCHANGE: 'report_retry',
            // 재시도 할 메시지를 담을 Queue
            REPORT_WAIT_QUEUE: 'report_wait',
            REPORT_ROUTING_KEY: 'report.external',
        },
        RETRY_DELAY: 10000, // 10초
        MAX_RETRIES: 3,
    },

};