import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Service-role guard (ARCHITECTURE §2): the admin client may only be imported
  // from sanctioned server paths. Everything else must use the JWT-bound client
  // so RLS stays the authority.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/admin",
              message:
                "Service-role client is allowed only in app/api/{webhooks,jobs,assets,auth,requests,checkout,payments,dev}/**, scripts/**, tests/**.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "app/api/webhooks/**",
      "app/api/jobs/**",
      "app/api/assets/**",
      "app/api/auth/**",
      "app/api/requests/**", // engine verdict recording — computed from DB truths only
      "app/api/consent/**",  // authenticity scan: RLS-checked read, service RPC to store result
      "app/api/inspect/**",  // public C2PA scan: reads manifest + ledger facts only
      "app/api/approval/**", // magic-link approval: token IS the credential, definer RPC does the writes
      "app/api/star-vote/**",
      "app/api/my-approvals/**", // creator-org-verified handoff of magic-link tokens // anonymous demand-capture voting via definer RPC, IP-throttled
      "app/api/protection/**", // C&D drafting: RLS-checked facts, letter never auto-sent
      "app/api/consent/handoff/**", // mints the single-use desktop->phone QR token
      "app/api/demo/**",            // admin-only demo staging; drives the app's own public endpoints
      "app/consent/phone/**",       // burns that token and exchanges it for a real session
      "app/api/v1/**",       // compliance API: public-safe read-only verification facts
      "app/api/checkout/**",
      "app/api/payments/**",
      "app/api/admin/**",    // admin-only actions (role re-checked before the service call)
      "app/api/dev/**",      // dev-only frictionless login (DEV_OPEN gated)
      "scripts/**",
      "tests/**",
      "lib/supabase/admin.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
