-- Tabela para armazenar ctwaClid por lead_id do Kommo
-- Usada para associar conversão (consulta agendada) ao clique do anúncio CTW

CREATE TABLE IF NOT EXISTS public.ctw_leads (
  lead_id       BIGINT PRIMARY KEY,
  ctwa_clid     TEXT NOT NULL,
  source_id     TEXT,
  source_url    TEXT,
  phone         TEXT,
  dataset_id    TEXT,
  page_id       TEXT,
  lead_event_sent_at  TIMESTAMPTZ DEFAULT now(),
  purchase_event_sent_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Index para busca por phone (caso precise associar sem lead_id)
CREATE INDEX IF NOT EXISTS ctw_leads_phone_idx ON public.ctw_leads (phone);
