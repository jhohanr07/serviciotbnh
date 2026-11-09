/* Utilidades compartidas · Servicio Técnico 2 · BNH Medical */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Llamada al backend: Vercel (/api/rpc) reenvía a Apps Script, que lee y escribe el Sheet
async function api(fn, ...args) {
  let r;
  try {
    r = await fetch('/api/rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fn: fn, args: args })
    });
  } catch (e) { throw new Error('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.'); }
  let data = null;
  try { data = await r.json(); } catch (e) {}
  if (!data) throw new Error('El servidor no respondió correctamente (' + r.status + ').');
  return data;
}

// Estado de carga de un botón: conserva el ancho y el texto original
function ocupado(btn, on, texto) {
  if (!btn) return;
  if (on) {
    if (!btn.dataset.txt) btn.dataset.txt = btn.textContent;
    btn.style.minWidth = btn.offsetWidth + 'px';
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    if (texto) btn.textContent = texto;
  } else {
    btn.disabled = false; btn.removeAttribute('aria-busy');
    if (btn.dataset.txt) btn.textContent = btn.dataset.txt;
    delete btn.dataset.txt; btn.style.minWidth = '';
  }
}

// Aviso flotante breve
function aviso(msg, tipo) {
  let box = $('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts'; box.className = 'toasts';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + (tipo || 'ok'); el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 4500);
}

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch (e) {
    const t = document.createElement('textarea');
    t.value = texto; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (_) {}
    t.remove(); return ok;
  }
}

// Clave del panel en la sesión de la pestaña (se borra al cerrarla)
const Sesion = {
  get() { try { return sessionStorage.getItem('st2_clave') || ''; } catch (e) { return ''; } },
  set(v) { try { sessionStorage.setItem('st2_clave', v); } catch (e) {} },
  clear() { try { sessionStorage.removeItem('st2_clave'); } catch (e) {} }
};

const horaCorta = () => new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
const clsEstatus = { 'Sin asignar': 's-sin', 'Asignado': 's-asig', 'En reparación': 's-rep', 'Esperando repuesto': 's-rpto', 'Resuelto': 's-res', 'Cerrado': 's-res' };
const badge = e => '<span class="badge ' + (clsEstatus[e] || 's-rpto') + '">' + esc(e) + '</span>';
const clsPri = p => p === 'P1' ? 'p1' : p === 'P2' ? 'p2' : '';
