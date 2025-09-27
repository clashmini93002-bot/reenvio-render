const { Telegraf } = require('telegraf');
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Access environment variables
const botToken = process.env.BOT_TOKEN;
const sourceChannelId = process.env.SOURCE_CHANNEL_ID; // Sin Number()
const destinationGroupId = process.env.DESTINATION_GROUP_ID; // Sin Number()
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(botToken);
const app = express();

// Middleware para parsear JSON
app.use(express.json());

// Webhook endpoint para Telegram
app.post(`/webhook`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

// Self-ping endpoint
app.get('/ping', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Bot is running', timestamp: new Date().toISOString() });
});

// Iniciar servidor web
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Self-ping cada 5 minutos
const startSelfPing = () => {
  setInterval(async () => {
    try {
      if (RENDER_EXTERNAL_URL) {
        const response = await fetch(`${RENDER_EXTERNAL_URL}/ping`);
        console.log(`Self-ping: ${response.status} - ${new Date().toISOString()}`);
      }
    } catch (error) {
      console.error('Error en self-ping:', error);
    }
  }, 5 * 60 * 1000);
};

// Handler for /start command
bot.start((ctx) => {
  ctx.reply('¡El bot está en línea y listo para funcionar!');
  console.log('Bot started');
});

// Función para extraer nombre de archivos (antes del guion)
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

// Función para extraer texto entre iconos (por ejemplo: ✨Texto✨)
const extractTextBetweenIcons = (text) => {
  if (!text) return null;
  
  // Buscar texto entre dos iconos idénticos (ej: ✨HaneAme✨)
  const match = text.match(/[�-🟿][^�-🟿]*[�-🟿]|[\u2600-\u26FF][^\u2600-\u26FF]*[\u2600-\u26FF]/);
  if (match) {
    const textBetweenIcons = match[0].replace(/[^a-zA-Z0-9_]/g, '');
    return textBetweenIcons ? `#${textBetweenIcons}` : null;
  }
  
  return null;
};

// Función para extraer hashtags tradicionales
const extractHashtag = (text) => {
  if (!text) return null;
  
  const hashtags = text.match(/#[a-zA-Z0-9_]+/g);
  return hashtags ? hashtags[0] : null;
};

// Función principal de clasificación
const getClassificationName = (message) => {
  console.log('Analizando mensaje para clasificación...');
  
  // 1. Primero verificar documentos/archivos
  if (message.document && message.document.file_name) {
    console.log('Es un documento:', message.document.file_name);
    const name = extractNameFromFilename(message.document.file_name);
    if (name) {
      console.log('Nombre extraído de archivo:', name);
      return name;
    }
  }
  
  // 2. Verificar caption (para medios con texto)
  if (message.caption) {
    console.log('Tiene caption:', message.caption);
    
    // Primero buscar entre iconos
    const iconText = extractTextBetweenIcons(message.caption);
    if (iconText) {
      console.log('Texto entre iconos encontrado:', iconText);
      return iconText;
    }
    
    // Luego buscar hashtags tradicionales
    const hashtag = extractHashtag(message.caption);
    if (hashtag) {
      console.log('Hashtag encontrado:', hashtag);
      return hashtag;
    }
    
    // Finalmente buscar texto antes del guion en el caption
    const beforeDash = extractNameFromFilename(message.caption);
    if (beforeDash) {
      console.log('Texto antes del guion en caption:', beforeDash);
      return beforeDash;
    }
  }
  
  // 3. Verificar texto plano
  if (message.text) {
    console.log('Es texto plano:', message.text);
    
    // Primero buscar entre iconos
    const iconText = extractTextBetweenIcons(message.text);
    if (iconText) {
      console.log('Texto entre iconos encontrado:', iconText);
      return iconText;
    }
    
    // Luego buscar hashtags tradicionales
    const hashtag = extractHashtag(message.text);
    if (hashtag) {
      console.log('Hashtag encontrado:', hashtag);
      return hashtag;
    }
  }
  
  console.log('No se encontró criterio de clasificación');
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
    console.log('Forum check result:', data);
    return data.ok && data.result.is_forum === true;
  } catch (error) {
    console.error('Error checking if group is forum:', error);
    return false;
  }
};

