-- ============================================================
-- MLC PLATFORM — 06: EMAIL TEMPLATES & DOCUMENT SETTINGS
-- ============================================================
create table public.email_templates (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('verified_customer', 'cold_email', 'process')),
  template_type text not null,
  name          text not null,
  subject       text not null,
  body          text not null,
  variables     text[],
  is_active     boolean default true,
  sort_order    integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create trigger email_templates_updated_at before update on public.email_templates for each row execute function update_updated_at();

alter table public.email_templates enable row level security;
create policy "Auth users view templates" on public.email_templates for select using (auth.uid() is not null);
create policy "Admins manage templates" on public.email_templates for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create table public.document_settings (
  id                  uuid primary key default gen_random_uuid(),
  company_name        text default 'My Landlord Certificate Ltd',
  company_address     text default '134 Merton High Street, London, SW19 1BA',
  company_phone       text default '+44 020 3996 1070',
  company_email       text default 'info@mylandlordcertificate.co.uk',
  company_reg         text default '17265132',
  vat_number          text,
  bank_name           text default 'My Landlord Certificate Ltd',
  bank_account        text default '83356126',
  bank_sort_code      text default '60-83-71',
  payment_terms_days  integer default 3,
  payment_methods     text default 'Bank Deposit, Card or Cash',
  invoice_footer      text default 'Our terms are strictly 3 days.',
  quote_footer        text default 'This quote is valid for 14 days from the date of issue.',
  google_review_url   text default 'https://g.page/r/CQQFQ83KgCpPEAI/review',
  created_at          timestamptz default now()
);
insert into public.document_settings default values;

