// YOETZ · Central de Envio de Folha — webhook do WhatsApp Cloud API
// Recebe os status das mensagens (enviado -> entregue -> lido / falhou) e as respostas dos clientes.
// Publicar SEM verificação de JWT: a Meta não envia token do Supabase; a autenticidade é a assinatura HMAC.
// Segredos: WHATSAPP_APP_SECRET (obrigatório), WHATSAPP_VERIFY_TOKEN
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const RANK: Record<string, number> = { fila: 0, enviado: 1, entregue: 2, lido: 3 };
const MAPA: Record<string, string> = { sent: "enviado", delivered: "entregue", read: "lido", failed: "falhou" };

async function assinaturaValida(raw: string, header: string | null): Promise<boolean> {
  const secret = env("WHATSAPP_APP_SECRET");
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  const esperado = header.slice(7);
  if (hex.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ esperado.charCodeAt(i);
  return dif === 0;
}

/** O wa_id de números brasileiros às vezes chega sem o 9º dígito. */
function variacoes(waId: string): string[] {
  const d = waId.replace(/\D/g, "");
  const s = new Set([d]);
  if (/^55\d{2}9\d{8}$/.test(d)) s.add(d.slice(0, 4) + d.slice(5));
  if (/^55\d{2}\d{8}$/.test(d)) s.add(d.slice(0, 4) + "9" + d.slice(4));
  return [...s];
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const esperado = env("WHATSAPP_VERIFY_TOKEN");
    const ok = !!esperado && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === esperado;
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await assinaturaValida(raw, req.headers.get("x-hub-signature-256")))) return new Response("Assinatura inválida", { status: 401 });

  try {
    const payload = JSON.parse(raw);
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};

        for (const s of v.statuses ?? []) {
          const novo = MAPA[s.status];
          if (!novo) continue;
          const { data: envio } = await db.from("dp_envios").select("id, status").eq("wa_message_id", s.id).maybeSingle();
          if (!envio) continue;
          const ts = new Date(Number(s.timestamp) * 1000).toISOString();
          if (novo === "falhou") {
            const err = s.errors?.[0];
            await db.from("dp_envios").update({
              status: "falhou",
              erro: err ? `${err.code} · ${err.error_data?.details ?? err.title ?? err.message}` : "Falha na entrega",
            }).eq("id", envio.id);
            continue;
          }
          if ((RANK[novo] ?? 0) <= (RANK[envio.status] ?? -1)) continue;
          const patch: Record<string, unknown> = { status: novo };
          if (novo === "entregue") patch.entregue_em = ts;
          if (novo === "lido") patch.lido_em = ts;
          await db.from("dp_envios").update(patch).eq("id", envio.id);
        }

        for (const m of v.messages ?? []) {
          const texto = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
          const { data: contato } = await db.from("dp_contatos").select("id").in("whatsapp", variacoes(m.from)).limit(1).maybeSingle();
          await db.from("dp_respostas").upsert({
            contato_id: contato?.id ?? null,
            whatsapp: m.from,
            nome_perfil: v.contacts?.find((c: { wa_id: string }) => c.wa_id === m.from)?.profile?.name ?? null,
            texto: String(texto).slice(0, 2000),
            wa_message_id: m.id,
            recebido_em: new Date(Number(m.timestamp) * 1000).toISOString(),
          }, { onConflict: "wa_message_id" });
        }
      }
    }
  } catch (e) {
    console.error("webhook", e);
  }
  return new Response("ok", { status: 200 });
});
