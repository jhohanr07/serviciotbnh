/**
 * Puente Vercel -> Google Apps Script
 *
 * El navegador llama a POST /api/rpc con { fn, args }.
 * Esta función agrega el API_TOKEN (que nunca llega al navegador) y lo reenvía
 * a la aplicación web de Apps Script, que lee y escribe el Google Sheet.
 * No se usa ninguna clave JSON de cuenta de servicio.
 *
 * Variables de entorno en Vercel:
 *   APPS_SCRIPT_URL  URL /exec de la implementación de Apps Script
 *   API_TOKEN        el mismo valor que la propiedad API_TOKEN del script
 */

// Solo estas funciones del backend se pueden llamar desde la web
const PERMITIDAS = new Set([
  'getFormConfig', 'calentarDatos', 'buscarClientes', 'seleccionarCliente', 'crearTicket', 'consultarTicket',
  'getTicketTecnico', 'guardarTicketTecnico',
  'panelLogin', 'getPanelData', 'actualizarTicket', 'reenviarTecnico', 'getDashboardData', 'enviarAlertasAhora',
  'tecnicoSolicitarCodigo', 'tecnicoVerificarCodigo', 'getPanelTecnico',
  'ping'
]);

// Límite por IP y por minuto (mejor esfuerzo: vive mientras la instancia esté activa)
const LIMITES = { crearTicket: 6, consultarTicket: 20, panelLogin: 10, tecnicoSolicitarCodigo: 4, tecnicoVerificarCodigo: 10, _: 120 };
const visitas = new Map();

function excedeLimite(ip, fn) {
  const ahora = Date.now();
  const clave = ip + '|' + (LIMITES[fn] ? fn : '_');
  const max = LIMITES[fn] || LIMITES._;
  const lista = (visitas.get(clave) || []).filter(t => ahora - t < 60000);
  lista.push(ahora);
  visitas.set(clave, lista);
  if (visitas.size > 5000) visitas.clear();
  return lista.length > max;
}

// Traduce la página de error de Google a un mensaje que diga qué arreglar
function explicarFallo(status, html) {
  const t = String(html || '');
  if (/already been declared|ya se ha declarado|ya fue declarad/i.test(t))
    return 'Apps Script tiene código repetido (hay dos archivos .gs con el mismo código). Deja un solo Code.gs y publica una nueva versión.';
  if (/authoriz|autoriza|permis/i.test(t))
    return 'Apps Script necesita permisos: en el editor ejecuta la función "autorizar", acepta los permisos y publica una nueva versión.';
  if (/accounts\.google\.com|ServiceLogin|signin|Iniciar sesi/i.test(t))
    return 'La implementación de Apps Script pide iniciar sesión: en "Quién tiene acceso" elige "Cualquier persona" y publica una nueva versión.';
  if (status === 404 || /no se encontr|not found|unable to open|no se puede abrir/i.test(t))
    return 'La URL de Apps Script no existe: revisa APPS_SCRIPT_URL en Vercel (debe ser la /exec de la implementación activa) y haz Redeploy.';
  const titulo = (/<title>([^<]*)<\/title>/i.exec(t) || [])[1];
  return 'El backend no respondió bien (' + status + (titulo ? ': ' + titulo.trim() : '') + '). Abre la URL /exec en el navegador para ver el error.';
}

function responder(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return responder(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  // Solo se acepta desde las páginas de este mismo dominio
  const origen = req.headers.origin;
  let hostOrigen = '';
  try { hostOrigen = origen ? new URL(origen).host : ''; } catch { hostOrigen = 'invalido'; }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origen && hostOrigen !== host) {
    return responder(res, 403, { ok: false, error: 'Origen no permitido.' });
  }

  const url = String(process.env.APPS_SCRIPT_URL || '').trim();
  // Se limpian espacios, saltos de línea y comillas que se cuelan al pegar en Vercel
  const token = String(process.env.API_TOKEN || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!url || !token) {
    return responder(res, 500, { ok: false, error: 'Falta configurar APPS_SCRIPT_URL o API_TOKEN en Vercel.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const fn = body && typeof body.fn === 'string' ? body.fn : '';
  const args = body && Array.isArray(body.args) ? body.args : [];

  if (!PERMITIDAS.has(fn)) return responder(res, 400, { ok: false, error: 'Acción no válida.' });
  if (JSON.stringify(args).length > 30000) return responder(res, 413, { ok: false, error: 'Los datos enviados son demasiado grandes.' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'anon';
  if (excedeLimite(ip, fn)) return responder(res, 429, { ok: false, error: 'Demasiados intentos. Espera un minuto e intenta de nuevo.' });

  try {
    // Apps Script responde con una redirección a googleusercontent.com; fetch la sigue sola
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args, token }),
      redirect: 'follow'
    });
    const texto = await r.text();
    let data;
    try { data = JSON.parse(texto); } catch {
      console.error('Respuesta no JSON de Apps Script', r.status, texto.slice(0, 500));
      return responder(res, 502, { ok: false, error: explicarFallo(r.status, texto) });
    }
    return responder(res, 200, data);
  } catch (e) {
    console.error('Error llamando a Apps Script:', e);
    return responder(res, 502, { ok: false, error: 'No se pudo conectar con el backend. Intenta de nuevo en unos segundos.' });
  }
}
