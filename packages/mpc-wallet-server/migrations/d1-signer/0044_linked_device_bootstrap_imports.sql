-- This receipt survives session cleanup to prevent replayed imports from resurrecting sessions.
CREATE TABLE linked_device_bootstrap_imports (
 namespace TEXT NOT NULL, org_id TEXT NOT NULL, project_id TEXT NOT NULL, env_id TEXT NOT NULL,
 link_session_id TEXT NOT NULL,
 PRIMARY KEY (namespace, org_id, project_id, env_id, link_session_id)
);
