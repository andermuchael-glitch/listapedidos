# ListaPedidos

Aplicativo PWA para transformar planilhas de pedidos em listas de separação.

## V1

Fluxo inicial:

1. Importar XLSX/XLS/CSV
2. Ler a primeira aba da planilha
3. Mostrar uma prévia para conferência
4. Criar a lista de separação
5. Controlar quantidade necessária, separada e faltante
6. Salvar progresso
7. Finalizar a separação
8. Manter histórico

## Tecnologias

- Next.js + React + TypeScript
- XLSX para leitura de planilhas
- Lucide React para ícones
- PWA na evolução da V1
- Supabase/PostgreSQL na próxima etapa para persistência em nuvem

## Regra importante

A planilha original nunca deve ser alterada. O aplicativo importa os dados e cria uma cópia operacional para a separação.

## Desenvolvimento

```bash
npm install
npm run dev
```
