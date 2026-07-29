-- in-flight 마커가 아직 이 작업(ARGV[1] = jobId)의 소유일 때만 해제한다.
-- TTL(5분)이 만료된 뒤 다음 요청이 같은 (projectId, jobType) 키를 새 jobId로 다시 claim한
-- 상태에서 늦게 끝난 이전 워커가 무조건 DEL을 하면, 아직 큐에 남아 있는 새 작업의 마커까지
-- 지워 버린다(중복 실행 + 새 작업의 상태 조회가 FAILED로 오보고).
if not redis.acl_check_cmd('GET', KEYS[1]) then
    return redis.error_reply('GET permission denied')
end
if not redis.acl_check_cmd('DEL', KEYS[1]) then
    return redis.error_reply('DEL permission denied')
end
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
