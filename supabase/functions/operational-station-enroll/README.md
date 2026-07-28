# operational-station-enroll

Type-check (reproducible, lockfile v5):

```bash
cd supabase/functions/operational-station-enroll
npx --yes deno@2.3.1 check index.ts
npx --yes deno@2.3.1 check index.ts
```

Use **Deno 2.3.1** for this function: `deno.lock` is `"version": "5"` and is not readable by Deno 2.2.x.

Always run with the committed `deno.lock` (default). CI must not disable the lockfile.
