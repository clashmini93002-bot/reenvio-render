const { Telegraf } = require('telegraf');
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Access environment variables
const botToken = process.env.BOT_TOKEN;
const sourceChannelId = process.env.SOURCE_CHANNEL_ID; // ID del canal como string
const destinationGroupId = process.env.DESTINATION_GROUP_ID; // ID del grupo como string
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

const bot = new Telegraf(botToken);
const app = express();

// Cola de mensajes para procesamiento secuencial
const messageQueue = [];
let isProcessing = false;

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
  res.json({ 
    status: 'Bot is running', 
    queueLength: messageQueue.length,
    timestamp: new Date().toISOString() 
  });
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

// Procesador de cola
const processQueue = async () => {
  if (isProcessing || messageQueue.length === 0) return;
  
  isProcessing = true;
  
  while (messageQueue.length > 0) {
    const messageData = messageQueue.shift();
    try {
      await processMessage(messageData.ctx, messageData.messageType);
      console.log(`Mensaje procesado: ${messageData.messageType}`);
      
      // Esperar 1 segundo entre mensajes
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error procesando mensaje de la cola:`, error);
    }
  }
  
  isProcessing = false;
};

// Añadir mensaje a la cola
const addToQueue = (ctx, messageType) => {
  messageQueue.push({ ctx, messageType, timestamp: new Date() });
  console.log(`Mensaje añadido a la cola. Longitud: ${messageQueue.length}`);
  processQueue();
};

// Handler for /start command
bot.start((ctx) => {
  ctx.reply('¡El bot está en línea y listo para funcionar! Puedes enviarme mensajes para clasificarlos.');
  console.log('Bot started');
});

// Función para extraer nombre de archivos (antes del guion)
const extractNameFromFilename = (filename) => {
  if (!filename) return null;
  
  console.log('Extrayendo nombre de archivo:', filename);
  
  // Extraer el nombre antes del primer guion
  const match = filename.match(/^([^-]+)/);
  if (match) {
    const name = match[1].trim();
    console.log('Nombre extraído antes del guion:', name);
    
    // Limpiar espacios y caracteres especiales, mantener solo letras, números y espacios
    const cleanName = name.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    console.log('Nombre limpio:', cleanName);
    
    return cleanName || null;
  }
  
  return null;
};

// Función para extraer texto entre iconos (ejemplo: ♀️ Potato Godzilla ♀️)
const extractTextBetweenIcons = (text) => {
  if (!text) return null;
  
  console.log('Extrayendo texto entre iconos:', text);
  
  // Buscar texto entre emojis/iconos
  // Esta regex busca texto rodeado por caracteres especiales/emojis
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu;
  const words = text.split(/\s+/);
  
  // Buscar patrones como: emoji texto emoji
  for (let i = 0; i < words.length - 2; i++) {
    if (emojiRegex.test(words[i]) && !emojiRegex.test(words[i+1]) && emojiRegex.test(words[i+2])) {
      const name = words[i+1].replace(/[^a-zA-Z0-9\s]/g, '').trim();
      console.log('Texto entre iconos encontrado:', name);
      return name || null;
    }
  }
  
  // Alternativa: buscar texto que esté entre dos grupos de emojis
  const match = text.match(/([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]+)\s*([^\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]+)\s*([\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}]+)/u);
  if (match && match[2]) {
    const name = match[2].replace(/[^a-zA-Z0-9\s]/g, '').trim();
    console.log('Texto entre iconos (alternativa):', name);
    return name || null;
  }
  
  return null;
};

// Función principal de clasificación
const getClassificationName = (message) => {
  console.log('=== ANALIZANDO MENSAJE PARA CLASIFICACIÓN ===');
  
  // 1. Primero verificar documentos/archivos
  if (message.document && message.document.file_name) {
    console.log('📄 Es un documento:', message.document.file_name);
    const name = extractNameFromFilename(message.document.file_name);
    if (name) {
      console.log('✅ Nombre de archivo extraído:', name);
      return name;
    }
  }
  
  // 2. Verificar caption (para medios con texto)
  if (message.caption) {
    console.log('📝 Tiene caption:', message.caption);
    
    // Primero buscar entre iconos
    const iconText = extractTextBetweenIcons(message.caption);
    if (iconText) {
      console.log('✅ Texto entre iconos encontrado en caption:', iconText);
      return iconText;
    }
    
    // Buscar texto antes del guion en el caption
    const beforeDash = extractNameFromFilename(message.caption);
    if (beforeDash) {
      console.log('✅ Texto antes del guion en caption:', beforeDash);
      return beforeDash;
    }
  }
  
  // 3. Verificar texto plano
  if (message.text) {
    console.log('📝 Es texto plano:', message.text);
    
    // Primero buscar entre iconos
    const iconText = extractTextBetweenIcons(message.text);
    if (iconText) {
      console.log('✅ Texto entre iconos encontrado en texto:', iconText);
      return iconText;
    }
    
    // Buscar texto antes del guion
    const beforeDash = extractNameFromFilename(message.text);
    if (beforeDash) {
      console.log('✅ Texto antes del guion en texto:', beforeDash);
      return beforeDash;
    }
  }
  
  console.log('❌ No se encontró criterio de clasificación');
  return null;
};

// Function to check if chat is a forum
const isForumGroup = async () => {
  try {
    console.log('🔍 Verificando si el grupo es foro...');
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getChat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId
      })
    });

    const data = await response.json();
    console.log('📊 Resultado verificación foro:', data.ok && data.result.is_forum);
    return data.ok && data.result.is_forum === true;
  } catch (error) {
    console.error('❌ Error verificando foro:', error);
    return false;
  }
};

// Function to create a new topic
const createTopic = async (topicName) => {
  try {
    console.log(`🆕 Creando tema: ${topicName}`);
    
    const response = await fetch(`https://api.telegram.org/bot${botToken}/createForumTopic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: destinationGroupId,
        name: topicName.substring(0, 255) // Limitar longitud máxima
      })
    });

    const data = await response.json();
    console.log('📊 Respuesta creación tema:', data);
    
    if (data.ok) {
      console.log(`✅ Tema creado: ${topicName} (ID: ${data.result.message_thread_id})`);
      return data.result.message_thread_id;
    } else {
      throw new Error(data.description);
    }
  } catch (error) {
    console.error('❌ Error creando tema:', error);
    throw error;
  }
};

