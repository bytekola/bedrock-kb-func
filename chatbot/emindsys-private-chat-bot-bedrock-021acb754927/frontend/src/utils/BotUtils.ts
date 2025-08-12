import { SharedScope } from '../@types/bot';
import copy from 'copy-to-clipboard';

export const getBotUrl = (botId: string) => {
  return `${window.location.origin}/bot/${botId}`;
};

export const copyBotUrl = (botId: string) => {
  copy(getBotUrl(botId));
};

/**
 * Determines if a bot is pinned by an administrator
 * @param botSharedStatus Bot shared status
 * @returns true if the bot is pinned, false otherwise
 */
export const isPinnedBot = (botSharedStatus: string): boolean => {
  return botSharedStatus.startsWith('pinned@');
};

/**
 * Gets the order of a pinned bot
 * @param botSharedStatus Bot shared status
 * @returns The numerical order of the pinned bot. Returns -1 if the bot is not pinned
 */
export const getPinOrder = (botSharedStatus: string): number => {
  if (!isPinnedBot(botSharedStatus)) {
    return -1;
  }

  const orderStr = botSharedStatus.split('@')[1];
  return parseInt(orderStr, 10);
};
/**
 * Determines if a bot can be pinned by an administrator
 * @param bot Bot metadata
 * @returns true if the bot can be pinned, false otherwise
 */
export const canBePinned = (botSharedScope: SharedScope): boolean => {
  return botSharedScope === 'all';
};
