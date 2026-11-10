/**
 * SERVICIO TÉCNICO 2 · BNH Medical · BACKEND (Apps Script)
 * Script vinculado al Google Sheet "Sistema_Tickets_Servicio_Tecnico" (Extensiones > Apps Script).
 *
 * Arquitectura (sin claves JSON de cuentas de servicio):
 *   Navegador ──> Vercel (páginas + /api/rpc) ──POST JSON + API_TOKEN──> este script (doPost) ──> Google Sheet
 *   El script se ejecuta como tú, así que lee y escribe el Sheet con tus permisos.
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   API_TOKEN     (obligatoria) secreto compartido con Vercel. Créalo con el menú
 *                 Servicio técnico > Generar token para Vercel.
 *   URL_APP       (obligatoria) dominio de Vercel, p. ej. https://servicio-tecnico2.vercel.app
 *   CLAVE_PANEL   (obligatoria) clave del panel y del dashboard
 *   CORREO_ADMIN  (opcional)    copia de alertas y casos sin técnico
 *
 * Rutas en Vercel:  /   /estado   /panel   /dashboard   /tecnico?id=..&t=..
 */

const TZ = 'America/Caracas';
const EMPRESA = 'BNH Medical';

const H_TICKETS = ['ID_Ticket', 'Fecha', 'Cliente', 'Contacto', 'Teléfono', 'Correo', 'Estado', 'Región',
  'Equipo', 'Serial', 'Descripción', 'Prioridad', 'Técnico asignado', 'Correo técnico', 'Estatus',
  'Fecha límite SLA', 'Fecha de atencion', 'Observaciones', 'Garantia', 'Fecha cierre',
  'Atencion en sitio', 'Fecha de la visita', 'Última alerta', 'Solicitud', 'Periféricos', 'Licencia'];
const H_ESTADOS = ['Estado', 'Región'];
const H_TECNICOS = ['Nombre', 'Región', 'Correo', 'Activo'];

const REGIONES = ['Central', 'Occidente', 'Oriente'];
const ESTATUS = ['Sin asignar', 'Asignado', 'En reparación', 'Esperando repuesto', 'Resuelto', 'Cerrado'];
const ESTATUS_ABIERTOS = ['Sin asignar', 'Asignado', 'En reparación', 'Esperando repuesto'];
const ESTATUS_CERRADOS = ['Resuelto', 'Cerrado'];
// Estatus que el técnico puede elegir desde su ficha (una vez registrada la atención)
const ESTATUS_TECNICO = ['En reparación', 'Esperando repuesto'];
// Un caso "sin respuesta" sigue en estos estatus y el técnico no ha puesto fecha de atención
const ESTATUS_SIN_RESPUESTA = ['Sin asignar', 'Asignado'];

// Alertas: horas corridas sin respuesta antes de avisar y cada cuánto se repite el aviso
const HORAS_SIN_RESPUESTA = 72;
const HORAS_REPETIR_ALERTA = 24;
const MINUTOS_REVISION = 15;
const COL_ALERTA = 'Última alerta';

// Tipos de solicitud del formulario. Solo "Corrección de falla" pide urgencia y descripción.
const TIPO_FALLA = 'Corrección de falla';
const TIPO_PERIFERICO = 'Instalación de periférico';
const TIPO_MANTENIMIENTO = 'Mantenimiento preventivo';
const TIPO_LICENCIA = 'Licencias';
const TIPOS_SOLICITUD = [TIPO_FALLA, TIPO_PERIFERICO, TIPO_MANTENIMIENTO, TIPO_LICENCIA];
// Periféricos que se pueden pedir (se puede marcar más de uno)
const PERIFERICOS = ['Impresora', 'Mico+', 'UltraAssist'];
// Prioridad que reciben las solicitudes que no son falla (define su fecha límite)
const PRIORIDAD_SIN_FALLA = 'P4';

// Tiempo objetivo de resolución en horas corridas
const URGENCIAS = [
  { id: 'P1', texto: 'Crítica: equipo detenido o riesgo para pacientes', horas: 24 },
  { id: 'P2', texto: 'Alta: equipo principal fuera de servicio', horas: 24 },
  { id: 'P3', texto: 'Media: funciona con fallas o de forma intermitente', horas: 48 },
  { id: 'P4', texto: 'Baja: consulta, instalación o mantenimiento', horas: 72 }
];

// Estado -> Región (Los Llanos repartidos: Apure y Barinas a Occidente, Guárico a Central)
const ESTADOS_VE = [
  ['Distrito Capital', 'Central'], ['Miranda', 'Central'], ['La Guaira', 'Central'],
  ['Aragua', 'Central'], ['Carabobo', 'Central'], ['Guárico', 'Central'],
  ['Zulia', 'Occidente'], ['Lara', 'Occidente'], ['Falcón', 'Occidente'], ['Mérida', 'Occidente'],
  ['Táchira', 'Occidente'], ['Trujillo', 'Occidente'], ['Yaracuy', 'Occidente'],
  ['Portuguesa', 'Occidente'], ['Cojedes', 'Occidente'], ['Apure', 'Occidente'], ['Barinas', 'Occidente'],
  ['Anzoátegui', 'Oriente'], ['Monagas', 'Oriente'], ['Sucre', 'Oriente'], ['Bolívar', 'Oriente'],
  ['Nueva Esparta', 'Oriente'], ['Delta Amacuro', 'Oriente'], ['Amazonas', 'Oriente'],
  ['Dependencias Federales', 'Oriente']
];

/* ===================== API PARA VERCEL ===================== */

// Funciones que Vercel puede llamar. Cualquier otra se rechaza.
function apiPermitida_(fn) {
  return {
    getFormConfig: getFormConfig, calentarDatos: calentarDatos, buscarClientes: buscarClientes,
    seleccionarCliente: seleccionarCliente, crearTicket: crearTicket, consultarTicket: consultarTicket,
    getTicketTecnico: getTicketTecnico, guardarTicketTecnico: guardarTicketTecnico,
    panelLogin: panelLogin, getPanelData: getPanelData, actualizarTicket: actualizarTicket,
    reenviarTecnico: reenviarTecnico, getDashboardData: getDashboardData, enviarAlertasAhora: enviarAlertasAhora,
    ping: function () { return { ok: true, empresa: EMPRESA, hora: fmt_(new Date()) }; }
  }[fn] || null;
}

// Recibe { fn, args, token } desde /api/rpc de Vercel y responde JSON
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const token = limpiarToken_(propiedad_('API_TOKEN'));
    if (!token) throw new Error('Falta API_TOKEN en las propiedades del script. Usa el menú Servicio técnico > Generar token para Vercel.');
    const recibido = limpiarToken_(req.token);
    if (recibido !== token) {
      Utilities.sleep(800);
      throw new Error('No autorizado: el API_TOKEN de Vercel (huella ' + huella_(recibido) + ') no coincide con el del script (huella ' +
        huella_(token) + '). Copia el mismo token en Vercel y haz Redeploy.');
    }
    const f = apiPermitida_(String(req.fn || ''));
    if (!f) throw new Error('Función no permitida.');
    out = f.apply(null, Array.isArray(req.args) ? req.args : []);
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? { ok: true } : out))
    .setMimeType(ContentService.MimeType.JSON);
}

// Quita espacios, saltos de línea y comillas que se cuelan al copiar y pegar
function limpiarToken_(x) {
  return String(x == null ? '' : x).trim().replace(/^["']+|["']+$/g, '').trim();
}

// Primeros 6 caracteres del SHA-256: sirve para comparar tokens sin mostrarlos
function huella_(x) {
  if (!x) return 'vacío';
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, x, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 6);
}

/* ===================== ENLACES ===================== */

// Dominio de Vercel sin barra final
function urlApp_() {
  return String(propiedad_('URL_APP') || '').trim().replace(/\/+$/, '');
}

// enlace_('tecnico', {id:'TK-0001', t:'…'}) -> https://dominio.vercel.app/tecnico?id=TK-0001&t=…
// Si falta URL_APP devuelve '' (el correo sale igual, pero sin botón) en vez de cancelar el envío
function enlace_(ruta, params) {
  const base = urlApp_();
  if (!base) { console.warn('Falta URL_APP en las propiedades del script: los correos salen sin enlace.'); return ''; }
  const q = Object.keys(params || {}).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  return base + '/' + (ruta || '') + (q ? '?' + q : '');
}

// Los correos viejos apuntaban a la URL /exec. Esto los manda a la misma vista en Vercel.
function doGet(e) {
  const p = (e && e.parameter) || {};
  const base = urlApp_();
  if (!base) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Servicio técnico ' + EMPRESA +
      ': falta configurar URL_APP en las propiedades del script.</p>').setTitle(EMPRESA);
  }
  const page = String(p.page || '').trim().toLowerCase();
  const ruta = ['estado', 'panel', 'dashboard', 'tecnico'].indexOf(page) >= 0 ? page : '';
  const params = {};
  if (/^TK-\d+$/.test(p.id || '')) params.id = p.id;
  if (/^[0-9a-f]{32}$/.test(p.t || '')) params.t = p.t;
  const destino = enlace_(ruta, params);
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_top"></head><body style="font-family:sans-serif;padding:24px">' +
    '<p>Abriendo el sistema de servicio técnico…</p><p><a href="' + h_(destino) + '">Si no se abre solo, toca aquí.</a></p>' +
    '<script>try{window.top.location.replace(' + JSON.stringify(destino) + ')}catch(e){}</script></body></html>')
    .setTitle('Servicio técnico · ' + EMPRESA)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Ejecútala UNA vez desde el editor (Ejecutar ▶) para aceptar todos los permisos que usa la app
