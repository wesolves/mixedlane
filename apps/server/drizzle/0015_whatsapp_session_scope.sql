ALTER TABLE whatsapp_sessions ADD COLUMN default_project_id uuid REFERENCES projects(id) ON DELETE SET NULL;
