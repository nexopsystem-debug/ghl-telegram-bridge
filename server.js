const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const axios = require('axios');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://telegram.lmclinicxpress.com';
const CLIENT_ID = process.env.GHL_CLIENT_ID || '6a57c1698099a144df50c33b-mrmegr2k';
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || 'f75361c4-58ba-425f-a309-7f0ca5973505';
const CONVERSATION_PROVIDER_ID = process.env.GHL_CONVERSATION_PROVIDER_ID || '';

// ----------------------------------------------------
// BASE DE DATOS JSON (CERO DEPENDENCIAS NATIVAS)
// ----------------------------------------------------
const dbDir = path.resolve('/app/data');
const dbPath = path.join(dbDir, 'db.json');

let dbState = {
  ghl_credentials: [],
  telegram_bots: [],
  contacts_mapping: []
};

function loadDb() {
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      dbState = JSON.parse(raw);
    } else {
      saveDb();
    }
  } catch (e) {
    console.error("Error al cargar la BD JSON:", e);
  }
}

function saveDb() {
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    fs.writeFileSync(dbPath, JSON.stringify(dbState, null, 2), 'utf8');
  } catch (e) {
    console.error("Error al guardar la BD JSON:", e);
  }
}

async function dbGet(queryType, params) {
  loadDb();
  if (queryType === 'creds') {
    return dbState.ghl_credentials.find(c => c.location_id === params[0]);
  }
  if (queryType === 'bot_by_id') {
    return dbState.telegram_bots.find(b => b.bot_id === params[0]);
  }
  if (queryType === 'bot_by_token') {
    return dbState.telegram_bots.find(b => b.bot_token === params[0]);
  }
  if (queryType === 'bot_by_username') {
    const username = params[0].toLowerCase();
    const locId = params[1];
    return dbState.telegram_bots.find(b => b.bot_username.toLowerCase() === username && b.ghl_location_id === locId);
  }
  if (queryType === 'mapping_by_tg') {
    return dbState.contacts_mapping.find(m => m.telegram_chat_id === params[0] && m.location_id === params[1]);
  }
  if (queryType === 'mapping_by_ghl') {
    return dbState.contacts_mapping.find(m => m.ghl_contact_id === params[0] && m.location_id === params[1]);
  }
  return null;
}

async function dbAllBots(locationId) {
  loadDb();
  return dbState.telegram_bots
    .filter(b => b.ghl_location_id === locationId)
    .map(b => ({ id: b.bot_id, username: b.bot_username, name: b.bot_name }));
}

async function dbSaveCreds(location_id, access_token, refresh_token, expires_at) {
  loadDb();
  const index = dbState.ghl_credentials.findIndex(c => c.location_id === location_id);
  const credData = { location_id, access_token, refresh_token, expires_at };
  if (index > -1) {
    dbState.ghl_credentials[index] = credData;
  } else {
    dbState.ghl_credentials.push(credData);
  }
  saveDb();
}

async function dbSaveBot(bot_token, bot_username, bot_name, ghl_location_id) {
  loadDb();
  const bot_id = dbState.telegram_bots.length > 0 ? Math.max(...dbState.telegram_bots.map(b => b.bot_id)) + 1 : 1;
  dbState.telegram_bots.push({ bot_id, bot_token, bot_username, bot_name, ghl_location_id });
  saveDb();
  return bot_id;
}

async function dbSaveMapping(ghl_contact_id, telegram_chat_id, last_bot_id, location_id) {
  loadDb();
  dbState.contacts_mapping.push({ ghl_contact_id, telegram_chat_id, last_bot_id, location_id });
  saveDb();
}

async function dbUpdateMappingBot(ghl_contact_id, last_bot_id) {
  loadDb();
  const index = dbState.contacts_mapping.findIndex(m => m.ghl_contact_id === ghl_contact_id);
  if (index > -1) {
    dbState.contacts_mapping[index].last_bot_id = last_bot_id;
    saveDb();
  }
}