// Function to get existing topics
const getForumTopics = async () => {
  try {
    console.log('🔍 Obteniendo temas existentes...');
    
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
    
    if (data.ok) {
      console.log(`✅ Temas encontrados: ${data.result.topics?.length || 0}`);
      return data.result.topics || [];
    }
    
    console.log('❌ Error obteniendo temas:', data);
    return [];
  } catch (error) {
    console.error('❌ Error obteniendo temas:', error);
    return [];
  }
};

// Encontrar o crear tema
const findOrCreateTopic = async (classificationName) => {
  try {
    const topics = await getForumTopics();
    const cleanClassification = classificationName.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase();
    
    console.log(`🔍 Buscando tema: "${cleanClassification}"`);
    
    // Buscar tema existente (búsqueda flexible)
    const existingTopic = topics.find(topic => {
      const cleanTopicName = topic.name.toLowerCase();
      return cleanTopicName.includes(cleanClassification) || 
             cleanClassification.includes(cleanTopicName) ||
             cleanTopicName === cleanClassification;
    });

    if (existingTopic) {
      console.log(`✅ Tema existente encontrado: "${existingTopic.name}"`);
      return existingTopic.message_thread_id;
    } else {
      console.log(`🆕 Creando nuevo tema: "${classificationName}"`);
      return await createTopic(classificationName);
    }
  } catch (error) {
    console.error('❌ Error en findOrCreateTopic:', error);
    throw error;
  }
};

