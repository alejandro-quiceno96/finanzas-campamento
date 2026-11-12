
import {
  timingSafeEqual,
  randomUUID
} from 'node:crypto';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function required(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar ${name}`);
  }

  return value;
}

// Comprobar contraseña del administrador
function checkPassword(event) {
  const password = required('APP_PASSWORD');

  const given =
    event.headers?.['x-app-password'] ||
    event.headers?.['X-App-Password'] ||
    '';

  const a = Buffer.from(String(given));
  const b = Buffer.from(password);

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

// Obtener acceso a Google Drive
async function getDriveToken() {
  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: required('GOOGLE_DRIVE_CLIENT_ID'),
        client_secret: required('GOOGLE_DRIVE_CLIENT_SECRET'),
        refresh_token: required('GOOGLE_DRIVE_REFRESH_TOKEN'),
        grant_type: 'refresh_token'
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      'Error de autorización con Drive: ' +
      (data.error_description ||
       data.error ||
       response.status)
    );
  }

  return data.access_token;
}

// Subir imagen directamente mediante Google Drive API
async function uploadToDrive(imageBuffer, accessToken) {
  const folderId = required('GOOGLE_DRIVE_FOLDER_ID');

  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw new Error('ID de carpeta de Drive inválido.');
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-');

  const filename =
    `Factura_${timestamp}_${randomUUID().slice(0, 8)}.jpg`;

  const metadata = {
    name: filename,
    mimeType: 'image/jpeg',
    parents: [folderId]
  };

  const boundary = `factura_${randomUUID()}`;

  const start = Buffer.from(
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: image/jpeg\r\n\r\n'
  );

  const end = Buffer.from(
    `\r\n--${boundary}--\r\n`
  );

  const body = Buffer.concat([
    start,
    imageBuffer,
    end
  ]);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files' +
    '?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type':
          `multipart/related; boundary=${boundary}`
      },
      body,
      signal: AbortSignal.timeout(25000)
    }
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result.error?.message ||
      'No se pudo subir la fotografía a Google Drive.'
    );
  }

  if (!result.id) {
    throw new Error('Drive no devolvió el ID del archivo.');
  }

  return {
    id: result.id,
    nombre: result.name,
    url:
      result.webViewLink ||
      `https://drive.google.com/file/d/${result.id}/view`
  };
}

// Función principal de Netlify
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return json(405, {
        error: 'Método no permitido'
      });
    }

    if (!checkPassword(event)) {
      return json(401, {
        error: 'Contraseña incorrecta'
      });
    }

    if ((event.body || '').length > 3500000) {
      return json(413, {
        error: 'La fotografía es demasiado grande.'
      });
    }

    let data;

    try {
      data = JSON.parse(event.body || '{}');
    } catch {
      return json(400, {
        error: 'Datos inválidos.'
      });
    }

    if (
      data.mimeType !== 'image/jpeg' ||
      typeof data.imagen !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data.imagen)
    ) {
      return json(400, {
        error: 'Debes seleccionar una fotografía JPEG.'
      });
    }

    const buffer = Buffer.from(
      data.imagen,
      'base64'
    );

    if (
      buffer.length < 4 ||
      buffer.length > 2500000 ||
      buffer[0] !== 255 ||
      buffer[1] !== 216 ||
      buffer[2] !== 255
    ) {
      return json(400, {
        error: 'Fotografía inválida o demasiado grande.'
      });
    }

    const accessToken = await getDriveToken();

    const factura = await uploadToDrive(
      buffer,
      accessToken
    );

    return json(200, {
      mensaje: 'Factura subida correctamente',
      url: factura.url,
      id: factura.id,
      nombre: factura.nombre
    });

  } catch (error) {
    console.error('Error al subir factura:', error.message);

    return json(500, {
      error: error.message || 'Error al subir factura'
    });
  }
}
