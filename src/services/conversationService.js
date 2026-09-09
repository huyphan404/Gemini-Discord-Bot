/**
 * Core conversation logic.
 * Handles incoming messages, extracts attachments, checks limits,
 * manages typing indicators, and delegates to the streaming service.
 */

import { ChannelType } from 'discord.js';
import { client } from '../core/runtime.js';
import {
  isRequestLimitReached,
  incrementRequestCount,
  toDeleteHistoryRef,
} from '../state/botState.js';
import { getActiveSessionDetails } from './sessionService.js';
import { buildConversationContext } from './conversationContext.js';
import { streamModelResponse } from './streamingService.js';
import { processPromptAndMediaAttachments, extractFileText, getUnsupportedAttachments, hasSupportedAttachments } from './attachmentService.js';
import { addSettingsButton, attachActionButtons } from '../ui/messageActions.js';
import { TYPING_HEARTBEAT_INTERVAL_MS, YOUTUBE_URL_REGEX } from '../constants.js';
import {
  applyEmbedFallback,
  createStatusEmbed,
  canSendMessages,
  getMentionPattern,
} from '../utils/discord.js';
import { logError } from '../utils/errorHandler.js';

function extractYouTubeUrls(text) {
  const urls = [];
  let match;
  while ((match = YOUTUBE_URL_REGEX.exec(text)) !== null) {
    urls.push(match[0]);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Action Buttons Data
// ---------------------------------------------------------------------------
function messageToActionContext(message) {
  return {
    guildId: message.guild?.id,
    userId: message.author.id,
    channelId: message.channel.id,
  };
}

// ---------------------------------------------------------------------------
// Limit & Error Embeds
// ---------------------------------------------------------------------------
function createLimitReachedEmbed() {
  return createStatusEmbed({
    variant: 'error',
    title: 'Daily Limit Reached',
    description: 'The bot has reached its daily request limit.',
  });
}

function createUnsupportedWarningEmbed(unsupportedAttachments) {
  return createStatusEmbed({
    variant: 'warning',
    title: 'Unsupported Files Ignored',
    description: `Some files could not be read and were ignored:\n${unsupportedAttachments.map(a => `- \`${a.name}\``).join('\n')}`,
  });
}

function createErrorEmbed() {
  return createStatusEmbed({
    variant: 'error',
    title: 'Error',
    description: 'I encountered an error while thinking of a reply.',
  });
}

// ---------------------------------------------------------------------------
// Typing heartbeat
// ---------------------------------------------------------------------------
/** Sends periodic typing indicators until the returned cleanup function is called. */
function createTypingHeartbeat(channel) {
  let isTyping = false;
  let typingInterval = null;

  const type = async () => {
    if (isTyping) return;
    isTyping = true;
    try {
      if (canSendMessages(channel)) {
        await channel.sendTyping();
      }
    } catch (error) {
      logError('TypingIndicator', error);
    } finally {
      isTyping = false;
    }
  };

  type();
  typingInterval = setInterval(type, TYPING_HEARTBEAT_INTERVAL_MS);

  return () => {
    if (typingInterval) clearInterval(typingInterval);
  };
}

// ---------------------------------------------------------------------------
// Interaction / Response Handlers
// ---------------------------------------------------------------------------

async function sendUnsupportedAttachmentsWarning(unsupportedAttachments, message, deleteHistoryRef) {
  try {
    const warningMessage = await message.reply(applyEmbedFallback(message.channel, {
      embeds: [createUnsupportedWarningEmbed(unsupportedAttachments)],
    }));
    deleteHistoryRef.current.push(warningMessage.id);
    return warningMessage.id;
  } catch (error) {
    logError('UnsupportedWarningReply', error, { messageId: message.id });
    return null;
  }
}

async function createChatSession(message) {
  try {
    return await message.reply(applyEmbedFallback(message.channel, {
      embeds: [createStatusEmbed({
        variant: 'primary',
        title: 'Chat Session Created',
        description: 'Generating response...',
      })],
    }));
  } catch (error) {
    logError('CreateChatSession', error, { messageId: message.id });
    return null;
  }
}

async function sendErrorReply(message, processingMessage, deleteHistoryRef) {
  try {
    const embedPayload = { embeds: [createErrorEmbed()] };
    let finalMessage;

    if (processingMessage) {
      finalMessage = await processingMessage.edit(applyEmbedFallback(processingMessage.channel, embedPayload));
    } else {
      finalMessage = await message.reply(applyEmbedFallback(message.channel, embedPayload));
    }

    if (finalMessage) {
      deleteHistoryRef.current.push(finalMessage.id);
      await addSettingsButton(finalMessage);
    }
  } catch (error) {
    logError('ErrorReply', error, { messageId: message.id });
  }
}

// ---------------------------------------------------------------------------
// Main Message Handler
// ---------------------------------------------------------------------------

/**
 * Main entry point for text messages.
 * 1. Checks limits.
 * 2. Prepares message context (removing mentions, extracting text from attachments).
 * 3. Fetches history.
 * 4. Calls streaming service.
 */
export async function handleTextMessage(message) {
  if (isRequestLimitReached()) {
    const response = await message.reply(applyEmbedFallback(message.channel, { embeds: [createLimitReachedEmbed()] }));
    await attachActionButtons(response, messageToActionContext(message));
    return;
  }

  const clientUserId = client.user?.id;
  const { historyId, sessionName, instructions } = getActiveSessionDetails(message.author.id);
  const deleteHistoryRef = toDeleteHistoryRef(historyId, message.author.id);

  const mentionPattern = clientUserId ? getMentionPattern(clientUserId) : null;
  let messageContent = mentionPattern
    ? message.content.replace(mentionPattern, '').trim()
    : message.content.trim();
    
  // Strip Reimu trigger
  messageContent = messageContent.replace(/^\s*reimu(?:\s+ơi)?(?:\s*[,!:：-])?\s*/i, '').trim();

  const unsupportedAttachments = getUnsupportedAttachments(message);
  const hasYouTubeContent = extractYouTubeUrls(messageContent).length > 0;

  if (!messageContent && !hasYouTubeContent && !(message.attachments.size > 0 && hasSupportedAttachments(message))) {
    messageContent = "*(Nheo mắt)* Ngươi gọi ta có việc gì? Không cúng dường thì đừng quấy rầy giấc ngủ trưa của ta.";
  }

  const stopTyping = createTypingHeartbeat(message.channel);

  let processingMessage = null;
  let parts;
  let unsupportedWarningMessageId = null;

  try {
    const fileText = await extractFileText(message, messageContent);
    const combinedText = [messageContent, fileText].filter(Boolean).join('\n\n');

    parts = await processPromptAndMediaAttachments(combinedText, message);

    if (message.channel.type === ChannelType.DM || message.content.startsWith(`<@${clientUserId}>`)) {
      processingMessage = await createChatSession(message);
      if (processingMessage) deleteHistoryRef.current.push(processingMessage.id);
    }

    if (unsupportedAttachments.length > 0) {
      unsupportedWarningMessageId = await sendUnsupportedAttachmentsWarning(unsupportedAttachments, message, deleteHistoryRef);
    }

    incrementRequestCount();

    const currentHistory = await buildConversationContext(message, instructions);
    currentHistory.push({ role: 'user', parts });

    await streamModelResponse({
      message,
      currentHistory,
      parts,
      historyId,
      sessionName,
      deleteHistoryRef,
      processingMessage,
      unsupportedWarningMessageId,
    });
  } catch (error) {
    logError('HandleTextMessage', error, { messageId: message.id, historyId });
    await sendErrorReply(message, processingMessage, deleteHistoryRef);
  } finally {
    stopTyping();
  }
}
