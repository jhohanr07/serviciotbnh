# Servicio Técnico 2 · BNH Medical

Sistema de tickets de servicio técnico: formulario para clientes, consulta de estado, ficha del técnico, panel de coordinación y dashboard.

- **Páginas:** Vercel (este repositorio).
- **Datos:** el Google Sheet `Sistema_Tickets_Servicio_Tecnico`, a través de Google Apps Script.
- **Sin claves JSON:** el Apps Script se ejecuta como tú y Vercel solo le habla con un token secreto.

```
Navegador ──► Vercel (/ , /estado, /panel, /dashboard, /tecnico, /tecnicos)
                 │
                 └─► /api/rpc  ──POST + API_TOKEN──►  Apps Script (doPost)  ──►  Google Sheet
                                                         └─ correos (MailApp) y alertas automáticas
```

## Estructura

```
public/                 Páginas que publica Vercel
  index.html            Formulario (/), consulta de estado (/estado) y panel (/panel)
  dashboard.html        Dashboard (/dashboard)
  tecnico.html          Ficha del técnico (/tecnico?id=…&t=…)
  tecnicos.html         Panel de cada técnico (/tecnicos): entra con su correo + código
  assets/estilos.css    Sistema de diseño
  assets/comun.js       Utilidades y llamada a la API
api/rpc.js              Puente Vercel → Apps Script (agrega el token)
apps-script/Code.gs     Backend: se pega en el editor de Apps Script del Sheet
apps-script/appsscript.json  Manifiesto (zona horaria, acceso de la web app)
vercel.json             Rutas limpias, cabeceras de seguridad, tiempo máximo de la función
.env.example            Variables que hay que cargar en Vercel
```

---

## Paso a paso

### 1. Backend en Apps Script (en el Sheet)

1. Abre el Sheet **Sistema_Tickets_Servicio_Tecnico** → **Extensiones → Apps Script**.
2. Reemplaza todo el contenido de `Code.gs` por el de `apps-script/Code.gs`.
3. Ve a **Configuración del proyecto** (engranaje) y activa **Mostrar el archivo de manifiesto "appsscript.json"**. Vuelve al editor, abre `appsscript.json` y reemplázalo por el de este repositorio.
4. Los archivos `Index`, `Tecnico`, `Dashboard`, `Estilos` y `Comun` ya no se usan. Puedes borrarlos cuando Vercel esté funcionando.
5. En **Configuración del proyecto → Propiedades del script**, confirma o agrega:
   - `CLAVE_PANEL`: la clave del panel y del dashboard.
   - `CORREO_ADMIN` (opcional): copia de alertas y casos sin técnico.
6. Guarda y recarga el Sheet. En el menú **Servicio técnico → Generar token para Vercel**, autoriza los permisos y **copia el token**.
7. **Implementar → Gestionar implementaciones → ✏️ Editar** la implementación que ya tienes → **Versión: Nueva versión**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**

   Pulsa **Implementar** y **copia la URL que termina en `/exec`**. Si no tenías ninguna, usa **Nueva implementación → Aplicación web**.

> Si editas la implementación existente, la URL `/exec` no cambia. Así los enlaces de correos viejos siguen funcionando y redirigen solos a Vercel.

### 2. Subir a GitHub

**Opción A: desde la web (sin instalar nada)**
1. Entra a GitHub con tu cuenta **jhohanr07** → **New repository**.
2. Nombre: `servicio-tecnico2`, visibilidad **Private**, sin README → **Create repository**.
3. Pulsa **uploading an existing file** y arrastra **el contenido** de esta carpeta: `api`, `apps-script`, `public`, `vercel.json`, `package.json`, `README.md`, `.gitignore` y `.env.example`. Si los archivos que empiezan con punto no se ven, actívalos en tu explorador o súbelos aparte.
4. **Commit changes**.

**Opción B: con Git en tu PC**
```bash
cd servicio-tecnico2
git init
git add .
git commit -m "Servicio Técnico 2: Vercel + Apps Script"
git branch -M main
git remote add origin https://github.com/jhohanr07/servicio-tecnico2.git
git push -u origin main
```

### 3. Desplegar en Vercel