alter table public.document_settings enable row level security;
create policy "Auth users view settings" on public.document_settings for select using (auth.uid() is not null);
create policy "Admins manage settings" on public.document_settings for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- Seed templates
insert into public.email_templates (category, template_type, name, subject, body, variables, sort_order) values
('verified_customer','discovery','Certificate Renewal — Discovery','Certificate Renewal Due — {{property_address}}','Good Morning/Afternoon {{name}},

I hope this email finds you well.

A/An {{inspection_name}} was carried out at {{property_address}} on {{last_inspection_date}} last year. The certificates issued at that time are now due for renewal.

To keep the property compliant and avoid any gaps in certification, we''d recommend scheduling a new inspection at your earliest convenience. We currently have morning and afternoon slots available from tomorrow onwards.

Please let us know how you''d like to proceed and we''ll get it booked in for you.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','last_inspection_date','rep_name'],1),

('verified_customer','follow_up_1','Certificate Renewal — Follow Up 1','Following Up — {{inspection_name}} Renewal at {{property_address}}','Good Morning/Afternoon {{name}},

I just wanted to follow up on my previous email regarding the {{inspection_name}} renewal at {{property_address}}.

We still have morning and afternoon slots available from tomorrow. Please let us know if you''d like us to get something booked in.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','rep_name'],2),

('verified_customer','follow_up_2','Certificate Renewal — Follow Up 2 (Final)','Final Notice — {{inspection_name}} Renewal at {{property_address}}','Good Morning/Afternoon {{name}},

I wanted to reach out one final time regarding the {{inspection_name}} renewal at {{property_address}}. As the certificates have now expired, we''d recommend getting this sorted as soon as possible to keep the property legally compliant.

Slots are available from tomorrow — just reply or call us on 020 3996 1070 and we''ll take care of it.

If you''ve made alternative arrangements, please do let us know.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','rep_name'],3),

('cold_email','discovery','Cold Outreach — Discovery','Landlord Certificates for Your Managed Properties','Good Morning/Afternoon {{name}},

I hope you''re well. I''m reaching out from My Landlord Certificate. We provide EICR, Gas Safety, EPC, Fire Risk Assessments, PAT Testing and more for letting agents across London.

We work with letting agencies to take the hassle out of compliance — competitive prices, accredited engineers, and certificates emailed within 24 hours of the inspection. No hidden charges, no delays to tenancy start dates.

If you''re currently managing these certificates across multiple properties, we''d love to show you how we can simplify the process for you.

Would you be open to a quick call this week?

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','rep_name'],4),

('cold_email','follow_up_1','Cold Outreach — Follow Up 1','Following Up — Compliance Certificates for Your Properties','Good Morning/Afternoon {{name}},

I just wanted to follow up on my previous email regarding compliance certificates for your managed properties.

We work with letting agencies across London as a single point of contact for all landlord certificates — one booking, one invoice, certificate within 24 hours. It removes a lot of the back-and-forth your team likely deals with at the moment.

If this sounds useful, I''d be happy to arrange a brief call at a time that suits you.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','rep_name'],5),

('cold_email','follow_up_2','Cold Outreach — Follow Up 2 (Final)','Keeping the Door Open — My Landlord Certificate','Good Morning/Afternoon {{name}},

I won''t keep chasing, but I did want to reach out one final time.

If landlord compliance is something your agency manages and you''d ever like a reliable, affordable partner for EICR, Gas Safety, EPC or any other certificates — we''re here.

Feel free to get in touch whenever the time is right.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','rep_name'],6),

('process','invoice','Invoice Email','Your Invoice — {{inspection_name}} at {{property_address}}','Good Morning/Afternoon {{name}},

Please find your invoice attached for the {{inspection_name}} at {{property_address}}.

Bank Transfer Details:
Account Name: My Landlord Certificate Ltd
Account Number: 83356126
Sort Code: 60-83-71

If you have any questions regarding the invoice, please don''t hesitate to get in touch.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','invoice_link','rep_name'],7),

('process','payment_confirmation','Payment Confirmation','Payment Received — {{inspection_name}} at {{property_address}}','Good Morning/Afternoon {{name}},

Thank you — we''ve received your payment for the {{inspection_name}} at {{property_address}}.

Your appointment is confirmed for {{date}} between {{time_window}}. You do not need to be present at the property — your tenant or a keyholder can provide access.

If you need to make any changes or have any questions ahead of the appointment, please contact us on 020 3996 1083 or reply to this email.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','date','time_window','rep_name'],8),

('process','job_confirmation','Booking Confirmation','Booking Confirmation — {{inspection_name}} at {{property_address}}','Good Morning/Afternoon {{name}},

Thank you for booking with My Landlord Certificate. Your appointment has been confirmed and details are as follows:

Service: {{inspection_name}}
Property: {{property_address}}
Date: {{date}}
Time Slot: {{time_slot}}
Certificate Holder: {{certificate_holder}}

Please note the following ahead of your appointment:
- You do not need to be present at the property — a tenant or keyholder can provide access
- Our engineer will call approximately one hour before arrival
- Please ensure parking is available for our engineer where possible

Your certificate will be emailed to you within 24 hours of the inspection being completed.

If you need to make any changes or have any questions, please contact us on 020 3996 1070 or reply to this email.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','date','time_slot','certificate_holder','rep_name'],9),

('process','certificate_delivery','Certificate Delivery','Your Certificate — {{inspection_name}} at {{property_address}}','Good Morning/Afternoon {{name}},

Please find your {{inspection_name}} certificate attached for {{property_address}}, carried out on {{date}}.

The certificate is fully compliant and accepted by all local authorities, letting agents and mortgage lenders. Please ensure a copy is forwarded to your tenant within 28 days as required by law.

Renewal Due: {{renewal_date}}

We''ll be in touch ahead of your renewal to make sure the property stays compliant.

We''d really appreciate it if you could take a moment to leave us a Google review — it takes less than a minute and makes a huge difference to us as a growing business.

https://g.page/r/CQQFQ83KgCpPEAI/review

Thank you for choosing My Landlord Certificate.

Kind regards,
{{rep_name}}
My Landlord Certificate
020 3996 1070',ARRAY['name','inspection_name','property_address','date','renewal_date','rep_name'],10);
