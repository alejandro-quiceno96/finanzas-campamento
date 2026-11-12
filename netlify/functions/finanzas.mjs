
import { createSign, timingSafeEqual } from 'node:crypto';

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  },
  body: JSON.stringify(body)
});

function required(key) {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Falta configurar ${key} en Netlify`);
  }

  return value;
}

const encode = value =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const sheetId = () => required('GOOGLE_SHEET_ID');

const norm = value =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/:$/, '');

// Interpretar respuestas de Google
async function googleJson(response, context) {
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `${context}: Google devolvió una respuesta no JSON ` +
      `(HTTP ${response.status}). Revisa la URL, ` +
      `la API de Google Sheets y la conexión.`
    );
  }

  if (!response.ok) {
    throw new Error(
      `${context}: ` +
      (data.error?.message ||
        data.error_description ||
        data.error ||
        `HTTP ${response.status}`)
    );
  }

  return data;
}

// Autenticación con Google Cloud
async function token() {
  const email = required('GOOGLE_CLIENT_EMAIL');

  const key = required('GOOGLE_PRIVATE_KEY')
    .replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);

  const header = encode({
    alg: 'RS256',
    typ: 'JWT'
  });

  const payload = encode({
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3500
  });

  const unsigned = `${header}.${payload}`;

  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();

  const assertion =
    `${unsigned}.${signer.sign(key, 'base64url')}`;

  const response = await fetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type:
          'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    }
  );

  const data = await googleJson(
    response,
    'No se pudo autenticar con Google'
  );

  return data.access_token;
}

// Leer pestañas
function range(name, columns = 'A:Z') {
  return encodeURIComponent(
    `'${name.replaceAll("'", "''")}'!${columns}`
  );
}