function autorizar() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  MailApp.getRemainingDailyQuota();
  Session.getEffectiveUser().getEmail();
  CacheService.getScriptCache();
  LockService.getScriptLock();
  ScriptApp.getProjectTriggers();
  console.log('Permisos aceptados. Ahora publica una nueva versión de la implementación.');
}

// Menú: revisa la configuración y envía un correo de prueba a quien lo ejecuta
function diagnostico() {
  const ui = SpreadsheetApp.getUi(), L = [];
  const chk = function (ok, txt) { L.push((ok ? '✅ ' : '❌ ') + txt); };
  const url = urlApp_();
  chk(!!url && !/script\.google\.com/.test(url), 'URL_APP: ' + (url || 'vacía (los correos salen sin botón)'));
  chk(!!propiedad_('API_TOKEN'), 'API_TOKEN ' + (propiedad_('API_TOKEN') ? 'configurado (huella ' + huella_(limpiarToken_(propiedad_('API_TOKEN'))) + ')' : 'falta'));
  chk(!!propiedad_('CLAVE_PANEL'), 'CLAVE_PANEL ' + (propiedad_('CLAVE_PANEL') ? 'configurada' : 'falta'));
  let cuota = -1;
  try { cuota = MailApp.getRemainingDailyQuota(); } catch (e) { L.push('❌ No se pudo leer la cuota de correo: ' + e.message); }
  if (cuota >= 0) chk(cuota > 5, 'Correos que aún puedes enviar hoy: ' + cuota);
  const sinCorreo = leer_('TECNICOS').filter(function (t) { return esActivo_(t) && !String(t['Correo'] || '').trim(); })
    .map(function (t) { return t['Nombre']; });
  chk(!sinCorreo.length, sinCorreo.length ? 'Técnicos activos sin correo: ' + sinCorreo.join(', ') : 'Todos los técnicos activos tienen correo');
  chk(alertasActivas_(), 'Alertas automáticas ' + (alertasActivas_() ? 'activas' : 'desactivadas'));
  const yo = Session.getEffectiveUser().getEmail();
  try {
    MailApp.sendEmail({ to: yo, subject: '[' + EMPRESA + '] Prueba de correo del sistema de tickets',
      htmlBody: correoHtml_({ titulo: 'Prueba de correo', subtitulo: 'Si recibes esto, el envío de correos funciona.',
        boton: { texto: 'Abrir formulario', url: enlace_('') } }),
      body: 'Si recibes esto, el envío de correos funciona.' });
    chk(true, 'Correo de prueba enviado a ' + yo);
  } catch (e) { chk(false, 'No se pudo enviar el correo de prueba: ' + e.message); }
  ui.alert('Diagnóstico del sistema', L.join('\n'), ui.ButtonSet.OK);
}

// Menú: crea (o muestra) el token compartido con Vercel
function generarTokenApi() {
  const ui = SpreadsheetApp.getUi();
  let t = propiedad_('API_TOKEN');
  if (t) {
    const r = ui.alert('Ya existe un token', '¿Quieres ver el actual (Sí) o crear uno nuevo (No)?\n' +
      'Si creas uno nuevo, debes actualizar API_TOKEN en Vercel.', ui.ButtonSet.YES_NO_CANCEL);
    if (r === ui.Button.CANCEL || r === ui.Button.CLOSE) return;
    if (r === ui.Button.NO) t = '';
  }
  if (!t) {
    t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    PropertiesService.getScriptProperties().setProperty('API_TOKEN', t);
  }
  ui.alert('Token para Vercel', 'Cópialo en Vercel > Settings > Environment Variables como API_TOKEN:\n\n' + t +
    '\n\nHuella: ' + huella_(t) + '\nDespués de pegarlo en Vercel, haz Redeploy.', ui.ButtonSet.OK);
}

/* ===================== CONFIGURACIÓN INICIAL ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Servicio técnico')
    .addItem('Configurar hojas', 'configurarHojas')
    .addItem('Actualizar datos de clientes y equipos', 'actualizarDatosClientes')
    .addSeparator()
    .addItem('Activar alertas automáticas', 'activarAlertas')
    .addItem('Revisar casos sin respuesta ahora', 'revisarAlertasMenu')
    .addItem('Desactivar alertas automáticas', 'desactivarAlertas')
    .addSeparator()
    .addItem('Generar token para Vercel', 'generarTokenApi')
    .addItem('Diagnóstico (configuración y correo de prueba)', 'diagnostico')
    .addItem('Ver enlaces de la aplicación', 'mostrarEnlaces')
    .addToUi();
}

function configurarHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sT = prepararHoja_(ss, 'TICKETS', H_TICKETS);
  const sTec = prepararHoja_(ss, 'TECNICOS', H_TECNICOS);
  const sE = prepararHoja_(ss, 'ESTADOS', H_ESTADOS);
  H_TICKETS.forEach(function (h) { asegurarColumna_(sT, h); });

  if (sTec.getLastRow() < 2) {
    sTec.getRange(2, 1, 3, 4).setValues([
      ['Técnico Oriente', 'Oriente', '', 'SI'],
      ['Técnico Central', 'Central', '', 'SI'],
      ['Técnico Occidente', 'Occidente', '', 'SI']
    ]);
  }
  if (sE.getLastRow() < 2) sE.getRange(2, 1, ESTADOS_VE.length, 2).setValues(ESTADOS_VE);

  // Listas desplegables para evitar errores de escritura
  const regla = function (lista) { return SpreadsheetApp.newDataValidation().requireValueInList(lista, true).build(); };
  sTec.getRange('B2:B200').setDataValidation(regla(REGIONES));
  sE.getRange('B2:B200').setDataValidation(regla(REGIONES));
  sTec.getRange('D2:D200').setDataValidation(regla(['SI', 'NO']));
  sT.getRange(2, colDe_(sT, 'Estatus'), 4999, 1).setDataValidation(regla(ESTATUS));
  sT.getRange(2, colDe_(sT, 'Solicitud'), 4999, 1).setDataValidation(regla(TIPOS_SOLICITUD));

  SpreadsheetApp.getUi().alert(
    'Hojas listas.\n\n1) Escribe los nombres y correos reales en la hoja TECNICOS.\n' +
    '2) Define CLAVE_PANEL y URL_APP en Configuración del proyecto > Propiedades del script.\n' +
    '3) Menú Servicio técnico > Generar token para Vercel.\n' +
    '   Implementa como aplicación web (Ejecutar como: yo · Acceso: cualquier persona).\n' +
    '4) Activa las alertas: menú Servicio técnico > Activar alertas automáticas.');
}

function mostrarEnlaces() {
  const b = urlApp_();
  SpreadsheetApp.getUi().alert(b ? 'Formulario: ' + b + '/\nConsulta del cliente: ' + b + '/estado\n' +
    'Panel: ' + b + '/panel\nDashboard: ' + b + '/dashboard'
    : 'Falta URL_APP: escribe el dominio de Vercel en Configuración del proyecto > Propiedades del script.');
}

function prepararHoja_(ss, nombre, headers) {
  let s = ss.getSheetByName(nombre);
  if (!s) s = ss.insertSheet(nombre);
  if (s.getLastRow() === 0) {
    s.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#00668a').setFontColor('#ffffff');
    s.setFrozenRows(1);
    s.autoResizeColumns(1, headers.length);
  }
  return s;
}

// Agrega la columna al final del encabezado si una hoja ya creada no la tiene
function asegurarColumna_(sh, nombre) {
  const ultima = Math.max(sh.getLastColumn(), 1);
  const h = sh.getRange(1, 1, 1, ultima).getValues()[0].map(function (x) { return String(x).trim(); });
  const i = h.indexOf(nombre);
  if (i >= 0) return i + 1;
  const col = h.join('') === '' ? 1 : ultima + 1;
  sh.getRange(1, col).setValue(nombre).setFontWeight('bold').setBackground('#00668a').setFontColor('#ffffff');
  return col;
}

/* ===================== UTILIDADES ===================== */

