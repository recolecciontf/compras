# Compras de campo · PWA

Aplicación móvil para consultar y completar el control documental previo a la recolección. La interfaz puede publicarse en GitHub Pages y utiliza un servicio seguro para leer y actualizar una hoja privada de Google Sheets.

## Funcionamiento

- Acceso común mediante usuario y contraseña.
- La contraseña no aparece en GitHub, en la PWA ni en Google Sheets: el servidor conserva únicamente su huella SHA-256.
- Cada inicio de sesión genera una autorización temporal de ocho horas.
- La hoja permanece privada y solo se comparte con la cuenta de servicio utilizada por la aplicación.
- Los cambios se guardan automáticamente y el listado se actualiza cada 15 segundos.
- Todos los campos obligatorios se validan antes de finalizar una revisión.
- El usuario ADMINISTRADOR puede crear compras y completar agricultor, finca, contrato y materia prima.
- Especie y variedad usan listas relacionadas; la opción «Otra» obliga a escribir el valor exacto.
- La pestaña «Cortes» registra si la fruta se ha cortado, los kilos totales y permite archivar o restaurar compras terminadas.
- El Administrador puede anular y restaurar expedientes, sustituir contratos conservando sus versiones anteriores y eliminar definitivamente registros creados por error mediante doble confirmación.
- Los expedientes anulados quedan separados del trabajo activo y conservan el motivo, la fecha y el usuario de cada cambio de estado.
- El usuario CONSULTAS puede revisar toda la información, pero nunca modificarla.
- Las columnas W:X de la hoja conservan las fórmulas que calculan «Puede recolectarse» y «Motivo del bloqueo».
- Las columnas AA:AE almacenan corte realizado, kilos cortados, archivo, variedad y kilos previstos.

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
- Pulsa «Nueva compra» para registrar un agricultor o una materia prima nueva.
- Selecciona un agricultor y completa la revisión.
- En «Cortes», anota los kilos reales y archiva la compra cuando la recolección haya terminado.
- Los avances incompletos se guardan, pero el expediente seguirá bloqueado hasta cumplir todos los requisitos.
- Solo se puede recolectar cuando el resultado muestre «SÍ PUEDE RECOLECTARSE».
