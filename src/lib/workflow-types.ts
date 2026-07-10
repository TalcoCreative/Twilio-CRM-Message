export type StepType =
  | "message"
  | "closing"
  | "input_text"
  | "textarea"
  | "dropdown"
  | "radio"
  | "checkbox"
  | "date"
  | "phone"
  | "email"
  | "number"
  | "file"
  | "conditional";

export const STEP_META: Record<StepType, { label: string; mappable: boolean; hasOptions: boolean; hasPrompt: boolean }> = {
  message:     { label: "Pesan Bot",       mappable: false, hasOptions: false, hasPrompt: true  },
  closing:     { label: "Pesan Penutup",   mappable: false, hasOptions: false, hasPrompt: true  },
  input_text:  { label: "Input Teks",      mappable: true,  hasOptions: false, hasPrompt: true  },
  textarea:    { label: "Textarea",        mappable: true,  hasOptions: false, hasPrompt: true  },
  dropdown:    { label: "Dropdown",        mappable: true,  hasOptions: true,  hasPrompt: true  },
  radio:       { label: "Radio",           mappable: true,  hasOptions: true,  hasPrompt: true  },
  checkbox:    { label: "Checkbox (multi)",mappable: true,  hasOptions: true,  hasPrompt: true  },
  date:        { label: "Tanggal",         mappable: true,  hasOptions: false, hasPrompt: true  },
  phone:       { label: "Nomor Telepon",   mappable: true,  hasOptions: false, hasPrompt: true  },
  email:       { label: "Email",           mappable: true,  hasOptions: false, hasPrompt: true  },
  number:      { label: "Angka",           mappable: true,  hasOptions: false, hasPrompt: true  },
  file:        { label: "Upload File",     mappable: true,  hasOptions: false, hasPrompt: true  },
  conditional: { label: "Conditional",     mappable: false, hasOptions: false, hasPrompt: false },
};

export const MAPPING_FIELDS: { value: string; label: string }[] = [
  { value: "",                              label: "— Tidak disimpan —" },
  { value: "contacts.full_name",            label: "Nama Lengkap" },
  { value: "contacts.whatsapp_number",      label: "No WhatsApp" },
  { value: "contacts.domicile",             label: "Domisili" },
  { value: "contacts.interested_product_id",label: "Produk (pilih dari katalog)" },
  { value: "contacts.stage_id",             label: "Stage (pipeline)" },
  { value: "contacts.content_code_id",      label: "Kategori Pertanyaan / Kode Konten" },
  { value: "contacts.estimated_revenue",    label: "Estimated Revenue (Rp)" },
  { value: "contacts.source",               label: "Source" },
  { value: "contacts.chief_complaint",      label: "Keluhan / Pertanyaan" },
  { value: "contacts.notes",                label: "Catatan" },
  { value: "contacts.document_url",         label: "URL Dokumen / Link" },
];

// Sumber opsi dinamis untuk step dropdown/radio/checkbox — opsi diambil realtime dari tabel terkait.
export const OPTION_SOURCES: { value: string; label: string; mapping?: string }[] = [
  { value: "manual",        label: "Manual (ketik sendiri)" },
  { value: "products",      label: "Katalog Produk",             mapping: "contacts.interested_product_id" },
  { value: "stages",        label: "Stages / Pipeline",          mapping: "contacts.stage_id" },
  { value: "content_codes", label: "Kategori Pertanyaan (Kode Konten)", mapping: "contacts.content_code_id" },
];

