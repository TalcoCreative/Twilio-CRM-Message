ALTER TABLE public.webinars ADD COLUMN IF NOT EXISTS form_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.webinar_registrations ADD COLUMN IF NOT EXISTS answers jsonb;
UPDATE public.webinars SET form_questions = '[
 {"key":"nama","label":"Nama","prompt":"Boleh kami tahu nama lengkap kamu?","map":"full_name"},
 {"key":"usia","label":"Usia","prompt":"Berapa usia kamu saat ini?","map":"age"},
 {"key":"domisili","label":"Domisili","prompt":"Kamu berdomisili di kota mana?","map":"domicile"},
 {"key":"pernah_periksa","label":"Sudah pernah periksa prostat?","prompt":"Apakah kamu sudah pernah periksa prostat sebelumnya? (Sudah/Belum)"},
 {"key":"pembayaran","label":"Metode pembayaran","prompt":"Jika nanti melakukan tindakan, metode pembayaran apa yang dipertimbangkan? (BPJS / ASURANSI / PRIBADI)"},
 {"key":"pertanyaan","label":"Pertanyaan untuk dokter","prompt":"Terakhir, ada pertanyaan yang ingin kamu sampaikan ke dokter saat webinar?"}
]'::jsonb WHERE form_questions = '[]'::jsonb;