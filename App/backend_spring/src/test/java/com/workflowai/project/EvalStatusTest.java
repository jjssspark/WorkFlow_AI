package com.workflowai.project;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EvalStatusTest {

    @Test
    void toJson_mapsEachValueToLowercaseFrontendLiteral() {
        assertThat(EvalStatus.PENDING.toJson()).isEqualTo("pending");
        assertThat(EvalStatus.EVALUATING.toJson()).isEqualTo("evaluating");
        assertThat(EvalStatus.PUBLISHED.toJson()).isEqualTo("published");
    }

    /**
     * enum이 DB의 chk_projects_eval_status가 허용하는 값과 어긋나면, 저장 시점에야
     * 제약 위반으로 드러난다. DONE이 그렇게 남아 있었다. 값이 늘어나면 마이그레이션으로
     * CHECK도 함께 넓히라는 뜻으로 여기서 막는다.
     */
    @Test
    void values_matchDatabaseCheckConstraint() {
        assertThat(EvalStatus.values())
            .containsExactly(EvalStatus.PENDING, EvalStatus.EVALUATING, EvalStatus.PUBLISHED);
    }
}