async function dbDeleteMapping(botId) {
  loadDb();
  dbState.contacts_mapping = dbState.contacts_mapping.filter(m => m.last_bot_id !== botId);
  saveDb();
}

async function dbDeleteBot(botId) {
  loadDb();
  dbState.telegram_bots = dbState.telegram_bots.filter(b => b.bot_id !== botId);
  saveDb();
}

// ----------------------------------------------------
// CLIENTE GOHIGHLEVEL (GHL)
// ----------------------------------------------------
async function getAccessToken(locationId) {
  const creds = await dbGet('creds', [locationId]);
  if (!creds) {
    throw new Error(`No se encontraron credenciales de GHL para la locaciÃ³n: ${locationId}`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (creds.expires_at - now < 300) {
    console.log(`Refrescando token para locaciÃ³n: ${locationId}...`);
    try {
      const response = await axios.post(
        'https://services.leadconnectorhq.com/oauth/token',
        new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: creds.refresh_token,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const data = response.data;
      const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
      await dbSaveCreds(locationId, data.access_token, data.refresh_token, expiresAt);
      return data.access_token;
    } catch (error) {
      console.error(`Error al refrescar token de GHL:`, error.response?.data || error.message);
      throw new Error(`FallÃ³ el refresco del token de GHL`);
    }
  }

  return creds.access_token;
}

async function createGHLContact(locationId, firstName, lastName, telegramUsername, telegramChatId) {
  const token = await getAccessToken(locationId);
  try {
    const fullName = `${firstName} ${lastName}`.trim();
    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      {
        firstName,
        lastName,
        name: fullName,
        tags: ['Telegram'],
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    );

    const contactId = response.data.contact.id;
    await axios.post(
      `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
      {
        body: `Contacto creado desde integraciÃ³n Telegram. Telegram Chat ID: ${telegramChatId}. Username: @${telegramUsername || 'sin_username'}`,
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Version': '2021-07-28',
          'Content-Type': 'application/json',
        },
      }
    ).catch(e => console.error("Error al crear nota en GHL:", e.message));

    return contactId;
  } catch (error) {
    console.error(`Error al crear contacto en GHL:`, error.response?.data || error.message);
    throw error;
  }
}

async function sendGHLInboundMessage(locationId, contactId, messageText) {
  const token = await getAccessToken(locationId);
  try {
    const response = await axios.post(
      'https://services.leadconnectorhq.com/conversations/messages/inbound',
      {
        type: 'SMS',
        contactId,
        message: messageText,
        conversationProviderId: CONVERSATION_PROVIDER_ID || 'PROVIDER_DE_PRUEBAS',
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Version': '2021-04-15',
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error(`Error al enviar mensaje entrante a GHL:`, error.response?.data || error.message);
    throw error;
  }
}

// ----------------------------------------------------
// CLIENTE TELEGRAM
// ----------------------------------------------------
async function getBotInfo(token) {
  const response = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
  if (response.data.ok) {
    return {
      username: response.data.result.username,
      first_name: response.data.result.first_name,
    };
  } else {
    throw new Error("Token de bot no vÃ¡lido");
  }
}

async function setBotWebhook(token, botId, baseUrl) {
  const webhookUrl = `${baseUrl}/webhooks/telegram/${botId}`;
  const response = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
    url: webhookUrl,
  });
  return response.data.ok;
}

async function sendTelegramMessage(token, chatId, text) {
  const response = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: text,
  });
  return response.data.ok;
}

// ----------------------------------------------------
// EXPRESS SERVER SETUP
// ----------------------------------------------------
app.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Middleware para verificar la firma de GHL
function verifyGHLSignature(req, res, next) {
  const signature = req.headers['x-ghl-signature'];
  const publicKey = process.env.GHL_PUBLIC_KEY;

  if (!publicKey) {
    return next();
  }

  if (!signature) {
    return res.status(401).json({ error: 'Firma de GHL faltante' });
  }

  try {
    const isVerified = crypto.verify(
      null,
      req.rawBody,
      {
        key: publicKey,
        format: 'der',
        type: 'spki',
      },
      Buffer.from(signature, 'hex')
    );

    if (isVerified) {
      next();
    } else {
      res.status(401).json({ error: 'Firma de GHL invÃ¡lida' });
    }
  } catch (error) {
    console.error('Error verificando la firma de GHL:', error);
    res.status(401).json({ error: 'Error de verificaciÃ³n de firma' });
  }
}

// 1. RUTAS DE INSTALACIÃ“N Y OAUTH GHL
app.get('/oauth/install', (req, res) => {
  const redirectUri = encodeURIComponent(`${BASE_URL}/oauth/callback`);
  const scopes = encodeURIComponent(
    'conversations/message.write conversations/message.readonly contacts.write contacts.readonly'
  );
  const consentUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=${redirectUri}&client_id=${CLIENT_ID}&scope=${scopes}`;
  res.redirect(consentUrl);
});

app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('CÃ³digo de autorizaciÃ³n faltante.');
  }

  try {
    console.log("Iniciando intercambio de token en oauth/callback. Query params:", JSON.stringify(req.query));
    const response = await axios.post(
      'https://services.leadconnectorhq.com/oauth/token',
      new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: `${BASE_URL}/oauth/callback`,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const data = response.data;
    console.log("Respuesta de intercambio de token de GHL:", JSON.stringify(data));
    const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    const locationId = data.locationId || req.query.locationId;

    if (!locationId) {
      throw new Error("No se pudo obtener el locationId del token de GHL ni de los parÃ¡metros de consulta");
    }

    console.log("Registrando credenciales para locationId:", locationId);
    await dbSaveCreds(locationId, data.access_token, data.refresh_token, expiresAt);
    res.redirect(`/index.html?locationId=${locationId}`);
  } catch (error) {
    console.error('Error en callback OAuth GHL:', error.response?.data || error.message);
    res.status(500).send('Error durante la autorizaciÃ³n de GoHighLevel.');
  }
});

// 2. WEBHOOKS DE MENSAJERÃA
app.post('/webhooks/telegram/:botId', async (req, res) => {
  const botId = parseInt(req.params.botId);
  const update = req.body;

  res.status(200).send('OK');

  if (!update.message || !update.message.text) {
    return;
  }

  const { chat, from, text } = update.message;
  const telegramChatId = chat.id;
  const firstName = from.first_name || 'Telegram';
  const lastName = from.last_name || 'User';
  const telegramUsername = from.username || '';

  try {
    const bot = await dbGet('bot_by_id', [botId]);
    if (!bot) {
      console.error(`Mensaje recibido en bot ID ${botId} que no existe en BD`);
      return;
    }

    const { ghl_location_id, bot_name } = bot;
    let contactMapping = await dbGet('mapping_by_tg', [telegramChatId, ghl_location_id]);
    let ghlContactId;

    if (!contactMapping) {
      console.log(`Creando nuevo contacto en GHL para chat Telegram: ${telegramChatId}...`);
      ghlContactId = await createGHLContact(
        ghl_location_id,
        firstName,
        lastName,
        telegramUsername,
        telegramChatId
      );

      await dbSaveMapping(ghlContactId, telegramChatId, botId, ghl_location_id);
    } else {
      ghlContactId = contactMapping.ghl_contact_id;
      await dbUpdateMappingBot(ghlContactId, botId);
    }

    const botLabel = bot_name ? `[Bot: ${bot_name}]` : '[Telegram Bot]';
    const userLabel = telegramUsername ? `@${telegramUsername}` : firstName;
    const formattedMessage = `${botLabel} ${userLabel}: ${text}`;

    await sendGHLInboundMessage(ghl_location_id, ghlContactId, formattedMessage);
  } catch (error) {
    console.error('Error al procesar mensaje de Telegram hacia GHL:', error.message);
  }
});

app.post('/webhooks/ghl/outbound', verifyGHLSignature, async (req, res) => {
  const outboundEvent = req.body;

  res.status(200).json({ success: true });

  if (outboundEvent.type !== 'OutboundMessage') {
    return;
  }

  const { locationId, contactId, body } = outboundEvent;

  try {
    const mapping = await dbGet('mapping_by_ghl', [contactId, locationId]);
    if (!mapping) {
      console.error(`No hay mapeo de Telegram registrado para el contacto de GHL: ${contactId}`);
      return;
    }

    const { telegram_chat_id, last_bot_id } = mapping;
    let targetBotId = last_bot_id;
    let cleanBody = body.trim();

    if (cleanBody.startsWith('/')) {
      const spaceIndex = cleanBody.indexOf(' ');
      if (spaceIndex > 0) {
        const requestedBotName = cleanBody.substring(1, spaceIndex).toLowerCase();
        const messageContent = cleanBody.substring(spaceIndex + 1).trim();

        const botByName = await dbGet('bot_by_username', [requestedBotName, locationId]);
        if (botByName) {
          targetBotId = botByName.bot_id;
          cleanBody = messageContent;
          await dbUpdateMappingBot(contactId, targetBotId);
        }
      }
    }

    const bot = await dbGet('bot_by_id', [targetBotId]);
    if (!bot) {
      console.error(`Bot ID ${targetBotId} no encontrado para despachar el mensaje`);
      return;
    }

    await sendTelegramMessage(bot.bot_token, telegram_chat_id, cleanBody);
  } catch (error) {
    console.error('Error al procesar mensaje de GHL hacia Telegram:', error.message);
  }
});

// 3. APIS DE CONFIGURACIÃ“N DEL PANEL
app.post('/api/bots', async (req, res) => {
  const { botToken, locationId } = req.body;
  console.log("POST /api/bots recibido con locationId:", locationId);
  if (!botToken || !locationId || locationId === 'undefined') {
    return res.status(400).json({ error: 'Token de Bot y Location ID son obligatorios y vÃ¡lidos.' });
  }

  try {
    const info = await getBotInfo(botToken);
    console.log("InformaciÃ³n del bot obtenida de Telegram:", JSON.stringify(info));
    const botId = await dbSaveBot(botToken, info.username, info.first_name, locationId);
    const setupWebhook = await setBotWebhook(botToken, botId, BASE_URL);
    console.log(`Bot registrado con ID ${botId}. Webhook configurado: ${setupWebhook}`);

    res.json({
      success: true,
      message: 'Bot registrado con Ã©xito.',
      bot: {
        id: botId,
        username: info.username,
        name: info.first_name,
        webhookConfigured: setupWebhook
      }
    });
  } catch (error) {
    console.error("Error al registrar bot:", error.message);
    res.status(500).json({ error: error.message || 'Error al registrar el bot.' });
  }
});

app.get('/api/bots', async (req, res) => {
  const locationId = req.query.locationId;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId es obligatorio.' });
  }

  try {
    const bots = await dbAllBots(locationId);
    res.json({ success: true, bots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/bots/:botId', async (req, res) => {
  const botId = parseInt(req.params.botId);
  const locationId = req.query.locationId;

  if (!locationId) {
    return res.status(400).json({ error: 'locationId es obligatorio.' });
  }

  try {
    const bot = await dbGet('bot_by_id', [botId]);
    if (!bot) {
      return res.status(404).json({ error: 'Bot no encontrado.' });
    }

    await axios.post(`https://api.telegram.org/bot${bot.bot_token}/deleteWebhook`).catch(e => {
      console.warn("No se pudo remover el webhook en Telegram:", e.message);
    });

    await dbDeleteMapping(botId);
    await dbDeleteBot(botId);

    res.json({ success: true, message: 'Bot eliminado con Ã©xito.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/debug-db', (req, res) => {
  loadDb();
  res.json(dbState);
});

const startServer = async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Servidor de IntegraciÃ³n GHL-Telegram escuchando en puerto ${PORT}`);
    });
  } catch (error) {
    console.error('Error al inicializar la base de datos o arrancar el servidor:', error);
    process.exit(1);
  }
};

startServer();