function hoja_(nombre) {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!s) throw new Error('Falta la hoja "' + nombre + '" en este libro.');
  return s;
}

function leer_(nombre) {
  const v = hoja_(nombre).getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0].map(function (x) { return String(x).trim(); });
  return v.slice(1)
    .map(function (r, i) {
      const o = { _fila: i + 2 };
      h.forEach(function (k, j) { o[k] = r[j]; });
      return o;
    })
    .filter(function (o) { return String(o[h[0]]).trim() !== ''; });
}

// Mapa encabezado -> número de columna (una sola lectura)
function columnas_(sh) {
  const m = {};
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .forEach(function (x, i) { m[String(x).trim()] = i + 1; });
  return m;
}

function colDe_(sh, nombre) {
  const c = columnas_(sh)[nombre];
  if (!c) throw new Error('Falta la columna "' + nombre + '" en la hoja ' + sh.getName() + '.');
  return c;
}

// Escribe varias celdas de una fila por nombre de columna
function escribir_(sh, fila, cambios) {
  const c = columnas_(sh);
  Object.keys(cambios).forEach(function (k) {
    if (!c[k]) throw new Error('Falta la columna "' + k + '" en la hoja ' + sh.getName() + '.');
    sh.getRange(fila, c[k]).setValue(cambios[k]);
  });
}

function buscarTicket_(id) {
  const t = leer_('TICKETS').filter(function (x) { return String(x['ID_Ticket']) === String(id); })[0];
  if (!t) throw new Error('No se encontró el ticket ' + id + '.');
  return t;
}

// Siempre texto: un Date en la respuesta puede hacer que el cliente reciba null
function fmt_(d) {
  const f = aFecha_(d);
  if (f) return Utilities.formatDate(f, TZ, 'dd/MM/yyyy HH:mm');
  return d === null || d === undefined ? '' : String(d);
}
function fmtDia_(d) {
  const f = aFecha_(d);
  return f ? Utilities.formatDate(f, TZ, 'dd/MM/yyyy') : '';
}

// Fecha de una celda como Date: acepta fechas reales y texto dd/MM/yyyy [HH:mm]
function aFecha_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(v || '').trim());
  if (!m) return null;
  const s = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + ' ' +
    ('0' + (m[4] || '0')).slice(-2) + ':' + (m[5] || '00');
  return Utilities.parseDate(s, TZ, 'yyyy-MM-dd HH:mm');
}

// Milisegundos para enviar al navegador (nunca un Date)
function ms_(v) {
  const d = aFecha_(v);
  return d ? d.getTime() : null;
}

// Número de día calendario en la zona horaria de la empresa
function diaN_(d) {
  const s = Utilities.formatDate(d, TZ, 'yyyy-MM-dd').split('-');
  return Date.UTC(+s[0], +s[1] - 1, +s[2]) / 864e5;
}

// Evita que un texto escrito por el usuario se interprete como fórmula
function seguro_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

// Para teléfonos y seriales: evita que Sheets los convierta en número (y pierda el 0 inicial)
function texto_(v) {
  v = String(v == null ? '' : v);
  return /^[=+\-@]/.test(v) || /^[\d\s.,\/-]+$/.test(v) ? "'" + v : v;
}

function esActivo_(t) {
  return String(t['Activo']).trim().toUpperCase() === 'SI';
}

function propiedad_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}

function urgencia_(id) {
  return URGENCIAS.filter(function (u) { return u.id === id; })[0] || { id: id, texto: '', horas: 0 };
}

/* ===================== FORMULARIO DEL CLIENTE ===================== */

