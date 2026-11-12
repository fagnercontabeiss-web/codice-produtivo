# Central de Envio de Folha

Aba **Envio de Folha** (grupo Escritório). Lê a pasta `Departamento Pessoal / {Competência} / {Cliente}` do Google Drive e envia os arquivos aos clientes pelo WhatsApp oficial (Cloud API), registrando envio, entrega e leitura.

## Peças

| Peça | Onde |
|---|---|
| Tela | `src/EnvioFolha.jsx` |
| Banco | `supabase/migrations/20261111_central_envio_folha.sql` (tabelas `dp_*`, RLS pela equipe) |
| Função `dp-folha` | ações `status`, `sync` (lê o Drive) e `enviar` (WhatsApp) |
| Função `dp-whatsapp-webhook` | recebe da Meta os status entregue/lido e as respostas (sem JWT; valida a assinatura) |

A pasta raiz e o dono do escritório ficam na tabela `dp_config` (uma linha).

## Como o Drive é lido

- Competência pelo nome da pasta: `Outubro de 2026`, `10-2026`, `2026-10`, `OUT/26`.
- Subpasta `Enviadas`: as pastas de cliente dentro dela entram como **Enviado (manual)** na primeira leitura.
- Pasta → cliente: vínculo salvo > CNPJ no nome da pasta ou de um arquivo > nome idêntico ao cadastro > sugestão por nome parecido (**precisa de confirmação na tela antes de qualquer envio**).
- Tipo do documento pelo nome do arquivo (FGTS, INSS/DARF, Recibos, Folha, Guia, Férias, Rescisão, Pró-labore). Pode ser corrigido na tela.
- Arquivo alterado no Drive depois de enviado volta para **Pronto** com o selo "Alterado após envio".

## Segredos das Edge Functions

| Segredo | Para quê |
|---|---|
| `GOOGLE_SA_JSON` | JSON da conta de serviço do Google com acesso de **Leitor** à pasta Departamento Pessoal |
| `WHATSAPP_TOKEN` | token permanente da Cloud API |
| `WHATSAPP_PHONE_ID` | ID do número de envio |
| `WHATSAPP_APP_SECRET` | segredo do app da Meta (valida o webhook) |
| `WHATSAPP_VERIFY_TOKEN` | frase usada na verificação do webhook |
| `WHATSAPP_TEMPLATE_DP` | opcional; padrão `envio_documento_dp` |

## Template do WhatsApp

Categoria **Utilidade**, idioma **Português (BR)**, cabeçalho **Documento**, nome `envio_documento_dp`:

> Olá, {{1}}! Segue {{2}} da empresa {{4}}, referente à competência {{3}}. Qualquer dúvida, é só responder esta mensagem. Equipe YOETZ · Departamento Pessoal

Exemplos: `{{1}}` Ana · `{{2}}` a guia do FGTS · `{{3}}` 10/2026 · `{{4}}` Empresa Exemplo Ltda.

Webhook na Meta: `https://<projeto>.supabase.co/functions/v1/dp-whatsapp-webhook`, campo **messages**.

## Sem o WhatsApp configurado

A tela funciona como painel de controle: sincroniza o Drive e permite **Marcar como enviado** para os envios feitos à mão.
