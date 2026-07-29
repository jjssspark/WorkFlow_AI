if not redis.acl_check_cmd('XLEN', KEYS[1]) then
    return redis.error_reply('XLEN permission denied')
end
if not redis.acl_check_cmd('XADD', KEYS[1], '*', 'payload', ARGV[2]) then
    return redis.error_reply('XADD permission denied')
end
local outstanding = redis.call('XLEN', KEYS[1])
if outstanding >= tonumber(ARGV[1]) then
    return 'QUEUE_FULL'
end
return redis.call('XADD', KEYS[1], '*', 'payload', ARGV[2])