function getFormConfig() {
  try {
    const estados = leer_('ESTADOS').map(function (e) { return String(e['Estado']); })
      .sort(function (a, b) { return a.localeCompare(b, 'es'); });
    const urgencias = URGENCIAS.map(function (u) { return { id: u.id, texto: u.texto, horas: u.horas }; });
    return { ok: true, estados: estados, urgencias: urgencias, tipos: TIPOS_SOLICITUD, perifericos: PERIFERICOS };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function crearTicket(d) {
  let lock = null;
  try {
    d = d || {};
    // Campo trampa: los humanos no lo ven; los bots lo llenan
    if (String(d.web || '').trim()) return { ok: true, id: 'TK-0000', region: '', tecnico: '' };

    const campos = ['cliente', 'refCliente', 'contacto', 'telefono', 'correo', 'estado', 'equipo', 'serial', 'urgencia', 'descripcion'];
    const v = {};
    campos.forEach(function (k) { v[k] = String(d[k] || '').trim().slice(0, 1500); });
    v.correo = v.correo.toLowerCase();

    // Si el cliente dejó vacío teléfono o correo y están registrados, se usan los registrados
    if (v.refCliente && (!v.telefono || !v.correo)) {
      const reg = registro_(v.refCliente, datos_());
      if (!v.telefono) v.telefono = reg.tel;
      if (!v.correo) v.correo = String(reg.correo || '').toLowerCase();
    }
    const faltan = ['cliente', 'contacto', 'telefono', 'correo', 'estado', 'equipo']
      .filter(function (k) { return !v[k]; });
    if (faltan.length) return { ok: false, error: 'Completa los campos obligatorios.', campos: faltan };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo)) return { ok: false, error: 'El correo no es válido.', campos: ['correo'] };

    // Tipo de solicitud y sus datos propios
    v.tipo = String(d.tipo || '').trim();
    if (TIPOS_SOLICITUD.indexOf(v.tipo) < 0) return { ok: false, error: 'Elige el tipo de solicitud.', campos: ['tipo'] };
    v.perifericos = '';
    v.licencia = '';
    let urg;
    if (v.tipo === TIPO_FALLA) {
      urg = URGENCIAS.filter(function (u) { return u.id === v.urgencia; })[0];
      if (!urg) return { ok: false, error: 'Selecciona la urgencia.', campos: ['urgencia'] };
      if (v.descripcion.length < 10) return { ok: false, error: 'Describe la falla con un poco más de detalle.', campos: ['descripcion'] };
    } else {
      urg = URGENCIAS.filter(function (u) { return u.id === PRIORIDAD_SIN_FALLA; })[0];
      if (v.tipo === TIPO_PERIFERICO) {
        const elegidos = (Array.isArray(d.perifericos) ? d.perifericos : [])
          .map(function (x) { return String(x); }).filter(function (x) { return PERIFERICOS.indexOf(x) >= 0; });
        if (!elegidos.length) return { ok: false, error: 'Marca al menos un periférico.', campos: ['perifericos'] };
        v.perifericos = PERIFERICOS.filter(function (x) { return elegidos.indexOf(x) >= 0; }).join(', ');
      }
      if (v.tipo === TIPO_LICENCIA) {
        v.licencia = String(d.licencia || '').trim().slice(0, 200);
        if (!v.licencia) return { ok: false, error: 'Escribe el nombre de la licencia.', campos: ['licencia'] };
      }
      // La descripción guarda un resumen legible para panel, correos y alertas
      v.descripcion = resumenSolicitud_(v.tipo, v.perifericos, v.licencia, '');
    }

    const fe = leer_('ESTADOS').filter(function (e) { return e['Estado'] === v.estado; })[0];
    if (!fe) return { ok: false, error: 'El estado seleccionado no es válido.', campos: ['estado'] };
    const region = String(fe['Región']);

    lock = LockService.getScriptLock();
    lock.waitLock(20000);

    const shT = hoja_('TICKETS');
    ['Solicitud', 'Periféricos', 'Licencia'].forEach(function (c) { asegurarColumna_(shT, c); });
    const tickets = leer_('TICKETS');
    let max = 0;
    tickets.forEach(function (t) {
      const n = parseInt(String(t['ID_Ticket']).replace(/\D/g, ''), 10);
      if (n > max) max = n;
    });
    const id = 'TK-' + ('0000' + (max + 1)).slice(-4);

    // Asignación: técnico activo de la región con menos casos abiertos
    const abiertos = {};
    tickets.forEach(function (t) {
      if (ESTATUS_ABIERTOS.indexOf(t['Estatus']) >= 0) {
        const n = t['Técnico asignado'];
        abiertos[n] = (abiertos[n] || 0) + 1;
      }
    });
    const tecs = leer_('TECNICOS')
      .filter(function (t) { return esActivo_(t) && t['Región'] === region; })
      .sort(function (a, b) { return (abiertos[a['Nombre']] || 0) - (abiertos[b['Nombre']] || 0); });
    const tec = tecs[0] || null;

    const ahora = new Date();
    const limite = new Date(ahora.getTime() + urg.horas * 3600000);

    appendPorEncabezado_(shT, {
      'ID_Ticket': id, 'Fecha': ahora, 'Cliente': seguro_(v.cliente), 'Contacto': seguro_(v.contacto),
      'Teléfono': texto_(v.telefono), 'Correo': seguro_(v.correo), 'Estado': v.estado, 'Región': region,
      'Equipo': seguro_(v.equipo), 'Serial': texto_(v.serial), 'Descripción': seguro_(v.descripcion),
      'Prioridad': urg.id, 'Técnico asignado': tec ? tec['Nombre'] : '',
      'Correo técnico': tec ? tec['Correo'] : '', 'Estatus': tec ? 'Asignado' : 'Sin asignar',
      'Fecha límite SLA': limite, 'Solicitud': v.tipo, 'Periféricos': v.perifericos, 'Licencia': seguro_(v.licencia)
    });
    SpreadsheetApp.flush();
    lock.releaseLock();
    lock = null;

    notificarNuevo_(id, v, region, urg, limite, tec);
    return { ok: true, id: id, region: region, tecnico: tec ? String(tec['Nombre']) : '', correo: maskCorreo_(v.correo) };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function appendPorEncabezado_(sh, obj) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(h.map(function (k) {
    const v = obj[String(k).trim()];
    return v === undefined ? '' : v;
  }));
}

// Texto corto que describe la solicitud (los tickets viejos no tienen tipo: se tratan como falla)
function tipoDe_(t) { return String(t['Solicitud'] || '').trim() || TIPO_FALLA; }
function resumenSolicitud_(tipo, perifericos, licencia, descripcion) {
  if (tipo === TIPO_PERIFERICO) return 'Instalación de periférico: ' + perifericos;
  if (tipo === TIPO_LICENCIA) return 'Licencia solicitada: ' + licencia;
  if (tipo === TIPO_MANTENIMIENTO) return 'Mantenimiento preventivo del equipo.';
  return String(descripcion || '');
}
function tituloBloque_(tipo) { return tipo === TIPO_FALLA ? 'Falla reportada:' : 'Solicitud:'; }

/* ===================== CONSULTA PÚBLICA DEL CLIENTE ===================== */

// Pide número de ticket + correo del reporte. Nunca devuelve observaciones internas.
function consultarTicket(id, correo) {
  try {
    id = String(id || '').trim().toUpperCase().replace(/^TK-?/, 'TK-');
    if (/^\d+$/.test(id)) id = 'TK-' + ('0000' + id).slice(-4);
    correo = String(correo || '').trim().toLowerCase();
    if (!/^TK-\d+$/.test(id) || !correo) throw new Error('Escribe el número de ticket y el correo del reporte.');

    const t = leer_('TICKETS').filter(function (x) { return String(x['ID_Ticket']) === id; })[0];
    if (!t || String(t['Correo']).trim().toLowerCase().replace(/^'/, '') !== correo) {
      Utilities.sleep(1200);
      throw new Error('No encontramos un ticket con ese número y correo.');
    }
    const est = String(t['Estatus']);
    const tec = String(t['Técnico asignado'] || '').trim();
    return {
      ok: true, id: id, fecha: fmt_(t['Fecha']), equipo: String(t['Equipo']), serial: String(t['Serial'] || ''),
      solicitud: tipoDe_(t), detalle: String(t['Periféricos'] || '') || String(t['Licencia'] || ''),
      estado: String(t['Estado']), region: String(t['Región']), prioridad: tipoDe_(t) === TIPO_FALLA ? urgencia_(String(t['Prioridad'])).texto.split(':')[0] : '',
      estatus: est, tecnico: tec ? tec.split(/\s+/)[0] : '',
      atencion: fmtDia_(t['Fecha de atencion']), visita: fmtDia_(t['Fecha de la visita']), cierre: fmtDia_(t['Fecha cierre']),
      cerrado: ESTATUS_CERRADOS.indexOf(est) >= 0
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ===================== CORREOS ===================== */

function h_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Plantilla común: o = {color, titulo, subtitulo, filas:[[k,v]], bloque:{titulo,texto}, boton:{texto,url}, pie}
function correoHtml_(o) {
  const filas = (o.filas || []).filter(function (f) { return f[1] !== '' && f[1] != null; }).map(function (f) {
    return '<tr><td style="padding:6px 14px 6px 0;color:#52707a;vertical-align:top;white-space:nowrap">' + h_(f[0]) +
      '</td><td style="padding:6px 0;color:#0f3d4f"><b>' + h_(f[1]) + '</b></td></tr>';
  }).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#0f3d4f;max-width:580px;margin:0 auto">' +
    '<div style="border-top:6px solid ' + (o.color || '#00668a') + ';padding:16px 0 4px">' +
    '<div style="font-size:11px;letter-spacing:.2em;color:#14775e;font-weight:bold">SERVICIO TÉCNICO · ' + h_(EMPRESA).toUpperCase() + '</div>' +
    '<h2 style="margin:6px 0 4px;font-size:20px;color:' + (o.color || '#00668a') + '">' + h_(o.titulo) + '</h2>' +
    (o.subtitulo ? '<p style="margin:0 0 12px;color:#52707a">' + h_(o.subtitulo) + '</p>' : '') + '</div>' +
    (filas ? '<table style="font-size:14px;border-collapse:collapse;margin:8px 0">' + filas + '</table>' : '') +
    (o.bloque ? '<p style="margin:14px 0 4px;color:#52707a">' + h_(o.bloque.titulo) + '</p>' +
      '<div style="background:#e6f7f3;padding:10px 12px;border-radius:6px;white-space:pre-wrap;font-size:14px">' + h_(o.bloque.texto) + '</div>' : '') +
    (o.boton && o.boton.url ? '<p style="margin:22px 0 8px"><a href="' + o.boton.url + '" style="background:#00668a;color:#ffffff;' +
      'text-decoration:none;padding:12px 26px;border-radius:6px;font-weight:bold;display:inline-block">' + h_(o.boton.texto) + '</a></p>' +
      '<p style="font-size:12px;color:#52707a;margin:0">Si el botón no funciona, copia este enlace: ' + o.boton.url + '</p>' : '') +
    (o.pie ? '<p style="font-size:12px;color:#52707a;margin-top:18px">' + h_(o.pie) + '</p>' : '') + '</div>';
}

function secreto_() {
  let s = propiedad_('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function token_(id) {
  return Utilities.computeHmacSha256Signature(String(id), secreto_())
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 32);
}

function tokenValido_(id, tk) {
  return /^TK-\d+$/.test(String(id)) && String(tk) === token_(id);
}

function enlaceTecnico_(id) {
  return enlace_('tecnico', { id: id, t: token_(id) });
}
function enlaceEstado_(id) {
  return enlace_('estado', { id: id });
}

// c = {id, tipo, cliente, contacto, telefono, estado, region, equipo, serial, prioridad, urgTexto, limite, descripcion}
function enviarTecnico_(c, tec, reenvio) {
  const link = enlaceTecnico_(c.id);
  MailApp.sendEmail({
    to: tec['Correo'],
    subject: '[' + EMPRESA + '] ' + (reenvio ? 'Recordatorio: ticket ' : 'Nuevo ticket ') + c.id + ' · ' + (c.tipo || TIPO_FALLA) + ' (' + c.prioridad + ')',
    htmlBody: correoHtml_({
      titulo: (reenvio ? 'Ticket ' : 'Nuevo ticket ') + c.id,
      subtitulo: reenvio ? 'Coordinación te reenvía este caso.' : 'Se te asignó un caso de servicio técnico.',
      filas: [['Solicitud', c.tipo || TIPO_FALLA], ['Cliente', c.cliente], ['Contacto', c.contacto + ' / ' + c.telefono],
        ['Ubicación', c.estado + ' (Región ' + c.region + ')'],
        ['Equipo', c.equipo + (c.serial ? ' (serial ' + c.serial + ')' : '')],
        ['Prioridad', c.prioridad + ' - ' + c.urgTexto], ['Fecha límite', c.limite]],
      bloque: { titulo: tituloBloque_(c.tipo || TIPO_FALLA), texto: c.descripcion },
      boton: { texto: 'Abrir ticket', url: link }
    }),
    body: 'Ticket ' + c.id + ' · ' + (c.tipo || TIPO_FALLA) + '\nCliente: ' + c.cliente + '\nEquipo: ' + c.equipo + '\nPrioridad: ' + c.prioridad +
      '\n\n' + c.descripcion + '\n\nAbrir ticket: ' + link
  });
}

function datosCorreo_(t) {
  const u = urgencia_(String(t['Prioridad']));
  return {
    id: String(t['ID_Ticket']), tipo: tipoDe_(t), cliente: t['Cliente'], contacto: t['Contacto'], telefono: t['Teléfono'],
    estado: t['Estado'], region: t['Región'], equipo: t['Equipo'], serial: t['Serial'],
    prioridad: t['Prioridad'], urgTexto: u.texto, limite: fmt_(t['Fecha límite SLA']), descripcion: t['Descripción']
  };
}

function notificarNuevo_(id, v, region, urg, limite, tec) {
  const bloque = { titulo: tituloBloque_(v.tipo), texto: v.descripcion };
  const filas = [['Ticket', id], ['Solicitud', v.tipo], ['Cliente', v.cliente], ['Contacto', v.contacto + ' / ' + v.telefono],
    ['Ubicación', v.estado + ' (Región ' + region + ')'], ['Equipo', v.equipo + (v.serial ? ' (serial ' + v.serial + ')' : '')],
    ['Prioridad', urg.id + ' - ' + urg.texto], ['Fecha límite objetivo', fmt_(limite)]];

  // 1) Cliente
  try {
    MailApp.sendEmail({
      to: v.correo, subject: '[' + EMPRESA + '] Recibimos tu solicitud ' + id,
      htmlBody: correoHtml_({
        titulo: 'Recibimos tu solicitud ' + id,
        subtitulo: 'Hola ' + v.contacto + ', ' + (tec ? 'tu caso ya está asignado a nuestro equipo de la región ' + region + '.'
          : 'en breve asignaremos tu caso a un técnico.'),
        filas: filas, bloque: bloque,
        boton: { texto: 'Ver estado del ticket', url: enlaceEstado_(id) },
        pie: 'Para consultar el estado necesitarás el número de ticket y este correo.'
      }),
      body: 'Hola ' + v.contacto + ',\n\nRecibimos tu solicitud (' + v.tipo + '). Tu número de ticket es ' + id +
        '.\nConsulta el estado en: ' + enlaceEstado_(id) + '\n\n' + bloque.titulo + '\n' + v.descripcion
    });
  } catch (e) { console.error('Correo al cliente: ' + e.message); }

  // 2) Técnico, con botón "Abrir ticket"
  if (tec && tec['Correo']) {
    try {
      enviarTecnico_({
        id: id, tipo: v.tipo, cliente: v.cliente, contacto: v.contacto, telefono: v.telefono, estado: v.estado,
        region: region, equipo: v.equipo, serial: v.serial, prioridad: urg.id, urgTexto: urg.texto,
        limite: fmt_(limite), descripcion: v.descripcion
      }, tec);
    } catch (e) { console.error('Correo al técnico: ' + e.message); }
  }

  // 3) Admin si no hay técnico
  const admin = propiedad_('CORREO_ADMIN');
  if (!tec && admin) {
    try {
      MailApp.sendEmail({
        to: admin, subject: '[' + EMPRESA + '] Ticket ' + id + ' SIN TÉCNICO en ' + region,
        htmlBody: correoHtml_({
          color: '#b3261e', titulo: 'Ticket ' + id + ' sin técnico',
          subtitulo: 'No hay técnico activo en la región ' + region + '. Asígnalo desde el panel.',
          filas: filas, bloque: bloque,
          boton: { texto: 'Abrir panel', url: enlace_('panel') }
        }),
        body: 'No hay técnico activo en la región ' + region + '. Asigna el ticket ' + id + ' desde el panel.'
      });
    } catch (e) { console.error('Correo al admin: ' + e.message); }
  }
}

// Avisa al cliente cuando su caso pasa a Resuelto
function notificarResuelto_(t) {
  try {
    const correo = String(t['Correo'] || '').replace(/^'/, '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return;
    const id = String(t['ID_Ticket']);
    MailApp.sendEmail({
      to: correo, subject: '[' + EMPRESA + '] Tu ticket ' + id + ' fue resuelto',
      htmlBody: correoHtml_({
        color: '#1e7a46', titulo: 'Ticket ' + id + ' resuelto',
        subtitulo: 'Hola ' + t['Contacto'] + ', nuestro equipo marcó tu caso como resuelto.',
        filas: [['Equipo', t['Equipo'] + (t['Serial'] ? ' (serial ' + t['Serial'] + ')' : '')], ['Reportado', fmt_(t['Fecha'])]],
        boton: { texto: 'Ver detalle', url: enlaceEstado_(id) },
        pie: 'Si la falla persiste, responde a este correo o crea un nuevo reporte.'
      }),
      body: 'Hola ' + t['Contacto'] + ',\n\nTu ticket ' + id + ' fue marcado como resuelto.\nDetalle: ' + enlaceEstado_(id)
    });
  } catch (e) { console.error('Correo de resuelto: ' + e.message); }
}

/* ===================== FICHA DEL TÉCNICO (enlace del correo) ===================== */

function fechaInput_(d) {
  const f = aFecha_(d);
  return f ? Utilities.formatDate(f, TZ, 'yyyy-MM-dd') : '';
}

function parseFecha_(s, nombre) {
  s = String(s || '').trim();
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('La ' + nombre + ' no es válida.');
  return Utilities.parseDate(s + ' 12:00', TZ, 'yyyy-MM-dd HH:mm');
}

function getTicketTecnico(id, tk) {
  try {
    if (!tokenValido_(id, tk)) throw new Error('Enlace no válido. Ábrelo desde el botón del correo más reciente.');
    const t = buscarTicket_(id);
    const est = String(t['Estatus']);
    return {
      ok: true,
      id: String(t['ID_Ticket']), fecha: fmt_(t['Fecha']), cliente: String(t['Cliente']), contacto: String(t['Contacto']),
      telefono: String(t['Teléfono']), correo: String(t['Correo']), estado: String(t['Estado']),
      region: String(t['Región']), equipo: String(t['Equipo']), serial: String(t['Serial']),
      descripcion: String(t['Descripción']), prioridad: String(t['Prioridad']),
      solicitud: tipoDe_(t), perifericos: String(t['Periféricos'] || ''), licencia: String(t['Licencia'] || ''),
      urgencia: urgencia_(String(t['Prioridad'])).texto,
      tecnico: String(t['Técnico asignado']), estatus: est, limite: fmt_(t['Fecha límite SLA']),
      vencido: ESTATUS_ABIERTOS.indexOf(est) >= 0 && (ms_(t['Fecha límite SLA']) || Infinity) < Date.now(),
      fechaAtencion: fechaInput_(t['Fecha de atencion']), obs: String(t['Observaciones'] || ''),
      sitio: String(t['Atencion en sitio'] || ''), fechaVisita: fechaInput_(t['Fecha de la visita']),
      garantia: String(t['Garantia'] || ''), fechaCierre: fechaInput_(t['Fecha cierre']),
      fechaReporte: fechaInput_(t['Fecha']), hoy: fechaInput_(new Date()),
      editable: est !== 'Cerrado', estatusTecnico: ESTATUS_TECNICO
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function guardarTicketTecnico(id, tk, d) {
  let lock = null;
  try {
    if (!tokenValido_(id, tk)) throw new Error('Enlace no válido. Ábrelo desde el botón del correo más reciente.');
    d = d || {};
    const fAtencion = parseFecha_(d.fechaAtencion, 'fecha de atención');
    const fVisita = parseFecha_(d.fechaVisita, 'fecha de la visita');
    const fCierre = parseFecha_(d.fechaCierre, 'fecha de cierre');
    const obs = String(d.obs || '').trim().slice(0, 4000);
    const sitio = String(d.sitio || '').trim().slice(0, 1500);
    const garantia = String(d.garantia || '').trim();
    const pedido = String(d.estatus || '').trim();
    const hoy = diaN_(new Date());

    const err = function (msg, campo) { const e = new Error(msg); e.campo = campo; throw e; };
    if (garantia && ['Sí', 'No'].indexOf(garantia) < 0) err('Garantía no válida.', 'garantia');
    if (pedido && ESTATUS_TECNICO.indexOf(pedido) < 0) err('Estatus no válido.', 'estatus');
    if (fAtencion && diaN_(fAtencion) > hoy) err('La fecha de atención no puede ser futura.', 'fechaAtencion');
    if (fCierre && diaN_(fCierre) > hoy) err('La fecha de cierre no puede ser futura.', 'fechaCierre');
    if (pedido && !fAtencion) err('Registra primero la fecha de atención.', 'fechaAtencion');
    if (fCierre) {
      if (!fAtencion) err('Para cerrar, registra también la fecha de atención.', 'fechaAtencion');
      if (diaN_(fCierre) < diaN_(fAtencion)) err('El cierre no puede ser anterior a la atención.', 'fechaCierre');
      if (!obs) err('Para cerrar, relata en Observaciones el problema y la solución.', 'obs');
      if (!garantia) err('Para cerrar, indica si entra por garantía.', 'garantia');
    }

    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const t = buscarTicket_(id);
    const antes = String(t['Estatus']);
    if (antes === 'Cerrado') throw new Error('Coordinación ya cerró este ticket; no se puede modificar.');
    const fRep = aFecha_(t['Fecha']);
    if (fAtencion && fRep && diaN_(fAtencion) < diaN_(fRep)) err('La atención no puede ser anterior al reporte (' + fmtDia_(fRep) + ').', 'fechaAtencion');

    // Estatus automático según lo que llene el técnico
    let est = antes;
    if (fCierre) est = 'Resuelto';
    else if (fAtencion) est = pedido || (ESTATUS_SIN_RESPUESTA.indexOf(antes) >= 0 || antes === 'Resuelto' ? 'En reparación' : antes);
    else if (antes === 'Resuelto' || ESTATUS_TECNICO.indexOf(antes) >= 0) est = t['Técnico asignado'] ? 'Asignado' : 'Sin asignar';

    const sh = hoja_('TICKETS');
    escribir_(sh, t._fila, {
      'Fecha de atencion': fAtencion, 'Observaciones': seguro_(obs), 'Atencion en sitio': seguro_(sitio),
      'Fecha de la visita': fVisita, 'Garantia': garantia, 'Fecha cierre': fCierre, 'Estatus': est
    });
    SpreadsheetApp.flush();
    lock.releaseLock();
    lock = null;

    if (est === 'Resuelto' && antes !== 'Resuelto') notificarResuelto_(t);
    return { ok: true, estatus: est, avisoCliente: est === 'Resuelto' && antes !== 'Resuelto' };
  } catch (e) {
    return { ok: false, error: e.message, campo: e.campo || '' };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* ===================== CLIENTES Y EQUIPOS (autocompletado) ===================== */

// Hoja DATA CLIENTE: G = nombre del cliente, I = teléfono, J = correo
// Hoja Sales: B = status, C = customer, D = serial number, F = short description, G = city
const HOJA_CLIENTES = 'DATA CLIENTE';
const HOJA_SALES = 'Sales';
const STATUS_EXCLUIDOS = ['DECOMMISSIONED'];
const ALIAS_ESTADO = { 'VARGAS': 'La Guaira', 'CARACAS': 'Distrito Capital', 'DTTO CAPITAL': 'Distrito Capital', 'DISTRITO FEDERAL': 'Distrito Capital' };
const PALABRAS_VACIAS = ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'Y', 'CA', 'SA', 'SRL', 'CIA'];
const CLAVE_CACHE = 'DATOS_CLIENTES_V1';

function norm_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function tokens_(s) {
  return norm_(s).split(' ').filter(function (t) { return t.length > 1 && PALABRAS_VACIAS.indexOf(t) < 0; });
}

// Dos nombres son el mismo si todas las palabras del más corto están en el más largo
// (JOSE CARPIO = JOSE RAUL CARPIO = JOSE RAUL CARPIO SALAZAR). Una sola palabra es ambigua.
function relacionado_(ta, tb) {
  if (!ta.length || !tb.length) return false;
  const corto = ta.length <= tb.length ? ta : tb;
  const largo = ta.length <= tb.length ? tb : ta;
  if (corto.length === 1 && largo.length > 1) return false;
  return corto.every(function (t) { return largo.indexOf(t) >= 0; });
}

function putChunked_(key, obj) {
  try {
    const s = JSON.stringify(obj), size = 30000, n = Math.ceil(s.length / size), m = {};
    for (let i = 0; i < n; i++) m[key + '_' + i] = s.substr(i * size, size);
    m[key + '_n'] = String(n);
    CacheService.getScriptCache().putAll(m, 1800);
  } catch (e) { console.error('Caché: ' + e.message); }
}

function getChunked_(key) {
  try {
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(key + '_n'), 10);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = cache.getAll(keys);
    let s = '';
    for (let i = 0; i < n; i++) {
      if (got[key + '_' + i] == null) return null;
      s += got[key + '_' + i];
    }
    return JSON.parse(s);
  } catch (e) { return null; }
}

function actualizarDatosClientes() {
  const cache = CacheService.getScriptCache();
  const n = parseInt(cache.get(CLAVE_CACHE + '_n'), 10) || 0;
  const keys = [CLAVE_CACHE + '_n'];
  for (let i = 0; i < n; i++) keys.push(CLAVE_CACHE + '_' + i);
  cache.removeAll(keys);
  const d = datos_();
  SpreadsheetApp.getActiveSpreadsheet().toast(d.clientes.length + ' clientes y ' + d.equipos.length + ' equipos cargados.', 'Servicio técnico', 6);
}

// Lee las dos hojas una sola vez y las guarda en caché 30 minutos
function datos_() {
  const guardado = getChunked_(CLAVE_CACHE);
  if (guardado) return guardado;

  const d = { clientes: [], equipos: [] };
  const shC = hoja_(HOJA_CLIENTES);
  const nC = shC.getLastRow() - 1;
  if (nC > 0) {
    shC.getRange(2, 7, nC, 4).getValues().forEach(function (r) {   // G..J
      const nombre = String(r[0]).trim();
      if (nombre) d.clientes.push([nombre, String(r[2]).trim(), String(r[3]).trim()]);
    });
  }
  const shS = hoja_(HOJA_SALES);
  const nS = shS.getLastRow() - 1;
  if (nS > 0) {
    shS.getRange(2, 2, nS, 6).getValues().forEach(function (r) {   // B..G
      const cliente = String(r[1]).trim();
      if (cliente) d.equipos.push([cliente, String(r[2]).trim(), String(r[4]).trim(), String(r[5]).trim(), String(r[0]).trim()]);
    });
  }
  putChunked_(CLAVE_CACHE, d);
  return d;
}

function calentarDatos() {
  try { datos_(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

// Confidencial: nunca devuelve listas. Solo responde cuando lo escrito
// identifica a UN solo cliente (nombre exacto o coincidencia única con 2+ palabras).
function buscarClientes(texto) {
  try {
    const qn = norm_(texto);
    const q = tokens_(texto);
    if (qn.length < 3 || !q.length) return { ok: true, items: [] };

    const d = datos_();
    const vistos = {}, coinciden = [];
    d.clientes.map(function (c) { return c[0]; }).concat(d.equipos.map(function (e) { return e[0]; }))
      .forEach(function (nombre) {
        const k = norm_(nombre);
        if (vistos[k]) return;
        vistos[k] = 1;
        const t = tokens_(nombre);
        const ok = q.every(function (qt) {
          return t.some(function (x) { return x === qt || x.indexOf(qt) === 0; });
        });
        if (ok) coinciden.push(nombre);
      });

    const exacto = coinciden.filter(function (n) { return norm_(n) === qn; });
    if (exacto.length === 1) return { ok: true, items: [exacto[0]] };
    if (q.length >= 2 && coinciden.length === 1) return { ok: true, items: [coinciden[0]] };
    return { ok: true, items: [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function formatoTel_(t) {
  let dig = String(t || '').replace(/\D/g, '');
  if (dig.indexOf('58') === 0 && dig.length === 12) dig = dig.slice(2);
  if (/^4\d{9}$/.test(dig)) dig = '0' + dig;
  return /^0[24]\d{9}$/.test(dig) ? dig : String(t || '').trim();
}

function maskTel_(t) {
  const dig = String(t).replace(/\D/g, '');
  return dig.length > 4 ? '••••••' + dig.slice(-4) : '••••';
}
function maskCorreo_(c) {
  c = String(c || '');
  const i = c.indexOf('@');
  return i < 1 ? '•••' : c.charAt(0) + '•••' + c.slice(i);
}

function estadoCanonico_(ciudad, estados) {
  const k = norm_(ciudad);
  if (!k) return '';
  if (ALIAS_ESTADO[k]) return ALIAS_ESTADO[k];
  for (let i = 0; i < estados.length; i++) if (norm_(estados[i]) === k) return estados[i];
  return '';
}

// Si hay coincidencia exacta de nombre se usa solo esa; si no, la aproximada
function coincidencias_(lista, nombre) {
  const k = norm_(nombre), t = tokens_(nombre);
  const exactos = lista.filter(function (x) { return norm_(x[0]) === k; });
  return exactos.length ? exactos : lista.filter(function (x) { return relacionado_(t, tokens_(x[0])); });
}

function registro_(nombre, d) {
  const cl = coincidencias_(d.clientes, nombre);
  const tel = cl.map(function (x) { return x[1]; }).filter(String)[0] || '';
  const correo = cl.map(function (x) { return x[2]; }).filter(String)[0] || '';
  return { contacto: cl.length ? cl[0][0] : '', tel: formatoTel_(tel), correo: correo };
}

// Datos del cliente elegido. Teléfono y correo van enmascarados: el formulario es público.
function seleccionarCliente(nombre) {
  try {
    nombre = String(nombre || '').trim();
    if (!nombre) throw new Error('Nombre vacío.');
    const d = datos_();
    const reg = registro_(nombre, d);
    const estados = leer_('ESTADOS').map(function (e) { return String(e['Estado']); });

    const vistos = {}, equipos = [], conteo = {};
    coincidencias_(d.equipos, nombre).forEach(function (e) {
      const serial = e[1], desc = e[2], status = e[4].toUpperCase();
      if (STATUS_EXCLUIDOS.indexOf(status) >= 0 || (!serial && !desc)) return;
      const clave = serial + '|' + desc;
      if (vistos[clave]) return;
      vistos[clave] = 1;
      const estado = estadoCanonico_(e[3], estados);
      if (estado) conteo[estado] = (conteo[estado] || 0) + 1;
      equipos.push({
        etiqueta: (desc || 'Equipo sin descripción') + (serial ? ' · S/N ' + serial : ''),
        equipo: desc || 'Equipo sin descripción', serial: serial, estado: estado
      });
    });
    equipos.sort(function (a, b) { return a.etiqueta.localeCompare(b.etiqueta, 'es'); });

    const estadoDefecto = Object.keys(conteo).sort(function (a, b) { return conteo[b] - conteo[a]; })[0] || '';
    return {
      ok: true, contacto: reg.contacto,
      tel: { tiene: !!reg.tel, mascara: reg.tel ? maskTel_(reg.tel) : '' },
      correo: { tiene: !!reg.correo, mascara: reg.correo ? maskCorreo_(reg.correo) : '' },
      estado: estadoDefecto, equipos: equipos.slice(0, 300)
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ===================== PANEL ===================== */

function validarClave_(clave) {
  const real = propiedad_('CLAVE_PANEL');
  if (!real) throw new Error('Falta definir CLAVE_PANEL en las propiedades del script.');
  if (String(clave) !== real) {
    Utilities.sleep(1000);
    throw new Error('Clave incorrecta.');
  }
}

function panelLogin(clave) {
  try { validarClave_(clave); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

function getPanelData(clave) {
  try {
    validarClave_(clave);
    const ahora = Date.now(), limAlerta = HORAS_SIN_RESPUESTA * 36e5;
    const tickets = leer_('TICKETS').reverse().map(function (t) {
      const est = String(t['Estatus']);
      const abierto = ESTATUS_ABIERTOS.indexOf(est) >= 0;
      const fecha = ms_(t['Fecha']), lim = ms_(t['Fecha límite SLA']), atencion = ms_(t['Fecha de atencion']);
      return {
        id: String(t['ID_Ticket']), fecha: fmt_(t['Fecha']), fechaMs: fecha,
        cliente: String(t['Cliente']), contacto: String(t['Contacto']), telefono: String(t['Teléfono']),
        correo: String(t['Correo']), estado: String(t['Estado']), region: String(t['Región']),
        equipo: String(t['Equipo']), serial: String(t['Serial']), descripcion: String(t['Descripción']),
        prioridad: String(t['Prioridad']), tecnico: String(t['Técnico asignado'] || ''), estatus: est,
        solicitud: tipoDe_(t), perifericos: String(t['Periféricos'] || ''), licencia: String(t['Licencia'] || ''),
        limite: fmt_(t['Fecha límite SLA']), cierre: fmt_(t['Fecha cierre']), obs: String(t['Observaciones'] || ''),
        atencion: fmt_(t['Fecha de atencion']), sitio: String(t['Atencion en sitio'] || ''),
        visita: fmt_(t['Fecha de la visita']), garantia: String(t['Garantia'] || ''), alerta: fmt_(t[COL_ALERTA]),
        abierto: abierto,
        vencido: abierto && !!lim && lim < ahora,
        sinResp: abierto && ESTATUS_SIN_RESPUESTA.indexOf(est) >= 0 && !atencion && !!fecha && ahora - fecha >= limAlerta
      };
    });
    const tecnicos = leer_('TECNICOS').map(function (t) {
      return { nombre: String(t['Nombre']), region: String(t['Región']), activo: esActivo_(t), correo: !!String(t['Correo'] || '').trim() };
    });
    return { ok: true, tickets: tickets, tecnicos: tecnicos, estatus: ESTATUS, regiones: REGIONES, diasAlerta: HORAS_SIN_RESPUESTA / 24 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function actualizarTicket(clave, id, estatus, tecnico, nota) {
  let lock = null;
  try {
    validarClave_(clave);
    if (ESTATUS.indexOf(estatus) < 0) throw new Error('Estatus no válido.');

    let tec = null;
    if (tecnico) {
      tec = leer_('TECNICOS').filter(function (t) { return t['Nombre'] === tecnico; })[0];
      if (!tec) throw new Error('El técnico no existe en la hoja TECNICOS.');
    }

    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    const t = buscarTicket_(id);
    const antes = String(t['Estatus']);
    const sh = hoja_('TICKETS');

    // Coherencia entre técnico y estatus
    if (tec && estatus === 'Sin asignar') estatus = 'Asignado';
    if (!tec && estatus === 'Asignado') estatus = 'Sin asignar';

    const cerrado = ESTATUS_CERRADOS.indexOf(estatus) >= 0;
    const cambios = {
      'Técnico asignado': tec ? tec['Nombre'] : '', 'Correo técnico': tec ? tec['Correo'] : '', 'Estatus': estatus
    };
    if (cerrado && !aFecha_(t['Fecha cierre'])) cambios['Fecha cierre'] = new Date();
    if (!cerrado) cambios['Fecha cierre'] = '';

    nota = String(nota || '').trim().slice(0, 2000);
    if (nota) {
      const previo = String(t['Observaciones'] || '');
      const linea = '[' + fmt_(new Date()) + ' · Coordinación] ' + nota;
      cambios['Observaciones'] = seguro_(previo ? previo + '\n' + linea : linea);
    }
    escribir_(sh, t._fila, cambios);
    SpreadsheetApp.flush();
    lock.releaseLock();
    lock = null;

    const avisos = [];
    // Avisar al técnico si el caso cambió de responsable
    if (tec && tec['Correo'] && tec['Nombre'] !== t['Técnico asignado']) {
      try { enviarTecnico_(datosCorreo_(t), tec); avisos.push('técnico'); } catch (e) { console.error(e.message); }
    }
    if (estatus === 'Resuelto' && ESTATUS_CERRADOS.indexOf(antes) < 0) { notificarResuelto_(t); avisos.push('cliente'); }
    return { ok: true, estatus: estatus, avisos: avisos };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (lock) lock.releaseLock();
  }
}

// Reenvía el correo al técnico asignado y devuelve su enlace para copiarlo
function reenviarTecnico(clave, id, soloEnlace) {
  try {
    validarClave_(clave);
    const t = buscarTicket_(id);
    const enlace = enlaceTecnico_(String(t['ID_Ticket']));
    if (soloEnlace) return { ok: true, enlace: enlace, enviado: false };
    const nombre = String(t['Técnico asignado'] || '').trim();
    if (!nombre) throw new Error('El ticket no tiene técnico asignado.');
    const tec = leer_('TECNICOS').filter(function (x) { return x['Nombre'] === nombre; })[0] || {};
    const correo = String(tec['Correo'] || t['Correo técnico'] || '').trim();
    if (!correo) throw new Error('El técnico ' + nombre + ' no tiene correo en la hoja TECNICOS.');
    enviarTecnico_(datosCorreo_(t), { 'Correo': correo }, true);
    return { ok: true, enlace: enlace, enviado: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ===================== DASHBOARD ===================== */

// Tickets con fechas en milisegundos; las métricas se calculan en el navegador
function getDashboardData(clave) {
  try {
    validarClave_(clave);
    const tickets = leer_('TICKETS').map(function (t) {
      const fecha = aFecha_(t['Fecha']), atencion = aFecha_(t['Fecha de atencion']);
      return {
        id: String(t['ID_Ticket']), fecha: fecha ? fecha.getTime() : null,
        cliente: String(t['Cliente']), equipo: String(t['Equipo']), serial: String(t['Serial']),
        estado: String(t['Estado']), region: String(t['Región']), prioridad: String(t['Prioridad']),
        tecnico: String(t['Técnico asignado'] || ''), estatus: String(t['Estatus']), solicitud: tipoDe_(t),
        limite: ms_(t['Fecha límite SLA']), atencion: atencion ? atencion.getTime() : null,
        // Días calendario entre el reporte y la fecha de atención (0 = el mismo día)
        respDias: fecha && atencion ? Math.max(0, diaN_(atencion) - diaN_(fecha)) : null,
        cierre: ms_(t['Fecha cierre']), visita: ms_(t['Fecha de la visita']),
        garantia: String(t['Garantia'] || '').trim(), sitio: String(t['Atencion en sitio'] || '').trim(),
        alerta: ms_(t[COL_ALERTA])
      };
    });
    const tecnicos = leer_('TECNICOS').map(function (t) {
      return { nombre: String(t['Nombre']), region: String(t['Región']), activo: esActivo_(t) };
    });
    return {
      ok: true, ahora: Date.now(), tickets: tickets, tecnicos: tecnicos, regiones: REGIONES,
      abiertos: ESTATUS_ABIERTOS, sinRespuesta: ESTATUS_SIN_RESPUESTA, tipos: TIPOS_SOLICITUD,
      horasAlerta: HORAS_SIN_RESPUESTA, horasRepetir: HORAS_REPETIR_ALERTA,
      minutosRevision: MINUTOS_REVISION, alertasActivas: alertasActivas_()
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ===================== ALERTAS: CASOS SIN RESPUESTA ===================== */

function alertasActivas_() {
  return ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === 'revisarSinRespuesta'; });
}

// Lo ejecuta el activador cada MINUTOS_REVISION minutos
function revisarSinRespuesta() {
  const r = procesarAlertas_();
  console.log('Casos sin respuesta: ' + r.casos + '. Correos enviados: ' + r.enviadas + '.');
  return r;
}

function activarAlertas() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'revisarSinRespuesta') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('revisarSinRespuesta').timeBased().everyMinutes(MINUTOS_REVISION).create();
  const r = procesarAlertas_();
  SpreadsheetApp.getUi().alert('Alertas activadas: los casos se revisan cada ' + MINUTOS_REVISION + ' minutos.\n\n' +
    'Ahora mismo hay ' + r.casos + ' caso(s) con más de ' + (HORAS_SIN_RESPUESTA / 24) + ' días sin respuesta; ' +
    'se enviaron ' + r.enviadas + ' correo(s).');
}

function desactivarAlertas() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'revisarSinRespuesta') { ScriptApp.deleteTrigger(tr); n++; }
  });
  SpreadsheetApp.getUi().alert(n ? 'Alertas automáticas desactivadas.' : 'Las alertas automáticas ya estaban desactivadas.');
}

function revisarAlertasMenu() {
  const r = procesarAlertas_();
  SpreadsheetApp.getUi().alert(r.casos + ' caso(s) con más de ' + (HORAS_SIN_RESPUESTA / 24) + ' días sin respuesta.\n' +
    'Correos enviados ahora: ' + r.enviadas + '.' +
    (r.omitidas ? '\n' + r.omitidas + ' ya tenían un aviso de las últimas ' + HORAS_REPETIR_ALERTA + ' horas.' : '') +
    (r.sinCorreo ? '\n' + r.sinCorreo + ' sin técnico ni CORREO_ADMIN a quién avisar.' : ''));
}

// Botón "Enviar alertas ahora" del dashboard
function enviarAlertasAhora(clave) {
  try {
    validarClave_(clave);
    const r = procesarAlertas_();
    return { ok: true, casos: r.casos, enviadas: r.enviadas, omitidas: r.omitidas, sinCorreo: r.sinCorreo, ocupado: r.ocupado };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Avisa por cada caso abierto sin fecha de atención que pasó HORAS_SIN_RESPUESTA desde el reporte.
// El aviso se repite cada HORAS_REPETIR_ALERTA horas mientras siga sin respuesta.
function procesarAlertas_() {
  const r = { casos: 0, enviadas: 0, omitidas: 0, sinCorreo: 0, ocupado: false };
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) { r.ocupado = true; return r; }   // otra revisión está en curso
  try {
    const sh = hoja_('TICKETS');
    const col = asegurarColumna_(sh, COL_ALERTA);
    const ahora = new Date();
    const admin = propiedad_('CORREO_ADMIN');
    const correos = {};
    leer_('TECNICOS').forEach(function (t) { correos[String(t['Nombre'])] = String(t['Correo'] || '').trim(); });

    leer_('TICKETS').forEach(function (t) {
      if (ESTATUS_SIN_RESPUESTA.indexOf(String(t['Estatus'])) < 0 || aFecha_(t['Fecha de atencion'])) return;
      const fecha = aFecha_(t['Fecha']);
      if (!fecha) return;
      const horas = (ahora.getTime() - fecha.getTime()) / 36e5;
      if (horas < HORAS_SIN_RESPUESTA) return;
      r.casos++;

      const ultima = aFecha_(t[COL_ALERTA]);
      if (ultima && ahora.getTime() - ultima.getTime() < HORAS_REPETIR_ALERTA * 36e5) { r.omitidas++; return; }

      const tecnico = String(t['Técnico asignado'] || '').trim();
      const correoTec = String(t['Correo técnico'] || '').trim() || correos[tecnico] || '';
      try {
        if (!enviarAlerta_(t, Math.floor(horas / 24), tecnico, correoTec, admin)) { r.sinCorreo++; return; }
        sh.getRange(t._fila, col).setValue(ahora);
        r.enviadas++;
      } catch (e) {
        console.error('Alerta ' + t['ID_Ticket'] + ': ' + e.message);
      }
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return r;
}

function enviarAlerta_(t, dias, tecnico, correoTec, admin) {
  const id = String(t['ID_Ticket']);
  const asunto = '[' + EMPRESA + '] ALERTA: ticket ' + id + ' lleva ' + dias + ' días sin respuesta';
  const filas = [['Solicitud', tipoDe_(t)], ['Cliente', t['Cliente']], ['Contacto', t['Contacto'] + ' / ' + t['Teléfono']],
    ['Ubicación', t['Estado'] + ' (Región ' + t['Región'] + ')'],
    ['Equipo', t['Equipo'] + (t['Serial'] ? ' (serial ' + t['Serial'] + ')' : '')],
    ['Prioridad', t['Prioridad']], ['Reportado', fmt_(t['Fecha'])], ['Fecha límite', fmt_(t['Fecha límite SLA'])]];
  const bloque = { titulo: tituloBloque_(tipoDe_(t)), texto: t['Descripción'] };

  if (correoTec) {
    const link = enlaceTecnico_(id);
    const opciones = {
      to: correoTec, subject: asunto,
      htmlBody: correoHtml_({
        color: '#b3261e', titulo: 'Ticket ' + id + ': ' + dias + ' días sin respuesta',
        subtitulo: 'El caso sigue sin fecha de atención. Atiéndelo o registra la fecha de atención en el ticket.',
        filas: filas, bloque: bloque, boton: { texto: 'Abrir ticket', url: link }
      }),
      body: 'El ticket ' + id + ' lleva ' + dias + ' días sin respuesta.\nCliente: ' + t['Cliente'] +
        '\nEquipo: ' + t['Equipo'] + '\nPrioridad: ' + t['Prioridad'] + '\n\nAbrir ticket: ' + link
    };
    if (admin) opciones.cc = admin;
    MailApp.sendEmail(opciones);
    return true;
  }
  if (admin) {
    MailApp.sendEmail({
      to: admin, subject: asunto + (tecnico ? ' (el técnico no tiene correo)' : ' (SIN TÉCNICO)'),
      htmlBody: correoHtml_({
        color: '#b3261e', titulo: 'Ticket ' + id + ': ' + dias + ' días sin respuesta',
        subtitulo: tecnico ? 'El técnico ' + tecnico + ' no tiene correo en la hoja TECNICOS.' : 'El caso no tiene técnico asignado. Asígnalo desde el panel.',
        filas: filas, bloque: bloque, boton: { texto: 'Abrir panel', url: enlace_('panel') }
      }),
      body: 'El ticket ' + id + ' lleva ' + dias + ' días sin respuesta y no hay a quién avisar. Cliente: ' + t['Cliente']
    });
    return true;
  }
  return false;
}
