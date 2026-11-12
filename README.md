# Cafeteros Finanzas · VS Code + Google Sheets + Netlify

Proyecto web estático con backend seguro en Netlify Functions. **No usa `google.script.run` ni requiere publicar Google Apps Script.**

## 1. Preparar Google Sheets

Crea una hoja de cálculo con estas pestañas:

| Pestaña | Estructura |
|---|---|
| `Gastos_Ingresos` | Columna A: `Dinero Rifa`, `Dinero Postres`, `Dinero Campistas` y `Total:`; columna B: sus importes |
| `Gastos` | `Numero`, `Fecha`, `Concepto`, `Descripcion`, `Valor`, `Soporte`, `UrlFactura` |

**Importante:** el panel toma los importes de resumen de `Gastos_Ingresos`; no vuelve a sumar las pestañas de movimientos de Rifa y Postres. La fila `Total:` puede contener la suma de los tres importes.

Copia el ID de la hoja desde `https://docs.google.com/spreadsheets/d/ID_AQUI/edit`.

## 2. Crear credenciales de Google Cloud

1. En [Google Cloud Console](https://console.cloud.google.com/) crea o selecciona un proyecto.
2. En **APIs y servicios > Biblioteca**, habilita **Google Sheets API**.
3. En **IAM y administración > Cuentas de servicio**, crea una cuenta de servicio.
4. En esa cuenta, ve a **Claves > Agregar clave > Crear clave nueva > JSON** y descarga el archivo privado.
5. Abre tu Google Sheet y compártela como **Editor** con el correo `client_email` de ese JSON. **No la compartas públicamente**.
6. Del JSON utiliza `client_email` y `private_key` para las variables de entorno. **Nunca subas el JSON a GitHub ni lo coloques en HTML**.

## 3. Abrir en VS Code y probar

1. Extrae este ZIP y abre la carpeta `cafeteros-finanzas-netlify` en VS Code.
2. Instala [Node.js 20 o superior](https://nodejs.org/) y Netlify CLI con `npm install -g netlify-cli`.
3. Ejecuta `netlify login` y `netlify init` (vincula el proyecto a un sitio Netlify).
4. Crea `.env` en la raíz copiando `.env.example` y reemplazando los valores por los tuyos. La clave privada se pega como una sola cadena con `\\n` entre líneas, entre comillas.
5. Ejecuta `netlify dev` y abre la dirección local indicada.
6. Pulsa **🔒 Acceso**, escribe la contraseña de `APP_PASSWORD` y prueba el panel y el registro.

## 4. Publicar en Netlify

1. Sube el proyecto a un repositorio privado de GitHub (sin `.env` ni credenciales) y en Netlify usa **Add new project > Import an existing project**.
2. Configura: **Build command** vacío, **Publish directory** `public`, **Functions directory** `netlify/functions`.
3. En Netlify **Project configuration > Environment variables**, añade `GOOGLE_SHEET_ID`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY` y `APP_PASSWORD` con sus valores reales. En la clave privada, puedes pegar el contenido con saltos de línea reales o `\\n` literales. Marca las variables como disponibles para Functions.
4. Ejecuta **Deploy / Trigger deploy** tras configurar las variables. Abre la URL `.netlify.app`.
5. Pulsa **🔒 Acceso** y escribe la contraseña. La contraseña se mantiene solo en la pestaña del navegador (`sessionStorage`), no en Google Sheets.

## 5. Logo de Google Drive

En **Personalización**, pega el enlace de la imagen de Google Drive, por ejemplo `https://drive.google.com/file/d/ID/view`, y pulsa **Guardar logo**. Debes permitir acceso de lectura al archivo para quienes deban verlo. Google Drive puede impedir la carga directa de algunas imágenes; una URL pública de imagen alojada en otro servicio suele ser más fiable. El logo se guarda **solo en ese navegador**.

## Seguridad y limitaciones

- La hoja de cálculo permanece privada. La clave de Google está solo en variables de entorno del servidor Netlify.
- **No uses el sitio sin `APP_PASSWORD`**: la función exige contraseña en todas las solicitudes, incluida la lectura.
- Es un acceso compartido simple, no un sistema multiusuario con roles, auditoría o límites de intentos. Para uso público o varios administradores se recomienda autenticación individual y control de acceso adicional.
- La contraseña viaja por HTTPS a Netlify y se guarda temporalmente en `sessionStorage` del navegador.
- El número consecutivo se calcula leyendo la hoja; **dos guardados simultáneos podrían recibir el mismo número**. Si necesitas concurrencia real, añade un identificador UUID o usa una base de datos transaccional.
- Los ingresos se leen del resumen de `Gastos_Ingresos`; los gastos se calculan a partir de las filas de `Gastos`.
- **No hemos conectado todavía tu hoja real**: hace falta configurar tus credenciales e ID para verificar la integración.
