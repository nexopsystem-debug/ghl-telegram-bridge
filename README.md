# IntegraciÃ³n Multi-Bot de Telegram con GoHighLevel (GHL)

Esta aplicaciÃ³n permite conectar mÃºltiples bots de Telegram y enrutar todas sus conversaciones hacia la bandeja de entrada unificada de **GoHighLevel**. Los agentes pueden responder directamente desde GHL seleccionando a quÃ© bot enviar la respuesta mediante prefijos o comandos en el chat.

---

## ðŸ› ï¸ ConfiguraciÃ³n en el Developer Marketplace de GHL

Para que esta aplicaciÃ³n pueda autenticar e interactuar con GoHighLevel, debes configurar tu aplicaciÃ³n en el marketplace con las siguientes especificaciones:

### 1. Permisos (OAuth Scopes)
En la secciÃ³n **Scopes** de tu aplicaciÃ³n en GHL, asegÃºrate de activar los siguientes permisos obligatorios:
*   `conversations/message.write` (Para enviar mensajes outbound e inbound)
*   `conversations/message.readonly` (Para leer flujos de mensajes)
*   `contacts.write` (Para crear nuevos contactos cuando escriban de Telegram)
*   `contacts.readonly` (Para buscar contactos existentes)
*   `notes.write` (Para asociar informaciÃ³n de Telegram al contacto como notas de GHL)

### 2. URL de RedirecciÃ³n (Redirect URI)
En la secciÃ³n **Auth** de tu aplicaciÃ³n, configura la siguiente URL de redirecciÃ³n:
`https://telegram.lmclinicxpress.com/oauth/callback`

### 3. Configurar el Conversation Provider
En la configuraciÃ³n de tu aplicaciÃ³n del Marketplace, habilita la capacidad de **Conversation Provider**:
*   **Provider Name:** `Telegram Integration` (o el nombre que gustes)
*   **Type:** `SMS` (Esta es la vÃ­a estÃ¡ndar recomendada por GHL para enrutar mensajerÃ­a customizada por canales numÃ©ricos/bots)
*   **Delivery URL (Outbound Webhook):** `https://telegram.lmclinicxpress.com/webhooks/ghl/outbound`
    *   *GHL enviarÃ¡ todas las respuestas escritas por los agentes en la bandeja de entrada a este webhook.*

Una vez creado, copia el **`conversationProviderId`** (ID de Proveedor) que te genere GHL. Lo necesitarÃ¡s para la variable de entorno `GHL_CONVERSATION_PROVIDER_ID`.

---

## ðŸš€ Despliegue en Dokploy

### Paso 1: Configurar Variables de Entorno en Dokploy
Al crear la aplicaciÃ³n de tipo Compose o Docker en Dokploy dentro del proyecto **LM Clinic Express**, configura las siguientes variables en la secciÃ³n de Variables de Entorno:

```env
PORT=3000
BASE_URL=https://telegram.lmclinicxpress.com
GHL_CLIENT_ID=6a57c1698099a144df50c33b-mrmegr2k
GHL_CLIENT_SECRET=f75361c4-58ba-425f-a309-7f0ca5973505
GHL_CONVERSATION_PROVIDER_ID=TU_CONVERSATION_PROVIDER_ID_AQUI
GHL_PUBLIC_KEY=LLAVE_PUBLICA_ED25519_DE_GHL_AQUI (Opcional, para verificar firmas)
```

### Paso 2: Conectar el Repositorio y Desplegar
1. Sube este cÃ³digo a tu repositorio de GitHub.
2. En Dokploy, agrega un servicio **Compose** o **Application** usando el repositorio de GitHub.
3. Configura el subdominio en Dokploy: `telegram.lmclinicxpress.com` apuntando al puerto `3000`.
4. Â¡Despliega!

---

## ðŸ“ˆ Flujo de Uso

1. **InstalaciÃ³n:** Accede a `https://telegram.lmclinicxpress.com/oauth/install` para autorizar la aplicaciÃ³n en tu subcuenta de GHL.
2. **Dashboard de Bots:** SerÃ¡s redirigido a `https://telegram.lmclinicxpress.com/index.html?locationId=TU_LOCATION_ID`.
3. **Vincular Bots:** Ingresa los Tokens de los Bots de Telegram creados en `@BotFather` para vincularlos. El sistema automÃ¡ticamente configurarÃ¡ el webhook de cada bot con Telegram.
4. **MensajerÃ­a Inbound:** Cuando un cliente escribe a cualquiera de los bots de Telegram, el sistema buscarÃ¡ si el cliente existe en GHL (mediante base de datos local). Si no, lo crea y guarda el chat ID. El mensaje aparecerÃ¡ en GHL marcado con la etiqueta `[Bot: NombreBot]`.
5. **MensajerÃ­a Outbound (Responder desde GHL):**
    *   **AutomÃ¡tico:** Si escribes normalmente en el chat de GHL, el sistema responderÃ¡ a travÃ©s del **Ãºltimo bot** con el que interactuÃ³ el usuario.
    *   **Elegir Bot EspecÃ­fico:** Puedes forzar la salida por un bot especÃ­fico iniciando tu mensaje con un comando que contenga el nombre de usuario del bot (sin @ y en minÃºsculas). Ejemplo:
        `/clinicbot Hola, este es un mensaje desde Clinic Bot`
        El sistema detectarÃ¡ `/clinicbot`, removerÃ¡ el comando y enviarÃ¡ "Hola, este es un mensaje..." a travÃ©s de ese bot.
