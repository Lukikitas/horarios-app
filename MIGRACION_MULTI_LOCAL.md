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
1. Crear la cuenta en **Firebase Authentication** (Correo/Contraseña u otro proveedor ya habilitado).
2. Copiar el `uid` generado.
3. Crear `users/{uid}` en Firestore con:
   - `displayName`: nombre visible.
   - `allowedStores`: array de IDs de local autorizados.
   - `defaultStore`: ID por defecto (opcional, uno de los `allowedStores`).
   - `role`: `"manager"` o `"admin"`.

Si el documento no existe, la app muestra *"Usuario sin permisos"* y bloquea el acceso.

### Ejemplo 1: Usuario de un solo local
```
users/uidJuan {
  displayName: "Juan Pérez",
  allowedStores: ["storeA"],
  defaultStore: "storeA",
  role: "manager"
}
```

### Ejemplo 2: Usuario con múltiples locales
```
users/uidAdmin {
  displayName: "Admin Multi",
  allowedStores: ["storeA", "storeB", "storeC"],
  defaultStore: "storeA",
  role: "admin"
}
```

### Crear el documento con Firebase CLI (opcional)
```
firebase firestore:documents:set \
  users/<UID> \
  --data '{"displayName":"Nombre","allowedStores":["storeA"],"defaultStore":"storeA","role":"manager"}'
```
Reemplazar `<UID>` y los valores según cada usuario/local.

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
