-- in-flight 마커가 아직 이 작업(ARGV[1] = jobId)의 소유일 때만 TTL을 ARGV[2] 밀리초로 늘린다.
-- 소유권을 확인하지 않으면, 이미 만료돼 다른 요청이 새 jobId로 다시 claim한 마커의 수명을
-- 늦게 끝난 이전 워커가 연장해 버린다. 키가 없으면 PEXPIRE가 0을 돌려주므로 되살아나지 않는다.
if not redis.acl_check_cmd('GET', KEYS[1]) then
    return redis.error_reply('GET permission denied')
end
if not redis.acl_check_cmd('PEXPIRE', KEYS[1], ARGV[2]) then
    return redis.error_reply('PEXPIRE permission denied')
end
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
