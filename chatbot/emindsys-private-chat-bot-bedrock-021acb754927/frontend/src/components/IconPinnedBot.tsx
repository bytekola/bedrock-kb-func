import React from 'react';
import { PiSealCheck, PiSealCheckFill } from 'react-icons/pi';
import { BaseProps } from '../@types/common';
import { isPinnedBot } from '../utils/BotUtils';

type Props = BaseProps & {
  botSharedStatus?: string;
  showAlways?: boolean;
  outlined?: boolean;
};

/**
 * Icon component that indicates a pinned bot
 * @param props.botSharedStatus Bot shared status
 * @param props.className CSS class name to apply to the icon
 * @param props.showAlways If true, always show the icon regardless of whether the bot is pinned
 * @param props.outlined If true, show the outlined version of the icon
 */
const IconPinnedBot: React.FC<Props> = ({
  botSharedStatus,
  className = '',
  showAlways = false,
  outlined = false,
}) => {
  if (!botSharedStatus && !showAlways) {
    return null;
  }
  if (botSharedStatus && !isPinnedBot(botSharedStatus) && !showAlways) {
    return null;
  }

  return outlined ? (
    <PiSealCheck className={className} />
  ) : (
    <PiSealCheckFill className={className} />
  );
};

export default IconPinnedBot;
