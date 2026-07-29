ALTER TABLE comments ADD COLUMN parent_id BIGINT NULL REFERENCES comments(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX ux_comments_one_reply_per_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
