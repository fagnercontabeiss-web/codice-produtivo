// YOETZ · Central de Envio de Folha
// POST { action: "status" }
// POST { action: "sync", competencia?: "2026-10" }        lê o Google Drive
// POST { action: "enviar", documento_ids: [], reenviar? } envia pelo WhatsApp (Cloud API)
//
// Segredos: GOOGLE_SA_JSON, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
// Opcionais: WHATSAPP_TEMPLATE_DP (padrão envio_documento_dp), WHATSAPP_TEMPLATE_LANG (pt_BR), WHATSAPP_GRAPH_VERSION
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = (k: string) => Deno.env.get(k) ?? "";

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// ------------------------------------------------------------------ texto
function normalizar(txt: string): string {
  return (txt ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(ltda|me|epp|eireli|slu|limitada|cia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

/** "Outubro de 2026", "10-2026", "2026-10", "OUT/26" -> "2026-10-01" */
function parseCompetencia(nome: string): string | null {
  const n = (nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const pad = (m: number) => String(m).padStart(2, "0");
  const ano = (a: string) => (a.length === 2 ? 2000 + Number(a) : Number(a));
  for (const mes of Object.keys(MESES).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`(^|[^a-z])${mes}([^a-z]|$)`).test(n)) {
      const a = n.match(/(20\d{2})/)?.[1] ?? n.match(/(?:^|\D)(\d{2})(?:\D|$)/)?.[1];
      if (a) return `${ano(a)}-${pad(MESES[mes])}-01`;
    }
  }
  let m = n.match(/(20\d{2})\D{0,3}(0?[1-9]|1[0-2])(?!\d)/);
  if (m) return `${m[1]}-${pad(Number(m[2]))}-01`;
  m = n.match(/(?<!\d)(0?[1-9]|1[0-2])\D{1,3}(20\d{2})/);
  if (m) return `${m[2]}-${pad(Number(m[1]))}-01`;
  m = n.match(/(?<!\d)(0?[1-9]|1[0-2])\D{1,3}(\d{2})(?!\d)/);
  if (m) return `${ano(m[2])}-${pad(Number(m[1]))}-01`;
  return null;
}

type Tipo = "FOLHA" | "RECIBO" | "FGTS" | "INSS_DARF" | "GUIA" | "PROLABORE" | "FERIAS" | "RESCISAO" | "OUTROS";

function classificar(nomeArquivo: string): Tipo {
  const n = normalizar(nomeArquivo.replace(/\.[a-z0-9]+$/i, ""));
  if (/\b(fgts|gfd|grrf)\b/.test(n)) return "FGTS";
  if (/\b(darf|dctf|dctfweb|inss|previdenc\w*|irrf|gps)\b/.test(n)) return "INSS_DARF";
  if (/\b(rescis\w*|trct|aviso previo|homologa\w*)\b/.test(n)) return "RESCISAO";
  if (/\bferias\b/.test(n)) return "FERIAS";
  if (/\bpro ?labore\b/.test(n)) return "PROLABORE";
  if (/\b(recibo\w*|holerite\w*|contra ?cheque\w*)\b/.test(n)) return "RECIBO";
  if (/\b(folha|relacao|relatorio|resumo|demonstrativo)\b/.test(n)) return "FOLHA";
  if (/\bguia\w*\b/.test(n)) return "GUIA";
  return "OUTROS";
}

const DESCRICAO: Record<Tipo, string> = {
  FOLHA: "o relatório da folha de pagamento",
  RECIBO: "os recibos de pagamento",
  FGTS: "a guia do FGTS",
  INSS_DARF: "a guia do INSS (DARF)",
  GUIA: "a guia de pagamento",
  PROLABORE: "o recibo de pró-labore",
  FERIAS: "o recibo de férias",
  RESCISAO: "a documentação de rescisão",
  OUTROS: "o documento do Departamento Pessoal",
};

const cnpjsEm = (txt: string) => [...(txt ?? "").replace(/[.\/-]/g, "").matchAll(/(?<!\d)\d{14}(?!\d)/g)].map((m) => m[0]);

// ------------------------------------------------------------------ Google Drive (Service Account, leitura)
const FOLDER = "application/vnd.google-apps.folder";
let gCache: { token: string; exp: number } | null = null;

const b64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function googleToken(): Promise<string> {
  if (gCache && gCache.exp > Date.now() + 60_000) return gCache.token;
  const sa = JSON.parse(env("GOOGLE_SA_JSON"));
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google: ${data.error_description ?? data.error ?? res.status}`);
  gCache = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return gCache.token;
}

interface DriveFile { id: string; name: string; mimeType: string; size?: string; md5Checksum?: string; modifiedTime?: string }

async function listar(parentId: string): Promise<DriveFile[]> {
  const token = await googleToken();
  const out: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,size,md5Checksum,modifiedTime)",
      pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true", orderBy: "name",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`Drive: ${data.error?.message ?? res.status}`);
    out.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function arquivosDe(parentId: string, profundidade = 2): Promise<DriveFile[]> {
  const itens = await listar(parentId);
  const arquivos = itens.filter((i) => i.mimeType !== FOLDER && i.mimeType !== "application/vnd.google-apps.shortcut");
  if (profundidade > 0) {
    for (const sub of itens.filter((i) => i.mimeType === FOLDER)) arquivos.push(...(await arquivosDe(sub.id, profundidade - 1)));
  }
  return arquivos;
}

async function baixar(fileId: string, mimeType: string): Promise<{ blob: Blob; mime: string }> {
  const token = await googleToken();
  const nativo = mimeType.startsWith("application/vnd.google-apps.");
  const url = nativo
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download do Drive falhou (${res.status})`);
  return { blob: await res.blob(), mime: nativo ? "application/pdf" : mimeType };
}

// ------------------------------------------------------------------ WhatsApp Cloud API
const waBase = () => `https://graph.facebook.com/${env("WHATSAPP_GRAPH_VERSION") || "v23.0"}/${env("WHATSAPP_PHONE_ID")}`;

async function waUpload(blob: Blob, mime: string, nome: string): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new File([blob], nome, { type: mime }));
  const res = await fetch(`${waBase()}/media`, { method: "POST", headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}` }, body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Upload para o WhatsApp falhou (${res.status})`);
  return data.id;
}

