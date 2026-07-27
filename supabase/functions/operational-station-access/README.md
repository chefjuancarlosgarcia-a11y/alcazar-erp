# operational-station-access

Type-check (reproducible, lockfile v5):

```bash
cd supabase/functions/operational-station-access
deno check index.ts
deno check index.ts
```

Use **Deno 2.2.3** (this repo’s lockfile is `"version": "4"` for that toolchain). Pin locally e.g. `deno upgrade --version 2.2.3` or `npx --yes deno@2.2.3`.

Always run with the committed `deno.lock` (default). CI must not disable the lockfile.
