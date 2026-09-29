PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  senha_hash TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  numero_pedido TEXT NOT NULL DEFAULT '',
  cliente TEXT NOT NULL DEFAULT '',
  arquivo_nome TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'em_andamento',
  total_itens INTEGER NOT NULL DEFAULT 0,
  total_unidades INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pedidos_usuario ON pedidos(usuario_id);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  codigo TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '',
  quantidade INTEGER NOT NULL DEFAULT 0,
  separado INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_em TEXT NOT NULL,
  FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