async function waEnviar(p: { para: string; mediaId: string; arquivo: string; contato: string; descricao: string; competencia: string; empresa: string }): Promise<string> {
  const res = await fetch(`${waBase()}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: p.para,
      type: "template",
      template: {
        name: env("WHATSAPP_TEMPLATE_DP") || "envio_documento_dp",
        language: { code: env("WHATSAPP_TEMPLATE_LANG") || "pt_BR" },
        components: [
          { type: "header", parameters: [{ type: "document", document: { id: p.mediaId, filename: p.arquivo } }] },
          { type: "body", parameters: [p.contato, p.descricao, p.competencia, p.empresa].map((text) => ({ type: "text", text })) },
        ],
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.error_data?.details ?? data?.error?.message ?? `Envio falhou (${res.status})`);
  return data.messages?.[0]?.id;
}

// ------------------------------------------------------------------ ações
interface Cfg { owner_id: string; drive_root_folder_id: string }

async function sincronizar(cfg: Cfg, competenciaAlvo?: string) {
  const alvo = competenciaAlvo ? `${competenciaAlvo}-01`.slice(0, 10) : undefined;

  const raiz = (await listar(cfg.drive_root_folder_id)).filter((f) => f.mimeType === FOLDER);
  const comps = raiz.map((p) => ({ ...p, comp: parseCompetencia(p.name) })).filter((p) => p.comp) as Array<DriveFile & { comp: string }>;
  comps.sort((a, b) => b.comp.localeCompare(a.comp));
  const selecionadas = alvo ? comps.filter((c) => c.comp === alvo) : comps.slice(0, 2);
  if (alvo && !selecionadas.length) throw new Error(`Pasta da competência ${competenciaAlvo} não encontrada no Drive.`);

  await db.from("dp_competencias").upsert(
    comps.map((c) => ({ competencia: c.comp, drive_folder_id: c.id, drive_folder_nome: c.name })),
    { onConflict: "competencia" },
  );

  const { data: clientes } = await db.from("clients").select("id, name, document").eq("user_id", cfg.owner_id);
  const { data: vinculos } = await db.from("dp_vinculos").select("pasta_norm, client_id");
  const vinc = new Map((vinculos ?? []).map((v) => [v.pasta_norm, v.client_id]));
  const porCnpj = new Map<string, string>();
  const nomes: Array<{ id: string; norm: string; tokens: Set<string> }> = [];
  for (const c of clientes ?? []) {
    const doc = String(c.document ?? "").replace(/\D/g, "");
    if (doc.length === 14) porCnpj.set(doc, c.id);
    const norm = normalizar(c.name);
    nomes.push({ id: c.id, norm, tokens: new Set(norm.split(" ")) });
  }

  /** Vínculo já salvo > CNPJ no nome da pasta/arquivos > nome idêntico > sugestão por nome (exige confirmação). */
  async function resolver(pastaNome: string, arquivos: DriveFile[]): Promise<string | null> {
    const norm = normalizar(pastaNome);
    if (vinc.has(norm)) return vinc.get(norm)!;
    let achado: { id: string; origem: string; confirmado: boolean } | null = null;

    const porDoc = new Set([pastaNome, ...arquivos.map((a) => a.name)].flatMap(cnpjsEm).map((c) => porCnpj.get(c)).filter(Boolean) as string[]);
    if (porDoc.size === 1) achado = { id: [...porDoc][0], origem: "cnpj", confirmado: true };

    if (!achado) {
      const iguais = nomes.filter((n) => n.norm === norm);
      if (iguais.length === 1) achado = { id: iguais[0].id, origem: "nome", confirmado: true };
    }
    if (!achado && norm.length >= 3) {
      const partes = norm.split(" ");
      const candidatos = nomes.filter((n) => partes.every((p) => n.tokens.has(p)));
      if (candidatos.length === 1) achado = { id: candidatos[0].id, origem: "sugestao", confirmado: false };
    }
    if (!achado) return null;
    await db.from("dp_vinculos").upsert(
      { pasta_norm: norm, pasta_nome: pastaNome, client_id: achado.id, origem: achado.origem, confirmado: achado.confirmado },
      { onConflict: "pasta_norm", ignoreDuplicates: true },
    );
    vinc.set(norm, achado.id);
    return achado.id;
  }

  const ehEnviadas = (nome: string) => /^enviad[oa]s?$/.test(normalizar(nome));
  const resumo: Record<string, unknown>[] = [];

  for (const comp of selecionadas) {
    const filhos = (await listar(comp.id)).filter((f) => f.mimeType === FOLDER);
    const pastas: Array<DriveFile & { emEnviadas: boolean }> = [];
    for (const f of filhos) {
      if (ehEnviadas(f.name)) {
        for (const sub of (await listar(f.id)).filter((s) => s.mimeType === FOLDER)) pastas.push({ ...sub, emEnviadas: true });
      } else pastas.push({ ...f, emEnviadas: false });
    }

    const { data: existentes } = await db.from("dp_documentos")
      .select("id, drive_file_id, md5, drive_modified_at, status, nome_arquivo, pasta_cliente_norm, em_enviadas, client_id, tipo, tipo_manual")
      .eq("competencia", comp.comp);
    const mapa = new Map((existentes ?? []).map((d) => [d.drive_file_id, d]));
    const vistos = new Set<string>();
    let novos = 0, alterados = 0, semVinculo = 0;

    for (const pasta of pastas) {
      const arquivos = await arquivosDe(pasta.id, 2);
      const clientId = await resolver(pasta.name, arquivos);
      if (!clientId) semVinculo++;
      const norm = normalizar(pasta.name);
      const inserir: Record<string, unknown>[] = [];

      for (const f of arquivos) {
        vistos.add(f.id);
        const atual = mapa.get(f.id);
        const base = {
          competencia: comp.comp, client_id: clientId, pasta_cliente_nome: pasta.name, pasta_cliente_norm: norm,
          em_enviadas: pasta.emEnviadas, drive_file_id: f.id, nome_arquivo: f.name, mime_type: f.mimeType,
          tamanho_bytes: f.size ? Number(f.size) : null, md5: f.md5Checksum ?? null, drive_modified_at: f.modifiedTime ?? null,
        };
        if (!atual) {
          // Pasta já movida para "Enviadas" antes de o sistema conhecer o arquivo = envio manual anterior
          inserir.push({ ...base, tipo: classificar(f.name), status: pasta.emEnviadas ? "enviado" : "pronto", enviado_manual: pasta.emEnviadas });
          novos++;
          continue;
        }
        const mudouConteudo = f.md5Checksum && atual.md5
          ? f.md5Checksum !== atual.md5
          : !!(f.modifiedTime && atual.drive_modified_at && new Date(f.modifiedTime).getTime() !== new Date(atual.drive_modified_at).getTime());
        const tipo = atual.tipo_manual ? atual.tipo : classificar(f.name);
        const mudouMeta = atual.nome_arquivo !== f.name || atual.pasta_cliente_norm !== norm || atual.em_enviadas !== pasta.emEnviadas ||
          atual.client_id !== clientId || atual.tipo !== tipo || atual.status === "ignorado";
        if (!mudouConteudo && !mudouMeta) continue;

        const patch: Record<string, unknown> = { ...base, tipo, updated_at: new Date().toISOString() };
        if (atual.status === "ignorado") patch.status = "pronto";
        if (mudouConteudo && ["enviado", "lido", "enviando"].includes(atual.status)) {
          patch.status = "pronto";
          patch.alterado_apos_envio = true;
          patch.enviado_manual = false;
          patch.rodada_em = new Date().toISOString();
          alterados++;
        }
        await db.from("dp_documentos").update(patch).eq("id", atual.id);
      }
      if (inserir.length) {
        const { error } = await db.from("dp_documentos").insert(inserir);
        if (error) throw new Error(error.message);
      }
    }

    const sumidos = (existentes ?? []).filter((d) => !vistos.has(d.drive_file_id) && d.status !== "ignorado");
    const apagar = sumidos.filter((d) => ["pronto", "falhou"].includes(d.status)).map((d) => d.id);
    const arquivar = sumidos.filter((d) => !["pronto", "falhou"].includes(d.status)).map((d) => d.id);
    if (apagar.length) await db.from("dp_documentos").delete().in("id", apagar);
    if (arquivar.length) await db.from("dp_documentos").update({ status: "ignorado" }).in("id", arquivar);
    await db.from("dp_competencias").update({ sincronizado_em: new Date().toISOString() }).eq("competencia", comp.comp);

    resumo.push({ competencia: comp.comp, pasta: comp.name, clientes: pastas.length, documentos: vistos.size, novos, alterados_apos_envio: alterados, pastas_sem_vinculo: semVinculo });
  }
  return { resumo };
}

async function enviar(documentoIds: string[], reenviar: boolean, userId: string) {
  const { data: docs, error } = await db.from("dp_documentos")
    .select("id, competencia, client_id, pasta_cliente_norm, nome_arquivo, mime_type, tamanho_bytes, drive_file_id, tipo, status, clients(name)")
    .in("id", documentoIds);
  if (error) throw new Error(error.message);

  const resultados: Array<{ documento_id: string; ok: boolean; enviados: number; erro?: string }> = [];
  for (const doc of docs ?? []) {
    try {
      if (!doc.client_id) throw new Error("Pasta não vinculada a um cliente");
      const { data: v } = await db.from("dp_vinculos").select("confirmado").eq("pasta_norm", doc.pasta_cliente_norm).maybeSingle();
      if (!v?.confirmado) throw new Error("Vínculo da pasta com o cliente ainda não confirmado");
      if (!reenviar && ["enviado", "lido"].includes(doc.status)) {
        resultados.push({ documento_id: doc.id, ok: true, enviados: 0, erro: "Já enviado" });
        continue;
      }
      await db.from("dp_documentos")
        .update({ status: "enviando", rodada_em: new Date().toISOString(), alterado_apos_envio: false, enviado_manual: false })
        .eq("id", doc.id);

      if ((doc.tamanho_bytes ?? 0) > 100 * 1024 * 1024) throw new Error("Arquivo acima de 100 MB");
      const { data: contatos } = await db.from("dp_contatos").select("id, nome, whatsapp")
        .eq("client_id", doc.client_id).eq("recebe_folha", true).eq("ativo", true);
      if (!contatos?.length) throw new Error("Cliente sem contato de WhatsApp cadastrado");

      const { blob, mime } = await baixar(doc.drive_file_id, doc.mime_type ?? "application/pdf");
      const nome = mime === "application/pdf" && !/\.pdf$/i.test(doc.nome_arquivo) ? `${doc.nome_arquivo}.pdf` : doc.nome_arquivo;
      const mediaId = await waUpload(blob, mime, nome);
      // deno-lint-ignore no-explicit-any
      const empresa = (doc as any).clients?.name ?? "sua empresa";
      const [a, m] = doc.competencia.split("-");

      let enviados = 0;
      for (const c of contatos) {
        const { data: envio } = await db.from("dp_envios")
          .insert({ documento_id: doc.id, contato_id: c.id, whatsapp: c.whatsapp, canal: "whatsapp", status: "fila", usuario_id: userId })
          .select("id").single();
        try {
          const waId = await waEnviar({
            para: c.whatsapp, mediaId, arquivo: nome, contato: c.nome.split(" ")[0],
            descricao: DESCRICAO[doc.tipo as Tipo] ?? DESCRICAO.OUTROS, competencia: `${m}/${a}`, empresa,
          });
          await db.from("dp_envios").update({ status: "enviado", wa_message_id: waId, enviado_em: new Date().toISOString() }).eq("id", envio!.id);
          enviados++;
        } catch (e) {
          await db.from("dp_envios").update({ status: "falhou", erro: (e as Error).message }).eq("id", envio!.id);
        }
        await sleep(350);
      }
      resultados.push({ documento_id: doc.id, ok: enviados > 0, enviados, erro: enviados ? undefined : "Nenhum contato recebeu" });
    } catch (e) {
      const msg = (e as Error).message;
      if (doc.status !== "enviado" && doc.status !== "lido") {
        await db.from("dp_documentos").update({ status: "falhou", updated_at: new Date().toISOString() }).eq("id", doc.id);
      }
      await db.from("dp_envios").insert({ documento_id: doc.id, canal: "whatsapp", status: "falhou", erro: msg, usuario_id: userId });
      resultados.push({ documento_id: doc.id, ok: false, enviados: 0, erro: msg });
    }
  }
  return { resultados };
}

// ------------------------------------------------------------------ handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const { data: cfg } = await db.from("dp_config").select("owner_id, drive_root_folder_id").eq("id", 1).maybeSingle();
  if (!cfg) return json({ error: "Módulo não configurado (dp_config)." }, 500);

  // Somente a equipe do escritório
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const userId = u?.user?.id;
  if (!userId) return json({ error: "Não autenticado" }, 401);
  if (userId !== cfg.owner_id) {
    const { data: perfil } = await db.from("user_profiles").select("owner_id, active").eq("id", userId).maybeSingle();
    if (!perfil || perfil.owner_id !== cfg.owner_id || perfil.active === false) return json({ error: "Sem permissão" }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const google = !!env("GOOGLE_SA_JSON");
  const whatsapp = !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_ID");

  try {
    if (body.action === "status") {
      let conta: string | null = null;
      try { conta = google ? JSON.parse(env("GOOGLE_SA_JSON")).client_email : null; } catch { /* JSON inválido */ }
      return json({ google, whatsapp, conta_servico: conta });
    }
    if (body.action === "sync") {
      if (!google) return json({ error: "Acesso ao Google Drive ainda não configurado (segredo GOOGLE_SA_JSON)." }, 412);
      return json({ ok: true, ...(await sincronizar(cfg, body.competencia)) });
    }
    if (body.action === "enviar") {
      if (!google) return json({ error: "Acesso ao Google Drive ainda não configurado." }, 412);
      if (!whatsapp) return json({ error: "WhatsApp ainda não configurado (WHATSAPP_TOKEN e WHATSAPP_PHONE_ID)." }, 412);
      const ids: string[] = Array.isArray(body.documento_ids) ? body.documento_ids : [];
      if (!ids.length || ids.length > 10) return json({ error: "Informe de 1 a 10 documento_ids." }, 400);
      return json({ ok: true, ...(await enviar(ids, !!body.reenviar, userId)) });
    }
    return json({ error: "Ação desconhecida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
