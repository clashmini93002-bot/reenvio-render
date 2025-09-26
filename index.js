const { Telegraf } = require('telegraf');
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Access environment variables
const botToken = process.env.BOT_TOKEN;
const sourceChannelId = Number(process.env.SOURCE_CHANNEL_ID);
const destinationGroupId = Number(process.env.DESTINATION_GROUP_ID);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL; // URL proporcionada por Render
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(botToken);
const app = express();

// Middleware para parsear JSON
app.use(express.json());

// Webhook endpoint para Telegram
app.post(`/webhook/${botToken}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// Self-ping endpoint para mantener el bot activo
app.get('/ping', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Iniciar servidor web
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Función para hacer self-ping cada 5 minutos
const startSelfPing = () => {
  setInterval(async () => {
    try {
      if (RENDER_EXTERNAL_URL) {
        const response = await fetch(`${RENDER_EXTERNAL_URL}/ping`);
        console.log(`Self-ping realizado: ${response.status} - ${new Date().toISOString()}`);
      }
    } catch (error) {
      console.error('Error en self-ping:', error);
    }
  }, 5 * 60 * 1000); // 5 minutos
};

// Handler for /start command
bot.start((ctx) => {
  ctx.reply('¡El bot está en línea y listo para funcionar!');
  console.log('Bot has started and is ready to forward messages.');
});

// Nueva función para extraer el nombre antes del guion
const extractNameBeforeDash = (text) => {
  if (!text) return null;
  
  // Buscar el primer texto antes del guion
  const match = text.match(/^([^-]+)(?=-)|#(\w+)/);
  
  if (match) {
    // Si encuentra un hashtag, lo usa
    if (match[2]) {
      return `#${match[2]}`;
    }
    // Si encuentra texto antes del guion, lo limpia y usa como hashtag
    if (match[1]) {
      const name = match[1].trim();
      // Limpiar caracteres no válidos para hashtag
      const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '');
      return cleanName ? `#${cleanName}` : null;
    }
  }
  
  return null;
};

// Función para extraer nombre de archivos/documents
const extractNameFromFilename = (filename) => {
  if (!filename) return null;
  
  // Extraer el nombre antes del primer guion
  const match = filename.match(/^([^-]+)/);
  if (match) {
    const name = match[1].trim();
    // Limpiar y convertir a formato hashtag
    const cleanName = name.replace(/[^a-zA-Z0-9_]/g, '');
    return cleanName ? `#${cleanName}` : null;
  }
  
  return null;
};

// Función para obtener el nombre de clasificación del mensaje
const getClassificationName = (message) => {
  // Para mensajes de texto con enlaces o texto normal
  if (message.text) {
    return extractNameBeforeDash(message.text);
  }
  
  // Para mensajes con caption (fotos, videos, etc.)
  if (message.caption) {
    return extractNameBeforeDash(message.caption);
  }
  
  // Para documentos/archivos
  if (message.document && message.document.file_name) {
    return extractNameFromFilename(message.document.file_name);
  }
  
  // Para fotos con nombre de archivo (aunque es raro)
  if (message.photo && message.photo.length > 0 && message.photo[0].file_name) {
    return extractNameFromFilename(message.photo[0].file_name);
  }
  
  return null;
};

// Function to check if chat is a forum
const isForumGroup = async () => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId
      })
    });

    const data = await response.json();
    return data.ok && data.result.is_forum === true;
  } catch (error) {
    console.error('Error checking if group is forum:', error);
    return false;
  }
};

// Function to create a new topic in the group (only if it's a forum)
const createTopic = async (topicName) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId,
        name: topicName
      })
    });

    const data = await response.json();
    if (data.ok) {
      return data.result.message_thread_id;
    } else {
      throw new Error(data.description);
    }
  } catch (error) {
    console.error('Error creating topic:', error);
    throw error;
  }
};

// Function to get existing topics in the group
const getForumTopics = async () => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getForumTopics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId
      })
    });

    const data = await response.json();
    if (data.ok) {
      return data.result.topics || [];
    }
    return [];
  } catch (error) {
    console.error('Error getting forum topics:', error);
    return [];
  }
};

// Función para encontrar o crear un tema en el foro
const findOrCreateTopic = async (classificationName) => {
  const topics = await getForumTopics();
  const existingTopic = topics.find(topic => 
    topic.name.toLowerCase().includes(classificationName.toLowerCase().replace('#', ''))
  );

  if (existingTopic) {
    console.log(`Found existing topic: ${existingTopic.name}`);
    return existingTopic.message_thread_id;
  } else {
    console.log(`Creating new topic: ${classificationName}`);
    return await createTopic(classificationName);
  }
};

// Middleware to handle forwarding messages
bot.on('channel_post', async (ctx) => {
  try {
    const message = ctx.channelPost;

    // Verificar que el mensaje proviene del canal de origen
    if (message && message.chat && message.chat.id === sourceChannelId) {
      console.log(`Received a message from source channel ${sourceChannelId}`);

      // Obtener el nombre de clasificación según las nuevas reglas
      const classificationName = getClassificationName(message);

      if (classificationName) {
        console.log(`Classification name found: ${classificationName}`);

        // Check if destination is a forum
        const isForum = await isForumGroup();
        
        if (isForum) {
          // Forum logic: create/find topics
          const topicId = await findOrCreateTopic(classificationName);

          // Reenviar el mensaje al tema específico
          await ctx.telegram.copyMessage(destinationGroupId, sourceChannelId, message.message_id, {
            message_thread_id: topicId
          });

          console.log(`Message forwarded to forum topic: ${classificationName}`);
        } else {
          // Regular group logic: just forward the message
          const originalCaption = message.caption || '';
          const newCaption = originalCaption ? `${classificationName}\n\n${originalCaption}` : classificationName;
          
          await ctx.telegram.copyMessage(destinationGroupId, sourceChannelId, message.message_id, {
            caption: newCaption
          });

          console.log(`Message forwarded with classification: ${classificationName}`);
        }
      } else {
        console.log('No classification name found in the message.');
        // Reenviar sin clasificación si no se encuentra nombre
        await ctx.telegram.copyMessage(destinationGroupId, sourceChannelId, message.message_id);
      }
    } else {
      console.log('Message received, but it did not match the source channel ID.');
    }
  } catch (error) {
    console.error('Error forwarding message:', error);
  }
});

// Configurar webhook al iniciar
const setupWebhook = async () => {
  try {
    if (RENDER_EXTERNAL_URL) {
      const webhookUrl = `${RENDER_EXTERNAL_URL}/webhook/${botToken}`;
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`Webhook configured: ${webhookUrl}`);
      
      // Iniciar self-ping
      startSelfPing();
    } else {
      console.log('RENDER_EXTERNAL_URL not set, using polling instead');
      bot.launch()
        .then(() => {
          console.log('Bot is running with polling...');
          startSelfPing();
        })
        .catch(error => {
          console.error('Failed to launch bot:', error);
        });
    }
  } catch (error) {
    console.error('Error setting up webhook:', error);
  }
};

// Inicializar el bot
setupWebhook();

// Graceful stop
process.once('SIGINT', () => {
  console.log('Shutting down gracefully...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  bot.stop('SIGTERM');
  process.exit(0);
});