// Function to create a new topic
const createTopic = async (topicName) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId,
        name: topicName.replace('#', '') // Quitar # para el nombre del tema
      })
    });

    const data = await response.json();
    console.log('Create topic response:', data);
    
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

// Function to get existing topics
const getForumTopics = async () => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getForumTopics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId,
        offset: 0,
        limit: 100
      })
    });

    const data = await response.json();
    console.log('Get topics response:', data);
    
    if (data.ok) {
      return data.result.topics || [];
    }
    return [];
  } catch (error) {
    console.error('Error getting forum topics:', error);
    return [];
  }
};

// Encontrar o crear tema
const findOrCreateTopic = async (classificationName) => {
  try {
    const topics = await getForumTopics();
    const cleanClassification = classificationName.replace('#', '').toLowerCase();
    
    console.log(`Buscando tema: ${cleanClassification}`);
    console.log('Topics disponibles:', topics.map(t => ({name: t.name, id: t.message_thread_id})));
    
    const existingTopic = topics.find(topic => 
      topic.name.toLowerCase().includes(cleanClassification) ||
      cleanClassification.includes(topic.name.toLowerCase())
    );

    if (existingTopic) {
      console.log(`Tema existente encontrado: ${existingTopic.name} (ID: ${existingTopic.message_thread_id})`);
      return existingTopic.message_thread_id;
    } else {
      console.log(`Creando nuevo tema: ${classificationName}`);
      return await createTopic(classificationName);
    }
  } catch (error) {
    console.error('Error en findOrCreateTopic:', error);
    throw error;
  }
};

// Middleware para mensajes del canal
bot.on('channel_post', async (ctx) => {
  try {
    const message = ctx.channelPost;
    console.log('Mensaje recibido:', {
      chatId: message?.chat?.id,
      messageId: message?.message_id,
      hasText: !!message?.text,
      hasCaption: !!message?.caption,
      hasDocument: !!message?.document
    });

    // Verificar origen del mensaje (como string para evitar problemas de tipo)
    if (message && message.chat && message.chat.id.toString() === sourceChannelId.toString()) {
      console.log('Mensaje confirmado del canal origen');

      const classificationName = getClassificationName(message);

      if (classificationName) {
        console.log(`Clasificación: ${classificationName}`);

        const isForum = await isForumGroup();
        console.log(`Es foro: ${isForum}`);

        if (isForum) {
          // Lógica para foro
          const topicId = await findOrCreateTopic(classificationName);
          console.log(`Enviando al topic ID: ${topicId}`);

          await ctx.telegram.copyMessage(destinationGroupId, sourceChannelId, message.message_id, {
            message_thread_id: topicId
          });

          console.log(`Mensaje reenviado al tema: ${classificationName}`);
        } else {
          // Lógica para grupo normal
          console.log('Reenviando a grupo normal');
          await ctx.telegram.forwardMessage(destinationGroupId, sourceChannelId, message.message_id);
        }
      } else {
        console.log('Sin clasificación - reenviando normalmente');
        await ctx.telegram.forwardMessage(destinationGroupId, sourceChannelId, message.message_id);
      }
    } else {
      console.log('Mensaje ignorado - no es del canal origen');
    }
  } catch (error) {
    console.error('Error grave:', error);
  }
});

// Configurar webhook
const setupWebhook = async () => {
  try {
    if (RENDER_EXTERNAL_URL) {
      const webhookUrl = `${RENDER_EXTERNAL_URL}/webhook`;
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`Webhook configurado: ${webhookUrl}`);
      startSelfPing();
    } else {
      console.log('Usando polling (modo desarrollo)');
      bot.launch().then(() => {
        console.log('Bot running with polling');
        startSelfPing();
      });
    }
  } catch (error) {
    console.error('Error configurando webhook:', error);
  }
};

// Manejo de errores global
bot.catch((err, ctx) => {
  console.error('Error global del bot:', err);
});

// Inicializar
setupWebhook();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('Apagando...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('Apagando...');
  bot.stop('SIGTERM');
  process.exit(0);
});
