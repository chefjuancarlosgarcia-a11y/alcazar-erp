# Adopción segura del baseline ERP

## Alcance

`20260808180000_erp_schema_baseline.sql` es exclusivamente un bootstrap para un proyecto Supabase nuevo cuyo schema `public` no contiene relaciones.

El guard inicial aborta antes del dump cuando:

- faltan `auth.users`, `storage.buckets` o la extensión `pgcrypto`;
- `public` contiene tablas ordinarias o particionadas, vistas, vistas materializadas, secuencias o foreign tables;
- aparecen sentinelas ERP como `profiles`, `pos_orders`, `user_roles` o `areas`.

El guard no elimina objetos, no usa `CASCADE`, no deshabilita triggers/RLS y no cambia privilegios.

## Bases existentes

El baseline debe abortar en una base existente. Su adopción no consiste en volver a ejecutar el dump.

Una futura incorporación de una base existente requiere:

1. aprobación manual y respaldo verificable;
2. auditoría estructural objeto por objeto;
3. comparación contra el historial de migraciones real;
4. reconciliación explícita y revisada del historial;
5. una migración forward-only específica para cualquier diferencia.

No se recomienda `migration repair` como paso rutinario ni se proporcionan comandos automáticos para Producción. Cualquier reconciliación futura necesita un procedimiento separado, aprobación explícita y evidencia propia.

## Producción y rollback

Producción no está autorizada por este runbook.

No existe rollback destructivo seguro del baseline: eliminar el esquema o sus objetos destruiría datos y dependencias. Ante una aplicación accidental o una divergencia, se debe detener el proceso y diseñar una recuperación manual a partir de respaldo; nunca usar un rollback genérico ni `CASCADE`.

## Integridad del artefacto

El guard se antepone al blob histórico. El contenido posterior al guard debe seguir byte-idéntico al blob de `HEAD` usado como fuente.

La huella histórica suministrada para control documental fue:

- bytes: `2,141,307`;
- SHA-256: `F0A9AA71F46D78084D40DBDF5454ABB5BB55F809F4AA3D145B36E090C1FAAD35`.

La fuente binaria autorizada fue verificada con esa huella antes de reconstruir el baseline protegido. El sufijo posterior al guard conserva exactamente los 2,141,307 bytes aprobados y `.gitattributes` deshabilita su normalización de texto.
