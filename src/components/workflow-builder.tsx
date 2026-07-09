import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, GripVertical, Plus, Trash2, Save, CircleCheck, FileText, Power, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";
import { STEP_META, MAPPING_FIELDS, type StepType } from "@/lib/workflow-types";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Workflow = { id: string; name: string; description: string | null; status: string; version: number; is_enabled: boolean; published_at: string | null; parent_id: string | null };
type Step = { id: string; workflow_id: string; position: number; type: StepType; label: string | null; prompt: string | null; config: any; mapping: string | null };

export function WorkflowBuilderTab() {
  const [list, setList] = useState<Workflow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Workflow | null>(null);

  async function loadList() {
    const [{ data }, { data: setting }] = await Promise.all([
      supabase.from("workflows").select("*").order("updated_at", { ascending: false }),
      supabase.from("system_settings").select("value").eq("key", "active_workflow_id").maybeSingle(),
    ]);
    setList(data || []);
    setActiveId((setting?.value as any) || null);
  }
  useEffect(() => { loadList(); }, []);

  async function createWorkflow() {
    const name = prompt("Nama workflow:", "Onboarding Husada");
    if (!name) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("workflows").insert({ name, status: "draft", version: 1, created_by: user?.id || null }).select().single();
    if (error) return toast.error(error.message);
    setEditing(data as any);
    loadList();
  }

  async function createLeadsPreset() {
    if (!confirm("Buat workflow preset 'Onboarding Leads' — mengumpulkan Nama, Domisili, Produk, Estimasi Revenue, Keluhan, lalu simpan ke /leads. Lanjutkan?")) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { data: wf, error } = await supabase.from("workflows").insert({
      name: "Onboarding Leads", description: "Preset: kumpulkan data lead lengkap → langsung tampil di halaman /leads",
      status: "draft", version: 1, is_enabled: true, created_by: user?.id || null,
    }).select().single();
    if (error) return toast.error(error.message);

    const steps = [
      { type: "message",    label: "Salam Pembuka",  prompt: "Halo 👋 Terima kasih sudah menghubungi kami. Saya akan bantu catat kebutuhan Anda sebentar ya.", config: {}, mapping: null },
      { type: "input_text", label: "Nama Lengkap",   prompt: "Boleh saya tahu nama lengkap Anda?", config: {}, mapping: "contacts.full_name" },
      { type: "input_text", label: "Domisili",       prompt: "Domisili Anda di kota apa?", config: {}, mapping: "contacts.domicile" },
      { type: "dropdown",   label: "Produk Diminati",prompt: "Produk/layanan mana yang Anda minati? (ketik nomornya)", config: { source: "products" }, mapping: "contacts.interested_product_id" },
      { type: "number",     label: "Estimasi Budget",prompt: "Berapa estimasi budget/nilai kebutuhan Anda? (angka saja, contoh: 5000000)", config: {}, mapping: "contacts.estimated_revenue" },
      { type: "textarea",   label: "Keluhan/Kebutuhan", prompt: "Ceritakan singkat keluhan atau kebutuhan Anda:", config: {}, mapping: "contacts.chief_complaint" },
      { type: "closing",    label: "Penutup",        prompt: "Terima kasih! Data Anda sudah kami terima. Tim kami akan segera menghubungi Anda. 🙏", config: {}, mapping: null },
    ];
    const rows = steps.map((s, i) => ({ workflow_id: wf!.id, position: i, ...s }));
    const { error: sErr } = await supabase.from("workflow_steps").insert(rows);
    if (sErr) { toast.error(sErr.message); return; }

    // auto publish + set active
    await supabase.from("workflows").update({ status: "published", published_at: new Date().toISOString() }).eq("id", wf!.id);
    await supabase.from("system_settings").upsert({ key: "active_workflow_id", value: wf!.id });
    toast.success("Workflow preset 'Onboarding Leads' dibuat, dipublish & diaktifkan");
    setEditing({ ...(wf as any), status: "published", published_at: new Date().toISOString() });
    loadList();
  }

  async function duplicate(w: Workflow) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: clone, error } = await supabase.from("workflows").insert({
      name: `${w.name} (copy)`, description: w.description, status: "draft",
      version: 1, parent_id: w.id, created_by: user?.id || null,
    }).select().single();
    if (error) return toast.error(error.message);
    const { data: steps } = await supabase.from("workflow_steps").select("*").eq("workflow_id", w.id).order("position");
    if (steps?.length) {
      await supabase.from("workflow_steps").insert(steps.map((s: any) => ({
        workflow_id: clone!.id, position: s.position, type: s.type, label: s.label, prompt: s.prompt, config: s.config, mapping: s.mapping,
      })));
    }
    toast.success("Workflow diduplikasi");
    loadList();
  }

  async function newVersion(w: Workflow) {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: clone, error } = await supabase.from("workflows").insert({
      name: w.name, description: w.description, status: "draft",
      version: w.version + 1, parent_id: w.id, created_by: user?.id || null,
    }).select().single();
    if (error) return toast.error(error.message);
    const { data: steps } = await supabase.from("workflow_steps").select("*").eq("workflow_id", w.id).order("position");
    if (steps?.length) {
      await supabase.from("workflow_steps").insert(steps.map((s: any) => ({
        workflow_id: clone!.id, position: s.position, type: s.type, label: s.label, prompt: s.prompt, config: s.config, mapping: s.mapping,
      })));
    }
    toast.success("Versi baru dibuat (draft)");
    setEditing(clone as any);
    loadList();
  }

  async function publish(w: Workflow) {
    const { error } = await supabase.from("workflows").update({ status: "published", published_at: new Date().toISOString() }).eq("id", w.id);
    if (error) return toast.error(error.message);
    // Auto-set as active if none yet, or replace older version of same family
    await supabase.from("system_settings").upsert({ key: "active_workflow_id", value: w.id });
    toast.success(`v${w.version} dipublikasikan & aktif`);
    loadList();
  }

  async function setActive(w: Workflow) {
    if (w.status !== "published") return toast.error("Hanya workflow yang sudah dipublikasi yang bisa diaktifkan");
    await supabase.from("system_settings").upsert({ key: "active_workflow_id", value: w.id });
    toast.success("Workflow aktif diperbarui");
    loadList();
  }

  async function toggleEnabled(w: Workflow) {
    await supabase.from("workflows").update({ is_enabled: !w.is_enabled }).eq("id", w.id);
    loadList();
  }

  async function remove(w: Workflow) {
    if (!confirm(`Hapus workflow "${w.name}" v${w.version}?`)) return;
    if (activeId === w.id) await supabase.from("system_settings").delete().eq("key", "active_workflow_id");
    const { error } = await supabase.from("workflows").delete().eq("id", w.id);
    if (error) return toast.error(error.message);
    toast.success("Workflow dihapus");
    loadList();
  }

  if (editing) return <WorkflowEditor workflow={editing} onBack={() => { setEditing(null); loadList(); }} />;

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Dynamic Workflow Builder</CardTitle>
            <CardDescription>Bangun alur chatbot inbound (greeting, pertanyaan, mapping) dengan drag & drop. Versioning, draft, publish, enable/disable didukung penuh.</CardDescription>
          </div>
          <Button variant="outline" onClick={createLeadsPreset}><FileText className="size-4 mr-1" />Preset Leads</Button>
          <Button onClick={createWorkflow}><Plus className="size-4 mr-1" />Workflow Baru</Button>
        </CardHeader>
        <CardContent>
          {!list.length && <p className="text-sm text-muted-foreground">Belum ada workflow. Buat workflow baru untuk memulai.</p>}
          <div className="space-y-2">
            {list.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border bg-card">
                <FileText className="size-4 text-muted-foreground" />
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{w.name}</span>
                    <Badge variant="outline" className="text-xs">v{w.version}</Badge>
                    {w.status === "draft" && <Badge className="bg-amber-500/15 text-amber-600 text-xs">Draft</Badge>}
                    {w.status === "published" && <Badge className="bg-emerald-500/15 text-emerald-600 text-xs">Published</Badge>}
                    {w.status === "archived" && <Badge variant="secondary" className="text-xs">Archived</Badge>}
                    {activeId === w.id && <Badge className="bg-primary text-primary-foreground text-xs">AKTIF</Badge>}
                    {!w.is_enabled && <Badge variant="destructive" className="text-xs">Disabled</Badge>}
                  </div>
                  {w.description && <p className="text-xs text-muted-foreground mt-0.5">{w.description}</p>}
                </div>
                <div className="flex gap-1 ml-auto flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => setEditing(w)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => duplicate(w)} title="Duplicate"><Copy className="size-3.5" /></Button>
                  {w.status === "published" && (
                    <Button size="sm" variant="ghost" onClick={() => newVersion(w)} title="New version">v+1</Button>
                  )}
                  {w.status === "draft" && <Button size="sm" onClick={() => publish(w)}><CircleCheck className="size-3.5 mr-1" />Publish</Button>}
                  {w.status === "published" && activeId !== w.id && <Button size="sm" variant="outline" onClick={() => setActive(w)}>Set Aktif</Button>}
                  <Button size="sm" variant="ghost" onClick={() => toggleEnabled(w)} title={w.is_enabled ? "Disable" : "Enable"}><Power className="size-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(w)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowEditor({ workflow, onBack }: { workflow: Workflow; onBack: () => void }) {
  const [wf, setWf] = useState<Workflow>(workflow);
  const [steps, setSteps] = useState<Step[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isLocked = false; // Workflow dapat diedit langsung (live), termasuk yang sudah published

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function loadSteps() {
    const { data } = await supabase.from("workflow_steps").select("*").eq("workflow_id", wf.id).order("position");
    setSteps((data || []) as any);
  }
  useEffect(() => { loadSteps(); }, [wf.id]);

  async function saveMeta() {
    const { error } = await supabase.from("workflows").update({ name: wf.name, description: wf.description }).eq("id", wf.id);
    if (error) return toast.error(error.message);
    toast.success("Tersimpan");
  }

  async function addStep(type: StepType) {
    if (isLocked) return toast.error("Workflow published — buat versi baru untuk mengedit");
    const pos = (steps[steps.length - 1]?.position ?? -1) + 1;
    const meta = STEP_META[type];
    const config: any = {};
    if (meta.hasOptions) config.options = ["Opsi 1", "Opsi 2"];
    const { data, error } = await supabase.from("workflow_steps").insert({
      workflow_id: wf.id, position: pos, type, label: meta.label, prompt: meta.hasPrompt ? "" : null, config, mapping: null,
    }).select().single();
    if (error) return toast.error(error.message);
    setSteps([...steps, data as any]);
    setExpandedId((data as any).id);
  }

  async function updateStep(id: string, patch: Partial<Step>) {
    setSteps((arr) => arr.map((s) => s.id === id ? { ...s, ...patch } : s));
    await supabase.from("workflow_steps").update(patch as any).eq("id", id);
  }

  async function duplicateStep(s: Step) {
    if (isLocked) return;
    const pos = steps[steps.length - 1].position + 1;
    const { data, error } = await supabase.from("workflow_steps").insert({
      workflow_id: wf.id, position: pos, type: s.type, label: s.label, prompt: s.prompt, config: s.config, mapping: s.mapping,
    }).select().single();
    if (error) return toast.error(error.message);
    setSteps([...steps, data as any]);
  }

  async function removeStep(id: string) {
    if (isLocked) return;
    if (!confirm("Hapus step ini?")) return;
    await supabase.from("workflow_steps").delete().eq("id", id);
    setSteps(steps.filter((s) => s.id !== id));
  }

  async function onDragEnd(event: DragEndEvent) {
    if (isLocked) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);
    const next = arrayMove(steps, oldIndex, newIndex).map((s, i) => ({ ...s, position: i }));
    setSteps(next);
    await Promise.all(next.map((s) => supabase.from("workflow_steps").update({ position: s.position }).eq("id", s.id)));
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" onClick={onBack}><ArrowLeft className="size-4 mr-1" />Kembali</Button>
            <CardTitle className="flex-1">Editor Workflow</CardTitle>
            <Badge variant="outline" className="text-xs">v{wf.version}</Badge>
            {wf.status === "draft" && <Badge className="bg-amber-500/15 text-amber-600 text-xs">Draft</Badge>}
            {wf.status === "published" && <Badge className="bg-emerald-500/15 text-emerald-600 text-xs">Published — perubahan langsung live</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nama Workflow</Label>
              <Input value={wf.name} onChange={(e) => setWf({ ...wf, name: e.target.value })} disabled={isLocked} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Deskripsi</Label>
              <Input value={wf.description || ""} onChange={(e) => setWf({ ...wf, description: e.target.value })} disabled={isLocked} placeholder="Tujuan workflow ini" />
            </div>
          </div>
          {!isLocked && <Button size="sm" onClick={saveMeta}><Save className="size-3.5 mr-1" />Simpan Meta</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Steps</CardTitle>
          <CardDescription>Tarik kartu (ikon ⋮⋮) untuk mengatur urutan. Klik kartu untuk mengedit detail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <SortableStepCard key={s.id} step={s} index={i} steps={steps} expanded={expandedId === s.id} onExpand={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    onUpdate={(p) => updateStep(s.id, p)} onDuplicate={() => duplicateStep(s)} onRemove={() => removeStep(s.id)} locked={isLocked} />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {!steps.length && <p className="text-sm text-muted-foreground">Belum ada step. Tambahkan step pertama di bawah.</p>}

          {!isLocked && (
            <div className="border-t pt-3">
              <Label className="text-xs">Tambah Step</Label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {Object.entries(STEP_META).map(([k, m]) => (
                  <Button key={k} size="sm" variant="outline" onClick={() => addStep(k as StepType)}>
                    <Plus className="size-3.5 mr-1" />{m.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableStepCard({ step, index, steps, expanded, onExpand, onUpdate, onDuplicate, onRemove, locked }: {
  step: Step; index: number; steps: Step[]; expanded: boolean; onExpand: () => void;
  onUpdate: (p: Partial<Step>) => void; onDuplicate: () => void; onRemove: () => void; locked: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const meta = STEP_META[step.type];

  return (
    <div ref={setNodeRef} style={style} className="border rounded-xl bg-card">
      <div className="flex items-center gap-2 p-3">
        <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 text-muted-foreground hover:text-foreground" disabled={locked}>
          <GripVertical className="size-4" />
        </button>
        <span className="size-7 grid place-items-center rounded-lg bg-muted text-xs font-mono">{index + 1}</span>
        <Badge variant="outline" className="text-xs">{meta.label}</Badge>
        <span className="flex-1 truncate text-sm">{step.label || step.prompt || <em className="text-muted-foreground">tanpa label</em>}</span>
        {step.mapping && <Badge className="bg-blue-500/15 text-blue-600 text-xs">{step.mapping.split(".")[1]}</Badge>}
        <Button size="sm" variant="ghost" onClick={onExpand}>{expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</Button>
        {!locked && <>
          <Button size="sm" variant="ghost" onClick={onDuplicate}><Copy className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}><Trash2 className="size-3.5" /></Button>
        </>}
      </div>

      {expanded && (
        <div className="border-t p-3 space-y-3 bg-muted/30">
          <div className="space-y-1.5">
            <Label className="text-xs">Label Internal</Label>
            <Input value={step.label || ""} onChange={(e) => onUpdate({ label: e.target.value })} disabled={locked} placeholder="Untuk memudahkan referensi" />
          </div>

          {meta.hasPrompt && (
            <div className="space-y-1.5">
              <Label className="text-xs">{step.type === "message" || step.type === "closing" ? "Pesan yang dikirim" : "Pertanyaan ke user"}</Label>
              <Textarea value={step.prompt || ""} onChange={(e) => onUpdate({ prompt: e.target.value })} disabled={locked} rows={3}
                placeholder={step.type === "message" ? "Halo, selamat datang di Rumah Sakit Husada." : "Mohon kirim nama lengkap Anda"} />
            </div>
          )}

          {meta.hasOptions && (
            <OptionsEditor step={step} onUpdate={onUpdate} locked={locked} />
          )}

          {meta.mappable && (
            <div className="space-y-1.5">
              <Label className="text-xs">Mapping ke Database</Label>
              <Select value={step.mapping || "__none"} onValueChange={(v) => onUpdate({ mapping: v === "__none" ? null : v })} disabled={locked}>
                <SelectTrigger><SelectValue placeholder="Tidak disimpan" /></SelectTrigger>
                <SelectContent>
                  {MAPPING_FIELDS.map((f) => <SelectItem key={f.value || "none"} value={f.value || "__none"}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {step.type === "conditional" && (
            <ConditionalEditor step={step} steps={steps} onUpdate={onUpdate} locked={locked} />
          )}
        </div>
      )}
    </div>
  );
}

function OptionsEditor({ step, onUpdate, locked }: { step: Step; onUpdate: (p: Partial<Step>) => void; locked: boolean }) {
  const cfg = step.config || {};
  const opts: string[] = cfg.options || [];
  const source = cfg.source || "manual";
  function setOpts(next: string[]) { onUpdate({ config: { ...cfg, options: next } }); }
  return (
    <div className="space-y-2">
      {step.mapping === "contacts.interested_product_id" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Sumber Opsi</Label>
          <Select value={source} onValueChange={(v) => onUpdate({ config: { ...cfg, source: v } })} disabled={locked}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="products">Otomatis dari Katalog Produk</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {source !== "products" && (
        <div className="space-y-1.5">
          <Label className="text-xs">Opsi Pilihan</Label>
          {opts.map((o, i) => (
            <div key={i} className="flex gap-1.5">
              <span className="size-9 grid place-items-center rounded-md bg-muted text-xs font-mono">{i + 1}</span>
              <Input value={o} onChange={(e) => { const n = [...opts]; n[i] = e.target.value; setOpts(n); }} disabled={locked} />
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => setOpts(opts.filter((_, idx) => idx !== i))}><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={locked} onClick={() => setOpts([...opts, `Opsi ${opts.length + 1}`])}><Plus className="size-3.5 mr-1" />Tambah Opsi</Button>
        </div>
      )}
    </div>
  );
}

function ConditionalEditor({ step, steps, onUpdate, locked }: { step: Step; steps: Step[]; onUpdate: (p: Partial<Step>) => void; locked: boolean }) {
  const cfg = step.config || {};
  const branches: any[] = cfg.branches || [];
  function setBranches(next: any[]) { onUpdate({ config: { ...cfg, branches: next } }); }
  const prevSteps = steps.filter((s) => s.position < step.position);
  const nextSteps = steps.filter((s) => s.position !== step.position);
  return (
    <div className="space-y-2">
      <Label className="text-xs">Cabang (jika kondisi cocok → lompat ke step)</Label>
      {branches.map((b, i) => (
        <div key={i} className="grid grid-cols-12 gap-1.5 items-end p-2 border rounded-lg bg-background">
          <div className="col-span-4">
            <Label className="text-[10px]">Step jawaban</Label>
            <Select value={b.if_step_id || ""} onValueChange={(v) => { const n = [...branches]; n[i] = { ...b, if_step_id: v }; setBranches(n); }} disabled={locked}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Step…" /></SelectTrigger>
              <SelectContent>{prevSteps.map((s) => <SelectItem key={s.id} value={s.id}>#{s.position + 1} {s.label || s.type}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-[10px]">Operator</Label>
            <Select value={b.op || "equals"} onValueChange={(v) => { const n = [...branches]; n[i] = { ...b, op: v }; setBranches(n); }} disabled={locked}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="equals">=</SelectItem>
                <SelectItem value="contains">contains</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-3">
            <Label className="text-[10px]">Nilai</Label>
            <Input className="h-8" value={b.value || ""} onChange={(e) => { const n = [...branches]; n[i] = { ...b, value: e.target.value }; setBranches(n); }} disabled={locked} />
          </div>
          <div className="col-span-2">
            <Label className="text-[10px]">Lompat ke</Label>
            <Select value={b.goto_step_id || ""} onValueChange={(v) => { const n = [...branches]; n[i] = { ...b, goto_step_id: v }; setBranches(n); }} disabled={locked}>
              <SelectTrigger className="h-8"><SelectValue placeholder="Step…" /></SelectTrigger>
              <SelectContent>{nextSteps.map((s) => <SelectItem key={s.id} value={s.id}>#{s.position + 1} {s.label || s.type}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-1">
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => setBranches(branches.filter((_, idx) => idx !== i))}><Trash2 className="size-3.5" /></Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" disabled={locked} onClick={() => setBranches([...branches, { op: "equals" }])}><Plus className="size-3.5 mr-1" />Tambah Cabang</Button>
    </div>
  );
}
