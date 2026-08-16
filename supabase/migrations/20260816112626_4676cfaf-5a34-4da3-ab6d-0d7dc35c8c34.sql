CREATE INDEX IF NOT EXISTS idx_msg_sent_at ON public.messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_dir_sent ON public.messages (direction, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_sentby_sent ON public.messages (sent_by_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_created ON public.contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_status ON public.conversations (status);
CREATE INDEX IF NOT EXISTS idx_inv_responded ON public.assignment_invitations (responded_at DESC);
ANALYZE public.messages;
ANALYZE public.contacts;
ANALYZE public.conversations;