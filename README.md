# Compras de campo · PWA

Aplicación móvil para consultar y completar el control documental previo a la recolección. La interfaz puede publicarse en GitHub Pages y utiliza un servicio seguro para leer y actualizar una hoja privada de Google Sheets.

## Funcionamiento

- Acceso común mediante usuario y contraseña.
- La contraseña no aparece en GitHub, en la PWA ni en Google Sheets: el servidor conserva únicamente su huella SHA-256.
- Cada inicio de sesión genera una autorización temporal de ocho horas.
- La hoja permanece privada y solo se comparte con la cuenta de servicio utilizada por la aplicación.
- Los cambios se guardan automáticamente y el listado se actualiza cada 15 segundos.
- Todos los campos obligatorios se validan antes de finalizar una revisión.
- Las columnas W:X de la hoja conservan las fórmulas que calculan «Puede recolectarse» y «Motivo del bloqueo».

## Configuración pública

`public/app-config.json` solo contiene la dirección del servicio:

```json
{
  "apiBaseUrl": "https://direccion-del-servicio"
}
```

Cuando la interfaz y el servicio se alojan juntos, `apiBaseUrl` puede permanecer vacío.

## Valores privados del servidor

Estos valores se configuran como secretos del alojamiento y nunca se añaden al repositorio:

- `ADMIN_USERNAME` y `ADMIN_PASSWORD_SHA256`
- `VIEWER_USERNAME` y `VIEWER_PASSWORD_SHA256`
- `SESSION_SECRET`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SPREADSHEET_ID`

También se pueden configurar:

- `GOOGLE_WORKSHEET_NAME` (por defecto, `Control documental`)
- `GOOGLE_DATA_START_ROW` (por defecto, `9`)
- `GOOGLE_DATA_END_ROW` (por defecto, `108`)
- `ALLOWED_ORIGINS` (orígenes autorizados separados por comas)

## Publicación en GitHub Pages

El flujo de GitHub Actions compila la carpeta `dist`. Antes de publicar en GitHub Pages, `public/app-config.json` debe contener la dirección pública del servicio seguro. Ninguna contraseña ni clave de Google debe añadirse a GitHub.

## Uso diario

- Abre la aplicación desde el móvil e inicia sesión con el acceso común.
- Selecciona un agricultor y completa la revisión.
- Los avances incompletos se guardan, pero el expediente seguirá bloqueado hasta cumplir todos los requisitos.
- Solo se puede recolectar cuando el resultado muestre «SÍ PUEDE RECOLECTARSE».
