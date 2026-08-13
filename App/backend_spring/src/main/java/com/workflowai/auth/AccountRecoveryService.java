package com.workflowai.auth;

import com.workflowai.user.User;
import com.workflowai.user.UserRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 아이디(이메일) 찾기.
 *
 * <p>이름·소속은 같은 조직 사람이면 대체로 아는 정보다. 그래서 조회 결과를 그대로 노출하면
 * 남의 이메일을 캐내는 통로가 된다. 마스킹으로 유출 폭을 제한하고, 일치 항목이 없어도
 * 예외 대신 빈 목록을 돌려준다 — "그 사람 없습니다"도 알려주지 않는다.
 */
@Service
public class AccountRecoveryService {
    private final UserRepository userRepository;

    public AccountRecoveryService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional(readOnly = true)
    public List<String> findMaskedEmails(String name, String affiliation) {
        if (name == null || affiliation == null) {
            return List.of();
        }
        return userRepository.findAllByNameAndAffiliation(name.trim(), affiliation.trim())
            .stream()
            .map(User::getEmail)
            .map(EmailMasker::mask)
            .toList();
    }
}
