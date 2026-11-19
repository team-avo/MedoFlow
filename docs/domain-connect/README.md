# Domain Connect template (CTO-38)

`medoflow.example.clinic-site.json` is MedoFlow's [Domain Connect](https://www.domainconnect.org/) template. A DNS provider that has onboarded it lets a clinic owner press **Connect automatically** on the Domains screen. The provider then creates the two records MedoFlow needs, after the owner confirms:

| Record | Host (relative to the `host` the clinic connects, e.g. `www`) | Value                                   |
| ------ | ------------------------------------------------------------- | --------------------------------------- |
| CNAME  | `@` (the connected host itself)                               | `%target%` (today `medoflow.pages.dev`) |
| TXT    | `_medoflow-verify`                                            | `medoflow-verify=%token%`               |

`hostRequired: true`: the template only connects a sub-domain such as `www`. Root domains can't CNAME, so the UI guides those by hand.

## The template is a placeholder until MedoFlow owns a domain

`providerId` and `syncPubKeyDomain` must be a domain MedoFlow controls. `medoflow.example` is a placeholder. Before submitting:

1. Buy the domain and replace `medoflow.example` in this file. Rename the file to `<providerId>.clinic-site.json`.
2. Generate a signing key pair:
   ```bash
   openssl genrsa -out dc-private.pem 2048
   openssl rsa -in dc-private.pem -pubout -outform DER | base64 | tr -d '\n' > dc-public.b64
   ```
3. Publish the public key as TXT records at `_dck1.<providerId>`, split into chunks if long: `p=1,a=RS256,d=<first 200 chars>`, `p=2,a=RS256,d=<next 200>`, and so on.
4. Set on the API (Render):
   - `DOMAIN_CONNECT_PROVIDER_ID=<providerId>`
   - `DOMAIN_CONNECT_SERVICE_ID=clinic-site`
   - `DOMAIN_CONNECT_KEY_HOST=_dck1`
   - `DOMAIN_CONNECT_PRIVATE_KEY=<contents of dc-private.pem, newlines as \n>`
5. Set `syncRedirectDomain` to the app's host (where `/dashboard/site/domains` lives).
6. Open a pull request with the file to https://github.com/Domain-Connect/Templates. Follow its README: run the schema check and `dc-template-linter`, and include the Online Editor test link.
7. Ask each DNS provider to onboard the template. GoDaddy, Cloudflare, IONOS, NameSilo and Vercel are listed as live implementations. Some providers ask for a contract or review first.

Until a provider has onboarded the template, the backend's template check (`GET {urlAPI}/v2/domainTemplates/providers/{providerId}/services/clinic-site`) answers 404. The button stays hidden, and the clinic follows the guided manual steps instead.
