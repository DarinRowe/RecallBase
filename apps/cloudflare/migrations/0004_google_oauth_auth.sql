CREATE TABLE IF NOT EXISTS auth_users (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  picture_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_identities (
  google_sub TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  picture_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id)
);

CREATE INDEX IF NOT EXISTS google_identities_user_idx
  ON google_identities (user_id);

CREATE TABLE IF NOT EXISTS cli_login_attempts (
  attempt_id TEXT PRIMARY KEY,
  poll_token_sha256 TEXT NOT NULL,
  oauth_state_sha256 TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  status TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  consumed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cli_login_attempts_poll_token_idx
  ON cli_login_attempts (poll_token_sha256);

CREATE UNIQUE INDEX IF NOT EXISTS cli_login_attempts_oauth_state_idx
  ON cli_login_attempts (oauth_state_sha256);

CREATE INDEX IF NOT EXISTS cli_login_attempts_status_idx
  ON cli_login_attempts (status, expires_at);

CREATE TABLE IF NOT EXISTS cli_device_tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS cli_device_tokens_hash_idx
  ON cli_device_tokens (token_sha256);

CREATE INDEX IF NOT EXISTS cli_device_tokens_subject_idx
  ON cli_device_tokens (user_id, device_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS web_oauth_states (
  state_sha256 TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS web_sessions (
  session_id_sha256 TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id)
);

CREATE INDEX IF NOT EXISTS web_sessions_user_idx
  ON web_sessions (user_id, revoked_at, expires_at);
