/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 * @description 이 마이그레이션은 external-service에 필요한 초기 테이블과 트리거를 생성합니다.
 */
exports.shorthands = undefined;

/**
 * up 함수: 마이그레이션을 적용할 때(npm run migrate up) 실행됩니다.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {

    console.log('🚀 [ExternalService][Migrate] 초기 스키마 마이그레이션 시작...');

    // --- 1. updated_at 자동 업데이트를 위한 트리거 함수 생성 ---
    pgm.createFunction(
        'update_timestamp',
        [],
        {
            returns: 'TRIGGER',
            language: 'plpgsql',
            security: 'DEFINER',
        },
        `
            BEGIN
                -- NEW는 트리거를 발생시킨 행의 새로운 버전을 의미합니다.
                -- 이 행의 updated_at 컬럼을 현재 시간으로 설정합니다.
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
        `
    );
    pgm.sql('GRANT EXECUTE ON FUNCTION update_timestamp() TO PUBLIC;');
    console.log('✅ [ExternalService][Migrate] "update_timestamp" 함수 생성 및 권한 부여 완료.');

    // --- 2. 외부 시스템 정보 테이블 ---
    pgm.createTable('external_systems', {
        id: { type: 'bigserial', primaryKey: true },
        system_name: { type: 'text', notNull: true, unique: true },
        api_key: { type: 'text', notNull: true, unique: true, default: pgm.func('gen_random_uuid()') },
        origin_urls: { type: 'text[]', notNull: true },
        subscribed_event_codes: { type: 'text[]', notNull: true, default: '{}' },
        is_active: { type: 'boolean', notNull: true, default: true },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('external_systems', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('external_systems', 'api_key');
    console.log('✅ [ExternalService][Migrate] "external_systems" 테이블 및 트리거, 인덱스 생성 완료.');

    // --- 3. 단말기 제원 정보 테이블 ---
    pgm.createTable('devices', {
        id: { type: 'bigserial', primaryKey: true },
        external_system_id: { type: 'bigint', notNull: true, references: 'external_systems', onDelete: 'NO ACTION' },
        device_id: { type: 'text', notNull: true, unique: true },
        device_type: { type: 'text', notNull: true },
        device_name: { type: 'text', notNull: true },
        server_ip: { type: 'text' },
        server_name: { type: 'text' },
        device_model: { type: 'text' },
        device_lat: { type: 'text' },
        device_lon: { type: 'text' },
        device_address: { type: 'text' },
        note: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('devices', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('devices', 'external_system_id');
    pgm.createConstraint('devices', 'unique_device_per_system', {
        unique: ['external_system_id', 'device_id'],
    });
    console.log('✅ [ExternalService][Migrate] "devices" 테이블 및 트리거, 제약조건, 인덱스 생성 완료.');

    // --- 4. API 수신 로그 ---
    pgm.createTable('api_receive_logs', {
        id: { type: 'bigserial', primaryKey: true },
        external_system_id: { type: 'bigint', notNull: true, references: 'external_systems', onDelete: 'NO ACTION' },
        request_path: { type: 'text', notNull: true },
        request_body: { type: 'jsonb' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('api_receive_logs', 'created_at');
    console.log('✅ [ExternalService][Migrate] "api_receive_logs" 테이블를 생성 완료.');

    // --- 5. 외부 시스템 접속 로그 (API, Socket)---
    pgm.createTable('external_system_connection_logs', {
        id: { type: 'bigserial', primaryKey: true },
        external_system_id: { type: 'bigint', notNull: true, references: 'external_systems', onDelete: 'NO ACTION' },
        event_type: { type: 'text', notNull: true, check: "event_type IN ('API_AUTH_SUCCESS', 'API_AUTH_FAILED', 'SOCKET_AUTH_SUCCESS', 'SOCKET_AUTH_FAILED', 'SOCKET_CONNECTED', 'SOCKET_DISCONNECTED')" },
        ip_address: { type: 'text' },
        detail: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('external_system_connection_logs', ['external_system_id', 'created_at']);
    console.log('✅ [ExternalService][Migrate] "external_system_connection_logs" 테이블 및 인덱스 생성 완료.');   

    // --- 6. 단말기 상태 로그 ---
    pgm.createTable('device_status_logs', {
        id: { type: 'bigserial', primaryKey: true },
        device_id: { type: 'bigint', notNull: true, references: 'devices', onDelete: 'NO ACTION' },
        status_code: { type: 'text', notNull: true, check: "status_code IN ('ONLINE', 'OFFLINE', 'ERROR')" },
        status_message: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    });
    pgm.createIndex('device_status_logs', ['device_id', 'created_at']);
    console.log('✅ [ExternalService][Migrate] "device_status_logs" 테이블 및 인덱스 생성 완료.');

    // --- 7. 메시지큐 수신 로그 ---
    pgm.createTable('mq_receive_logs', {
        id: { type: 'bigserial', primaryKey: true },
        raw_message: { type: 'text', notNull: true },
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SUCCESS', 'FAILED')" },
        error_message: { type: 'text' },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('mq_receive_logs', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('mq_receive_logs', ['status', 'updated_at']);
    console.log('✅ [ExternalService][Migrate] "mq_receive_logs" 테이블 및 트리거, 인덱스 생성 완료.');   

    // --- 8. 보고 정보 발행 로그 ---
    pgm.createTable('report_publish_logs', {
        id: { type: 'bigserial', primaryKey: true },
        api_receive_log_id: { type: 'bigint', notNull: true, references: 'api_receive_logs', onDelete: 'NO ACTION' },
        external_system_name: { type: 'text', notNull: true },
        type: { type: 'text', notNull: true },
        routing_key: { type: 'text', notNull: true},
        raw_message: { type: 'jsonb', notNull: true },
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SENT', 'SUCCESS', 'FAILED')"},
        retry_count: { type: 'integer', notNull: true, default: 0 },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('report_publish_logs', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('report_publish_logs', ['status', 'updated_at']);
    console.log('✅ [ExternalService][Migrate] "report_publish_logs" 테이블 및 트리거 생성 완료.');   

    // --- 9. 재난 정보 발신 로그 테이블 ---
    pgm.createTable('disaster_transmit_logs', {
        id: { type: 'bigserial', primaryKey: true },
        mq_receive_log_id: { type: 'bigint', notNull: true, references: 'mq_receive_logs', onDelete: 'NO ACTION' },
        external_system_id: { type: 'bigint', notNull: true, references: 'external_systems', onDelete: 'NO ACTION' },
        identifier: { type: 'text', notNull: true },
        raw_message: { type: 'jsonb', notNull: true },
        status: { type: 'text', notNull: true, default: 'PENDING', check: "status IN ('PENDING', 'SENT', 'SUCCESS', 'FAILED')"},
        retry_count: { type: 'integer', notNull: true, default: 0 },
        created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
        updated_at: { type: 'timestamptz' },
    });
    pgm.createTrigger('disaster_transmit_logs', 'trigger_update_timestamp', {
        when: 'BEFORE', operation: 'UPDATE', level: 'ROW', function: 'update_timestamp',
    });
    pgm.createIndex('disaster_transmit_logs', ['status', 'updated_at']);
    pgm.createConstraint('disaster_transmit_logs', 'unique_disaster_transmit_logs_per_system', {
        unique: ['external_system_id', 'identifier'],
    });
    console.log('✅ [ExternalService][Migrate] "disaster_transmit_logs" 테이블 및 트리거, 제약조건, 인덱스 생성 완료.');   

};

/**
 * down 함수: 마이그레이션을 되돌릴 때(npm run migrate down) 실행됩니다.
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {

    console.log('🚀 [ExternalService][Migrate] 초기 스키마 마이그레이션 롤백 시작...');

    // 테이블 삭제 (생성의 역순)
    pgm.dropTable('disaster_transmit_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "disaster_transmit_logs" 테이블을 삭제 완료.');

    pgm.dropTable('report_publish_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "report_publish_logs" 테이블을 삭제 완료.');

    pgm.dropTable('mq_receive_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "mq_receive_logs" 테이블을 삭제 완료.');

    pgm.dropTable('device_status_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "device_status_logs" 테이블을 삭제 완료.');

    pgm.dropTable('external_system_connection_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "external_system_connection_logs" 테이블을 삭제 완료.');

    pgm.dropTable('api_receive_logs', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "api_receive_logs" 테이블을 삭제 완료.');

    pgm.dropTable('devices', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "devices" 테이블을 삭제 완료.');

    pgm.dropTable('external_systems', { ifExists: true }, { cascade: true } );
    console.log('✅ [ExternalService][Migrate] "external_systems" 테이블을 삭제 완료.');

    // 트리거 함수 삭제
    pgm.dropFunction('update_timestamp', [], { ifExists: true, cascade: true } );
    console.log('✅ [ExternalService][Migrate] "update_timestamp" 함수를 삭제 완료.');

    console.log('✅ [ExternalService][Migrate] 초기 스키마 마이그레이션 롤백 완료.');

};