async function getRows(access, name) {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/` +
    `${encodeURIComponent(sheetId())}/values/${range(name)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${access}`
    }
  });

  const data = await googleJson(
    response,
    `Error leyendo hoja «${name}»`
  );

  return data.values || [];
}

// Convertir filas en registros
function records(rows) {
  if (rows.length < 2) return [];

  const keys = rows[0].map(norm);

  return rows
    .slice(1)
    .filter(row =>
      row.some(cell => String(cell ?? '').trim())
    )
    .map((row, index) =>
      Object.fromEntries([
        ...keys.map((key, column) => [
          key,
          row[column] ?? ''
        ]),
        ['_row', index + 2]
      ])
    );
}

// Convertir valores monetarios
function amount(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  let raw = String(value ?? '')
    .replace(/[^\d,.-]/g, '');

  if (!raw) return 0;

  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');

  if (comma >= 0 && dot >= 0) {
    raw = comma > dot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');

  } else if (comma >= 0) {
    raw = /^-?\d{1,3}(,\d{3})+$/.test(raw)
      ? raw.replace(/,/g, '')
      : raw.replace(',', '.');

  } else if (dot >= 0) {
    raw = /^-?\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, '')
      : raw;
  }

  const result = Number(raw);

  return Number.isFinite(result) ? result : 0;
}

// Leer ingresos por COLUMNAS
function incomeSummary(rows) {
  if (rows.length < 2) {
    throw new Error(
      'La pestaña «Gastos_Ingresos» necesita ' +
      'encabezados en la fila 1 y valores en la fila 2.'
    );
  }

  const columns = new Map(
    rows[0].map((header, index) => [
      norm(header),
      index
    ])
  );

  const values = rows[1];

  const read = (label, optional = false) => {
    const column = columns.get(norm(label));

    if (column === undefined) {
      if (optional) return undefined;

      throw new Error(
        `No se encontró la columna «${label}» ` +
        'en «Gastos_Ingresos».'
      );
    }

    return amount(values[column]);
  };

  const rifa = read('Dinero_Rifa');
  const postres = read('Dinero_Postres');

  const otros =
    read('Dinero_Campistas', true) ?? 0;

  const totalColumn = columns.get('total');

  const totalCell =
    totalColumn === undefined
      ? ''
      : values[totalColumn];

  const total =
    String(totalCell ?? '').trim()
      ? amount(totalCell)
      : rifa + postres + otros;

  return {
    rifa,
    postres,
    otros,
    total
  };
}

// Verificar contraseña
function checkPassword(event) {
  const expected = required('APP_PASSWORD');

  const given =
    event.headers?.['x-app-password'] ||
    event.headers?.['X-App-Password'] ||
    '';

  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);

  return (
    a.length === b.length &&
    timingSafeEqual(a, b)
  );
}

// Categorías permitidas
const allowed = [
  'Alimentación',
  'Transporte',
  'Materiales',
  'Refrigerios',
  'Logística',
  'Seguros y pólizas',
  'Recreación',
  'Otros'
];

// FUNCIÓN PRINCIPAL
export async function handler(event) {
  try {
    if (!checkPassword(event)) {
      return json(401, {
        error:
          'Contraseña incorrecta. ' +
          'Pulsa «Acceso» para ingresarla.'
      });
    }

    if (!['GET', 'POST'].includes(event.httpMethod)) {
      return json(405, {
        error: 'Método no permitido'
      });
    }

    const access = await token();

    // CONSULTAR INGRESOS Y GASTOS
    if (event.httpMethod === 'GET') {

      // Leer primero los gastos
      const gastos = await getRows(access, 'Gastos');

      let rifa = 0;
      let postres = 0;
      let otros = 0;
      let income = 0;
      let advertencia = '';

      // Si fallan los ingresos, conservar los gastos
      try {
        const incomeRows = await getRows(
          access,
          'Gastos_Ingresos'
        );

        const resumen = incomeSummary(incomeRows);

        rifa = resumen.rifa;
        postres = resumen.postres;
        otros = resumen.otros;
        income = resumen.total;

      } catch (error) {
        console.warn(
          'No se pudo leer Gastos_Ingresos:',
          error.message
        );

        advertencia =
          'No se pudieron consultar los ingresos: ' +
          error.message;
      }

      // Validar encabezados de gastos
      if (gastos.length) {
        const headers = gastos[0].map(norm);

        const requiredHeaders = [
          'fecha',
          'concepto',
          'descripcion',
          'valor'
        ];

        if (
          !requiredHeaders.every(header =>
            headers.includes(header)
          )
        ) {
          throw new Error(
            'La pestaña «Gastos» necesita los encabezados ' +
            'Fecha, Concepto, Descripcion y Valor. ' +
            'Encabezados encontrados: ' +
            gastos[0].join(', ')
          );
        }
      }

      // Preparar historial de gastos
      const items = records(gastos)
        .map((g, index) => ({
          numero: g.numero || index + 1,
          fecha: g.fecha || '',
          concepto: g.concepto || '',
          descripcion: g.descripcion || '',
          valor: amount(g.valor),
          urlFactura:
            g.url_factura ||
            g['url factura'] ||
            ''
        }))
        .reverse();

      const spent = items.reduce(
        (sum, item) => sum + item.valor,
        0
      );

      return json(200, {
        ingresos: {
          rifa,
          postres,
          otros,
          total: income
        },
        totalGastos: spent,
        saldo: income - spent,
        cantidadGastos: items.length,
        advertencia,
        gastos: items
      });
    }

    // GUARDAR NUEVO GASTO
    if ((event.body || '').length > 10000) {
      return json(413, {
        error: 'Solicitud demasiado grande'
      });
    }

    let data;

    try {
      data = JSON.parse(event.body || '{}');
    } catch {
      return json(400, {
        error: 'JSON inválido'
      });
    }

    const fecha = String(data.fecha || '');
    const concepto = String(data.concepto || '');

    const descripcion =
      String(data.descripcion || '').trim();

    const valor = Number(data.valor);

    const soporte =
      String(data.soporte || '').trim();

    const urlFactura =
      String(data.urlFactura || '').trim();

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      !allowed.includes(concepto) ||
      !descripcion ||
      descripcion.length > 500 ||
      !Number.isSafeInteger(valor) ||
      valor <= 0 ||
      soporte.length > 200
    ) {
      return json(400, {
        error:
          'Revisa fecha, concepto, descripción ' +
          'y valor del gasto.'
      });
    }

    if (urlFactura) {
      try {
        if (
          new URL(urlFactura).protocol !== 'https:'
        ) {
          throw new Error();
        }
      } catch {
        return json(400, {
          error:
            'La URL de la factura debe comenzar con https://'
        });
      }
    }

    // Calcular siguiente número
    const rows = await getRows(access, 'Gastos');

    const next =
      Math.max(
        0,
        ...records(rows).map(row =>
          Number(row.numero) || 0
        )
      ) + 1;

    const values = [[
      String(next),
      fecha,
      concepto,
      descripcion,
      String(valor),
      urlFactura
    ]];

    const appendRange = encodeURIComponent(
      "'Gastos'!A:F"
    );

    const appendUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/` +
      `${encodeURIComponent(sheetId())}/values/` +
      `${appendRange}:append` +
      '?valueInputOption=USER_ENTERED' +
      '&insertDataOption=INSERT_ROWS';

    const response = await fetch(appendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values })
    });

    await googleJson(
      response,
      'No se pudo guardar el gasto'
    );

    return json(200, {
      mensaje: 'Gasto guardado correctamente',
      numero: next
    });

  } catch (error) {
    console.error(error);

    return json(500, {
      error: error.message || 'Error interno'
    });
  }
}
