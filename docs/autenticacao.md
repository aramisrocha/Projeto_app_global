# Autenticação e plano B (usuários locais no Cognito)

## Como funciona o login

Cada região tem o seu próprio Cognito User Pool (`infra/templates/cognito.yaml`):

| Região | Hosted UI |
|---|---|
| us-east-1 · N. Virginia | `https://app-global-prd-use1.auth.us-east-1.amazoncognito.com` |
| eu-west-1 · Irlanda | `https://app-global-prd-euw1.auth.eu-west-1.amazoncognito.com` |

O fluxo normal é:

1. O frontend manda o usuário para o Cognito da região com `identity_provider=okta`.
2. O Cognito redireciona para o **Okta** (OIDC), que autentica o usuário.
3. O Cognito emite os tokens (JWT) e o frontend chama a API com eles.
4. O API Gateway valida o JWT com o **issuer do Cognito** da região, não com o Okta.

## O risco: o Okta é um ponto único de falha no login

| Situação com o Okta fora do ar | Efeito |
|---|---|
| Usuário já logado | Continua usando a aplicação até o token expirar (1 h, padrão do Cognito) |
| Novo login | Falha: o Cognito não consegue redirecionar para o Okta |
| Troca de região (failover do Route 53) | O usuário precisa logar de novo na outra região, e o login falha |
| Health check do Route 53 | Não percebe: o `/health` não exige autenticação |

A arquitetura multirregião protege contra a queda de uma região da AWS, mas não contra a queda do provedor de identidade.

## Plano B: usuários locais no Cognito

O App Client aceita dois provedores:

- `okta`: o login normal.
- `COGNITO`: usuários criados diretamente no User Pool, usados como **contingência**.

Parâmetros do `cognito.yaml`:

| Parâmetro | Padrão | Função |
|---|---|---|
| `EnableLocalUsers` | `"true"` | Libera o provedor `COGNITO` no App Client |
| `EnableOktaReplication` | `"true"` | Cria a Lambda que replica os usuários do Okta (exige `EnableLocalUsers`) |
| `ReplicaRegions` | `"us-east-1,eu-west-1"` | Regiões onde a Lambda cria os usuários |
| `PoolParameterName` | `"/app-global/cognito/user-pool-id"` | Parâmetro SSM com o ID do pool de cada região |

Regras do User Pool para os usuários locais:

- Só um administrador (ou a Lambda de replicação) cria usuários; não existe auto cadastro.
- Política de senha: mínimo de 12 caracteres, com maiúscula, minúscula, número e símbolo.
- A recuperação de senha é feita pelo e-mail verificado.

## Replicação automática dos usuários do Okta

```
Login pelo Okta ──► Cognito (Pre token generation) ──► Lambda okta-replica
                                                          │
                          ┌───────────────────────────────┴───────────────────────────────┐
                          ▼                                                               ▼
              Pool us-east-1 (via SSM)                                        Pool eu-west-1 (via SSM)
         existe usuário local com o e-mail?                              existe usuário local com o e-mail?
         não → cria, senha aleatória, desabilita                         não → cria, senha aleatória, desabilita
```

A cada login pelo Okta, a Lambda `<ProjectName>-<Environment>-okta-replica`:

1. Ignora logins locais e renovações de token.
2. Lê o ID do pool de cada região no SSM (`/app-global/cognito/user-pool-id`). Cada stack do Cognito grava o seu.
3. Se ainda não existe um usuário local com aquele e-mail, cria com:
   - `email` e `name` vindos do Okta, e `email_verified=true`;
   - uma senha aleatória que ninguém conhece (status `CONFIRMED`), sem enviar e-mail;
   - o usuário **desabilitado**.
4. Nunca bloqueia o login: erros só vão para o log, e a Lambda para antes do limite de 5 s do Cognito.

Os logs ficam em `/aws/lambda/<ProjectName>-<Environment>-okta-replica` (14 dias).

Limitações:

- Só é replicado quem **já fez login pelo Okta** pelo menos uma vez. O Okta não exporta senhas, então não existe importação em massa com senha.
- A **remoção não é sincronizada**: se a pessoa for removida do Okta, o usuário local continua existindo (desabilitado). Remova com `admin-delete-user`.
- Os usuários locais **não** passam pelas políticas do Okta (MFA, bloqueio, desligamento).

## Durante uma queda do Okta

1. Habilite os usuários de contingência nas duas regiões:

   ```bash
   ./scripts/contingencia.sh enable                         # todos
   ./scripts/contingencia.sh enable nome.sobrenome@empresa.com  # só um
   ```

2. O usuário clica em **"Okta indisponível? Entrar com usuário de contingência"**.
3. Na tela do Cognito, usa **"Forgot your password?"** com o e-mail, recebe um código e define a senha.
4. Entra e vê os mesmos ativos; as movimentações que fizer ficam registradas no histórico com o mesmo e-mail do Okta.

Quando o Okta voltar:

```bash
./scripts/contingencia.sh disable
./scripts/contingencia.sh list
```

As senhas definidas durante o incidente continuam valendo, mas a conta fica desabilitada até o próximo incidente.

## Criar um usuário de contingência manualmente

Para quem ainda não fez login pelo Okta, crie o usuário nas duas regiões com o **mesmo e-mail do Okta**:

```bash
EMAIL="nome.sobrenome@empresa.com"

for REGION in us-east-1 eu-west-1; do
  POOL_ID=$(aws ssm get-parameter --region "$REGION" \
    --name /app-global/cognito/user-pool-id --query Parameter.Value --output text)

  aws cognito-idp admin-create-user \
    --region "$REGION" \
    --user-pool-id "$POOL_ID" \
    --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true Name=name,Value="Nome Sobrenome" \
    --desired-delivery-mediums EMAIL
done
```

O Cognito envia uma senha temporária por e-mail, que deve ser trocada no primeiro login.

## Permissão necessária no pipeline

A role `Role_app_global_infra` precisa de permissão de Lambda para criar a função de replicação:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaOktaReplica",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:ListTags"
      ],
      "Resource": "arn:aws:lambda:*:181317788381:function:*-okta-replica"
    }
  ]
}
```

## Boas práticas

- Mantenha os usuários de contingência **desabilitados** fora de incidentes.
- O e-mail padrão do Cognito tem limite baixo de envio por dia. Se muitos usuários precisarem recuperar a senha ao mesmo tempo, configure o Amazon SES no User Pool.
- Revise periodicamente (`./scripts/contingencia.sh list`) e apague quem saiu da empresa.
