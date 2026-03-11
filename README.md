# Códice Produtivo

App de produtividade para escritórios de contabilidade.

---

## 🚀 Deploy no Vercel — Passo a Passo

### Pré-requisitos
- [Node.js](https://nodejs.org/) versão 18 ou superior
- [Git](https://git-scm.com/) instalado
- Conta no [GitHub](https://github.com) (gratuita)
- Conta no [Vercel](https://vercel.com) (gratuita)

---

### 1. Instalar dependências localmente (opcional — só para testar)

```bash
npm install
npm run dev
```
Acesse `http://localhost:5173` para ver o app rodando.

---

### 2. Criar repositório no GitHub

1. Acesse [github.com/new](https://github.com/new)
2. Nome do repositório: `codice-produtivo`
3. Deixe **privado** (recomendado)
4. Clique em **Create repository**

---

### 3. Subir o código para o GitHub

Abra o terminal na pasta do projeto e rode:

```bash
git init
git add .
git commit -m "primeiro commit"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/codice-produtivo.git
git push -u origin main
```

> Substitua `SEU_USUARIO` pelo seu usuário do GitHub.

---

### 4. Publicar no Vercel

1. Acesse [vercel.com](https://vercel.com) e faça login com sua conta GitHub
2. Clique em **"Add New Project"**
3. Selecione o repositório `codice-produtivo`
4. As configurações já estão prontas — clique em **"Deploy"**
5. Aguarde ~1 minuto

✅ Pronto! Você receberá uma URL como:
```
https://codice-produtivo.vercel.app
```

---

### 5. Atualizar o app no futuro

Sempre que quiser publicar uma nova versão:

```bash
git add .
git commit -m "descrição da atualização"
git push
```

O Vercel detecta automaticamente e republica em ~30 segundos.

---

## 📁 Estrutura do projeto

```
codice-produtivo/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.jsx       # Ponto de entrada React
│   └── App.jsx        # Todo o app (componentes, lógica, estado)
├── index.html         # HTML base com Tailwind CDN
├── package.json       # Dependências
├── vite.config.js     # Configuração do Vite
├── vercel.json        # Configuração do deploy
└── .gitignore
```

---

## 📦 Dependências

| Pacote | Versão | Uso |
|--------|--------|-----|
| react | 18.x | Framework UI |
| react-dom | 18.x | Renderização |
| recharts | 2.x | Gráficos |
| vite | 5.x | Build tool |
| tailwindcss | CDN | Estilos |

---

## ⚠️ Sobre os dados

Os dados são salvos no `localStorage` do navegador — ficam na máquina onde você acessa.
Para sincronizar entre dispositivos, o próximo passo seria integrar com **Supabase** ou **Firebase**.
