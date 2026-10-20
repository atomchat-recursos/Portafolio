# Entre amigos

Agendador en español para GitHub Pages, con Google Apps Script como servicio de Calendar y Sheets. Conserva `matriz.html`.

## Estado y uso local

Requiere Node.js 22+ para las pruebas y Python 3 para servir los archivos. No necesita instalar dependencias.

```sh
cd /workspace/Portafolio
npm test
npm start
```

Sin URL en `config.js`, el formulario muestra el aviso de conexión pendiente y no inventa disponibilidad ni confirma reservas. La integración real requiere el despliegue autorizado por la persona propietaria de Google.

## Conectar tu cuenta de Google

1. Crea un proyecto en [Google Apps Script](https://script.google.com/home/start), copia `google/Code.gs` a `Code.gs`, y en Configuración activa la visualización de `appsscript.json`; reemplaza su contenido por `google/appsscript.json`. El manifiesto habilita el servicio avanzado Calendar v3. Si usas un proyecto de Google Cloud propio, habilita también Google Calendar API allí.
2. En el selector de funciones del editor, elige **inicializarAgenda** y pulsa **Ejecutar**. Autoriza con tu cuenta de Google. La función crea un calendario **Entre amigos · Encuentros** y una hoja **Entre amigos · Registro de citas**, sin publicarlos ni compartirlos. Guarda automáticamente sus IDs en las propiedades del proyecto. En el registro de ejecución aparece el enlace de la hoja; el calendario aparece en Google Calendar. Esta creación solo sucede al ejecutar la función autorizada, no al abrir el formulario público.
3. También configura `BUSY_CALENDAR_IDS` con tu calendario principal y el nuevo calendario. Así tus compromisos existentes bloquean disponibilidad, y las nuevas reservas se escriben solo en **Entre amigos · Encuentros**. Si necesitas considerar otros calendarios, añade sus IDs al arreglo JSON de esa propiedad. No se consultan automáticamente todos los calendarios de tu cuenta.
4. Puedes volver a ejecutar **inicializarAgenda**: conserva los recursos que ya tengan IDs guardados y las filas existentes. No borres las propiedades para reintentar. Si prefieres recursos existentes, configura primero `CALENDAR_ID` y `SPREADSHEET_ID` en las propiedades del proyecto; la función los reutilizará.
5. En **Implementar → Nueva implementación → Aplicación web**, selecciona **Ejecutar como: yo** y **Quién tiene acceso: cualquier usuario**. Algunas organizaciones impiden aplicaciones públicas; en ese caso necesitarás que su administrador lo permita o un backend con autenticación. No publiques un despliegue que requiera inicio de sesión para este frontend.
6. Copia la URL que termina en `/exec` a `apiUrl` en `config.js`, confirma ese archivo y publícalo. La URL es pública y no debe contener tokens. Al cambiar código de Apps Script, actualiza la implementación a una versión nueva.
7. Comprueba desde la web publicada que se cargan horarios. Haz una reserva real y verifica un evento en el nuevo calendario y una fila **CONFIRMADA** en la nueva hoja. Bloquea un horario en tu calendario principal y comprueba que desaparezca de la lista. Las reservas de prueba crean datos reales: elimínalos manualmente si corresponde.

La comunicación usa GET para disponibilidad y POST `text/plain` para reservar, sin preflight CORS. Google entrega JSON mediante redirección a `script.googleusercontent.com`. La prueba desde el dominio publicado es obligatoria: políticas de cuenta o restricciones del navegador pueden impedir acceso. No se ha validado esa integración con una cuenta real sin su autorización.

## Publicar en GitHub

El workflow `.github/workflows/pages.yml` prueba el código y despliega únicamente archivos públicos cuando cambia `main`. En **Settings → Pages → Build and deployment → Source**, selecciona **GitHub Actions**. Ejecuta el workflow si ya habías subido el código. GitHub mostrará la dirección definitiva cuando termine correctamente. Apps Script sigue alojado en Google; GitHub Pages solo sirve el sitio estático y no guarda credenciales.

## Reglas y consistencia

- Zona horaria fija: **America/Lima (UTC−5)**.
- Lunes–viernes: 17:00–22:00. Sábado–domingo: 10:00–22:00.
- Duración: **60 minutos**; inicios cada 30 minutos. Último inicio: 21:00. No se ofrecen horas pasadas ni fechas a más de un año.
- Calendar Freebusy considera eventos recurrentes, eventos de todo el día y transparencia del calendario.
- Se valida todo en el servidor; un bloqueo de Apps Script serializa reservas del formulario y vuelve a consultar la disponibilidad antes de crear el evento.
- Un ID por solicitud y un ID determinista de evento evitan duplicados al reintentar. Una fila PENDIENTE sirve para recuperar una creación parcial. Si una solicitud dio error y cambias sus datos, recarga primero para obtener un identificador nuevo. No se promete una transacción atómica entre Google Calendar y Sheets.
- Ediciones directas del calendario y otros sistemas no participan en el bloqueo: podrían introducir conflictos durante una reserva. Revisa el calendario si lo modificas desde varias aplicaciones al mismo tiempo.
- Datos escritos como texto para evitar fórmulas en la hoja. No se publican detalles de otros eventos ni los datos de las reservas.
- No se envían invitaciones ni correos automáticos a visitantes. Se muestra la confirmación en pantalla.
- El endpoint es público: quien tenga su URL puede solicitar reservas dentro de las reglas. Antes de difusión masiva, incorpora CAPTCHA con validación en servidor, controles contra abuso y una política de privacidad apropiada. Hay cuotas de Apps Script y Google APIs; no está diseñado para reservas masivas.

## Verificación

`npm test` ejecuta pruebas del backend real mediante dobles de las APIs de Google: horarios, fines de semana, solapes, fecha/hora, validación, reservas, recuperación de fallos e idempotencia. No sustituye una prueba real autorizada de Calendar/Sheets ni la publicación de Pages.
