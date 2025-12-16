# Migración a modelo multi-local

## Estructura objetivo
```
stores/{storeId}
  employees/{employeeId}
  solicitudes/{solicitudId}
  schedules/{docId}   // se mantiene "main" para configuración
  weeks/{weekId}
  settings/{docId}
users/{uid}
```

## Crear usuarios
1. Crear `users/{uid}` para cada cuenta con:
   - `displayName`: nombre visible.
   - `allowedStores`: array de IDs de local autorizados.
   - `defaultStore`: ID por defecto (opcional).
   - `role`: `"manager"` o `"admin"`.

Si el documento no existe, la app muestra *"Usuario sin permisos"* y bloquea el acceso.

## Crear locales
1. Crear documento en `stores/{storeId}` (puede estar vacío).
2. Crear las subcolecciones según necesidad (`employees`, `schedules`, `weeks`, `solicitudes`).
3. Para configuración principal crear `stores/{storeId}/schedules/main` con:
   - `templates`, `projectedTickets`, `breaks`, `roles`, `rappiCode`.

## Compatibilidad temporal
- Los servicios primero buscan datos en `stores/{storeId}`.
- Si no existen, caen a la estructura legacy global (`employees`, `schedules/main`, `weeks`, `solicitudes`).
- Todo fallback está marcado con `// TODO MIGRACION MULTI-LOCAL` y centralizado en servicios.

## Plan de migración manual rápida
1. Seleccionar un `storeId` objetivo.
2. Copiar `employees` globales a `stores/{storeId}/employees`.
3. Copiar `schedules/main` a `stores/{storeId}/schedules/main`.
4. Copiar `weeks/*` a `stores/{storeId}/weeks/*`.
5. Copiar `solicitudes/*` a `stores/{storeId}/solicitudes/*`.
6. Crear documentos `users/{uid}` con `allowedStores` que incluyan el store migrado.
7. Validar acceso con la app y luego borrar colecciones legacy cuando ya no se usen.

## Script de ayuda
`node scripts/migrate_to_stores.js --store=<storeId> [--dry-run]`

- Copia colecciones legacy (`employees`, `schedules/main`, `weeks`, `solicitudes`) a `stores/{storeId}`.
- Por defecto corre en modo lectura y muestra el plan. Use `--execute` para escribir.
- No borra datos existentes.

## Reglas de seguridad
El archivo `firestore.rules` contiene un borrador multi-local:
- Solo usuarios autenticados.
- Acceso a `stores/{storeId}` restringido a `users/{uid}.allowedStores`.
- Actualización de solicitudes permitida solo a roles `manager/admin`.

## Notas
- Mantener idioma en UI.
- Si se cambia el local activo, la app recarga el estado para ese store.
- Los logs de consola indican cuando se usa compatibilidad legacy.