1. Entra a [vercel.com](https://vercel.com) con GitHub → **Add New… → Project** → importa `servicio-tecnico2`.
2. **Framework Preset:** `Other`. Deja vacíos Build Command e Install Command; el directorio de salida (`public`) ya viene en `vercel.json`.
3. Abre **Environment Variables** y agrega:

   | Nombre | Valor |
   |---|---|
   | `APPS_SCRIPT_URL` | La URL `/exec` del paso 1.7 |
   | `API_TOKEN` | El token del paso 1.6 |

4. **Deploy**. Al terminar, copia tu dominio, por ejemplo `https://servicio-tecnico2.vercel.app`.

### 4. Conectar los correos con Vercel

En Apps Script → **Propiedades del script** agrega:

| Propiedad | Valor |
|---|---|
| `URL_APP` | Tu dominio de Vercel, **sin barra al final** (ej. `https://servicio-tecnico2.vercel.app`) |

Las propiedades no necesitan una nueva implementación: se aplican al instante.

### 5. Probar

- `https://TU-DOMINIO/`: crea un ticket de prueba.
- Revisa los correos: el del técnico debe abrir `https://TU-DOMINIO/tecnico?id=…`.
- `https://TU-DOMINIO/estado`: consulta con el número de ticket y el correo.
- `https://TU-DOMINIO/panel` y `/dashboard`: entra con `CLAVE_PANEL`.
- En el Sheet: **Servicio técnico → Ver enlaces de la aplicación** muestra todas las rutas.

Las alertas automáticas siguen funcionando igual (activador de Apps Script): **Servicio técnico → Activar alertas automáticas**.

---

## Cómo actualizar después

| Qué cambias | Qué hacer |
|---|---|
| Algo en `public/` o `api/` | `git push` (o sube el archivo en GitHub). Vercel despliega solo. |
| `apps-script/Code.gs` | Pégalo en el editor → **Gestionar implementaciones → Editar → Nueva versión**. |
| El token | Menú **Generar token para Vercel** → actualiza `API_TOKEN` en Vercel → **Redeploy**. |

## Problemas frecuentes

| Mensaje | Causa y solución |
|---|---|
| *Falta configurar APPS_SCRIPT_URL o API_TOKEN en Vercel* | Faltan las variables. Agrégalas y haz **Redeploy** (las variables solo aplican a despliegues nuevos). |
| *No autorizado: … huella X … huella Y* | El `API_TOKEN` de Vercel y el del script son distintos. Menú **Generar token para Vercel → Sí** (ver el actual), pega ese valor en Vercel y haz **Redeploy**. Cuando las dos huellas coincidan, funciona. |
| *El backend no respondió bien…* | La implementación no tiene acceso **Cualquier persona**, o no publicaste una **Nueva versión** después de pegar el código. |
| *Falta URL_APP…* al crear un ticket | Agrega `URL_APP` en las propiedades del script (paso 4). |
| Enlaces del correo abren Apps Script | `URL_APP` vacío o con la URL `/exec`; debe ser el dominio de Vercel. |
| *Apps Script necesita permisos* | En el editor elige la función `autorizar` → ▶ Ejecutar → acepta → publica **Nueva versión**. |
| *código repetido* | Hay dos archivos `.gs` con el mismo código: deja solo `Code.gs`. |
| `404 DEPLOYMENT_NOT_FOUND` al abrir el botón del correo | `URL_APP` apunta a un dominio que ya no existe. Copia el dominio de **Vercel → proyecto → Settings → Domains** en la propiedad `URL_APP` (sin barra final) y reenvía el correo desde el panel. |
| El técnico no recibe el código de `/tecnicos` | Su correo no está en la hoja TECNICOS o la columna Activo no dice `SI`. |
| *Demasiados intentos* | Límite por minuto del puente (`api/rpc.js` → `LIMITES`). |

## Seguridad

- El `API_TOKEN` vive solo en Vercel y en las propiedades del script; nunca llega al navegador.
- `api/rpc.js` y `doPost` solo aceptan una lista cerrada de funciones.
- No guardes claves en celdas del Sheet: cualquiera con acceso al archivo las vería.
- La ficha del técnico usa un enlace firmado (HMAC) por ticket.
- El panel `/tecnicos` pide un código de 6 dígitos que llega al correo del técnico (vence en 10 minutos, máximo 5 intentos). La sesión dura 7 días en ese navegador.
