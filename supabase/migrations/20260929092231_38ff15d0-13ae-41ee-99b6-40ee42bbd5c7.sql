INSERT INTO public.webinars (name, code, zoom_link, message_template, is_active, stop_chatbot, form_questions)
SELECT name, 'WEBINAR', zoom_link, message_template, true, stop_chatbot, '[]'::jsonb
FROM public.webinars WHERE id = '96dbcc65-2fbe-402d-b65e-4eb6f40cbe34'
AND NOT EXISTS (SELECT 1 FROM public.webinars WHERE upper(code) = 'WEBINAR');