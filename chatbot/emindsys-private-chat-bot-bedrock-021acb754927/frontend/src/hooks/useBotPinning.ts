import { useState } from 'react';
import { UpdateBotPushedRequest } from '../@types/bot';
import useAdminApi from './useAdminApi';

const useBotPinning = () => {
  const adminApi = useAdminApi();
  const [isUpdating, setIsUpdating] = useState(false);

  /**
   * Register a bot as pinned by administrator
   */
  const pinBot = async (botId: string, order: number) => {
    setIsUpdating(true);
    try {
      const params: UpdateBotPushedRequest = {
        toPinned: true,
        order,
      };
      await adminApi.updatePinnedBot(botId, params);
      return true;
    } catch (error) {
      console.error('Failed to mark bot as essential:', error);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  /**
   * Remove pinned status from a bot
   */
  const unpinBot = async (botId: string) => {
    setIsUpdating(true);
    try {
      const params: UpdateBotPushedRequest = {
        toPinned: false,
      };
      await adminApi.updatePinnedBot(botId, params);
      return true;
    } catch (error) {
      console.error('Failed to remove essential status:', error);
      return false;
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    pinBot,
    unpinBot,
    isUpdating,
  };
};

export default useBotPinning;