// Función principal de procesamiento de mensajes
const processMessage = async (ctx, messageType) => {
  try {
    const message = messageType === 'channel' ? ctx.channelPost : ctx.message;
    
    if (!message) {
      console.log('❌ Mensaje no válido');
      return;
    }

    console.log('=== INICIANDO PROCESAMIENTO ===');
    console.log('Tipo:', messageType);
    console.log('Chat ID:', message.chat?.id);
    console.log('Message ID:', message.message_id);

    // Verificar si es del canal origen o mensaje privado
    const isFromSourceChannel = message.chat && message.chat.id.toString() === sourceChannelId.toString();
    const isPrivateMessage = message.chat && message.chat.type === 'private';
    
    if (!isFromSourceChannel && !isPrivateMessage) {
      console.log('❌ Mensaje ignorado - no es del canal origen ni mensaje privado');
      return;
    }

    console.log('✅ Mensaje válido para procesar');

    const classificationName = getClassificationName(message);

    if (classificationName) {
      console.log(`🏷️ Clasificación encontrada: "${classificationName}"`);

      const isForum = await isForumGroup();
      console.log(`💬 Es foro: ${isForum}`);

      if (isForum) {
        // Lógica para foro
        const topicId = await findOrCreateTopic(classificationName);
        console.log(`📤 Enviando al topic ID: ${topicId}`);

        // Usar copyMessage para evitar "reenviado"
        await ctx.telegram.copyMessage(destinationGroupId, message.chat.id, message.message_id, {
          message_thread_id: topicId
        });

        console.log(`✅ Mensaje reenviado al tema: "${classificationName}"`);
        
        // Responder en privado si es mensaje directo
        if (isPrivateMessage) {
          await ctx.reply(`✅ Mensaje clasificado y enviado a: ${classificationName}`);
        }
      } else {
        // Lógica para grupo normal
        console.log('📤 Reenviando a grupo normal');
        await ctx.telegram.copyMessage(destinationGroupId, message.chat.id, message.message_id);
        
        if (isPrivateMessage) {
          await ctx.reply('✅ Mensaje enviado al grupo');
        }
      }
    } else {
      console.log('❌ Sin clasificación - reenviando normalmente');
      await ctx.telegram.copyMessage(destinationGroupId, message.chat.id, message.message_id);
      
      if (isPrivateMessage) {
        await ctx.reply('✅ Mensaje enviado sin clasificación específica');
      }
    }
    
    console.log('✅ Procesamiento completado correctamente');
    
  } catch (error) {
    console.error('❌ Error grave en processMessage:', error);
    
    // Responder error en privado si es mensaje directo
    if (ctx.message && ctx.message.chat.type === 'private') {
      await ctx.reply('❌ Error procesando el mensaje. Intenta nuevamente.');
    }
  }
};

// Middleware para mensajes del canal
bot.on('channel_post', (ctx) => {
  console.log('📨 Mensaje de canal recibido - añadiendo a cola');
  addToQueue(ctx, 'channel');
});

// Middleware para mensajes privados
bot.on('message', (ctx) => {
  // Solo procesar mensajes privados (no de grupos/canales)
  if (ctx.message && ctx.message.chat.type === 'private') {
    console.log('📨 Mensaje privado recibido - añadiendo a cola');
    addToQueue(ctx, 'private');
  }
});

// Configurar webhook
const setupWebhook = async () => {
  try {
    if (RENDER_EXTERNAL_URL) {
      const webhookUrl = `${RENDER_EXTERNAL_URL}/webhook`;
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`🌐 Webhook configurado: ${webhookUrl}`);
      startSelfPing();
    } else {
      console.log('🔧 Usando polling (modo desarrollo)');
      bot.launch().then(() => {
        console.log('🤖 Bot running with polling');
        startSelfPing();
      });
    }
  } catch (error) {
    console.error('❌ Error configurando webhook:', error);
  }
};

// Manejo de errores global
bot.catch((err, ctx) => {
  console.error('❌ Error global del bot:', err);
});

// Inicializar
setupWebhook();

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('🛑 Apagando...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('🛑 Apagando...');
  bot.stop('SIGTERM');
  process.exit(0);
});
